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
#include <algorithm>
#include <cstring>
#include <iostream>
#include <stdexcept>
extern "C" {
#include "video_context.h"
}

namespace {
GLuint boundArrayBuffer = 0;
GLuint submissionBuffer = 0;
GLsizeiptr submissionBytes = 0;
GLsizeiptr writtenBytes = 0;
unsigned submissions = 0;
bool completeSubmissions = true;
unsigned readbacks = 0;
}

extern "C" void __real_glReadPixels(GLint, GLint, GLsizei, GLsizei, GLenum, GLenum, void*);
extern "C" void __wrap_glReadPixels(GLint x, GLint y, GLsizei width, GLsizei height, GLenum format, GLenum type, void* pixels) {
	++readbacks;
	__real_glReadPixels(x, y, width, height, format, type, pixels);
}
extern "C" void __real_glBindBuffer(GLenum, GLuint);
extern "C" void __real_glBufferData(GLenum, GLsizeiptr, const void*, GLenum);
extern "C" void __real_glBufferSubData(GLenum, GLintptr, GLsizeiptr, const void*);
extern "C" void __wrap_glBindBuffer(GLenum target, GLuint buffer) {
	if (target == GL_ARRAY_BUFFER) boundArrayBuffer = buffer;
	__real_glBindBuffer(target, buffer);
}
extern "C" void __wrap_glBufferData(GLenum target, GLsizeiptr bytes, const void* data, GLenum usage) {
	if (target == GL_ARRAY_BUFFER && usage == GL_STREAM_DRAW && data == nullptr) {
		if (submissions != 0) completeSubmissions &= writtenBytes == submissionBytes;
		submissionBuffer = boundArrayBuffer;
		submissionBytes = bytes;
		writtenBytes = 0;
		++submissions;
	}
	__real_glBufferData(target, bytes, data, usage);
}
extern "C" void __wrap_glBufferSubData(GLenum target, GLintptr offset, GLsizeiptr bytes, const void* data) {
	if (target == GL_ARRAY_BUFFER && boundArrayBuffer == submissionBuffer) {
		completeSubmissions &= offset == writtenBytes;
		writtenBytes += bytes;
	}
	__real_glBufferSubData(target, offset, bytes, data);
}

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
		gpu.writeGp1(0x09000001u);
		std::vector<u8> snapshot(PSX_MACHINE_SPEC.gxGpuVramBytes);
		// The first dirty checkpoint spans this untouched grid, so packing the
		// GPU staging image must preserve every possible raw word, including mask.
		for (u32 word = 0; word < 65536u; ++word) {
			const u32 at = (512u * 1024u + word) * 2u;
			snapshot[at] = static_cast<u8>(word);
			snapshot[at + 1u] = static_cast<u8>(word >> 8u);
		}
		// A four-bit atlas and CLUT exercise the compact signed texture
		// source varyings and rectangle UV wrapping/flips, as used by glyphs.
		for (u32 y = 0; y < 256; ++y) for (u32 x = 0; x < 64; ++x) {
			const u32 at = (y * 1024u + 320u + x) * 2u;
			const u32 index = (x + y) & 15u;
			const u32 word = index | (((index + 1u) & 15u) << 4u)
				| (((index + 2u) & 15u) << 8u) | (((index + 3u) & 15u) << 12u);
			snapshot[at] = static_cast<u8>(word);
			snapshot[at + 1u] = static_cast<u8>(word >> 8u);
		}
		for (u32 index = 0; index < 16; ++index) {
			const u32 at = (24u * 1024u + 320u + index) * 2u;
			const u32 word = index | ((31u - index) << 5u) | ((index * 2u) << 10u);
			snapshot[at] = static_cast<u8>(word);
			snapshot[at + 1u] = static_cast<u8>(word >> 8u);
		}
		gpu.replaceVramSnapshotBytes(snapshot);
		for (const auto [index, word] : std::array<std::pair<u32, u32>, 4>{{
			{GX_GPU_PCRTC_PMODE_LOW, 0x0000ff21u}, {GX_GPU_PCRTC_DISPFB1_LOW, (16u << 9u) | (GX_GPU_PSMGX16 << 15u)},
			{GX_GPU_PCRTC_DISPLAY1_LOW, 3u << 23u}, {GX_GPU_PCRTC_DISPLAY1_HIGH, 1023u | (255u << 12u)},
		}}) memory.writeMappedU32LE(gxGpuPcrtcRegisterAddress(index), word);
		// Direct16 texture page (512,256), three colors followed by a transparent texel.
		// Left face is flat modulated with neutral 80H; right face is raw textured.
		for (const u32 word : {
			0xe3000000u, 0xe40fffffu, 0xe5000000u,
			0xa0000000u, 0x01000200u, 0x00010004u, 0x03e0001fu, 0x00007c00u,
			0x24808080u, 0x00480008u, 0u, 0x00480048u, 0x01180003u, 0x00080008u, 0u,
			0x25010203u, 0x00480068u, 0u, 0x004800a8u, 0x01180003u, 0x00080068u, 0u,
			// Read-after-write blending needs a GPU-side sample-copy pass.
			0xe1000020u, 0x6200ff00u, 0x00080008u, 0x00100020u,
		}) {
			gpu.writeGp0(word);
			scheduler.advanceTo(scheduler.currentNowCycles() + 10'000);
			gpu.onService(scheduler.currentNowCycles());
		}
		// Updating an atlas after queued drawing must update the same retained
		// VRAM target, not leave its previous attachment contents visible.
		std::vector<u32> atlasUpload{0xa0000000u, 320u, (24u << 16u) | 50u};
		for (u32 pair = 0; pair < 50u * 24u / 2u; ++pair)
			atlasUpload.push_back(0x32100123u ^ (pair * 337u));
		for (const u32 word : atlasUpload) {
			gpu.writeGp0(word);
			scheduler.advanceTo(scheduler.currentNowCycles() + 10'000);
			gpu.onService(scheduler.currentNowCycles());
		}
		for (u32 flip = 0; flip < 4; ++flip) {
			for (const u32 word : {0xe1000005u | (flip << 12u),
				0x65808080u, (100u << 16u) | (8u + flip * 16u),
				((20u | (24u << 6u)) << 16u) | 0xfdfdu, 0x00080008u}) {
				gpu.writeGp0(word);
				scheduler.advanceTo(scheduler.currentNowCycles() + 10'000);
				gpu.onService(scheduler.currentNowCycles());
			}
		}
		// Masked CPU uploads cannot use the direct texture update path. The
		// destination wraps independently of the payload's packed 1024-word rows.
		std::vector<u32> upload{0xe6000001u, 0xa0000000u,
			(750u << 16u) | 1019u, (3u << 16u) | 615u};
		for (u32 i = 0; i < (615u * 3u + 1u) / 2u; ++i)
			upload.push_back((i * 337u) ^ 0x759a1357u);
		upload.push_back(0xe6000000u);
		for (const u32 word : upload) {
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

static std::vector<u8> render(std::unique_ptr<GPUBackend> backend, TexturedModelFixture& fixture) {
	TestVideoOutput video(256, 256);
	backend->resizePresentationTarget(256, 256);
	VideoPresenter presenter(video, std::move(backend), 256, 256);
	presenter.installRenderPipeline(std::make_unique<RenderPassLibrary>(&presenter.backend(), &presenter));
	presenter.configurePresentation(VideoPresenter::PresentationMode::Completed, true);
	presenter.present(fixture.gpu.readDeviceOutput(), 0, 0);
	const auto pixels = presenter.captureGameFrame().pixels;
	presenter.backend().captureGxGpuVramSnapshot(fixture.gpu);
	const unsigned beforeUnchangedCheckpoint = readbacks;
	presenter.backend().captureGxGpuVramSnapshot(fixture.gpu);
	require(readbacks == beforeUnchangedCheckpoint, "an unchanged VRAM checkpoint performs no GPU readback");
	// A later, disjoint high-row write must retain all earlier texture/drawing
	// bytes outside the new dirty region, including its row stride and origin.
	for (const u32 word : {0x6000ff00u, (901u << 16u) | 197u, 0x00020003u}) {
		fixture.gpu.writeGp0(word);
		fixture.scheduler.advanceTo(fixture.scheduler.currentNowCycles() + 10'000);
		fixture.gpu.onService(fixture.scheduler.currentNowCycles());
	}
	fixture.gpu.presentReadyFrameOnVblankEdge();
	presenter.present(fixture.gpu.readDeviceOutput(), 0, 0);
	presenter.backend().captureGxGpuVramSnapshot(fixture.gpu);
	return pixels;
}

int main(int argc, char** argv) {
	const bool framebuffer = argc == 2 && std::strcmp(argv[1], "--fb") == 0;
	EGLDisplay display = EGL_NO_DISPLAY;
	EGLSurface surface = EGL_NO_SURFACE;
	EGLContext context = EGL_NO_CONTEXT;
	if (framebuffer) {
		bmsx_video_context_open(BMSX_VIDEO_CONTEXT_FBDEV, false);
		require(bmsx_video_context_enable_gles2(), "open explicit framebuffer GLES2 context");
	} else {
	display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
	require(eglInitialize(display, nullptr, nullptr), "initialize explicit EGL renderer test");
	require(eglBindAPI(EGL_OPENGL_ES_API), "bind GLES");
	const EGLint attributes[]{EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
		EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8, EGL_NONE};
	EGLConfig config; EGLint count;
	require(eglChooseConfig(display, attributes, &config, 1, &count) && count == 1, "choose GLES config");
	const EGLint dimensions[]{EGL_WIDTH, 256, EGL_HEIGHT, 256, EGL_NONE};
	surface = eglCreatePbufferSurface(display, config, dimensions);
	const EGLint contextAttributes[]{EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};
	context = eglCreateContext(display, config, EGL_NO_CONTEXT, contextAttributes);
	require(eglMakeCurrent(display, surface, surface, context), "make GLES context current");
	}
	{
		TexturedModelFixture referenceFixture;
		TexturedModelFixture fixture;
		auto software = std::make_unique<SoftwareBackend>(256, 256, PSX_MACHINE_SPEC.gxGpuVramBytes);
		auto gles = std::make_unique<OpenGLES2Backend>(256, 256, false, PSX_MACHINE_SPEC.gxGpuVramBytes);
		gles->setContextCallbacks([]() -> uintptr_t { return 0; }, eglGetProcAddress); gles->onContextReset();
		const auto expected = render(std::move(software), referenceFixture);
		const auto actual = render(std::move(gles), fixture);
		const auto expectedVram = referenceFixture.gpu.readDeviceOutput().vramSnapshotBytes;
		const auto actualVram = fixture.gpu.readDeviceOutput().vramSnapshotBytes;
		require(expectedVram[(901u * 1024u + 197u) * 2u + 1u] == 3u,
			"the disjoint high-row rectangle actually changes VRAM");
		require(std::equal(expectedVram.begin(), expectedVram.end(), actualVram.begin()),
			"dirty-region VRAM checkpoints preserve every byte across disjoint writes");
		require(actual == expected, "GLES2 and CPU match for flat/raw textured projected model faces");
		for (const u32 dx : {0u, 96u}) for (const auto [x, rgb] : std::array<std::pair<u32, u32>, 4>{{
			{12, 0x0000ffu}, {32, 0x00ff00u}, {52, 0xff0000u}, {69, 0u},
		}}) {
			const size_t at = (71u * 256u + x + dx) * 4u;
			const u32 pixel = actual[at] | (actual[at + 1u] << 8u) | (actual[at + 2u] << 16u);
			require(pixel == rgb, "affine nearest texels, neutral flat modulation and transparent holes");
		}
		require(submissions > 1 && completeSubmissions && writtenBytes == submissionBytes,
			"GX streams orphan exactly the current ordered submission, not a live maximum-size arena");
		require(glGetError() == GL_NO_ERROR, "textured model rendering leaves no GLES error");
		std::cout << "GX-TEXTURED:PASS software/GLES2 " << glGetString(GL_RENDERER) << '\n';
	}
	if (framebuffer) bmsx_video_context_close();
	else {
		eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
		eglDestroyContext(display, context); eglDestroySurface(display, surface); eglTerminate(display);
	}
}
