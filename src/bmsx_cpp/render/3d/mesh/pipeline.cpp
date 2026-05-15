#include "render/3d/mesh/pipeline.h"

#if BMSX_ENABLE_GLES2
#include "core/console.h"
#include "machine/runtime/runtime.h"
#include "render/3d/mesh/rom_source.h"
#include "render/3d/mesh/vertex_stream.h"
#include "render/3d/shaders/render_3d_shaders.h"
#include "render/backend/gles2_backend.h"
#include "render/gameview.h"

#include <GLES2/gl2.h>
#include <cstddef>
#include <cstdint>

namespace bmsx {
namespace {

constexpr i32 MESH_TEXTURE_UNIT = 0;

struct MeshGLES2Program {
	GLuint id = 0u;
	GLint attribPosition = -1;
	GLint attribNormal = -1;
	GLint attribUv = -1;
	GLint attribColor = -1;
	GLint uniformModel = -1;
	GLint uniformNormalMatrix = -1;
	GLint uniformViewProjection = -1;
	GLint uniformCameraPosition = -1;
	GLint uniformTexture = -1;
	GLint uniformUseTexture = -1;
	GLint uniformAmbientColorIntensity = -1;
	GLint uniformDirectionalLightCount = -1;
	GLint uniformDirectionalLightDirections = -1;
	GLint uniformDirectionalLightColorIntensities = -1;
	GLint uniformPointLightCount = -1;
	GLint uniformPointLightPositionRanges = -1;
	GLint uniformPointLightColorIntensities = -1;
	GLint uniformSurface = -1;
	GLint uniformAlphaCutoff = -1;
	GLint uniformMetallicFactor = -1;
	GLint uniformRoughnessFactor = -1;
	GLint uniformEmissiveFactor = -1;
	GLint uniformDoubleSided = -1;
	GLint uniformUnlit = -1;
	GLuint vertexBuffer = 0u;
	MeshVertexStreamBuilder vertexStream;
};

MeshGLES2Program g_mesh{};

TextureHandle textureForMeshEntry(const MeshPipelineState& state, const GameView::VdpMeshRenderEntry& entry) {
	const u32 slot = (entry.control & VDP_MDU_CONTROL_TEXTURE_SLOT_MASK) >> VDP_MDU_CONTROL_TEXTURE_SLOT_SHIFT;
	switch (slot) {
		case VDP_SLOT_PRIMARY: return state.textpagePrimaryTex;
		case VDP_SLOT_SECONDARY: return state.textpageSecondaryTex;
		case VDP_SLOT_SYSTEM: return state.systemSlotTex;
	}
	throw BMSX_RUNTIME_ERROR("[MeshPipeline] VDP mesh packet selected a texture slot outside the VDP slot set.");
}

void setupMeshProgramLocations(MeshGLES2Program& program) {
	program.attribPosition = glGetAttribLocation(program.id, "a_position");
	program.attribNormal = glGetAttribLocation(program.id, "a_normal");
	program.attribUv = glGetAttribLocation(program.id, "a_uv");
	program.attribColor = glGetAttribLocation(program.id, "a_color");
	program.uniformModel = glGetUniformLocation(program.id, "u_model");
	program.uniformNormalMatrix = glGetUniformLocation(program.id, "u_normalMatrix");
	program.uniformViewProjection = glGetUniformLocation(program.id, "u_viewProjection");
	program.uniformCameraPosition = glGetUniformLocation(program.id, "u_cameraPosition");
	program.uniformTexture = glGetUniformLocation(program.id, "u_texture");
	program.uniformUseTexture = glGetUniformLocation(program.id, "u_useTexture");
	program.uniformAmbientColorIntensity = glGetUniformLocation(program.id, "u_ambient_color_intensity");
	program.uniformDirectionalLightCount = glGetUniformLocation(program.id, "u_numDirLights");
	program.uniformDirectionalLightDirections = glGetUniformLocation(program.id, "u_dirLightDirection[0]");
	program.uniformDirectionalLightColorIntensities = glGetUniformLocation(program.id, "u_dirLightColorIntensity[0]");
	program.uniformPointLightCount = glGetUniformLocation(program.id, "u_numPointLights");
	program.uniformPointLightPositionRanges = glGetUniformLocation(program.id, "u_pointLightPositionRange[0]");
	program.uniformPointLightColorIntensities = glGetUniformLocation(program.id, "u_pointLightColorIntensity[0]");
	program.uniformSurface = glGetUniformLocation(program.id, "u_surface");
	program.uniformAlphaCutoff = glGetUniformLocation(program.id, "u_alphaCutoff");
	program.uniformMetallicFactor = glGetUniformLocation(program.id, "u_metallicFactor");
	program.uniformRoughnessFactor = glGetUniformLocation(program.id, "u_roughnessFactor");
	program.uniformEmissiveFactor = glGetUniformLocation(program.id, "u_emissiveFactor");
	program.uniformDoubleSided = glGetUniformLocation(program.id, "u_doubleSided");
	program.uniformUnlit = glGetUniformLocation(program.id, "u_unlit");
	glGenBuffers(1, &program.vertexBuffer);
	glUseProgram(program.id);
	glUniform1i(program.uniformTexture, MESH_TEXTURE_UNIT);
}

void bindMeshVertexLayout(const MeshGLES2Program& program) {
	glBindBuffer(GL_ARRAY_BUFFER, program.vertexBuffer);
	glEnableVertexAttribArray(static_cast<GLuint>(program.attribPosition));
	glEnableVertexAttribArray(static_cast<GLuint>(program.attribNormal));
	glEnableVertexAttribArray(static_cast<GLuint>(program.attribUv));
	glEnableVertexAttribArray(static_cast<GLuint>(program.attribColor));
	glVertexAttribPointer(program.attribPosition, 3, GL_FLOAT, GL_FALSE, sizeof(MeshGLES2Vertex), reinterpret_cast<const void*>(offsetof(MeshGLES2Vertex, x)));
	glVertexAttribPointer(program.attribNormal, 3, GL_FLOAT, GL_FALSE, sizeof(MeshGLES2Vertex), reinterpret_cast<const void*>(offsetof(MeshGLES2Vertex, nx)));
	glVertexAttribPointer(program.attribUv, 2, GL_FLOAT, GL_FALSE, sizeof(MeshGLES2Vertex), reinterpret_cast<const void*>(offsetof(MeshGLES2Vertex, u)));
	glVertexAttribPointer(program.attribColor, 4, GL_FLOAT, GL_FALSE, sizeof(MeshGLES2Vertex), reinterpret_cast<const void*>(offsetof(MeshGLES2Vertex, r)));
}

void uploadMeshFrameUniforms(const MeshGLES2Program& program, const MeshPipelineState& state) {
	glUniformMatrix4fv(program.uniformViewProjection, 1, GL_FALSE, state.viewProj.data());
	glUniform3fv(program.uniformCameraPosition, 1, state.cameraPosition.data());
	glUniform4fv(program.uniformAmbientColorIntensity, 1, state.ambientColorIntensity.data());
	glUniform1i(program.uniformDirectionalLightCount, state.directionalLightCount);
	glUniform4fv(program.uniformDirectionalLightDirections, static_cast<GLsizei>(RENDER_MAX_DIRECTIONAL_LIGHTS), state.directionalLightDirections.data());
	glUniform4fv(program.uniformDirectionalLightColorIntensities, static_cast<GLsizei>(RENDER_MAX_DIRECTIONAL_LIGHTS), state.directionalLightColorIntensities.data());
	glUniform1i(program.uniformPointLightCount, state.pointLightCount);
	glUniform4fv(program.uniformPointLightPositionRanges, static_cast<GLsizei>(RENDER_MAX_POINT_LIGHTS), state.pointLightPositionRanges.data());
	glUniform4fv(program.uniformPointLightColorIntensities, static_cast<GLsizei>(RENDER_MAX_POINT_LIGHTS), state.pointLightColorIntensities.data());
}

void setupMeshDrawState(OpenGLES2Backend& backend, void* framebuffer, MeshGLES2Program& program, const MeshPipelineState& state) {
	backend.setRenderTarget(static_cast<GLuint>(reinterpret_cast<uintptr_t>(framebuffer)), state.width, state.height);
	glUseProgram(program.id);
	uploadMeshFrameUniforms(program, state);
	glEnable(GL_DEPTH_TEST);
	glDepthMask(GL_TRUE);
	glDisable(GL_BLEND);
	bindMeshVertexLayout(program);
}

void applyMeshMaterialDrawState(const MeshGLES2Program& program, const MeshGLES2DrawMaterial& material) {
	glUniform1i(program.uniformSurface, material.surface);
	glUniform1f(program.uniformAlphaCutoff, material.alphaCutoff);
	glUniform1f(program.uniformMetallicFactor, material.metallicFactor);
	glUniform1f(program.uniformRoughnessFactor, material.roughnessFactor);
	glUniform3fv(program.uniformEmissiveFactor, 1, material.emissiveFactor.data());
	glUniform1i(program.uniformDoubleSided, material.doubleSided ? 1 : 0);
	glUniform1i(program.uniformUnlit, material.unlit ? 1 : 0);
	if (material.doubleSided) {
		glDisable(GL_CULL_FACE);
	} else {
		glEnable(GL_CULL_FACE);
		glCullFace(GL_BACK);
	}
	if (material.surface == MESH_GLES2_SURFACE_BLEND) {
		glEnable(GL_BLEND);
		glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
		glDepthMask(GL_FALSE);
	} else {
		glDisable(GL_BLEND);
		glDepthMask(GL_TRUE);
	}
}

void uploadMeshDrawStream(const MeshGLES2Program& program, const MeshGLES2DrawStream& stream) {
	glUniformMatrix4fv(program.uniformModel, 1, GL_FALSE, stream.modelMatrix->data());
	glUniformMatrix3fv(program.uniformNormalMatrix, 1, GL_FALSE, stream.normalMatrix->data());
	glBufferData(
		GL_ARRAY_BUFFER,
		static_cast<GLsizeiptr>(stream.vertexCount * sizeof(MeshGLES2Vertex)),
		stream.vertices,
		GL_STREAM_DRAW
	);
	glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(stream.vertexCount));
}

void writeAmbientState(MeshPipelineState& state, const LightingFrameState& lighting) {
	if (lighting.ambient.has_value()) {
		state.ambientColorIntensity = {
			lighting.ambient->color[0],
			lighting.ambient->color[1],
			lighting.ambient->color[2],
			lighting.ambient->intensity,
		};
	}
}

void writeDirectionalLightState(MeshPipelineState& state, const LightingFrameState& lighting) {
	state.directionalLightCount = lighting.dirCount;
	for (i32 index = 0; index < lighting.dirCount; ++index) {
		const DirectionalLight& light = lighting.directional[static_cast<size_t>(index)];
		const size_t base = static_cast<size_t>(index) * 4u;
		state.directionalLightDirections[base] = light.orientation[0];
		state.directionalLightDirections[base + 1u] = light.orientation[1];
		state.directionalLightDirections[base + 2u] = light.orientation[2];
		state.directionalLightDirections[base + 3u] = 0.0f;
		state.directionalLightColorIntensities[base] = light.color[0];
		state.directionalLightColorIntensities[base + 1u] = light.color[1];
		state.directionalLightColorIntensities[base + 2u] = light.color[2];
		state.directionalLightColorIntensities[base + 3u] = light.intensity;
	}
}

void writePointLightState(MeshPipelineState& state, const LightingFrameState& lighting) {
	state.pointLightCount = lighting.pointCount;
	for (i32 index = 0; index < lighting.pointCount; ++index) {
		const PointLight& light = lighting.point[static_cast<size_t>(index)];
		const size_t base = static_cast<size_t>(index) * 4u;
		state.pointLightPositionRanges[base] = light.pos.x;
		state.pointLightPositionRanges[base + 1u] = light.pos.y;
		state.pointLightPositionRanges[base + 2u] = light.pos.z;
		state.pointLightPositionRanges[base + 3u] = light.range;
		state.pointLightColorIntensities[base] = light.color[0];
		state.pointLightColorIntensities[base + 1u] = light.color[1];
		state.pointLightColorIntensities[base + 2u] = light.color[2];
		state.pointLightColorIntensities[base + 3u] = light.intensity;
	}
}

MeshPipelineState buildMeshPipelineState(const RenderPassDef::RenderGraphPassContext& ctx, const FrameSharedState& frameShared) {
	MeshPipelineState state;
	state.width = static_cast<i32>(ctx.view->offscreenCanvasSize.x);
	state.height = static_cast<i32>(ctx.view->offscreenCanvasSize.y);
	state.viewProj = ctx.view->vdpTransform.viewProj;
	state.cameraPosition = frameShared.view.camPos;
	state.textpagePrimaryTex = ctx.view->textures.at(VDP_PRIMARY_SLOT_TEXTURE_KEY);
	state.textpageSecondaryTex = ctx.view->textures.at(VDP_SECONDARY_SLOT_TEXTURE_KEY);
	state.systemSlotTex = ctx.view->textures.at(SYSTEM_SLOT_TEXTURE_KEY);
	writeAmbientState(state, frameShared.lighting);
	writeDirectionalLightState(state, frameShared.lighting);
	writePointLightState(state, frameShared.lighting);
	return state;
}

} // namespace

void initMeshPipeline(OpenGLES2Backend& backend) {
	g_mesh.id = backend.buildProgram(kRender3DMeshVertexShader, kRender3DMeshFragmentShader, "mesh");
	setupMeshProgramLocations(g_mesh);
}

void renderMeshBatch(const MeshRuntime& runtime, void* framebuffer, const MeshPipelineState& pipelineState) {
	OpenGLES2Backend& backend = runtime.backend;
	const GameView& view = runtime.context;
	if (view.vdpMeshCount == 0u) {
		return;
	}
	MeshGLES2Program& program = g_mesh;
	setupMeshDrawState(backend, framebuffer, program, pipelineState);
	for (size_t index = 0u; index < view.vdpMeshCount; ++index) {
		const GameView::VdpMeshRenderEntry& submission = view.vdpMeshes[index];
		const MeshRomDrawSource source = resolveMeshRomDrawSource(runtime.rom, submission);
		const MeshGLES2DrawStream stream = program.vertexStream.build(view, source.model, source.mesh, submission);
		const bool useTexture = (submission.control & VDP_MDU_CONTROL_TEXTURE_ENABLE) != 0u;
		glUniform1i(program.uniformUseTexture, useTexture ? 1 : 0);
		applyMeshMaterialDrawState(program, stream.material);
		if (useTexture) {
			backend.setActiveTextureUnit(MESH_TEXTURE_UNIT);
			backend.bindTexture2D(textureForMeshEntry(pipelineState, submission));
		}
		uploadMeshDrawStream(program, stream);
	}
	glDepthMask(GL_TRUE);
	glDisable(GL_BLEND);
	glDisable(GL_CULL_FACE);
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
	desc.graph->buildState = [&registry](const RenderPassDef::RenderGraphPassContext& ctx) -> std::any {
		return buildMeshPipelineState(ctx, registry.getStateRef<FrameSharedState>("frame_shared"));
	};
	desc.shouldExecute = []() {
		return ConsoleCore::instance().view()->vdpMeshCount > 0u;
	};
	desc.exec = [](GPUBackend* backend, void* framebuffer, std::any& state) {
		ConsoleCore& console = ConsoleCore::instance();
		MeshRuntime runtime{*static_cast<OpenGLES2Backend*>(backend), *console.view(), console.runtime().activeRom()};
		renderMeshBatch(runtime, framebuffer, std::any_cast<MeshPipelineState&>(state));
	};
	registry.registerPass(desc);
}

} // namespace bmsx
#endif
