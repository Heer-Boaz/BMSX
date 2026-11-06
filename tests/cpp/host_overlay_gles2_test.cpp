#include "render/host_overlay/gles2/pipeline.h"
#include "render/host_overlay/software/renderer.h"
#include "support/host_overlay_fixture.h"
#include "support/host_font_atlas_fixture.h"
#include "spec/bmsx/model.h"
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <algorithm>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <vector>

using namespace bmsx;

void testHostOverlayGLES2Batches(OpenGLES2Backend& backend, HostOverlayGLES2State& pipeline, const Host2DPipelineState& state);

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
		require(pipeline.atlases.empty(), "bootstrapping a renderer must not upload unused atlases");
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
		endHostOverlayGLES2(backend, pipeline);
		glReadPixels(0, 0, 64, 48, GL_RGBA, GL_UNSIGNED_BYTE, alphaPixels.data());
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
					endHostOverlayGLES2(backend, pipeline);
					glReadPixels(0, 0, 64, 48, GL_RGBA, GL_UNSIGNED_BYTE, bounds == &full ? reference.data() : clipped.data());
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
					endHostOverlayGLES2(backend, pipeline);
					glReadPixels(0, 0, 64, 48, GL_RGBA, GL_UNSIGNED_BYTE, phase == 0 ? reference.data() : clipped.data());
					require(glGetError() == GL_NO_ERROR, "GLES2 bitmap font graphics error");
					if (phase != 0) require(clipped == reference, "fractional layout must not remove bitmap glyph rows or move text backgrounds");
				}
			}
		}
		// Compare coverage, clipping and tint against the software datapath at real
		// presentation scales. Ordinary atlas images following text stay nearest.
		SoftwareBackend software(64, 48, PSX_MACHINE_SPEC.gxGpuVramBytes);
		software.resizePresentationTarget(64, 48);
		const test::HostFontAtlasFixture fontSources[]{{false, false}, {false, true}, {false, false}, {false, true}, {true, false}, {true, true}};
		const FontRendering fontModes[]{{FontRaster::Bitmap, FontSampling::Nearest}, {FontRaster::Bitmap, FontSampling::Linear},
			{FontRaster::Msdf, FontSampling::Linear, 3, 2}};
		const auto builtinAtlasCount = pipeline.atlases.size();
		for (int repeat = 0; repeat < 2; repeat++) {
			beginHostOverlaySoftware(software, state); beginHostOverlayGLES2(backend, pipeline, state);
			std::fill_n(software.framebuffer(), 64 * 48, 0);
			glClearColor(0, 0, 0, 0); glClear(GL_COLOR_BUFFER_BIT);
			for (int row = 0; row < 3; row++) for (int column = 0; column < 3; column++) {
				BFont font(fontSources[row * 2 + column % 2], {{'A', "fixture"}, {'?', "fixture"}}, 0, fontModes[row]);
				GlyphRenderSubmission text;
				text.font = &font; text.items = {"A"}; text.item_end = 1;
				text.x = 1 + column * 6; text.y = 1 + row * 6;
				renderHost2DEntrySoftware(software, Host2DKind::Glyphs, {.glyphs = &text});
				renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Glyphs, {.glyphs = &text});
			}
			endHostOverlaySoftware(software); endHostOverlayGLES2(backend, pipeline);
			glReadPixels(0, 0, 64, 48, GL_RGBA, GL_UNSIGNED_BYTE, alphaPixels.data());
			require(glGetError() == GL_NO_ERROR, "GLES2 source-owned atlas graphics error");
			require(pipeline.atlases.size() == builtinAtlasCount + 6, "atlas cache reuses texture storage across frames and font instances");
			for (int row = 0; row < 3; row++) for (int column = 0; column < 3; column++) {
				for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) {
					const int px = 1 + column * 6 + x, py = 1 + row * 6 + y;
					const bool lit = (x == y) == (column % 2 == 0);
					require(software.framebuffer()[py * 64 + px] == (lit ? 0xffffffffu : 0), "software glyphs consume their source atlas");
					const auto actual = alphaPixels[((47 - py) * 64 + px) * 4];
					if (actual != (lit ? 255 : 0)) std::cerr << "atlas pixel: repeat=" << repeat << " row=" << row << " column=" << column << " x=" << x << " y=" << y << " actual=" << static_cast<int>(actual) << " lit=" << lit << '\n';
					require(actual == (lit ? 255 : 0), "GLES2 glyphs consume their source atlas");
				}
			}
		}
		HostImageRenderSubmission image;
		image.imgid = fixture.font.getGlyph('A').imgid;
		image.pos = {.x = 2, .y = 42};
		const HostOverlayClipRect textArea{0, 0, 64, 40};
		image.scale = {.x = 2, .y = 2};
		for (const auto variant : {FontVariant::Msx, FontVariant::Tiny, FontVariant::Mono}) {
			for (const auto style : {FontStyle::Normal, FontStyle::Italic}) {
				Font font(variant, style, FontSampling::Linear);
				GlyphRenderSubmission text;
				text.font = &font; text.x = 2; text.y = 2;
				text.items = {"Ag"}; text.item_end = 2; text.color = 0x80ff0000;
				for (const f32 scale : {1.0F, 1.5F, 2.0F, 3.0F, 3.75F}) {
					const HostOverlayTransform transform{scale, 0.25F, 0.5F};
					for (const HostOverlayClipRect* bounds : {&textArea, &clip}) {
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
						endHostOverlaySoftware(software);
						endHostOverlayGLES2(backend, pipeline);
						glReadPixels(0, 0, 64, 48, GL_RGBA, GL_UNSIGNED_BYTE, alphaPixels.data());
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
						// MSDF amplifies bilinear distance error by screen range, then applies the 0.5 tint alpha.
						const f32 tolerance = variant == FontVariant::Mono ? 2 + scale : 2;
						if (maxError > tolerance) std::cerr << "font coverage error: " << maxError << " scale: " << scale << '\n';
						require(maxError <= tolerance, "GLES2 and software glyph coverage agree within hardware rounding");
						if (bounds == &textArea) require(partial > 0, "smooth glyphs include fractional coverage");
					}
				}
			}
		}
		// MSDF antialiasing follows physical pixel density, independently of layout units.
		Font scalable(FontVariant::Mono);
		GlyphRenderSubmission scalableText;
		scalableText.font = &scalable; scalableText.x = 1.25F; scalableText.y = 2.5F;
		scalableText.items = {"Ag"}; scalableText.item_end = 2;
		std::vector<u32> densitySoftware(64 * 48);
		for (const i32 density : {1, 2}) {
			state.overlayWidth = 64 / density; state.overlayHeight = 48 / density;
			const HostOverlayTransform transform{2.0F / density, 0, 0};
			std::fill_n(software.framebuffer(), 64 * 48, 0);
			beginHostOverlaySoftware(software, state);
			beginHostOverlayGLES2(backend, pipeline, state);
			glClearColor(0, 0, 0, 0); glClear(GL_COLOR_BUFFER_BIT);
			renderHost2DEntrySoftware(software, Host2DKind::Transform, {.transform = &transform});
			renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Transform, {.transform = &transform});
			renderHost2DEntrySoftware(software, Host2DKind::Glyphs, {.glyphs = &scalableText});
			renderHost2DEntryGLES2(backend, pipeline, Host2DKind::Glyphs, {.glyphs = &scalableText});
			endHostOverlaySoftware(software); endHostOverlayGLES2(backend, pipeline);
			glReadPixels(0, 0, 64, 48, GL_RGBA, GL_UNSIGNED_BYTE, density == 1 ? reference.data() : clipped.data());
			require(glGetError() == GL_NO_ERROR, "GLES2 scalable font density graphics error");
			if (density == 1) std::copy_n(software.framebuffer(), 64 * 48, densitySoftware.begin());
			else {
				require(reference == clipped, "GLES2 glyph coverage must depend on physical size, not logical units");
				require(std::equal(densitySoftware.begin(), densitySoftware.end(), software.framebuffer()),
					"software glyph coverage must depend on physical size, not logical units");
			}
		}
		state.overlayWidth = 64; state.overlayHeight = 48;
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
			endHostOverlayGLES2(backend, pipeline);
			glReadPixels(0, 0, 64, 48, GL_RGBA, GL_UNSIGNED_BYTE, transform == &doubled ? clipped.data() : reference.data());
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
		endHostOverlayGLES2(backend, pipeline);
		glReadPixels(0, 0, 64, 48, GL_RGBA, GL_UNSIGNED_BYTE, clipped.data());
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
		endHostOverlayGLES2(backend, pipeline);
		glReadPixels(0, 0, 64, 48, GL_RGBA, GL_UNSIGNED_BYTE, clipped.data());
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
		endHostOverlayGLES2(backend, pipeline);
		glReadPixels(0, 0, 64, 48, GL_RGBA, GL_UNSIGNED_BYTE, reference.data());
		require(reference[(47 - 8) * 64 + 12] == 0xff0000ff && reference[(47 - 8) * 64 + 28] == 0xff00ff00,
			"embedded frame top row is not vertically flipped");
		require(reference[(47 - 24) * 64 + 12] == 0xffff0000 && reference[(47 - 24) * 64 + 28] == 0xffffffff,
			"embedded frame bottom row and nearest scaling");
		require(glGetError() == GL_NO_ERROR, "embedded frame graphics error");
		testHostOverlayGLES2Batches(backend, pipeline, state);
		backend.destroyTexture(state.frameTexture);
		shutdownHostOverlayGLES2(backend, pipeline);
		require(pipeline.atlases.empty(), "shutdown releases every atlas texture from the renderer context");
		require(pipeline.drawList.vertices.capacity() == 0 && pipeline.drawList.batches.capacity() == 0,
			"shutdown releases retained draw-list storage");
		backend.onContextDestroy();
	}
	eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
	eglDestroyContext(display, context);
	eglDestroySurface(display, surface);
	eglTerminate(display);
	std::cout << "HOST-OVERLAY-GLES2:PASS\n";
}
