#include "common/hash.h"
#include "machine/devices/gx/device_output.h"
#include "render/backend/gles2/backend.h"
#include "render/backend/gles2/fullscreen_quad.h"
#include "render/post/crt/gles2/shaders/crt_post_shaders.h"
#include "render/backend/pass/library.h"
#include "render/backend/texture_params.h"
#include "render/post/crt/noise.h"
#include "spec/bmsx/model.h"
#include "support/gpu_output_fixture.h"
#include <EGL/egl.h>
#include <algorithm>
#include <array>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <stdexcept>
#include <vector>
extern "C" {
#include "video_context.h"
}

using namespace bmsx;

static GLuint presentationFramebuffer = 0;

static void require(bool value, const char* message) {
	if (!value) throw std::runtime_error(message);
}

int main(int argc, char** argv) {
	std::setvbuf(stdout, nullptr, _IOLBF, 0);
	u32 fingerprint = 0x12345678u;
	for (const u8 value : CRTPipeline::noiseTextureBytes()) fingerprint = fmix32(fingerprint ^ value);
	require(fingerprint == 0xa0a78f1au, "shared TS/C++ grain corpus fingerprint");
	bool framebuffer = false, measure = false;
	i32 width = 320, height = 240;
	const char* output = nullptr;
	const char* reference = nullptr;
	for (int index = 1; index < argc; ++index) {
		if (std::strcmp(argv[index], "--fb") == 0) framebuffer = true;
		else if (std::strcmp(argv[index], "--measure") == 0) measure = true;
		else if (std::strcmp(argv[index], "--output") == 0) output = argv[++index];
		else if (std::strcmp(argv[index], "--reference") == 0) reference = argv[++index];
		else if (std::strcmp(argv[index], "--size") == 0) {
			width = std::stoi(argv[++index]);
			height = std::stoi(argv[++index]);
		}
		else throw std::runtime_error("unknown CRT test argument");
	}
	EGLDisplay display = EGL_NO_DISPLAY;
	EGLSurface surface = EGL_NO_SURFACE;
	EGLContext context = EGL_NO_CONTEXT;
	if (framebuffer) {
		bmsx_video_context_open(BMSX_VIDEO_CONTEXT_FBDEV, false);
		require(bmsx_video_context_enable_gles2(), "open framebuffer GLES2 context");
	} else {
		display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
		require(eglInitialize(display, nullptr, nullptr), "initialize EGL");
		require(eglBindAPI(EGL_OPENGL_ES_API), "bind GLES");
		const EGLint attributes[]{EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
			EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8, EGL_NONE};
		EGLConfig config; EGLint count;
		require(eglChooseConfig(display, attributes, &config, 1, &count) && count == 1, "choose GLES config");
		const EGLint dimensions[]{EGL_WIDTH, width, EGL_HEIGHT, height, EGL_NONE};
		surface = eglCreatePbufferSurface(display, config, dimensions);
		const EGLint contextAttributes[]{EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};
		context = eglCreateContext(display, config, EGL_NO_CONTEXT, contextAttributes);
		require(eglMakeCurrent(display, surface, surface, context), "make GLES context current");
	}
	std::ofstream images;
	if (output) images.open(output, std::ios::binary);
	{
		OpenGLES2Backend backend(width, height, false, PSX_MACHINE_SPEC.gxGpuVramBytes);
		backend.setContextCallbacks([]() -> uintptr_t { return presentationFramebuffer; }, eglGetProcAddress);
		backend.onContextReset();
		RenderPassLibrary library(&backend, nullptr);
		auto& state = library.getStateRef<CRTPipelineState>("crt");
		state.width = state.srcWidth = width;
		state.height = state.srcHeight = height;
		std::vector<u8> source(width * height * 4), pixels(source.size()), repeated(source.size());
		for (i32 y = 0; y < height; ++y) for (i32 x = 0; x < width; ++x) {
			const size_t at = (y * width + x) * 4;
			source[at] = x < width / 2 ? 128u : static_cast<u8>(x * 37u);
			source[at + 1u] = x < width / 2 ? 128u : static_cast<u8>(y * 47u);
			source[at + 2u] = x < width / 2 ? 128u : static_cast<u8>(x * 11u + y * 13u);
			source[at + 3u] = 255u;
		}
		state.colorTex = backend.createTexture(source.data(), width, height, RGBA8_LINEAR_TEXTURE_PARAMS);
		// The custom host supplies a native-sized texture FBO, not its 720p window.
		const auto destination = backend.createTexture(nullptr, width, height, RGBA8_LINEAR_TEXTURE_PARAMS);
		void* target = backend.createRenderTarget(destination, nullptr);
		presentationFramebuffer = backend.framebufferName(target);
		GLuint referenceProgram = 0;
		FullscreenQuad referenceQuad;
		GLint referencePosition = -1, referenceUv = -1;
		if (reference) {
			std::ifstream input(reference);
			const std::string code{std::istreambuf_iterator<char>{input}, std::istreambuf_iterator<char>{}};
			referenceProgram = backend.buildProgram(kPostGLES2FullscreenVertexShader, code.c_str(), "crt_reference");
			referencePosition = glGetAttribLocation(referenceProgram, "a_position");
			referenceUv = glGetAttribLocation(referenceProgram, "a_texcoord");
			createFullscreenQuad(referenceQuad);
			updateFullscreenQuad(referenceQuad, width, height);
			glUseProgram(referenceProgram);
			glUniform2f(glGetUniformLocation(referenceProgram, "u_resolution"), width, height);
			glUniform1f(glGetUniformLocation(referenceProgram, "u_scale"), 1);
			glUniform2f(glGetUniformLocation(referenceProgram, "u_srcResolution"), width, height);
			glUniform2f(glGetUniformLocation(referenceProgram, "u_srcTexel"), 1.0f / width, 1.0f / height);
			glUniform1i(glGetUniformLocation(referenceProgram, "u_texture"), 3);
			glUniform1f(glGetUniformLocation(referenceProgram, "u_time"), 128);
			glUniform1f(glGetUniformLocation(referenceProgram, "u_random"), 0.375f);
		}
		test::GpuOutputFixture fixture;
		backend.beginFrame();
		for (const u32 flags : {0u, 1u, 2u, 4u, 8u, 16u, 32u, 64u, 17u, 3u, 18u, 54u, 55u, 118u, 119u, 63u})
		for (const u32 phase : {49152u, 0u, 131071u}) {
			if (measure && (phase != 49152u || flags == 64u)) continue;
			state.options.applyNoise = (flags & 1u) != 0u;
			state.options.applyColorBleed = (flags & 2u) != 0u;
			state.options.applyScanlines = (flags & 4u) != 0u;
			state.options.applyBlur = (flags & 8u) != 0u;
			state.options.applyGlow = (flags & 16u) != 0u;
			state.options.applyFringing = (flags & 32u) != 0u;
			state.options.applyAperture = (flags & 64u) != 0u;
			state.noisePhase = phase;
			if (reference) {
				glUseProgram(referenceProgram);
				const std::array<const char*, 7> names{"u_enableNoise", "u_enableColorBleed", "u_enableScanlines",
					"u_enableBlur", "u_enableGlow", "u_enableFringing", "u_enableAperture"};
				for (u32 bit = 0; bit < names.size(); ++bit)
					glUniform1i(glGetUniformLocation(referenceProgram, names[bit]), (flags >> bit) & 1u);
				glUniform1f(glGetUniformLocation(referenceProgram, "u_noiseIntensity"), state.options.noiseIntensity);
				glUniform3fv(glGetUniformLocation(referenceProgram, "u_colorBleed"), 1, state.options.colorBleed.data());
				glUniform1f(glGetUniformLocation(referenceProgram, "u_blurIntensity"), state.options.blurIntensity);
				glUniform3fv(glGetUniformLocation(referenceProgram, "u_glowColor"), 1, state.options.glowColor.data());
				backend.setRenderTarget(presentationFramebuffer, width, height);
				backend.setActiveTextureUnit(3);
				backend.bindTexture2D(state.colorTex);
				bindFullscreenQuad(referenceQuad, referencePosition, referenceUv);
				for (u32 warmup = 0; warmup < 4u; ++warmup) {
					glClear(GL_COLOR_BUFFER_BIT); glDrawArrays(GL_TRIANGLES, 0, 6); glFinish();
				}
				const auto start = std::chrono::steady_clock::now();
				const u32 samples = measure ? 40u : 2u;
				for (u32 frame = 0; frame < samples; ++frame) {
					glClear(GL_COLOR_BUFFER_BIT); glDrawArrays(GL_TRIANGLES, 0, 6); glFinish();
				}
				const double elapsed = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count() / samples;
				std::printf("CRT reference flags=%u avg_ms=%.3f\n", flags, elapsed);
				glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, repeated.data());
				if (flags == 1u) {
					std::array<bool, 256> levels{};
					for (i32 y = 0; y < height; ++y) for (i32 x = 0; x < width / 2; ++x)
						levels[repeated[(y * width + x) * 4]] = true;
					std::printf("CRT reference noise grey_levels=%zu\n", static_cast<size_t>(std::count(levels.begin(), levels.end(), true)));
				}
			}
			for (u32 warmup = 0; warmup < 4u; ++warmup) {
				glClear(GL_COLOR_BUFFER_BIT); library.execute("crt", nullptr, fixture.output); glFinish();
			}
			const auto start = std::chrono::steady_clock::now();
			const u32 samples = measure ? 40u : 2u;
			for (u32 frame = 0; frame < samples; ++frame) {
				glClear(GL_COLOR_BUFFER_BIT); library.execute("crt", nullptr, fixture.output); glFinish();
			}
			const double elapsed = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count() / samples;
			glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, pixels.data());
			if (reference && (flags & 1u) == 0u) require(pixels == repeated, "non-noise effects preserve reference shader pixels");
			if (flags == 1u || flags == 3u || flags == 17u) {
				const auto noise = CRTPipeline::noiseTextureBytes();
				for (i32 y = 0; y < height; ++y) for (i32 x = 0; x < width / 2; ++x) {
					const u32 nx = (x + (state.noisePhase & 511u)) & 511u;
					const u32 ny = (y + state.noisePhase / 512u) & 255u;
					const size_t at = (ny * 512u + nx) * 4u;
					const float pixelGrain = noise[at] / 255.0f - 0.5f;
					const float lineGrain = noise[at + 1u] / 255.0f - 0.5f;
					std::array<float, 3> color{128.0f / 255.0f, 128.0f / 255.0f, 128.0f / 255.0f};
					if (state.options.applyColorBleed)
						for (u32 c = 0; c < 3u; ++c) color[c] += state.options.colorBleed[c];
					if (state.options.applyGlow) {
						const float lum = color[0] * 0.299f + color[1] * 0.587f + color[2] * 0.114f;
						for (u32 c = 0; c < 3u; ++c) color[c] += state.options.glowColor[c] * lum;
					}
					const float lum = color[0] * 0.299f + color[1] * 0.587f + color[2] * 0.114f;
					const float amplitude = (pixelGrain * 0.65f + lineGrain * 0.35f)
						* state.options.noiseIntensity * (1.0f - 0.8f * lum);
					for (u32 c = 0; c < 3u; ++c) {
						const int expected = static_cast<int>(color[c] * (1.0f + amplitude) * 255.0f + 0.5f);
						const int actual = pixels[(y * width + x) * 4u + c];
						if (std::abs(actual - expected) > 1)
							throw std::runtime_error("CRT grain flags=" + std::to_string(flags) + " x=" + std::to_string(x)
								+ " y=" + std::to_string(y) + " channel=" + std::to_string(c)
								+ " expected=" + std::to_string(expected) + " actual=" + std::to_string(actual));
					}
				}
			}
			glClear(GL_COLOR_BUFFER_BIT);
			library.execute("crt", nullptr, fixture.output);
			glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, repeated.data());
			require(pixels == repeated, "identical CRT state produces identical output");
			std::array<bool, 256> levels{};
			for (i32 y = 0; y < height; ++y) for (i32 x = 0; x < width / 2; ++x)
				levels[pixels[(y * width + x) * 4]] = true;
			std::printf("CRT flags=%u avg_ms=%.3f grey_levels=%zu\n", flags, elapsed,
				static_cast<size_t>(std::count(levels.begin(), levels.end(), true)));
			if (output) images.write(reinterpret_cast<const char*>(pixels.data()), pixels.size());
		}
		require(glGetError() == GL_NO_ERROR, "CRT rendering leaves no GLES error");
		backend.destroyTexture(state.colorTex);
		backend.destroyRenderTarget(target);
		backend.destroyTexture(destination);
		presentationFramebuffer = 0;
		if (reference) { glDeleteProgram(referenceProgram); destroyFullscreenQuad(referenceQuad); }
		std::printf("CRT-GLES2:PASS %s\n", glGetString(GL_RENDERER));
	}
	if (framebuffer) bmsx_video_context_close();
	else {
		eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
		eglDestroyContext(display, context); eglDestroySurface(display, surface); eglTerminate(display);
	}
}
