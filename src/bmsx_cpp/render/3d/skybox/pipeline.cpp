#include "render/3d/skybox/pipeline.h"

#if BMSX_ENABLE_GLES2
#include "core/console.h"
#include "render/3d/shaders/render_3d_shaders.h"
#include "render/backend/gles2_backend.h"
#include "render/gameview.h"
#include "render/shared/hardware/camera.h"
#include "render/shared/queues.h"
#include "rompack/format.h"

#include <GLES2/gl2.h>

namespace bmsx {
namespace {

constexpr i32 SKYBOX_VERTEX_COUNT = 36;

struct SkyboxGLES2Runtime {
	GLuint program = 0;
	GLint attribPosition = -1;
	GLint uniformView = -1;
	GLint uniformProjection = -1;
	GLint uniformTextpagePrimary = -1;
	GLint uniformTextpageSecondary = -1;
	GLint uniformFaceUvRect0 = -1;
	GLint uniformFaceUvRect1 = -1;
	GLint uniformFaceUvRect2 = -1;
	GLint uniformFaceUvRect3 = -1;
	GLint uniformFaceUvRect4 = -1;
	GLint uniformFaceUvRect5 = -1;
	GLint uniformFaceTextpage0 = -1;
	GLint uniformFaceTextpage1 = -1;
	GLint uniformFaceTextpage2 = -1;
	GLint uniformFaceTextpage3 = -1;
	GLint uniformFaceTextpage4 = -1;
	GLint uniformFaceTextpage5 = -1;
	GLint uniformTint = -1;
	GLint uniformExposure = -1;
};

SkyboxGLES2Runtime g_skybox{};

void bindSkyboxTextpages(OpenGLES2Backend& backend, const SkyboxPipelineState& state) {
	backend.setActiveTextureUnit(0);
	backend.bindTexture2D(state.textpagePrimaryTex);
	backend.setActiveTextureUnit(1);
	backend.bindTexture2D(state.textpageSecondaryTex);
}

} // namespace

GLuint skyboxBuffer = 0;

void createSkyboxProgram(OpenGLES2Backend& backend) {
	g_skybox.program = backend.buildProgram(kRender3DSkyboxVertexShader, kRender3DSkyboxFragmentShader, "skybox");
}

void setupSkyboxLocations() {
	auto& state = g_skybox;
	state.attribPosition = glGetAttribLocation(state.program, "a_position");
	state.uniformView = glGetUniformLocation(state.program, "u_view");
	state.uniformProjection = glGetUniformLocation(state.program, "u_projection");
	state.uniformTextpagePrimary = glGetUniformLocation(state.program, "u_textpage_primary");
	state.uniformTextpageSecondary = glGetUniformLocation(state.program, "u_textpage_secondary");
	// TS WebGL2 uses u_face_uv_rect[6] and u_face_textpage[6]. For the
	// SNES-mini GLES2 target we keep the same face data in SkyboxPipelineState
	// but bind it to scalar uniforms to avoid non-portable dynamic array
	// indexing in old GLES2 fragment shaders.
	state.uniformFaceUvRect0 = glGetUniformLocation(state.program, "u_face_uv_rect0");
	state.uniformFaceUvRect1 = glGetUniformLocation(state.program, "u_face_uv_rect1");
	state.uniformFaceUvRect2 = glGetUniformLocation(state.program, "u_face_uv_rect2");
	state.uniformFaceUvRect3 = glGetUniformLocation(state.program, "u_face_uv_rect3");
	state.uniformFaceUvRect4 = glGetUniformLocation(state.program, "u_face_uv_rect4");
	state.uniformFaceUvRect5 = glGetUniformLocation(state.program, "u_face_uv_rect5");
	state.uniformFaceTextpage0 = glGetUniformLocation(state.program, "u_face_textpage0");
	state.uniformFaceTextpage1 = glGetUniformLocation(state.program, "u_face_textpage1");
	state.uniformFaceTextpage2 = glGetUniformLocation(state.program, "u_face_textpage2");
	state.uniformFaceTextpage3 = glGetUniformLocation(state.program, "u_face_textpage3");
	state.uniformFaceTextpage4 = glGetUniformLocation(state.program, "u_face_textpage4");
	state.uniformFaceTextpage5 = glGetUniformLocation(state.program, "u_face_textpage5");
	state.uniformTint = glGetUniformLocation(state.program, "u_skyTint");
	state.uniformExposure = glGetUniformLocation(state.program, "u_skyExposure");
	glUseProgram(state.program);
	glUniform1i(state.uniformTextpagePrimary, 0);
	glUniform1i(state.uniformTextpageSecondary, 1);
	glUniform3f(state.uniformTint, 1.0f, 1.0f, 1.0f);
	glUniform1f(state.uniformExposure, 1.0f);
}

void createSkyboxBuffer() {
	const f32 vertices[SKYBOX_VERTEX_COUNT * 3] = {
		-1.0f, -1.0f,  1.0f,  1.0f, -1.0f,  1.0f,  1.0f,  1.0f,  1.0f,
		-1.0f, -1.0f,  1.0f,  1.0f,  1.0f,  1.0f, -1.0f,  1.0f,  1.0f,
		-1.0f, -1.0f, -1.0f, -1.0f,  1.0f, -1.0f,  1.0f,  1.0f, -1.0f,
		-1.0f, -1.0f, -1.0f,  1.0f,  1.0f, -1.0f,  1.0f, -1.0f, -1.0f,
		-1.0f,  1.0f, -1.0f, -1.0f,  1.0f,  1.0f,  1.0f,  1.0f,  1.0f,
		-1.0f,  1.0f, -1.0f,  1.0f,  1.0f,  1.0f,  1.0f,  1.0f, -1.0f,
		-1.0f, -1.0f, -1.0f,  1.0f, -1.0f, -1.0f,  1.0f, -1.0f,  1.0f,
		-1.0f, -1.0f, -1.0f,  1.0f, -1.0f,  1.0f, -1.0f, -1.0f,  1.0f,
			1.0f, -1.0f, -1.0f,  1.0f,  1.0f, -1.0f,  1.0f,  1.0f,  1.0f,
			1.0f, -1.0f, -1.0f,  1.0f,  1.0f,  1.0f,  1.0f, -1.0f,  1.0f,
		-1.0f, -1.0f, -1.0f, -1.0f, -1.0f,  1.0f, -1.0f,  1.0f,  1.0f,
		-1.0f, -1.0f, -1.0f, -1.0f,  1.0f,  1.0f, -1.0f,  1.0f, -1.0f,
	};
	glGenBuffers(1, &skyboxBuffer);
	glBindBuffer(GL_ARRAY_BUFFER, skyboxBuffer);
	glBufferData(GL_ARRAY_BUFFER, sizeof(vertices), vertices, GL_STATIC_DRAW);
}

void initSkyboxPipeline(OpenGLES2Backend& backend) {
	createSkyboxProgram(backend);
	setupSkyboxLocations();
	createSkyboxBuffer();
}

void drawSkybox(SkyboxRuntime& runtime, void* framebuffer, const SkyboxPipelineState& pipelineState) {
	auto& state = g_skybox;
	OpenGLES2Backend& backend = runtime.backend;
	backend.setRenderTarget(static_cast<GLuint>(reinterpret_cast<uintptr_t>(framebuffer)), pipelineState.width, pipelineState.height);
	glUseProgram(state.program);
	glDisable(GL_DEPTH_TEST);
	glDisable(GL_CULL_FACE);
	glDisable(GL_BLEND);
	glDepthMask(GL_FALSE);
	glBindBuffer(GL_ARRAY_BUFFER, skyboxBuffer);
	glEnableVertexAttribArray(static_cast<GLuint>(state.attribPosition));
	glVertexAttribPointer(state.attribPosition, 3, GL_FLOAT, GL_FALSE, 0, nullptr);
	glUniformMatrix4fv(state.uniformView, 1, GL_FALSE, pipelineState.view.data());
	glUniformMatrix4fv(state.uniformProjection, 1, GL_FALSE, pipelineState.proj.data());
	glUniform4fv(state.uniformFaceUvRect0, 1, pipelineState.faceUvRects.data() + 0u);
	glUniform4fv(state.uniformFaceUvRect1, 1, pipelineState.faceUvRects.data() + 4u);
	glUniform4fv(state.uniformFaceUvRect2, 1, pipelineState.faceUvRects.data() + 8u);
	glUniform4fv(state.uniformFaceUvRect3, 1, pipelineState.faceUvRects.data() + 12u);
	glUniform4fv(state.uniformFaceUvRect4, 1, pipelineState.faceUvRects.data() + 16u);
	glUniform4fv(state.uniformFaceUvRect5, 1, pipelineState.faceUvRects.data() + 20u);
	glUniform1f(state.uniformFaceTextpage0, static_cast<f32>(pipelineState.faceTextpageBindings[0]));
	glUniform1f(state.uniformFaceTextpage1, static_cast<f32>(pipelineState.faceTextpageBindings[1]));
	glUniform1f(state.uniformFaceTextpage2, static_cast<f32>(pipelineState.faceTextpageBindings[2]));
	glUniform1f(state.uniformFaceTextpage3, static_cast<f32>(pipelineState.faceTextpageBindings[3]));
	glUniform1f(state.uniformFaceTextpage4, static_cast<f32>(pipelineState.faceTextpageBindings[4]));
	glUniform1f(state.uniformFaceTextpage5, static_cast<f32>(pipelineState.faceTextpageBindings[5]));
	glUniform3f(state.uniformTint, RenderQueues::_skyTint[0], RenderQueues::_skyTint[1], RenderQueues::_skyTint[2]);
	glUniform1f(state.uniformExposure, RenderQueues::_skyExposure);
	bindSkyboxTextpages(backend, pipelineState);
	glDrawArrays(GL_TRIANGLES, 0, SKYBOX_VERTEX_COUNT);
	glDepthMask(GL_TRUE);
}

void registerSkyboxPass_GLES2(RenderPassLibrary& registry) {
	RenderPassDef desc;
	desc.id = "skybox";
	desc.name = "Skybox";
	desc.graph = RenderPassDef::RenderPassGraphDef{};
	desc.graph->writes = { RenderPassDef::RenderGraphSlot::FrameColor };
	desc.bootstrap = [](GPUBackend* backend) {
		initSkyboxPipeline(*static_cast<OpenGLES2Backend*>(backend));
	};
	desc.shouldExecute = []() {
		return ConsoleCore::instance().view()->skyboxRenderReady;
	};
	desc.graph->buildState = [](const RenderPassDef::RenderGraphPassContext& ctx) -> std::any {
		const HardwareCameraState& camera = resolveActiveHardwareCamera();
		SkyboxPipelineState state;
		state.width = static_cast<i32>(ctx.view->offscreenCanvasSize.x);
		state.height = static_cast<i32>(ctx.view->offscreenCanvasSize.y);
		state.view = camera.skyboxView;
		state.proj = camera.proj;
		state.textpagePrimaryTex = ctx.view->textures.at(VDP_PRIMARY_SLOT_TEXTURE_KEY);
		state.textpageSecondaryTex = ctx.view->textures.at(VDP_SECONDARY_SLOT_TEXTURE_KEY);
		state.faceUvRects = ctx.view->skyboxFaceUvRects;
		state.faceTextpageBindings = ctx.view->skyboxFaceTextpageBindings;
		return state;
	};
	desc.exec = [](GPUBackend* backend, void* framebuffer, std::any& state) {
		SkyboxRuntime runtime{*static_cast<OpenGLES2Backend*>(backend), *ConsoleCore::instance().view()};
		drawSkybox(runtime, framebuffer, std::any_cast<SkyboxPipelineState&>(state));
	};
	registry.registerPass(desc);
}

} // namespace bmsx
#endif
