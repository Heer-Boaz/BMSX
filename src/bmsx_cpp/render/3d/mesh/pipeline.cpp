#include "render/3d/mesh/pipeline.h"

#if BMSX_ENABLE_GLES2
#include "core/console.h"
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
	GLint attribUv = -1;
	GLint attribColor = -1;
	GLint uniformModel = -1;
	GLint uniformViewProjection = -1;
	GLint uniformTexture = -1;
	GLint uniformUseTexture = -1;
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
	program.attribUv = glGetAttribLocation(program.id, "a_uv");
	program.attribColor = glGetAttribLocation(program.id, "a_color");
	program.uniformModel = glGetUniformLocation(program.id, "u_model");
	program.uniformViewProjection = glGetUniformLocation(program.id, "u_viewProjection");
	program.uniformTexture = glGetUniformLocation(program.id, "u_texture");
	program.uniformUseTexture = glGetUniformLocation(program.id, "u_useTexture");
	glGenBuffers(1, &program.vertexBuffer);
	glUseProgram(program.id);
	glUniform1i(program.uniformTexture, MESH_TEXTURE_UNIT);
}

void bindMeshVertexLayout(const MeshGLES2Program& program) {
	glBindBuffer(GL_ARRAY_BUFFER, program.vertexBuffer);
	glEnableVertexAttribArray(static_cast<GLuint>(program.attribPosition));
	glEnableVertexAttribArray(static_cast<GLuint>(program.attribUv));
	glEnableVertexAttribArray(static_cast<GLuint>(program.attribColor));
	glVertexAttribPointer(program.attribPosition, 3, GL_FLOAT, GL_FALSE, sizeof(MeshGLES2Vertex), reinterpret_cast<const void*>(offsetof(MeshGLES2Vertex, x)));
	glVertexAttribPointer(program.attribUv, 2, GL_FLOAT, GL_FALSE, sizeof(MeshGLES2Vertex), reinterpret_cast<const void*>(offsetof(MeshGLES2Vertex, u)));
	glVertexAttribPointer(program.attribColor, 4, GL_FLOAT, GL_FALSE, sizeof(MeshGLES2Vertex), reinterpret_cast<const void*>(offsetof(MeshGLES2Vertex, r)));
}

void setupMeshDrawState(OpenGLES2Backend& backend, void* framebuffer, MeshGLES2Program& program, const MeshPipelineState& state) {
	backend.setRenderTarget(static_cast<GLuint>(reinterpret_cast<uintptr_t>(framebuffer)), state.width, state.height);
	glUseProgram(program.id);
	glUniformMatrix4fv(program.uniformViewProjection, 1, GL_FALSE, state.viewProj.data());
	glEnable(GL_DEPTH_TEST);
	glDepthMask(GL_TRUE);
	glDisable(GL_BLEND);
	bindMeshVertexLayout(program);
}

void uploadMeshDrawStream(const MeshGLES2Program& program, const MeshGLES2DrawStream& stream) {
	glUniformMatrix4fv(program.uniformModel, 1, GL_FALSE, stream.modelMatrix->data());
	glBufferData(
		GL_ARRAY_BUFFER,
		static_cast<GLsizeiptr>(stream.vertexCount * sizeof(MeshGLES2Vertex)),
		stream.vertices,
		GL_STREAM_DRAW
	);
	glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(stream.vertexCount));
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
		if (useTexture) {
			backend.setActiveTextureUnit(MESH_TEXTURE_UNIT);
			backend.bindTexture2D(textureForMeshEntry(pipelineState, submission));
		}
		uploadMeshDrawStream(program, stream);
	}
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
		ConsoleCore& console = ConsoleCore::instance();
		MeshRuntime runtime{*static_cast<OpenGLES2Backend*>(backend), *console.view(), console.activeRom()};
		renderMeshBatch(runtime, framebuffer, std::any_cast<MeshPipelineState&>(state));
	};
	registry.registerPass(desc);
}

} // namespace bmsx
#endif
