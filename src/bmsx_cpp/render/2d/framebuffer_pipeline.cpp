/*
 * framebuffer_pipeline.cpp - 2D framebuffer presentation pass
 */

#include "framebuffer_pipeline.h"

#include "render/backend/pass/library.h"
#include "render/gameview.h"
#include "render/vdp/framebuffer.h"
#include <any>

#if BMSX_ENABLE_GLES2
#include "render/backend/gles2/backend.h"
#include "render/2d/shaders/framebuffer_2d_shaders.h"
#endif

namespace bmsx {
namespace {

constexpr i32 kFramebuffer2DTextureUnit = 3;

void setFramebuffer2DViewportSize(Framebuffer2DPipelineState& state, const GameView* view) {
	state.width = static_cast<i32>(view->offscreenCanvasSize.x);
	state.height = static_cast<i32>(view->offscreenCanvasSize.y);
	state.baseWidth = static_cast<i32>(view->viewportSize.x);
	state.baseHeight = static_cast<i32>(view->viewportSize.y);
}

Framebuffer2DPipelineState buildFramebuffer2DState(const RenderPassDef::RenderGraphPassContext& ctx) {
	Framebuffer2DPipelineState state;
	setFramebuffer2DViewportSize(state, ctx.view);
	state.colorTex = ctx.view->vdpFrameBufferTextures().displayTexture();
	return state;
}

#if BMSX_ENABLE_GLES2
struct Framebuffer2DGLES2State {
	GLuint program = 0;
	GLint attribPos = -1;
	GLint attribTex = -1;
	GLint uniformResolution = -1;
	GLint uniformScale = -1;
	GLint uniformTexture = -1;
	GLuint vboPos = 0;
	GLuint vboUv = 0;
	i32 width = -1;
	i32 height = -1;
};

Framebuffer2DGLES2State g_framebuffer2d;

void initFramebuffer2DGLES2(OpenGLES2Backend& backend) {
	g_framebuffer2d.program = backend.buildProgram(kFramebuffer2DVertexShader, kFramebuffer2DFragmentShader, "framebuffer_2d");
	g_framebuffer2d.attribPos = glGetAttribLocation(g_framebuffer2d.program, "a_position");
	g_framebuffer2d.attribTex = glGetAttribLocation(g_framebuffer2d.program, "a_texcoord");
	g_framebuffer2d.uniformResolution = glGetUniformLocation(g_framebuffer2d.program, "u_resolution");
	g_framebuffer2d.uniformScale = glGetUniformLocation(g_framebuffer2d.program, "u_scale");
	g_framebuffer2d.uniformTexture = glGetUniformLocation(g_framebuffer2d.program, "u_texture");
	glGenBuffers(1, &g_framebuffer2d.vboPos);
	glGenBuffers(1, &g_framebuffer2d.vboUv);
	glUseProgram(g_framebuffer2d.program);
	glUniform1i(g_framebuffer2d.uniformTexture, kFramebuffer2DTextureUnit);
}

void updateFramebuffer2DQuad(i32 width, i32 height) {
	if (g_framebuffer2d.width == width && g_framebuffer2d.height == height) return;

	g_framebuffer2d.width = width;
	g_framebuffer2d.height = height;
	const float w = static_cast<float>(width);
	const float h = static_cast<float>(height);
	const float positions[12] = {
		0.0f, 0.0f,
		0.0f, h,
		w, 0.0f,
		w, 0.0f,
		0.0f, h,
		w, h
	};
	const float texcoords[12] = {
		0.0f, 1.0f,
		0.0f, 0.0f,
		1.0f, 1.0f,
		1.0f, 1.0f,
		0.0f, 0.0f,
		1.0f, 0.0f
	};
	glBindBuffer(GL_ARRAY_BUFFER, g_framebuffer2d.vboPos);
	glBufferData(GL_ARRAY_BUFFER, sizeof(positions), positions, GL_STATIC_DRAW);
	glBindBuffer(GL_ARRAY_BUFFER, g_framebuffer2d.vboUv);
	glBufferData(GL_ARRAY_BUFFER, sizeof(texcoords), texcoords, GL_STATIC_DRAW);
}

void renderFramebuffer2DGLES2(OpenGLES2Backend& backend, const Framebuffer2DPipelineState& state) {
	glUseProgram(g_framebuffer2d.program);
	glUniform1i(g_framebuffer2d.uniformTexture, kFramebuffer2DTextureUnit);
	updateFramebuffer2DQuad(state.width, state.height);

	glDisable(GL_DEPTH_TEST);
	glDisable(GL_CULL_FACE);
	glEnable(GL_BLEND);
	glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);

	glBindBuffer(GL_ARRAY_BUFFER, g_framebuffer2d.vboPos);
	glEnableVertexAttribArray(static_cast<GLuint>(g_framebuffer2d.attribPos));
	glVertexAttribPointer(static_cast<GLuint>(g_framebuffer2d.attribPos), 2, GL_FLOAT, GL_FALSE, 0, nullptr);

	glBindBuffer(GL_ARRAY_BUFFER, g_framebuffer2d.vboUv);
	glEnableVertexAttribArray(static_cast<GLuint>(g_framebuffer2d.attribTex));
	glVertexAttribPointer(static_cast<GLuint>(g_framebuffer2d.attribTex), 2, GL_FLOAT, GL_FALSE, 0, nullptr);

	glUniform2f(g_framebuffer2d.uniformResolution, static_cast<float>(state.width), static_cast<float>(state.height));
	glUniform1f(g_framebuffer2d.uniformScale, 1.0f);

	backend.setActiveTextureUnit(kFramebuffer2DTextureUnit);
	backend.bindTexture2D(state.colorTex);
	glDrawArrays(GL_TRIANGLES, 0, 6);
	glDisable(GL_BLEND);
}
#endif

} // namespace

void registerFramebuffer2DPass_Software(RenderPassLibrary& registry) {
	RenderPassDef desc;
	desc.id = "framebuffer_2d";
	desc.name = "Framebuffer2D";
	desc.graph = RenderPassDef::RenderPassGraphDef{};
	desc.graph->writes = { RenderPassDef::RenderGraphSlot::FrameColor };
	desc.graph->buildState = [](const RenderPassDef::RenderGraphPassContext& ctx) -> std::any {
		return buildFramebuffer2DState(ctx);
	};
	desc.exec = [](GPUBackend* backend, void*, std::any& state) {
		auto& fbState = std::any_cast<Framebuffer2DPipelineState&>(state);
		auto* softBackend = static_cast<SoftwareBackend*>(backend);
		softBackend->blitTexture(fbState.colorTex,
			0,
			0,
			fbState.baseWidth,
			fbState.baseHeight,
			0,
			0,
			fbState.width,
			fbState.height,
			0.0f,
			0xffffffffu,
			false,
			false,
			DitherParams{},
			false);
	};
	registry.registerPass(desc);
}

#if BMSX_ENABLE_GLES2
void registerFramebuffer2DPass_GLES2(RenderPassLibrary& registry) {
	RenderPassDef desc;
	desc.id = "framebuffer_2d";
	desc.name = "Framebuffer2D";
	desc.graph = RenderPassDef::RenderPassGraphDef{};
	desc.graph->writes = { RenderPassDef::RenderGraphSlot::FrameColor };
	desc.graph->buildState = [](const RenderPassDef::RenderGraphPassContext& ctx) -> std::any {
		return buildFramebuffer2DState(ctx);
	};
	desc.bootstrap = [](GPUBackend* backend) {
		initFramebuffer2DGLES2(*static_cast<OpenGLES2Backend*>(backend));
	};
	desc.exec = [](GPUBackend* backend, void*, std::any& state) {
		auto& fbState = std::any_cast<Framebuffer2DPipelineState&>(state);
		renderFramebuffer2DGLES2(*static_cast<OpenGLES2Backend*>(backend), fbState);
	};
	registry.registerPass(desc);
}

void shutdownFramebuffer2DGLES2() {
	if (g_framebuffer2d.program != 0) glDeleteProgram(g_framebuffer2d.program);
	if (g_framebuffer2d.vboPos != 0) glDeleteBuffers(1, &g_framebuffer2d.vboPos);
	if (g_framebuffer2d.vboUv != 0) glDeleteBuffers(1, &g_framebuffer2d.vboUv);
	g_framebuffer2d = Framebuffer2DGLES2State{};
}
#endif

} // namespace bmsx
