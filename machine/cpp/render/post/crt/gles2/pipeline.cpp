/*
 * crt/gles2/pipeline.cpp - GLES2 CRT post-processing pipeline
 */

#include "pipeline.h"
#include "render/post/crt/noise.h"
#include "render/backend/texture_params.h"

#include "render/backend/gles2/backend.h"
#include "render/backend/pass/library.h"
#include "render/video_presenter.h"
#include "render/backend/gles2/fullscreen_quad.h"
#include "render/backend/gles2/texture_units.h"
#include "render/post/crt/gles2/shaders/crt_post_shaders.h"

#include <cstdio>

#include <GLES2/gl2.h>

namespace bmsx {
namespace CRTPipeline {
namespace {

constexpr bool kCRTVerboseLog = false;

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

void initializeFullscreenPostProcessProgram(OpenGLES2Backend& backend, GLuint program, GLint uniformTexture, FullscreenQuad& quad) {
	createFullscreenQuad(backend.drawState, quad);
	backend.drawState.useProgram(program);
	glUniform1i(uniformTexture, GLES2_TEXTURE_UNIT_POST_PROCESSING_SOURCE);
}

void beginFullscreenPostProcessDraw(OpenGLES2Backend& backend,
										FullscreenQuad& quad,
										GLuint program,
										GLint attribPosition,
										GLint attribUv,
										GLuint targetFbo,
										i32 width,
										i32 height) {
	backend.drawState.useProgram(program);
	updateFullscreenQuad(backend.drawState, quad, width, height);
	backend.setRenderTarget(targetFbo, width, height);
	backend.drawState.disable(GLES2Capability::DepthTest);
	backend.drawState.disable(GLES2Capability::CullFace);
	backend.drawState.disable(GLES2Capability::Blend);
	bindFullscreenQuad(backend.drawState, quad, attribPosition, attribUv);
}

} // namespace

void initPresentGLES2(OpenGLES2Backend& backend, PresentGLES2State& pipeline) {
	pipeline.program = backend.buildProgram(kPostGLES2FullscreenVertexShader, kPresentFragmentShader, "present");

	pipeline.attrib_pos = glGetAttribLocation(pipeline.program, "a_position");
	pipeline.attrib_uv = glGetAttribLocation(pipeline.program, "a_texcoord");

	pipeline.uniform_resolution = glGetUniformLocation(pipeline.program, "u_resolution");
	pipeline.uniform_scale = glGetUniformLocation(pipeline.program, "u_scale");
	pipeline.uniform_texture = glGetUniformLocation(pipeline.program, "u_texture");

	initializeFullscreenPostProcessProgram(backend, pipeline.program, pipeline.uniform_texture, pipeline.quad);
}

void initCRTGLES2(OpenGLES2Backend& backend, CRTGLES2State& pipeline) {
	logFramebufferDitherState();
	createFullscreenQuad(backend.drawState, pipeline.quad);
}

static void initializeCrtProgram(OpenGLES2Backend& backend, CRTGLES2Program& pipeline, u32 effects) {
	char defines[256];
	std::snprintf(defines, sizeof(defines),
		"#define u_enableNoise %s\n#define u_enableColorBleed %s\n"
		"#define u_enableScanlines %s\n#define u_enableBlur %s\n"
		"#define u_enableGlow %s\n#define u_enableFringing %s\n#define u_enableAperture %s\n"
		"#define BMSX_CRT_NOISE_REPEAT %u\n",
		(effects & 1u) ? "true" : "false", (effects & 2u) ? "true" : "false",
		(effects & 4u) ? "true" : "false", (effects & 8u) ? "true" : "false",
		(effects & 16u) ? "true" : "false", (effects & 32u) ? "true" : "false",
		(effects & 64u) ? "true" : "false", (effects >> 7u) & 1u);
	pipeline.program = backend.buildProgram(kPostGLES2FullscreenVertexShader, kCRTFragmentShader, "crt", defines);

	pipeline.attrib_pos = glGetAttribLocation(pipeline.program, "a_position");
	pipeline.attrib_uv = glGetAttribLocation(pipeline.program, "a_texcoord");

	pipeline.uniform_resolution = glGetUniformLocation(pipeline.program, "u_resolution");
	pipeline.uniform_src_resolution = glGetUniformLocation(pipeline.program, "u_srcResolution");
	pipeline.uniform_src_texel = glGetUniformLocation(pipeline.program, "u_srcTexel");
	pipeline.uniform_scale = glGetUniformLocation(pipeline.program, "u_scale");
	pipeline.uniform_noise_offset = glGetUniformLocation(pipeline.program, "u_noiseOffset");
	pipeline.uniform_noise_intensity = glGetUniformLocation(pipeline.program, "u_noiseIntensity");
	pipeline.uniform_color_bleed = glGetUniformLocation(pipeline.program, "u_colorBleed");
	pipeline.uniform_blur_intensity = glGetUniformLocation(pipeline.program, "u_blurIntensity");
	pipeline.uniform_glow_color = glGetUniformLocation(pipeline.program, "u_glowColor");
	pipeline.uniform_texture = glGetUniformLocation(pipeline.program, "u_texture");

	backend.drawState.useProgram(pipeline.program);
	glUniform1i(pipeline.uniform_texture, GLES2_TEXTURE_UNIT_POST_PROCESSING_SOURCE);
	glUniform1i(glGetUniformLocation(pipeline.program, "u_noise"), GLES2_TEXTURE_UNIT_CRT_NOISE);
	if (kCRTVerboseLog) {
		std::fprintf(stderr,
						"[BMSX][GLES2][CRT] init program=%u attribs(pos=%d uv=%d) uniforms(res=%d srcRes=%d srcTexel=%d scale=%d noiseOffset=%d tex=%d)\n",
						static_cast<unsigned>(pipeline.program), pipeline.attrib_pos,
						pipeline.attrib_uv, pipeline.uniform_resolution,
						pipeline.uniform_src_resolution, pipeline.uniform_src_texel,
						pipeline.uniform_scale, pipeline.uniform_noise_offset, pipeline.uniform_texture);
	}
}

void shutdownCRTGLES2(OpenGLES2Backend& backend, CRTGLES2State& pipeline) {
	if (pipeline.noiseTexture != nullptr) backend.destroyTexture(pipeline.noiseTexture.release());
	for (const auto& program : pipeline.programs)
		if (program.program != 0) {
			backend.drawState.forgetProgram(program.program);
			glDeleteProgram(program.program);
		}
	destroyFullscreenQuad(backend.drawState, pipeline.quad);
	pipeline = CRTGLES2State{};
}

void shutdownPresentGLES2(OpenGLES2Backend& backend, PresentGLES2State& pipeline) {
	if (pipeline.program != 0) {
		backend.drawState.forgetProgram(pipeline.program);
		glDeleteProgram(pipeline.program);
	}
	destroyFullscreenQuad(backend.drawState, pipeline.quad);
	pipeline = PresentGLES2State{};
}



void renderPresentTextureGLES2State(OpenGLES2Backend& backend, PresentGLES2State& pipeline, GLuint targetFbo, const PresentPipelineState& state) {
	beginFullscreenPostProcessDraw(
		backend,
		pipeline.quad,
		pipeline.program,
		pipeline.attrib_pos,
		pipeline.attrib_uv,
		targetFbo,
		state.width,
		state.height);
	glUniform2f(pipeline.uniform_resolution, static_cast<float>(state.width), static_cast<float>(state.height));
	glUniform1f(pipeline.uniform_scale, 1.0f);

	backend.setActiveTextureUnit(GLES2_TEXTURE_UNIT_POST_PROCESSING_SOURCE);
	backend.bindTexture2D(state.colorTex);

	glDrawArrays(GL_TRIANGLES, 0, 6);
}

void executePresentationHistoryGLES2Pass(
	GPUBackend* backend,
	VideoPresenter*,
	void* fbo,
	RenderPassStateStorage& state,
	void* context,
	const GxGpuDeviceOutput&
) {
	auto& typedBackend = *static_cast<OpenGLES2Backend*>(backend);
	auto& typedPipeline = *static_cast<PresentGLES2State*>(context);
	renderPresentTextureGLES2State(typedBackend, typedPipeline, typedBackend.framebufferName(fbo), state.present);
}

void renderPresentGLES2State(OpenGLES2Backend& backend, PresentGLES2State& pipeline, const PresentPipelineState& state) {
	const GLuint targetFbo = backend.backbuffer();
	renderPresentTextureGLES2State(backend, pipeline, targetFbo, state);
}

void renderCRTGLES2State(OpenGLES2Backend& backend, CRTGLES2State& pipeline, const CRTPipelineState& state) {
	const auto& options = state.options;
	const u32 effects = static_cast<u32>(options.applyNoise)
		| (static_cast<u32>(options.applyColorBleed) << 1u)
		| (static_cast<u32>(options.applyScanlines) << 2u)
		| (static_cast<u32>(options.applyBlur) << 3u)
		| (static_cast<u32>(options.applyGlow) << 4u)
		| (static_cast<u32>(options.applyFringing) << 5u)
		| (static_cast<u32>(options.applyAperture) << 6u);
	// In this domain the unwrapped integer texel plus its half-texel center
	// remains exact in mediump. Larger sources keep the integer address reduction.
	const bool repeatNoise = options.applyNoise
		&& state.srcWidth <= static_cast<i32>(NOISE_WIDTH)
		&& state.srcHeight <= static_cast<i32>(NOISE_HEIGHT);
	const u32 programKey = effects | (static_cast<u32>(repeatNoise) << 7u);
	auto& program = pipeline.programs[programKey];
	if (program.program == 0) initializeCrtProgram(backend, program, programKey);
	if (kCRTVerboseLog) {
		auto* srcTex = OpenGLES2Backend::asTexture(state.colorTex);
		std::fprintf(stderr,
						"[BMSX][GLES2][CRT] render backbuffer_fbo=%u colorTex=%u size=%dx%d source=%dx%d\n",
						static_cast<unsigned>(backend.backbuffer()),
						static_cast<unsigned>(srcTex->id), state.width,
						state.height, state.srcWidth, state.srcHeight);
	}
	beginFullscreenPostProcessDraw(
		backend,
		pipeline.quad,
		program.program,
		program.attrib_pos,
		program.attrib_uv,
		backend.backbuffer(),
		state.width,
		state.height);
	glUniform2f(program.uniform_resolution, static_cast<float>(state.width), static_cast<float>(state.height));
	glUniform1f(program.uniform_scale, 1.0f);
	if (program.source_width != state.srcWidth || program.source_height != state.srcHeight) {
		program.source_width = state.srcWidth;
		program.source_height = state.srcHeight;
		glUniform2f(program.uniform_src_resolution, static_cast<float>(state.srcWidth), static_cast<float>(state.srcHeight));
		glUniform2f(program.uniform_src_texel, 1.0f / static_cast<float>(state.srcWidth), 1.0f / static_cast<float>(state.srcHeight));
	}
	if (state.options.applyNoise) {
		if (pipeline.noiseTexture == nullptr) {
			pipeline.noiseTexture.reset(OpenGLES2Backend::asTexture(
				backend.createTexture(noiseTextureBytes().data(), NOISE_WIDTH, NOISE_HEIGHT,
					TextureParams{.wrapS = GL_REPEAT, .wrapT = GL_REPEAT, .srgb = false})));
		}
		glUniform2f(program.uniform_noise_offset, static_cast<f32>(state.noisePhase & (NOISE_WIDTH - 1u)),
			static_cast<f32>(state.noisePhase / NOISE_WIDTH));
		backend.setActiveTextureUnit(GLES2_TEXTURE_UNIT_CRT_NOISE);
		backend.bindTexture2D(pipeline.noiseTexture.get());
		glUniform1f(program.uniform_noise_intensity, state.options.noiseIntensity);
	}

	if (state.options.applyColorBleed) {
		const auto& color = state.options.colorBleed;
		glUniform3f(program.uniform_color_bleed, color[0], color[1], color[2]);
	}
	if (state.options.applyBlur) glUniform1f(program.uniform_blur_intensity, state.options.blurIntensity);
	if (state.options.applyGlow) {
		const auto& color = state.options.glowColor;
		glUniform3f(program.uniform_glow_color, color[0], color[1], color[2]);
	}

	backend.setActiveTextureUnit(GLES2_TEXTURE_UNIT_POST_PROCESSING_SOURCE);
	backend.bindTexture2D(state.colorTex);

	glDrawArrays(GL_TRIANGLES, 0, 6);
}


void registerPresentationHistoryGLES2Pass(
	RenderPassLibrary& registry,
	PresentGLES2State& pipeline,
	const char* id,
	const char* name,
	RenderPassDef::RenderGraphSlot historySlot,
	bool (*shouldExecute)(VideoPresenter*, void*)) {
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
