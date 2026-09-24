#include "render/video_presenter.h"
#include "render/backend/gles2/backend.h"
#include "render/backend/pass/library.h"
#include "machine/devices/gx/device_output.h"
#include "machine/cpu/cpu.h"
#include "machine/memory/memory.h"
#include "machine/devices/irq/controller.h"
#include "machine/scheduler/device.h"
#include "spec/bmsx/model.h"
#include "support/cartridge_fixture.h"
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <iostream>
#include <stdexcept>

using namespace bmsx;

static void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

class TestVideoOutput final : public VideoOutput {
	void setDisplaySize(i32, i32) override {}
};

// Real device-output owners, with disabled display circuits and a fixed background.
struct OutputFixture {
	std::array<u8, 1> rom{};
	Memory memory{MemoryInit{{rom.data(), 0u}, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes};
	IrqController irq{memory};
	ExecutionAddressSpace addressSpace{memory};
	CPU cpu{memory, irq, addressSpace};
	DeviceScheduler scheduler{cpu};
	DmaController dma{memory, cpu, irq, scheduler};
	GxGpuCommandBuffer commands{dma};
	GxGpuReadbackPort readback{dma};
	std::array<u32, GX_GPU_PCRTC_CONFIG_WORD_COUNT> words{};
	GxGpuPcrtcTiming timing{};
	GxGpuPcrtcScanout scanout{};
	std::vector<u8> vram = std::vector<u8>(PSX_MACHINE_SPEC.gxGpuVramBytes);
	GxGpuDeviceOutput output{commands, readback, words, timing, scanout, vram};
};

static RgbaImage capture(std::unique_ptr<GPUBackend> backend) {
	TestVideoOutput video;
	backend->resizePresentationTarget(65, 3);
	VideoPresenter presenter(video, std::move(backend), 65, 3);
	presenter.installRenderPipeline(std::make_unique<RenderPassLibrary>(&presenter.backend(), &presenter));
	bool unavailable = false;
	try { presenter.captureGameFrame(); } catch (const std::runtime_error&) { unavailable = true; }
	require(unavailable, "unpublished history must not return initial black pixels");
	OutputFixture fixture;
	fixture.scanout.backgroundColor = 0x00332211;
	fixture.scanout.revision += 1;
	presenter.configurePresentation(VideoPresenter::PresentationMode::Completed, true);
	presenter.present(fixture.output, 0, 0);
	const auto sequence = presenter.gameFrameSequence();
	const RgbaImage first = presenter.captureGameFrame();
	require(first.width == 65 && first.height == 3, "native dimensions");
	for (size_t i = 0; i < first.pixels.size(); i += 4) {
		require(first.pixels[i] == 0x11 && first.pixels[i + 1] == 0x22 && first.pixels[i + 2] == 0x33 && first.pixels[i + 3] == 255,
			"native capture must not gamma-encode or include CRT effects");
	}
	// Held presentation changes host size and paints an opaque overlay, but not history.
	presenter.setFixedRenderTargetSize(130, 6);
	RectRenderSubmission fill;
	fill.kind = RectRenderKind::Fill; fill.area = {.left = 0, .top = 0, .right = 130, .bottom = 6};
	fill.color = 0xffffffff;
	const Host2DKind kind = Host2DKind::Rect;
	const Host2DRef ref{.rect = &fill};
	presenter.hostOverlayQueue.publishOverlayFrame({130, 6, &kind, &ref, 1});
	fixture.scanout.backgroundColor = 0x00665544;
	fixture.scanout.revision += 1;
	presenter.configurePresentation(VideoPresenter::PresentationMode::Partial, false);
	presenter.present(fixture.output, 0, 0);
	require(presenter.gameFrameSequence() == sequence, "UI repaint must not advance game-frame identity");
	require(presenter.captureGameFrame().pixels == first.pixels, "overlay/partial frame must not contaminate completed history");
	presenter.configurePresentation(VideoPresenter::PresentationMode::Completed, true);
	presenter.present(fixture.output, 0, 0);
	require(presenter.captureGameFrame().pixels != first.pixels && presenter.gameFrameSequence() != sequence,
		"committed image replaces history without mutating owned captures");
	presenter.setScanoutSize(66, 3);
	require(!presenter.gameFrameSequence(), "graph replacement retires frame availability");
	return first;
}

int main() {
	const EGLDisplay display = eglGetPlatformDisplay(EGL_PLATFORM_SURFACELESS_MESA, EGL_DEFAULT_DISPLAY, nullptr);
	require(eglInitialize(display, nullptr, nullptr), "initialize EGL");
	require(eglBindAPI(EGL_OPENGL_ES_API), "bind GLES");
	const EGLint attributes[]{EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
		EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8, EGL_NONE};
	EGLConfig config; EGLint count;
	require(eglChooseConfig(display, attributes, &config, 1, &count) && count == 1, "choose EGL config");
	const EGLint dimensions[]{EGL_WIDTH, 130, EGL_HEIGHT, 6, EGL_NONE};
	const EGLSurface surface = eglCreatePbufferSurface(display, config, dimensions);
	const EGLint contextAttributes[]{EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};
	const EGLContext context = eglCreateContext(display, config, EGL_NO_CONTEXT, contextAttributes);
	require(eglMakeCurrent(display, surface, surface, context), "make GLES context current");
	{
		auto native = std::make_unique<OpenGLES2Backend>(65, 3, false, PSX_MACHINE_SPEC.gxGpuVramBytes);
		native->setContextCallbacks([]() -> uintptr_t { return 0; }, eglGetProcAddress);
		native->onContextReset();
		// Odd height and non-aligned width, distinct rows/channels: no orientation ambiguity.
		const auto texture = native->createColorTexture(65, 3, nullptr);
		void* target = native->createRenderTarget(texture, nullptr);
		native->activateRenderTarget(target, 65, 3);
		glEnable(GL_SCISSOR_TEST);
		std::vector<u8> expected(65 * 3 * 4);
		for (i32 y = 0; y < 3; ++y) for (i32 x = 0; x < 65; ++x) {
			const u8 r = static_cast<u8>(x + y * 65), g = static_cast<u8>(y * 63), b = static_cast<u8>(255 - x);
			const size_t at = static_cast<size_t>(y * 65 + x) * 4;
			expected[at] = r; expected[at + 1] = g; expected[at + 2] = b; expected[at + 3] = 255;
			glScissor(x, 2 - y, 1, 1); glClearColor(r / 255.0F, g / 255.0F, b / 255.0F, 1); glClear(GL_COLOR_BUFFER_BIT);
		}
		glDisable(GL_SCISSOR_TEST);
		GLint previous; glGetIntegerv(GL_FRAMEBUFFER_BINDING, &previous);
		require(native->readColorTexture(texture, 65, 3) == expected, "GLES color readback must normalize origin and preserve channels");
		GLint bound; glGetIntegerv(GL_FRAMEBUFFER_BINDING, &bound);
		require(bound == previous, "readback preserves the active render target");
		native->activateDefaultRenderTarget(); native->destroyRenderTarget(target); native->destroyTexture(texture);
		const auto gles = capture(std::move(native));
		auto softwareBackend = std::make_unique<SoftwareBackend>(65, 3, PSX_MACHINE_SPEC.gxGpuVramBytes);
		const auto softwareTexture = softwareBackend->createTexture(expected.data(), 65, 3, RGBA8_LINEAR_TEXTURE_PARAMS);
		require(softwareBackend->readColorTexture(softwareTexture, 65, 3) == expected, "software ARGB words must emit top-down RGBA bytes");
		softwareBackend->destroyTexture(softwareTexture);
		const auto software = capture(std::move(softwareBackend));
		require(gles.pixels == software.pixels, "software/GLES2 capture parity");
		require(glGetError() == GL_NO_ERROR, "capture leaves no GLES error");
	}
	eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
	eglDestroyContext(display, context); eglDestroySurface(display, surface); eglTerminate(display);
	std::cout << "GAME-CAPTURE:PASS\n";
}
