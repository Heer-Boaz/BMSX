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


} // namespace

void initPresentGLES2(OpenGLES2Backend& backend, PresentGLES2State& pipeline) {
	pipeline.program = backend.buildProgram(kPostGLES2FullscreenVertexShader, kPresentFragmentShader, "present");

	pipeline.attrib_pos = glGetAttribLocation(pipeline.program, "a_position");
	pipeline.attrib_uv = glGetAttribLocation(pipeline.program, "a_texcoord");

	pipeline.uniform_resolution = glGetUniformLocation(pipeline.program, "u_resolution");
	pipeline.uniform_scale = glGetUniformLocation(pipeline.program, "u_scale");
	pipeline.uniform_texture = glGetUniformLocation(pipeline.program, "u_texture");

	createFullscreenQuad(pipeline.quad);

	glUseProgram(pipeline.program);
	glUniform1i(pipeline.uniform_texture, kTexUnitPostProcess);
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

	createFullscreenQuad(pipeline.quad);

	glUseProgram(pipeline.program);
	// Re-apply sampler binding every draw; shared contexts can clobber uniform state.
	// This keeps the CRT pass sampling the offscreen color texture.
	glUniform1i(pipeline.uniform_texture, kTexUnitPostProcess);
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


void renderPresentGLES2State(OpenGLES2Backend& backend, PresentGLES2State& pipeline, const PresentPipelineState& state) {
	glUseProgram(pipeline.program);
	glUniform1i(pipeline.uniform_texture, kTexUnitPostProcess);

	updateFullscreenQuad(pipeline.quad, state.width, state.height);

	backend.setRenderTarget(backend.backbuffer(), state.width, state.height);

	glDisable(GL_DEPTH_TEST);
	glDisable(GL_CULL_FACE);
	glDisable(GL_BLEND);

	bindFullscreenQuad(pipeline.quad, pipeline.attrib_pos, pipeline.attrib_uv);

	glUniform2f(pipeline.uniform_resolution, static_cast<float>(state.width), static_cast<float>(state.height));
	glUniform1f(pipeline.uniform_scale, 1.0f);

	backend.setActiveTextureUnit(kTexUnitPostProcess);
	backend.bindTexture2D(state.colorTex);

	glDrawArrays(GL_TRIANGLES, 0, 6);
}

void renderCRTGLES2State(OpenGLES2Backend& backend, CRTGLES2State& pipeline, const CRTPipelineState& state) {
	glUseProgram(pipeline.program);
	glUniform1i(pipeline.uniform_texture, kTexUnitPostProcess);
	if (kCRTVerboseLog) {
		auto* srcTex = OpenGLES2Backend::asTexture(state.colorTex);
		std::fprintf(stderr,
						"[BMSX][GLES2][CRT] render backbuffer_fbo=%u colorTex=%u size=%dx%d base=%dx%d\n",
						static_cast<unsigned>(backend.backbuffer()),
						static_cast<unsigned>(srcTex->id), state.width,
						state.height, state.baseWidth, state.baseHeight);
	}
	updateFullscreenQuad(pipeline.quad, state.width, state.height);

	backend.setRenderTarget(backend.backbuffer(), state.width, state.height);

	glDisable(GL_DEPTH_TEST);
	glDisable(GL_CULL_FACE);
	glDisable(GL_BLEND);

	bindFullscreenQuad(pipeline.quad, pipeline.attrib_pos, pipeline.attrib_uv);

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

void renderPresent(GPUBackend* backend, GameView*, void*, RenderPassStateStorage& state, void* context) {
	renderPresentGLES2State(
		*static_cast<OpenGLES2Backend*>(backend),
		*static_cast<PresentGLES2State*>(context),
		state.present);
}

void renderCRT(GPUBackend* backend, GameView*, void*, RenderPassStateStorage& state, void* context) {
	renderCRTGLES2State(
		*static_cast<OpenGLES2Backend*>(backend),
		*static_cast<CRTGLES2State*>(context),
		state.crt);
}

void registerPresentGLES2Pass(RenderPassLibrary& registry, PresentGLES2State& pipeline) {
	RenderPassDef desc;
	desc.id = "present";
	desc.name = "Present";
	setAutoPresentGraph(desc);
	desc.context = &pipeline;
	desc.exec = renderPresent;
	desc.shouldExecute = shouldExecuteAutoPresentPass;
	registry.registerPass(desc);
}

void registerCRTGLES2Pass(RenderPassLibrary& registry, CRTGLES2State& pipeline) {
	RenderPassDef desc;
	desc.id = "crt";
	desc.name = "Present/CRT";
	setAutoCRTGraph(desc);
	desc.context = &pipeline;
	desc.exec = renderCRT;
	desc.shouldExecute = shouldExecuteAutoCRTPass;
	registry.registerPass(desc);
}

} // namespace CRTPipeline
} // namespace bmsx
