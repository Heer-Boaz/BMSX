#include "render/host_overlay/gles2/pipeline.h"
#include "support/host_overlay_fixture.h"
#include "spec/bmsx/model.h"
#include <EGL/egl.h>
#include <EGL/eglext.h>
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
		for (size_t index = 0; index < fixture.kinds.size(); ++index) {
			for (const HostOverlayClipRect* bounds : {&full, &clip, &empty}) {
				beginHostOverlayGLES2(backend, pipeline, state);
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
		shutdownHostOverlayGLES2(backend, pipeline);
		backend.onContextDestroy();
	}
	eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
	eglDestroyContext(display, context);
	eglDestroySurface(display, surface);
	eglTerminate(display);
	std::cout << "HOST-OVERLAY-GLES2:PASS\n";
}
