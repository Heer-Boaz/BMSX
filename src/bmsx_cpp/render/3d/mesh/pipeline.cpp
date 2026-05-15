#include "render/3d/mesh/pipeline.h"

#if BMSX_ENABLE_GLES2
#include "core/console.h"
#include "machine/devices/vdp/fixed_point.h"
#include "render/3d/shaders/render_3d_shaders.h"
#include "render/backend/gles2_backend.h"
#include "render/gameview.h"
#include "rompack/assets.h"
#include "rompack/loader.h"
#include "rompack/tokens.h"

#include <GLES2/gl2.h>
#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace bmsx {
namespace {

constexpr i32 MESH_TEXTURE_UNIT = 0;
constexpr size_t MESH_JOINT_LIMIT = VDP_JTU_MATRIX_COUNT;
constexpr size_t MESH_MORPH_LIMIT = VDP_MDU_MORPH_WEIGHT_LIMIT;

struct MeshGLES2Vertex {
	f32 x = 0.0f;
	f32 y = 0.0f;
	f32 z = 0.0f;
	f32 u = 0.0f;
	f32 v = 0.0f;
	f32 r = 1.0f;
	f32 g = 1.0f;
	f32 b = 1.0f;
	f32 a = 1.0f;
};

struct MeshGLES2Runtime {
	GLuint program = 0u;
	GLint attribPosition = -1;
	GLint attribUv = -1;
	GLint attribColor = -1;
	GLint uniformModel = -1;
	GLint uniformViewProjection = -1;
	GLint uniformTexture = -1;
	GLint uniformUseTexture = -1;
	GLuint vertexBuffer = 0u;
	std::array<MeshGLES2Vertex, VDP_MDU_VERTEX_LIMIT> vertices{};
	size_t vertexCount = 0u;
	std::array<Render3D::Mat4, MESH_JOINT_LIMIT> jointMatrices{};
	std::array<f32, MESH_MORPH_LIMIT> morphWeights{};
	Render3D::Mat4 modelMatrix{};
};

MeshGLES2Runtime g_mesh{};

void decodeMatrixWordsInto(Render3D::Mat4& target, const u32* words) {
	for (size_t index = 0u; index < VDP_XF_MATRIX_WORDS; ++index) {
		target[index] = decodeSignedQ16_16(words[index]);
	}
}

void transformPointAffineInto(Vec3& out, const Render3D::Mat4& m, f32 x, f32 y, f32 z) {
	out.x = m[0] * x + m[4] * y + m[8] * z + m[12];
	out.y = m[1] * x + m[5] * y + m[9] * z + m[13];
	out.z = m[2] * x + m[6] * y + m[10] * z + m[14];
}

AssetToken meshAssetToken(const GameView::VdpMeshRenderEntry& entry) {
	return makeAssetToken(entry.modelTokenLo, entry.modelTokenHi);
}

const ModelAsset& resolveMeshModel(const RuntimeRomPackage& rom, const GameView::VdpMeshRenderEntry& entry) {
	const auto it = rom.model.find(meshAssetToken(entry));
	if (it == rom.model.end()) {
		throw BMSX_RUNTIME_ERROR("[MeshPipeline] VDP mesh packet references a model token that is not in the active ROM.");
	}
	return it->second;
}

const ModelMesh& resolveMeshPrimitive(const ModelAsset& model, const GameView::VdpMeshRenderEntry& entry) {
	if (entry.meshIndex >= model.meshes.size()) {
		throw BMSX_RUNTIME_ERROR("[MeshPipeline] VDP mesh packet references a mesh index outside the model.");
	}
	return model.meshes[entry.meshIndex];
}

std::array<f32, 4> packetColorAsLinear(u32 color) {
	return {
		static_cast<f32>((color >> 16u) & 0xffu) / 255.0f,
		static_cast<f32>((color >> 8u) & 0xffu) / 255.0f,
		static_cast<f32>(color & 0xffu) / 255.0f,
		static_cast<f32>((color >> 24u) & 0xffu) / 255.0f,
	};
}

std::array<f32, 4> meshBaseColor(const ModelAsset& model, const ModelMesh& mesh, const GameView::VdpMeshRenderEntry& entry) {
	std::array<f32, 4> color = packetColorAsLinear(entry.color);
	u32 materialIndex = entry.materialIndex;
	if (materialIndex == VDP_MDU_MATERIAL_MESH_DEFAULT && mesh.materialIndex.has_value()) {
		materialIndex = static_cast<u32>(*mesh.materialIndex);
	}
	if (materialIndex != VDP_MDU_MATERIAL_MESH_DEFAULT && materialIndex >= model.materials.size()) {
		throw BMSX_RUNTIME_ERROR("[MeshPipeline] VDP mesh packet references a material index outside the model.");
	}
	if (materialIndex < model.materials.size()) {
		const ModelMaterial& material = model.materials[materialIndex];
		if (material.baseColorFactor.has_value()) {
			const auto& factor = *material.baseColorFactor;
			color[0] *= factor[0];
			color[1] *= factor[1];
			color[2] *= factor[2];
			color[3] *= factor[3];
		}
	}
	return color;
}

TextureHandle textureForMeshEntry(const MeshPipelineState& state, const GameView::VdpMeshRenderEntry& entry) {
	const u32 slot = (entry.control & VDP_MDU_CONTROL_TEXTURE_SLOT_MASK) >> VDP_MDU_CONTROL_TEXTURE_SLOT_SHIFT;
	switch (slot) {
		case VDP_SLOT_PRIMARY: return state.textpagePrimaryTex;
		case VDP_SLOT_SECONDARY: return state.textpageSecondaryTex;
		case VDP_SLOT_SYSTEM: return state.systemSlotTex;
	}
	throw BMSX_RUNTIME_ERROR("[MeshPipeline] VDP mesh packet selected a texture slot outside the VDP slot set.");
}

size_t meshMorphTargetCount(const ModelMesh& mesh, const GameView::VdpMeshRenderEntry& entry) {
	size_t morphCount = entry.morphCount;
	if (morphCount > mesh.morphPositions.size()) {
		morphCount = mesh.morphPositions.size();
	}
	return morphCount;
}

bool meshHasSkinningSource(const ModelMesh& mesh, const GameView::VdpMeshRenderEntry& entry) {
	const size_t influenceCount = (mesh.positions.size() / 3u) * 4u;
	return entry.jointCount != 0u && mesh.jointIndices.size() >= influenceCount && mesh.jointWeights.size() >= influenceCount;
}

void decodeMorphWeights(MeshGLES2Runtime& runtime, const GameView& view, const GameView::VdpMeshRenderEntry& entry, size_t morphCount) {
	for (size_t index = 0u; index < morphCount; ++index) {
		runtime.morphWeights[index] = decodeSignedQ16_16(view.vdpMorphWeightWords[entry.morphBase + index]);
	}
}

void decodeJointMatrices(MeshGLES2Runtime& runtime, const GameView& view, const GameView::VdpMeshRenderEntry& entry) {
	for (u32 index = 0u; index < entry.jointCount; ++index) {
		decodeMatrixWordsInto(runtime.jointMatrices[index], view.vdpJointMatrixWords.data() + static_cast<size_t>((entry.jointBase + index) * VDP_JTU_MATRIX_WORDS));
	}
}

void acceptMeshVertexStream(size_t outputVertexCount) {
	if (outputVertexCount > VDP_MDU_VERTEX_LIMIT) {
		throw BMSX_RUNTIME_ERROR("[MeshPipeline] VDP mesh packet expands beyond the MDU vertex stream limit.");
	}
}

void writeSkinnedPositionInto(Vec3& out, const MeshGLES2Runtime& runtime, const ModelMesh& mesh, size_t vertexIndex, f32 x, f32 y, f32 z, u32 jointCount) {
	const size_t influenceBase = vertexIndex * 4u;
	Vec3 weighted{};
	Vec3 transformed{};
	for (size_t influence = 0u; influence < 4u; ++influence) {
		const u16 joint = mesh.jointIndices[influenceBase + influence];
		if (joint < jointCount) {
			transformPointAffineInto(transformed, runtime.jointMatrices[joint], x, y, z);
		} else {
			transformed.x = x;
			transformed.y = y;
			transformed.z = z;
		}
		const f32 weight = mesh.jointWeights[influenceBase + influence];
		weighted.x += transformed.x * weight;
		weighted.y += transformed.y * weight;
		weighted.z += transformed.z * weight;
	}
	out = weighted;
}

void writeMeshVertex(MeshGLES2Vertex& target,
					const MeshGLES2Runtime& runtime,
					const ModelMesh& mesh,
					size_t vertexIndex,
					size_t morphCount,
					bool skinningEnabled,
					u32 jointCount,
					const std::array<f32, 4>& baseColor) {
	const size_t positionBase = vertexIndex * 3u;
	f32 x = mesh.positions[positionBase];
	f32 y = mesh.positions[positionBase + 1u];
	f32 z = mesh.positions[positionBase + 2u];
	for (u32 morphIndex = 0u; morphIndex < morphCount; ++morphIndex) {
		const std::vector<f32>& morph = mesh.morphPositions[morphIndex];
		const f32 weight = runtime.morphWeights[morphIndex];
		x += morph[positionBase] * weight;
		y += morph[positionBase + 1u] * weight;
		z += morph[positionBase + 2u] * weight;
	}
	if (skinningEnabled) {
		Vec3 skinned{};
		writeSkinnedPositionInto(skinned, runtime, mesh, vertexIndex, x, y, z, jointCount);
		x = skinned.x;
		y = skinned.y;
		z = skinned.z;
	}
	const size_t uvBase = vertexIndex * 2u;
	const bool hasTexcoord = uvBase + 1u < mesh.texcoords.size();
	const size_t colorBase = vertexIndex * 4u;
	const bool hasColor = colorBase + 3u < mesh.colors.size();
	target.x = x;
	target.y = y;
	target.z = z;
	target.u = hasTexcoord ? mesh.texcoords[uvBase] : 0.0f;
	target.v = hasTexcoord ? mesh.texcoords[uvBase + 1u] : 0.0f;
	target.r = hasColor ? mesh.colors[colorBase] * baseColor[0] : baseColor[0];
	target.g = hasColor ? mesh.colors[colorBase + 1u] * baseColor[1] : baseColor[1];
	target.b = hasColor ? mesh.colors[colorBase + 2u] * baseColor[2] : baseColor[2];
	target.a = hasColor ? mesh.colors[colorBase + 3u] * baseColor[3] : baseColor[3];
}

void buildMeshVertices(MeshGLES2Runtime& runtime, const GameView& view, const ModelAsset& model, const ModelMesh& mesh, const GameView::VdpMeshRenderEntry& entry) {
	decodeMatrixWordsInto(runtime.modelMatrix, view.vdpXfMatrixWords.data() + static_cast<size_t>(entry.modelMatrixIndex * VDP_XF_MATRIX_WORDS));
	const std::array<f32, 4> baseColor = meshBaseColor(model, mesh, entry);
	const size_t outputVertexCount = mesh.indices.empty() ? mesh.positions.size() / 3u : mesh.indices.size();
	acceptMeshVertexStream(outputVertexCount);
	const size_t morphCount = meshMorphTargetCount(mesh, entry);
	decodeMorphWeights(runtime, view, entry, morphCount);
	decodeJointMatrices(runtime, view, entry);
	const bool skinningEnabled = meshHasSkinningSource(mesh, entry);
	runtime.vertexCount = outputVertexCount;
	if (mesh.indices.empty()) {
		for (size_t index = 0u; index < outputVertexCount; ++index) {
			writeMeshVertex(runtime.vertices[index], runtime, mesh, index, morphCount, skinningEnabled, entry.jointCount, baseColor);
		}
		return;
	}
	for (size_t index = 0u; index < outputVertexCount; ++index) {
		writeMeshVertex(runtime.vertices[index], runtime, mesh, mesh.indices[index], morphCount, skinningEnabled, entry.jointCount, baseColor);
	}
}

MeshPipelineState buildMeshPipelineState(const RenderPassDef::RenderGraphPassContext& ctx) {
	MeshPipelineState state;
	state.width = static_cast<i32>(ctx.view->offscreenCanvasSize.x);
	state.height = static_cast<i32>(ctx.view->offscreenCanvasSize.y);
	state.viewProj = ctx.view->vdpTransform.viewProj;
	state.textpagePrimaryTex = ctx.view->textures.at(VDP_PRIMARY_SLOT_TEXTURE_KEY);
	state.textpageSecondaryTex = ctx.view->textures.at(VDP_SECONDARY_SLOT_TEXTURE_KEY);
	state.systemSlotTex = ctx.view->textures.at(SYSTEM_SLOT_TEXTURE_KEY);
	return state;
}

} // namespace

void initMeshPipeline(OpenGLES2Backend& backend) {
	g_mesh.program = backend.buildProgram(kRender3DMeshVertexShader, kRender3DMeshFragmentShader, "mesh");
	g_mesh.attribPosition = glGetAttribLocation(g_mesh.program, "a_position");
	g_mesh.attribUv = glGetAttribLocation(g_mesh.program, "a_uv");
	g_mesh.attribColor = glGetAttribLocation(g_mesh.program, "a_color");
	g_mesh.uniformModel = glGetUniformLocation(g_mesh.program, "u_model");
	g_mesh.uniformViewProjection = glGetUniformLocation(g_mesh.program, "u_viewProjection");
	g_mesh.uniformTexture = glGetUniformLocation(g_mesh.program, "u_texture");
	g_mesh.uniformUseTexture = glGetUniformLocation(g_mesh.program, "u_useTexture");
	glGenBuffers(1, &g_mesh.vertexBuffer);
	glUseProgram(g_mesh.program);
	glUniform1i(g_mesh.uniformTexture, MESH_TEXTURE_UNIT);
}

void renderMeshBatch(MeshRuntime& runtime, void* framebuffer, const MeshPipelineState& pipelineState) {
	OpenGLES2Backend& backend = runtime.backend;
	GameView& view = runtime.context;
	if (view.vdpMeshCount == 0u) {
		return;
	}
	auto& state = g_mesh;
	backend.setRenderTarget(static_cast<GLuint>(reinterpret_cast<uintptr_t>(framebuffer)), pipelineState.width, pipelineState.height);
	glUseProgram(state.program);
	glUniformMatrix4fv(state.uniformViewProjection, 1, GL_FALSE, pipelineState.viewProj.data());
	glEnable(GL_DEPTH_TEST);
	glDepthMask(GL_TRUE);
	glDisable(GL_BLEND);
	glBindBuffer(GL_ARRAY_BUFFER, state.vertexBuffer);
	glEnableVertexAttribArray(static_cast<GLuint>(state.attribPosition));
	glEnableVertexAttribArray(static_cast<GLuint>(state.attribUv));
	glEnableVertexAttribArray(static_cast<GLuint>(state.attribColor));
	glVertexAttribPointer(state.attribPosition, 3, GL_FLOAT, GL_FALSE, sizeof(MeshGLES2Vertex), reinterpret_cast<const void*>(offsetof(MeshGLES2Vertex, x)));
	glVertexAttribPointer(state.attribUv, 2, GL_FLOAT, GL_FALSE, sizeof(MeshGLES2Vertex), reinterpret_cast<const void*>(offsetof(MeshGLES2Vertex, u)));
	glVertexAttribPointer(state.attribColor, 4, GL_FLOAT, GL_FALSE, sizeof(MeshGLES2Vertex), reinterpret_cast<const void*>(offsetof(MeshGLES2Vertex, r)));
	const RuntimeRomPackage& rom = ConsoleCore::instance().activeRom();
	for (size_t index = 0u; index < view.vdpMeshCount; ++index) {
		const GameView::VdpMeshRenderEntry& submission = view.vdpMeshes[index];
		const ModelAsset& model = resolveMeshModel(rom, submission);
		const ModelMesh& mesh = resolveMeshPrimitive(model, submission);
		buildMeshVertices(state, view, model, mesh, submission);
		glUniformMatrix4fv(state.uniformModel, 1, GL_FALSE, state.modelMatrix.data());
		const bool useTexture = (submission.control & VDP_MDU_CONTROL_TEXTURE_ENABLE) != 0u;
		glUniform1i(state.uniformUseTexture, useTexture ? 1 : 0);
		if (useTexture) {
			backend.setActiveTextureUnit(MESH_TEXTURE_UNIT);
			backend.bindTexture2D(textureForMeshEntry(pipelineState, submission));
		}
		glBufferData(
			GL_ARRAY_BUFFER,
			static_cast<GLsizeiptr>(state.vertexCount * sizeof(MeshGLES2Vertex)),
			state.vertices.data(),
			GL_STREAM_DRAW
		);
		glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(state.vertexCount));
	}
	state.vertexCount = 0u;
}

void registerMeshPass_GLES2(RenderPassLibrary& registry) {
	RenderPassDef desc;
	desc.id = "mesh";
	desc.name = "Mesh";
	desc.graph = RenderPassDef::RenderPassGraphDef{};
	desc.graph->writes = { RenderPassDef::RenderGraphSlot::FrameColor, RenderPassDef::RenderGraphSlot::FrameDepth };
	desc.writesDepth = true;
	desc.depthTest = true;
	desc.bootstrap = [](GPUBackend* backend) {
		initMeshPipeline(*static_cast<OpenGLES2Backend*>(backend));
	};
	desc.graph->buildState = [](const RenderPassDef::RenderGraphPassContext& ctx) -> std::any {
		return buildMeshPipelineState(ctx);
	};
	desc.shouldExecute = []() {
		return ConsoleCore::instance().view()->vdpMeshCount > 0u;
	};
	desc.exec = [](GPUBackend* backend, void* framebuffer, std::any& state) {
		MeshRuntime runtime{*static_cast<OpenGLES2Backend*>(backend), *ConsoleCore::instance().view()};
		renderMeshBatch(runtime, framebuffer, std::any_cast<MeshPipelineState&>(state));
	};
	registry.registerPass(desc);
}

} // namespace bmsx
#endif
