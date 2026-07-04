/*
 * framebuffer_pipeline.cpp - host-managed framebuffer texture presentation pass
 */

#include "framebuffer_pipeline.h"

#include "render/backend/pass/library.h"

#if BMSX_ENABLE_GLES2
#include "render/backend/gles2/backend.h"
#include "render/backend/gles2/fullscreen_quad.h"
#include "render/2d/shaders/framebuffer_2d_shaders.h"
#endif

namespace bmsx {
namespace {

constexpr i32 kFramebuffer2DTextureUnit = 3;

#if BMSX_ENABLE_GLES2
struct Framebuffer2DGLES2State {
	GLuint program = 0;
	GLint attribPos = -1;
	GLint attribTex = -1;
	GLint uniformResolution = -1;
	GLint uniformScale = -1;
	GLint uniformTexture = -1;
	FullscreenQuad quad;
};

Framebuffer2DGLES2State g_framebuffer2d;

void initFramebuffer2DGLES2(OpenGLES2Backend& backend) {
	g_framebuffer2d.program = backend.buildProgram(kFramebuffer2DVertexShader, kFramebuffer2DFragmentShader, "framebuffer_2d");
	g_framebuffer2d.attribPos = glGetAttribLocation(g_framebuffer2d.program, "a_position");
	g_framebuffer2d.attribTex = glGetAttribLocation(g_framebuffer2d.program, "a_texcoord");
	g_framebuffer2d.uniformResolution = glGetUniformLocation(g_framebuffer2d.program, "u_resolution");
	g_framebuffer2d.uniformScale = glGetUniformLocation(g_framebuffer2d.program, "u_scale");
	g_framebuffer2d.uniformTexture = glGetUniformLocation(g_framebuffer2d.program, "u_texture");
	createFullscreenQuad(g_framebuffer2d.quad);
	glUseProgram(g_framebuffer2d.program);
	glUniform1i(g_framebuffer2d.uniformTexture, kFramebuffer2DTextureUnit);
}

void renderFramebuffer2DGLES2State(OpenGLES2Backend& backend, const Framebuffer2DPipelineState& state) {
	glUseProgram(g_framebuffer2d.program);
	glUniform1i(g_framebuffer2d.uniformTexture, kFramebuffer2DTextureUnit);
	updateFullscreenQuad(g_framebuffer2d.quad, state.width, state.height);

	glDisable(GL_DEPTH_TEST);
	glDisable(GL_CULL_FACE);
	glEnable(GL_BLEND);
	glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);

	bindFullscreenQuad(g_framebuffer2d.quad, g_framebuffer2d.attribPos, g_framebuffer2d.attribTex);

	glUniform2f(g_framebuffer2d.uniformResolution, static_cast<float>(state.width), static_cast<float>(state.height));
	glUniform1f(g_framebuffer2d.uniformScale, 1.0f);

	backend.setActiveTextureUnit(kFramebuffer2DTextureUnit);
	backend.bindTexture2D(state.colorTex);
	glDrawArrays(GL_TRIANGLES, 0, 6);
	glDisable(GL_BLEND);
}
#endif

void renderFramebuffer2DSoftware(SoftwareBackend& backend, const Framebuffer2DPipelineState& state) {
	backend.blitTexture(state.colorTex,
		0,
		0,
		state.baseWidth,
		state.baseHeight,
		0,
		0,
		state.width,
		state.height,
		0.0f,
		0xffffffffu,
		false,
		false,
		DitherParams{},
		false);
}

} // namespace

void registerFramebuffer2DPass_Software(RenderPassLibrary& registry) {
	RenderPassDef desc;
	desc.id = "framebuffer_2d";
	desc.name = "Framebuffer2D";
	setFramebuffer2DGraph(desc);
	desc.shouldExecute = shouldExecuteFramebuffer2DPass;
	desc.exec = executeStateRenderPass<
		SoftwareBackend,
		Framebuffer2DPipelineState,
		&RenderPassStateStorage::framebuffer2D,
		renderFramebuffer2DSoftware>;
	registry.registerPass(desc);
}

#if BMSX_ENABLE_GLES2
void registerFramebuffer2DPass_GLES2(RenderPassLibrary& registry) {
	RenderPassDef desc;
	desc.id = "framebuffer_2d";
	desc.name = "Framebuffer2D";
	setFramebuffer2DGraph(desc);
	desc.shouldExecute = shouldExecuteFramebuffer2DPass;
	desc.bootstrap = bootstrapBackendRenderPass<OpenGLES2Backend, initFramebuffer2DGLES2>;
	desc.exec = executeStateRenderPass<
		OpenGLES2Backend,
		Framebuffer2DPipelineState,
		&RenderPassStateStorage::framebuffer2D,
		renderFramebuffer2DGLES2State>;
	registry.registerPass(desc);
}

void shutdownFramebuffer2DGLES2() {
	if (g_framebuffer2d.program != 0) glDeleteProgram(g_framebuffer2d.program);
	destroyFullscreenQuad(g_framebuffer2d.quad);
	g_framebuffer2d = Framebuffer2DGLES2State{};
}
#endif

} // namespace bmsx
