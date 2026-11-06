#include "render/host_overlay/gles2/pipeline.h"
#include "render/host_overlay/software/renderer.h"
#include "support/host_overlay_fixture.h"
#include "spec/bmsx/model.h"
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <algorithm>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <vector>

using namespace bmsx;

static void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

int main() {
	// Explicit EGL test target: real GLES2 pipeline, no window-system or alternate-renderer fallback.
	const EGLDisplay display = eglGetPlatformDisplay(EGL_PLATFORM_SURFACELESS_MESA, EGL_DEFAULT_DISPLAY, nullptr);
	require(eglInitialize(display, nullptr, nullptr), "initialize EGL test display");
	require(eglBindAPI(EGL_OPENGL_ES_API), "bind GLES API");
	const EGLint configAttributes[]{EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
		EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8, EGL_NONE};
	EGLConfig config;
	EGLint count;
	require(eglChooseConfig(display, configAttributes, &config, 1, &count) && count == 1, "choose RGBA8 GLES2 pbuffer config");
	const EGLint surfaceAttributes[]{EGL_WIDTH, 64, EGL_HEIGHT, 48, EGL_NONE};
	const EGLSurface surface = eglCreatePbufferSurface(display, config, surfaceAttributes);
	const EGLint contextAttributes[]{EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};
	const EGLContext context = eglCreateContext(display, config, EGL_NO_CONTEXT, contextAttributes);
	require(eglMakeCurrent(display, surface, surface, context), "make GLES2 test context current");
	{
		OpenGLES2Backend backend(64, 48, false, PSX_MACHINE_SPEC.gxGpuVramBytes);
		backend.onContextReset();
		HostOverlayGLES2State pipeline;
		bootstrapHostOverlayGLES2(backend, pipeline);
		Host2DPipelineState state;
		state.width = state.overlayWidth = 64;
		state.height = state.overlayHeight = 48;
		test::HostOverlayFixture fixture;
		const HostOverlayClipRect full{0, 0, 64, 48};
		const HostOverlayClipRect clip{11, 9, 43, 34};
		const HostOverlayClipRect empty{20, 10, 20, 30};
		std::vector<u32> reference(64 * 48);
		std::vector<u32> clipped(64 * 48);
		const RectRenderSubmission translucentRed{RectRenderKind::Fill, {0, 0, 64, 48, 0}, 0x80ff0000u, Layer2D::IDE};
		std::vector<u8> alphaPixels(64 * 48 * 4);
		beginHostOverlayGLES2(backend, pipeline, state);
		glClearColor(0, 0, 0, 1);
		glClear(GL_COLOR_BUFFER_BIT);
		renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Rect, {.rect = &translucentRed});
		glReadPixels(0, 0, 64, 48, GL_RGBA, GL_UNSIGNED_BYTE, alphaPixels.data());
		endHostOverlayGLES2(backend, pipeline);
		require(glGetError() == GL_NO_ERROR, "GLES2 source-over alpha graphics error");
		for (size_t offset = 0; offset < alphaPixels.size(); offset += 4) {
			require(alphaPixels[offset] == 128 && alphaPixels[offset + 1] == 0 && alphaPixels[offset + 2] == 0,
				"GLES2 translucent red over opaque black must blend straight RGB once");
			require(alphaPixels[offset + 3] == 255, "GLES2 source-over must preserve opaque destination alpha");
		}
		for (const HostOverlayTransform transform : {IDENTITY_HOST_OVERLAY_TRANSFORM, HostOverlayTransform{0.5F, 3, 2}, HostOverlayTransform{2, 3, 2}}) {
			for (size_t index = 0; index < fixture.kinds.size(); ++index) {
				for (const HostOverlayClipRect* bounds : {&full, &clip, &empty}) {
					beginHostOverlayGLES2(backend, pipeline, state);
					renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Transform, {.transform = &transform});
					glClearColor(0, 0, 0, 0);
					glClear(GL_COLOR_BUFFER_BIT);
					renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Clip, {.clip = bounds});
					renderHost2DEntryGLES2(backend, pipeline, fixture.kinds[index], fixture.refs[index]);
					glReadPixels(0, 0, 64, 48, GL_RGBA, GL_UNSIGNED_BYTE, bounds == &full ? reference.data() : clipped.data());
					endHostOverlayGLES2(backend, pipeline);
					require(glGetError() == GL_NO_ERROR, "GLES2 host overlay graphics error");
					require(glIsEnabled(GL_SCISSOR_TEST) == GL_FALSE, "host overlay must release scissor state at pass end");
					if (bounds == &full) continue;
					int lit = 0;
					for (int y = 0; y < 48; ++y) {
						for (int x = 0; x < 64; ++x) {
							const bool inside = x >= bounds->left && x < bounds->right && y >= bounds->top && y < bounds->bottom;
							const size_t offset = static_cast<size_t>((47 - y) * 64 + x);
							require(clipped[offset] == (inside ? reference[offset] : 0), "GLES2 clipping must crop the original raster");
							lit += clipped[offset] != 0;
						}
					}
					require(bounds == &empty ? lit == 0 : lit > 0, "fixture must test both partial pixels and empty scissor");
				}
			}
		}
		for (const auto variant : {FontVariant::Msx, FontVariant::Tiny}) {
			for (const auto style : {FontStyle::Normal, FontStyle::Italic}) {
				Font font(variant, style);
				GlyphRenderSubmission text;
				text.font = &font;
				text.items = {"true\tgy\nfalse\ntrue"}; text.item_end = 18;
				text.has_background_color = true; text.background_color = 0xff223344;
				for (const f32 phase : {0.0F, 0.25F, 0.5F, 0.75F}) {
					text.x = 8 + phase; text.y = 7 + phase;
					beginHostOverlayGLES2(backend, pipeline, state);
					glClearColor(0, 0, 0, 0); glClear(GL_COLOR_BUFFER_BIT);
					renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Clip, {.clip = &clip});
					renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Glyphs, {.glyphs = &text});
					glReadPixels(0, 0, 64, 48, GL_RGBA, GL_UNSIGNED_BYTE, phase == 0 ? reference.data() : clipped.data());
					endHostOverlayGLES2(backend, pipeline);
					require(glGetError() == GL_NO_ERROR, "GLES2 bitmap font graphics error");
					if (phase != 0) require(clipped == reference, "fractional layout must not remove bitmap glyph rows or move text backgrounds");
				}
			}
		}
		// Compare coverage, clipping and tint against the software datapath at real
		// presentation scales. Ordinary atlas images following text stay nearest.
		SoftwareBackend software(64, 48, PSX_MACHINE_SPEC.gxGpuVramBytes);
		software.resizePresentationTarget(64, 48);
		HostImageRenderSubmission image;
		image.imgid = fixture.font.getGlyph('A').imgid;
		image.pos = {.x = 2, .y = 42};
		image.scale = {.x = 2, .y = 2};
		for (const auto variant : {FontVariant::Msx, FontVariant::Tiny}) {
			for (const auto style : {FontStyle::Normal, FontStyle::Italic}) {
				Font font(variant, style, FontSampling::Linear);
				GlyphRenderSubmission text;
				text.font = &font; text.x = 2; text.y = 2;
				text.items = {"Ag"}; text.item_end = 2; text.color = 0x80ff0000;
				for (const f32 scale : {1.0F, 1.5F, 2.0F, 3.0F, 3.75F}) {
					const HostOverlayTransform transform{scale, 0.25F, 0.5F};
					for (const HostOverlayClipRect* bounds : {&full, &clip}) {
						std::fill_n(software.framebuffer(), 64 * 48, 0xff000000);
						beginHostOverlaySoftware(software, state);
						beginHostOverlayGLES2(backend, pipeline, state);
						glClearColor(0, 0, 0, 1); glClear(GL_COLOR_BUFFER_BIT);
						renderHost2DEntrySoftware(software, Host2DKind::Transform, {.transform = &transform});
						renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Transform, {.transform = &transform});
						renderHost2DEntrySoftware(software, Host2DKind::Clip, {.clip = bounds});
						renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Clip, {.clip = bounds});
						renderHost2DEntrySoftware(software, Host2DKind::Glyphs, {.glyphs = &text});
						renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Glyphs, {.glyphs = &text});
						renderHost2DEntrySoftware(software, Host2DKind::Transform, {.transform = &IDENTITY_HOST_OVERLAY_TRANSFORM});
						renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Transform, {.transform = &IDENTITY_HOST_OVERLAY_TRANSFORM});
						renderHost2DEntrySoftware(software, Host2DKind::Clip, {.clip = &full});
						renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Clip, {.clip = &full});
						renderHost2DEntrySoftware(software, Host2DKind::Img, {.img = &image});
						renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Img, {.img = &image});
						glReadPixels(0, 0, 64, 48, GL_RGBA, GL_UNSIGNED_BYTE, alphaPixels.data());
						endHostOverlaySoftware(software);
						endHostOverlayGLES2(backend, pipeline);
						require(glGetError() == GL_NO_ERROR, "GLES2 smooth font graphics error");
						int partial = 0, maxError = 0;
						for (int y = 0; y < 48; ++y) for (int x = 0; x < 64; ++x) {
							const u32 expected = software.framebuffer()[y * 64 + x];
							const size_t offset = static_cast<size_t>(((47 - y) * 64 + x) * 4);
							const int shifts[]{16, 8, 0, 24};
							for (int channel = 0; channel < 4; ++channel) {
								const int error = std::abs(static_cast<int>((expected >> shifts[channel]) & 255u) - alphaPixels[offset + channel]);
								maxError = std::max(maxError, error);
								if (y >= 42) require(error == 0, "atlas image after smooth text must remain nearest sampled");
							}
							partial += y < 42 && alphaPixels[offset] > 0 && alphaPixels[offset] < 128;
						}
						// Bilinear hardware weights and UNORM output each round by at most one byte.
						if (maxError > 2) std::cerr << "font coverage error: " << maxError << " scale: " << scale << '\n';
						require(maxError <= 2, "GLES2 and software glyph coverage agree within hardware rounding");
						if (bounds == &full) require(partial > 0, "smooth glyphs include fractional coverage");
					}
				}
			}
		}
		fixture.glyphs.x = 2;
		fixture.glyphs.y = 3;
		fixture.glyphs.items = {"A\tB\nC"};
		fixture.glyphs.item_end = 5;
		const HostOverlayTransform doubled{2, 0, 0};
		for (const HostOverlayTransform* transform : {&IDENTITY_HOST_OVERLAY_TRANSFORM, &doubled}) {
			beginHostOverlayGLES2(backend, pipeline, state);
			require(pipeline.transform.scale == 1 && pipeline.transform.offsetX == 0, "new GLES2 pass resets transform");
			glClearColor(0, 0, 0, 0);
			glClear(GL_COLOR_BUFFER_BIT);
			renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Transform, {.transform = transform});
			renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Glyphs, {.glyphs = &fixture.glyphs});
			glReadPixels(0, 0, 64, 48, GL_RGBA, GL_UNSIGNED_BYTE, transform == &doubled ? clipped.data() : reference.data());
			endHostOverlayGLES2(backend, pipeline);
			require(glGetError() == GL_NO_ERROR, "GLES2 transformed glyph graphics error");
		}
		for (int y = 0; y < 48; ++y) {
			for (int x = 0; x < 64; ++x) {
				require(clipped[(47 - y) * 64 + x] == reference[(47 - y / 2) * 64 + x / 2], "GLES2 2x glyphs must reproduce each texel including tabs, newlines and backgrounds");
			}
		}
		// Logical layout does not own the backbuffer dimensions or GL's Y origin.
		state.overlayWidth = 128;
		state.overlayHeight = 96;
		const HostOverlayClipRect logicalClip{32, 24, 96, 72};
		const RectRenderSubmission white{RectRenderKind::Fill, {0, 0, 128, 96, 0}, 0xffffffff, Layer2D::IDE};
		beginHostOverlayGLES2(backend, pipeline, state);
		glClearColor(0, 0, 0, 0);
		glClear(GL_COLOR_BUFFER_BIT);
		renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Clip, {.clip = &logicalClip});
		renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Rect, {.rect = &white});
		glReadPixels(0, 0, 64, 48, GL_RGBA, GL_UNSIGNED_BYTE, clipped.data());
		endHostOverlayGLES2(backend, pipeline);
		require(glGetError() == GL_NO_ERROR, "GLES2 scaled target graphics error");
		for (int y = 0; y < 48; ++y) {
			for (int x = 0; x < 64; ++x) {
				const bool inside = x >= 16 && x < 48 && y >= 12 && y < 36;
				require(clipped[static_cast<size_t>(y * 64 + x)] == (inside ? 0xffffffff : 0), "logical clip must map to the physical target");
			}
		}
		// Compose a logical scope and clip before independently mapping the two target axes.
		state.overlayWidth = 8; state.overlayHeight = 3;
		const HostOverlayTransform scope{0.5F, 1, 0.5F};
		const HostOverlayClipRect scopeClip{1, 1, 3, 2};
		const RectRenderSubmission scopedWhite{RectRenderKind::Fill, {0, 0, 4, 3, 0}, 0xffffffff, Layer2D::IDE};
		beginHostOverlayGLES2(backend, pipeline, state);
		glClearColor(0, 0, 0, 0); glClear(GL_COLOR_BUFFER_BIT);
		renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Transform, {.transform = &scope});
		renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Clip, {.clip = &scopeClip});
		renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Rect, {.rect = &scopedWhite});
		glReadPixels(0, 0, 64, 48, GL_RGBA, GL_UNSIGNED_BYTE, clipped.data());
		endHostOverlayGLES2(backend, pipeline);
		require(glGetError() == GL_NO_ERROR, "GLES2 nonuniform frame projection graphics error");
		for (int y = 0; y < 48; ++y) {
			for (int x = 0; x < 64; ++x) {
				const bool inside = x >= 8 && x < 24 && y >= 16 && y < 32;
				require(clipped[(47 - y) * 64 + x] == (inside ? 0xffffffff : 0), "GLES2 scope and clip must share the frame projection");
			}
		}
		// Framebuffer textures have OpenGL's lower-left origin; UI coordinates do not.
		const u8 framePixels[]{0, 0, 255, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255};
		state.frameTexture = backend.createTexture(framePixels, 2, 2, RGBA8_LINEAR_TEXTURE_PARAMS);
		state.overlayWidth = 64; state.overlayHeight = 48;
		const HostFrameRenderSubmission frame{{8, 4, 40, 36, 0}};
		beginHostOverlayGLES2(backend, pipeline, state);
		glClearColor(0, 0, 0, 0); glClear(GL_COLOR_BUFFER_BIT);
		renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Frame, {.frame = &frame});
		glReadPixels(0, 0, 64, 48, GL_RGBA, GL_UNSIGNED_BYTE, reference.data());
		endHostOverlayGLES2(backend, pipeline);
		require(reference[(47 - 8) * 64 + 12] == 0xff0000ff && reference[(47 - 8) * 64 + 28] == 0xff00ff00,
			"embedded frame top row is not vertically flipped");
		require(reference[(47 - 24) * 64 + 12] == 0xffff0000 && reference[(47 - 24) * 64 + 28] == 0xffffffff,
			"embedded frame bottom row and nearest scaling");
		require(glGetError() == GL_NO_ERROR, "embedded frame graphics error");
		backend.destroyTexture(state.frameTexture);
		shutdownHostOverlayGLES2(backend, pipeline);
		backend.onContextDestroy();
	}
	eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
	eglDestroyContext(display, context);
	eglDestroySurface(display, surface);
	eglTerminate(display);
	std::cout << "HOST-OVERLAY-GLES2:PASS\n";
}
