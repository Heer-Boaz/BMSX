#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gpu_local_memory.h"
#include "machine/cpu/cpu.h"
#include "machine/memory/memory.h"
#include "machine/devices/irq/controller.h"
#include "machine/scheduler/device.h"
#include "render/backend/gles2/backend.h"
#include "render/backend/pass/library.h"
#include "render/video_presenter.h"
#include "spec/bmsx/model.h"
#include "support/cartridge_fixture.h"
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <iostream>
#include <stdexcept>

using namespace bmsx;

static void require(bool value, const char* message) {
	if (!value) throw std::runtime_error(message);
}

// The model's projected XY/UV packets enter the ordinary device and scanout
// owners. No scene/editor renderer or mutable gameplay cartridge participates.
struct TexturedModelFixture {
	std::array<u8, 1> rom{};
	Memory memory{MemoryInit{{rom.data(), 0u}, test::cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes};
	IrqController irq{memory};
	ExecutionAddressSpace addressSpace{memory};
	CPU cpu{memory, irq, addressSpace};
	DeviceScheduler scheduler{cpu};
	DmaController dma{memory, cpu, irq, scheduler};
	GxGpu gpu{memory, cpu, irq, scheduler, dma, PSX_MACHINE_SPEC.gxGpuVramBytes};

	TexturedModelFixture() {
		gpu.reset();
		gpu.replaceVramSnapshotBytes(std::vector<u8>(PSX_MACHINE_SPEC.gxGpuVramBytes));
		for (const auto [index, word] : std::array<std::pair<u32, u32>, 4>{{
			{GX_GPU_PCRTC_PMODE_LOW, 0x0000ff21u}, {GX_GPU_PCRTC_DISPFB1_LOW, (16u << 9u) | (GX_GPU_PSMGX16 << 15u)},
			{GX_GPU_PCRTC_DISPLAY1_LOW, 3u << 23u}, {GX_GPU_PCRTC_DISPLAY1_HIGH, 1023u | (255u << 12u)},
		}}) memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(index), word);
		// Direct16 texture page (512,256), three colors followed by a transparent texel.
		// Left face is flat modulated with neutral 80H; right face is raw textured.
		for (const u32 word : {
			0xe3000000u, 0xe407ffffu, 0xe5000000u,
			0xa0000000u, 0x01000200u, 0x00010004u, 0x03e0001fu, 0x00007c00u,
			0x24808080u, 0x00480008u, 0u, 0x00480048u, 0x01180003u, 0x00080008u, 0u,
			0x25010203u, 0x00480068u, 0u, 0x004800a8u, 0x01180003u, 0x00080068u, 0u,
		}) {
			gpu.writeGp0(word);
			scheduler.advanceTo(scheduler.currentNowCycles() + 10'000);
			gpu.onService(scheduler.currentNowCycles());
		}
		gpu.presentReadyFrameOnVblankEdge();
	}
};

class TestVideoOutput final : public VideoOutput {
public:
	using VideoOutput::VideoOutput;
	void setDisplaySize(i32, i32, i32 viewportWidth, i32 viewportHeight) override { visibleViewportBounds = RectBounds{0, 0, static_cast<f32>(viewportWidth), static_cast<f32>(viewportHeight), 0}; }
};

static std::vector<u8> render(std::unique_ptr<GPUBackend> backend, const GxGpuDeviceOutput& output) {
	TestVideoOutput video(256, 256);
	backend->resizePresentationTarget(256, 256);
	VideoPresenter presenter(video, std::move(backend), 256, 256);
	presenter.installRenderPipeline(std::make_unique<RenderPassLibrary>(&presenter.backend(), &presenter));
	presenter.configurePresentation(VideoPresenter::PresentationMode::Completed, true);
	presenter.present(output, 0, 0);
	return presenter.captureGameFrame().pixels;
}

int main() {
	const EGLDisplay display = eglGetPlatformDisplay(EGL_PLATFORM_SURFACELESS_MESA, EGL_DEFAULT_DISPLAY, nullptr);
	require(eglInitialize(display, nullptr, nullptr), "initialize explicit EGL renderer test");
	require(eglBindAPI(EGL_OPENGL_ES_API), "bind GLES");
	const EGLint attributes[]{EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
		EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8, EGL_NONE};
	EGLConfig config; EGLint count;
	require(eglChooseConfig(display, attributes, &config, 1, &count) && count == 1, "choose GLES config");
	const EGLint dimensions[]{EGL_WIDTH, 256, EGL_HEIGHT, 256, EGL_NONE};
	const EGLSurface surface = eglCreatePbufferSurface(display, config, dimensions);
	const EGLint contextAttributes[]{EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};
	const EGLContext context = eglCreateContext(display, config, EGL_NO_CONTEXT, contextAttributes);
	require(eglMakeCurrent(display, surface, surface, context), "make GLES context current");
	{
		TexturedModelFixture fixture;
		auto software = std::make_unique<SoftwareBackend>(256, 256, PSX_MACHINE_SPEC.gxGpuVramBytes);
		auto gles = std::make_unique<OpenGLES2Backend>(256, 256, false, PSX_MACHINE_SPEC.gxGpuVramBytes);
		gles->setContextCallbacks([]() -> uintptr_t { return 0; }, eglGetProcAddress); gles->onContextReset();
		const auto expected = render(std::move(software), fixture.gpu.readDeviceOutput());
		const auto actual = render(std::move(gles), fixture.gpu.readDeviceOutput());
		require(actual == expected, "GLES2 and CPU match for flat/raw textured projected model faces");
		for (const u32 dx : {0u, 96u}) for (const auto [x, rgb] : std::array<std::pair<u32, u32>, 4>{{
			{12, 0x0000ffu}, {32, 0x00ff00u}, {52, 0xff0000u}, {69, 0u},
		}}) {
			const size_t at = (71u * 256u + x + dx) * 4u;
			const u32 pixel = actual[at] | (actual[at + 1u] << 8u) | (actual[at + 2u] << 16u);
			require(pixel == rgb, "affine nearest texels, neutral flat modulation and transparent holes");
		}
		require(glGetError() == GL_NO_ERROR, "textured model rendering leaves no GLES error");
		std::cout << "GX-TEXTURED:PASS software/GLES2 " << glGetString(GL_RENDERER) << '\n';
	}
	eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
	eglDestroyContext(display, context); eglDestroySurface(display, surface); eglTerminate(display);
}
