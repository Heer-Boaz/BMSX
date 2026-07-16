/*
 * crt/gles2/pipeline.cpp - GLES2 CRT post-processing pipeline
 */

#include "pipeline.h"

#include "render/backend/gles2/backend.h"
#include "render/backend/pass/library.h"
#include "render/gameview.h"
#include "render/backend/gles2/fullscreen_quad.h"
#include "render/post/crt/gles2/shaders/crt_post_shaders.h"

#include <cstdio>
#include <cstdlib>

#include <GLES2/gl2.h>

namespace bmsx {
namespace CRTPipeline {
namespace {

constexpr bool kCRTVerboseLog = false;

constexpr int kTexUnitPostProcess = 3;

void logFramebufferDitherState() {
	GLint red_bits = 0;
	GLint green_bits = 0;
	GLint blue_bits = 0;
	GLint alpha_bits = 0;
	glGetIntegerv(GL_RED_BITS, &red_bits);
	glGetIntegerv(GL_GREEN_BITS, &green_bits);
	glGetIntegerv(GL_BLUE_BITS, &blue_bits);
	glGetIntegerv(GL_ALPHA_BITS, &alpha_bits);
	const int dither_enabled = glIsEnabled(GL_DITHER) ? 1 : 0;

	std::fprintf(stderr,
					"[BMSX][GLES2] FB bits RGBA=%d/%d/%d/%d GL_DITHER=%d\n",
					static_cast<int>(red_bits),
					static_cast<int>(green_bits),
					static_cast<int>(blue_bits),
					static_cast<int>(alpha_bits), dither_enabled);
}

void initializeFullscreenPostProcessProgram(GLuint program, GLint uniformTexture, FullscreenQuad& quad) {
	createFullscreenQuad(quad);
	glUseProgram(program);
	glUniform1i(uniformTexture, kTexUnitPostProcess);
}

void beginFullscreenPostProcessDraw(OpenGLES2Backend& backend,
										FullscreenQuad& quad,
										GLuint program,
										GLint attribPosition,
										GLint attribUv,
										GLint uniformTexture,
										GLuint targetFbo,
										i32 width,
										i32 height) {
	glUseProgram(program);
	glUniform1i(uniformTexture, kTexUnitPostProcess);
	updateFullscreenQuad(quad, width, height);
	backend.setRenderTarget(targetFbo, width, height);
	glDisable(GL_DEPTH_TEST);
	glDisable(GL_CULL_FACE);
	glDisable(GL_BLEND);
	bindFullscreenQuad(quad, attribPosition, attribUv);
}

} // namespace

void initPresentGLES2(OpenGLES2Backend& backend, PresentGLES2State& pipeline) {
	pipeline.program = backend.buildProgram(kPostGLES2FullscreenVertexShader, kPresentFragmentShader, "present");

	pipeline.attrib_pos = glGetAttribLocation(pipeline.program, "a_position");
	pipeline.attrib_uv = glGetAttribLocation(pipeline.program, "a_texcoord");

	pipeline.uniform_resolution = glGetUniformLocation(pipeline.program, "u_resolution");
	pipeline.uniform_scale = glGetUniformLocation(pipeline.program, "u_scale");
	pipeline.uniform_texture = glGetUniformLocation(pipeline.program, "u_texture");

	initializeFullscreenPostProcessProgram(pipeline.program, pipeline.uniform_texture, pipeline.quad);
}

void initCRTGLES2(OpenGLES2Backend& backend, CRTGLES2State& pipeline) {
	logFramebufferDitherState();
	pipeline.program = backend.buildProgram(kPostGLES2FullscreenVertexShader, kCRTFragmentShader, "crt");

	pipeline.attrib_pos = glGetAttribLocation(pipeline.program, "a_position");
	pipeline.attrib_uv = glGetAttribLocation(pipeline.program, "a_texcoord");

	pipeline.uniform_resolution = glGetUniformLocation(pipeline.program, "u_resolution");
	pipeline.uniform_src_resolution = glGetUniformLocation(pipeline.program, "u_srcResolution");
	pipeline.uniform_scale = glGetUniformLocation(pipeline.program, "u_scale");
	pipeline.uniform_fragscale = glGetUniformLocation(pipeline.program, "u_fragscale");
	pipeline.uniform_time = glGetUniformLocation(pipeline.program, "u_time");
	pipeline.uniform_random = glGetUniformLocation(pipeline.program, "u_random");
	pipeline.uniform_apply_noise = glGetUniformLocation(pipeline.program, "u_enableNoise");
	pipeline.uniform_apply_color_bleed = glGetUniformLocation(pipeline.program, "u_enableColorBleed");
	pipeline.uniform_apply_scanlines = glGetUniformLocation(pipeline.program, "u_enableScanlines");
	pipeline.uniform_apply_blur = glGetUniformLocation(pipeline.program, "u_enableBlur");
	pipeline.uniform_apply_glow = glGetUniformLocation(pipeline.program, "u_enableGlow");
	pipeline.uniform_apply_fringing = glGetUniformLocation(pipeline.program, "u_enableFringing");
	pipeline.uniform_apply_aperture = glGetUniformLocation(pipeline.program, "u_enableAperture");
	pipeline.uniform_noise_intensity = glGetUniformLocation(pipeline.program, "u_noiseIntensity");
	pipeline.uniform_color_bleed = glGetUniformLocation(pipeline.program, "u_colorBleed");
	pipeline.uniform_blur_intensity = glGetUniformLocation(pipeline.program, "u_blurIntensity");
	pipeline.uniform_glow_color = glGetUniformLocation(pipeline.program, "u_glowColor");
	pipeline.uniform_texture = glGetUniformLocation(pipeline.program, "u_texture");

	initializeFullscreenPostProcessProgram(pipeline.program, pipeline.uniform_texture, pipeline.quad);
	if (kCRTVerboseLog) {
		std::fprintf(stderr,
						"[BMSX][GLES2][CRT] init program=%u attribs(pos=%d uv=%d) uniforms(res=%d srcRes=%d scale=%d fragscale=%d time=%d random=%d tex=%d)\n",
						static_cast<unsigned>(pipeline.program), pipeline.attrib_pos,
						pipeline.attrib_uv, pipeline.uniform_resolution,
						pipeline.uniform_src_resolution, pipeline.uniform_scale,
						pipeline.uniform_fragscale, pipeline.uniform_time,
						pipeline.uniform_random, pipeline.uniform_texture);
	}
}

void shutdownCRTGLES2(CRTGLES2State& pipeline) {
	if (pipeline.program != 0) glDeleteProgram(pipeline.program);
	destroyFullscreenQuad(pipeline.quad);
	pipeline = CRTGLES2State{};
}

void shutdownPresentGLES2(PresentGLES2State& pipeline) {
	if (pipeline.program != 0) glDeleteProgram(pipeline.program);
	destroyFullscreenQuad(pipeline.quad);
	pipeline = PresentGLES2State{};
}



void renderPresentTextureGLES2State(OpenGLES2Backend& backend, PresentGLES2State& pipeline, GLuint targetFbo, const PresentPipelineState& state) {
	beginFullscreenPostProcessDraw(
		backend,
		pipeline.quad,
		pipeline.program,
		pipeline.attrib_pos,
		pipeline.attrib_uv,
		pipeline.uniform_texture,
		targetFbo,
		state.width,
		state.height);
	glUniform2f(pipeline.uniform_resolution, static_cast<float>(state.width), static_cast<float>(state.height));
	glUniform1f(pipeline.uniform_scale, 1.0f);

	backend.setActiveTextureUnit(kTexUnitPostProcess);
	backend.bindTexture2D(state.colorTex);

	glDrawArrays(GL_TRIANGLES, 0, 6);
}

void executePresentationHistoryGLES2Pass(GPUBackend* backend, GameView*, void* fbo, RenderPassStateStorage& state, void* context) {
	auto& typedBackend = *static_cast<OpenGLES2Backend*>(backend);
	auto& typedPipeline = *static_cast<PresentGLES2State*>(context);
	renderPresentTextureGLES2State(typedBackend, typedPipeline, typedBackend.framebufferName(fbo), state.present);
}

void renderPresentGLES2State(OpenGLES2Backend& backend, PresentGLES2State& pipeline, const PresentPipelineState& state) {
	const GLuint targetFbo = backend.backbuffer();
	renderPresentTextureGLES2State(backend, pipeline, targetFbo, state);
}

void renderCRTGLES2State(OpenGLES2Backend& backend, CRTGLES2State& pipeline, const CRTPipelineState& state) {
	if (kCRTVerboseLog) {
		auto* srcTex = OpenGLES2Backend::asTexture(state.colorTex);
		std::fprintf(stderr,
						"[BMSX][GLES2][CRT] render backbuffer_fbo=%u colorTex=%u size=%dx%d base=%dx%d\n",
						static_cast<unsigned>(backend.backbuffer()),
						static_cast<unsigned>(srcTex->id), state.width,
						state.height, state.baseWidth, state.baseHeight);
	}
	beginFullscreenPostProcessDraw(
		backend,
		pipeline.quad,
		pipeline.program,
		pipeline.attrib_pos,
		pipeline.attrib_uv,
		pipeline.uniform_texture,
		backend.backbuffer(),
		state.width,
		state.height);
	glUniform2f(pipeline.uniform_resolution, static_cast<float>(state.width), static_cast<float>(state.height));
	glUniform2f(pipeline.uniform_src_resolution, static_cast<float>(state.baseWidth), static_cast<float>(state.baseHeight));
	glUniform1f(pipeline.uniform_scale, 1.0f);
	glUniform1f(pipeline.uniform_fragscale, static_cast<float>(state.srcWidth) / static_cast<float>(state.baseWidth));
	glUniform1f(pipeline.uniform_time, state.time);
	glUniform1f(pipeline.uniform_random, static_cast<float>(std::rand()) / static_cast<float>(RAND_MAX));

	glUniform1i(pipeline.uniform_apply_noise, state.options.applyNoise ? 1 : 0);
	glUniform1i(pipeline.uniform_apply_color_bleed, state.options.applyColorBleed ? 1 : 0);
	glUniform1i(pipeline.uniform_apply_scanlines, state.options.applyScanlines ? 1 : 0);
	glUniform1i(pipeline.uniform_apply_blur, state.options.applyBlur ? 1 : 0);
	glUniform1i(pipeline.uniform_apply_glow, state.options.applyGlow ? 1 : 0);
	glUniform1i(pipeline.uniform_apply_fringing, state.options.applyFringing ? 1 : 0);
	glUniform1i(pipeline.uniform_apply_aperture, state.options.applyAperture ? 1 : 0);

	const auto& colorBleed = state.options.colorBleed;
	const auto& glowColor = state.options.glowColor;
	glUniform1f(pipeline.uniform_noise_intensity, state.options.noiseIntensity);
	glUniform3f(pipeline.uniform_color_bleed, colorBleed[0], colorBleed[1], colorBleed[2]);
	glUniform1f(pipeline.uniform_blur_intensity, state.options.blurIntensity);
	glUniform3f(pipeline.uniform_glow_color, glowColor[0], glowColor[1], glowColor[2]);

	backend.setActiveTextureUnit(kTexUnitPostProcess);
	backend.bindTexture2D(state.colorTex);

	glDrawArrays(GL_TRIANGLES, 0, 6);
}


void registerPresentationHistoryGLES2Pass(
	RenderPassLibrary& registry,
	PresentGLES2State& pipeline,
	const char* id,
	const char* name,
	RenderPassDef::RenderGraphSlot historySlot,
	bool (*shouldExecute)(GameView*, void*)) {
	RenderPassDef desc;
	desc.id = id;
	desc.name = name;
	setPresentationHistoryGraph(desc, historySlot);
	desc.context = &pipeline;
	desc.exec = executePresentationHistoryGLES2Pass;
	desc.shouldExecute = shouldExecute;
	registry.registerPass(desc);
}

void registerPresentationHistoryGLES2Passes(RenderPassLibrary& registry, PresentGLES2State& pipeline) {
	registerPresentationHistoryGLES2Pass(
		registry,
		pipeline,
		"presentation_history_a",
		"PresentationHistoryA",
		RenderPassDef::RenderGraphSlot::FrameHistoryA,
		shouldUpdatePresentationHistoryA);
	registerPresentationHistoryGLES2Pass(
		registry,
		pipeline,
		"presentation_history_b",
		"PresentationHistoryB",
		RenderPassDef::RenderGraphSlot::FrameHistoryB,
		shouldUpdatePresentationHistoryB);
}

void registerPresentGLES2Pass(RenderPassLibrary& registry, PresentGLES2State& pipeline) {
	RenderPassDef desc;
	desc.id = "present";
	desc.name = "Present";
	setAutoPresentGraph(desc);
	desc.context = &pipeline;
	desc.exec = executePipelineRenderPass<
		OpenGLES2Backend,
		PresentGLES2State,
		PresentPipelineState,
		&RenderPassStateStorage::present,
		renderPresentGLES2State>;
	desc.shouldExecute = shouldExecuteAutoPresentPass;
	registry.registerPass(desc);
}

void registerCRTGLES2Pass(RenderPassLibrary& registry, CRTGLES2State& pipeline) {
	RenderPassDef desc;
	desc.id = "crt";
	desc.name = "Present/CRT";
	setAutoCRTGraph(desc);
	desc.context = &pipeline;
	desc.exec = executePipelineRenderPass<
		OpenGLES2Backend,
		CRTGLES2State,
		CRTPipelineState,
		&RenderPassStateStorage::crt,
		renderCRTGLES2State>;
	desc.shouldExecute = shouldExecuteAutoCRTPass;
	registry.registerPass(desc);
}

} // namespace CRTPipeline
} // namespace bmsx
