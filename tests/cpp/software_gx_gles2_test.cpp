#include "render/backend/gles2/backend.h"
#include "render/backend/pass/library.h"
#include "render/backend/software/gx_gpu_execution.h"
#include "render/backend/software/gx_gpu_scanout.h"
#include "render/backend/software/gx_gpu_state.h"
#include "render/backend/texture_params.h"
#include "machine/devices/gx/gpu_local_memory.h"
#include "support/gpu_output_fixture.h"

#include <EGL/egl.h>
#include <array>
#include <iostream>
#include <stdexcept>

namespace bmsx {
void executeGxGpuPass(GPUBackend*, VideoPresenter*, void*, RenderPassStateStorage&, void*, const GxGpuPresentation&);
}
using namespace bmsx;
namespace {
void require(bool value, const char* message) { if (!value) throw std::runtime_error(message); }

void testPayloadProfile(OpenGLES2Backend& backend) {
	RenderPassLibrary library(&backend, nullptr);
	test::GpuOutputFixture fixture;
	fixture.commands.reset();
	const std::array<u32, 5> words{0xa0000000u, 0u, 0x00010003u, 0x00020001u, 0x99990003u};
	const size_t start = fixture.commands.appendWords(words.data(), words.size());
	fixture.commands.pushCommand(GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, 0xa0u, start, words.size(),
		0u, 0u, 0u, 0u, 0u, 0u, 0u, GX_GPU_SKIPPED_LINE_NONE);
	if (backend.profilesGxUploads()) backend.beginGxUploadProfileFrame();
	// The same accepted prefix can be consumed through the packet route and
	// then revisited by presentation; VRAM and profile both execute it once.
	fixture.commands.completeCommandExecution(1u);
	fixture.commands.sealCommandsForPresentation();
	backend.executeGxGpuCommands(fixture.commands);
	backend.executeGxGpuPresentation(fixture.output);
	std::array<u8, 6> pixels{};
	backend.readGxGpuVram({0u, 0u, 3u, 1u, 0u}, pixels.data());
	require(pixels == std::array<u8, 6>{1u, 0u, 2u, 0u, 3u, 0u}, "CPU-to-VRAM writes three raw pixels");
	GxUploadProfileFrame profile{};
	const bool reported = backend.readGxUploadProfileFrame(0u, profile);
	require(reported == backend.profilesGxUploads(), "GX profile remains opt-in");
	if (reported) {
		require(profile.commands == 1u && profile.logicalBytes == 6u
			&& profile.elapsedNanoseconds == profile.maxCommandNanoseconds,
			"profile counts only the three executed pixels, not the prefix revisit or packed padding");
		require(profile.hostCalls == 0u && profile.hostBytes == 0u && profile.scanoutUploadCalls == 0u,
			"software VRAM payload does not issue a GL transfer");
	}
}

void testScanoutImport(OpenGLES2Backend& backend) {
	test::GpuOutputFixture fixture;
	fixture.words = {
		0x0000ff21u, 0u,
		(16u << 9u) | (GX_GPU_PSMGX16 << 15u), 0u,
		3u << 23u, 1023u | (255u << 12u), 0u, 0u, 0u, 0u, 0u, 0u,
		0x40806504u, 7u, 0u, 0u, 0x1fc83030u, 0x0007f5c2u,
		0x003484bcu, 0u, 0x02101404u, 0x00a90005u,
	};
	fixture.output.vramReplacementSerial = 1u;
	for (size_t word = 0; word < fixture.vram.size() / 2u; ++word) {
		fixture.vram[word * 2u] = static_cast<u8>(word);
		fixture.vram[word * 2u + 1u] = static_cast<u8>(word >> 8u);
	}
	GxGpuSoftwareState reference(PSX_MACHINE_SPEC.gxGpuVramBytes, 0u);
	RenderPassLibrary library(&backend, nullptr);
	RenderPassStateStorage storage;
	auto& state = storage.gxGpu;
	for (const auto size : {std::array<i32, 2>{7, 5}, std::array<i32, 2>{13, 9}}) {
		state.width = size[0]; state.height = size[1];
		const auto texture = backend.createTexture(nullptr, state.width, state.height, RGBA8_LINEAR_TEXTURE_PARAMS);
		void* framebuffer = backend.createRenderTarget(texture, nullptr);
		std::vector<u32> expected((state.width + 3u) * state.height, 0xaabbccddu);
		for (const u32 format : {GX_GPU_PSMGX16, GX_GPU_PSMCT32}) {
			fixture.words[GX_GPU_PCRTC_DISPFB1_LOW] = (16u << 9u) | (format << 15u);
			fixture.words[GX_GPU_PCRTC_DISPLAY1_HIGH] = (state.width * 4u - 1u) | ((state.height - 1u) << 12u);
			for (u32 frame = 0; frame < 8u; ++frame) {
				fixture.words[GX_GPU_PCRTC_SMODE2_LOW] = frame < 4u ? 0u : GX_GPU_PCRTC_SMODE2_INT | GX_GPU_PCRTC_SMODE2_FFMD;
				fixture.timing.update(fixture.words);
				fixture.scanout.update(fixture.words, fixture.timing);
				fixture.scanout.setField(frame & 1u);
				for (u32 y = 0; y < static_cast<u32>(state.height); ++y) for (u32 x = 0; x < static_cast<u32>(state.width); ++x) {
					const u32 at = format == GX_GPU_PSMGX16 ? y * 1024u + x : gxGpuLocalMemoryAddress32(0u, 16u, x, y);
					if (format == GX_GPU_PSMGX16) {
						const u16 word = static_cast<u16>((x * 173u + y * 3167u + frame * 17171u));
						fixture.vram[at * 2u] = static_cast<u8>(word);
						fixture.vram[at * 2u + 1u] = static_cast<u8>(word >> 8u);
					} else {
						fixture.vram[at * 2u] = static_cast<u8>(x * 37u + frame);
						fixture.vram[at * 2u + 1u] = static_cast<u8>(y * 53u + frame * 3u);
						fixture.vram[at * 2u + 2u] = static_cast<u8>(x * 17u + y * 19u);
						fixture.vram[at * 2u + 3u] = static_cast<u8>(x * 83u + y * 67u);
					}
				}
				++fixture.output.vramSnapshotSerial;
				executeGxGpuSoftwareVramCommands(reference, fixture.output, 0u);
				scanoutGxGpuSoftwareVram(reference, expected.data(), state.width + 3,
					state, fixture.scanout, fixture.output.vramReplacementSerial);
				// Exercise both direct device ownership and immutable packet restore.
				if ((frame & 1u) == 0u) backend.executeGxGpuPresentation(fixture.output);
				else backend.replaceGxGpuVramSnapshot(fixture.vram, fixture.output.vramSnapshotSerial);
				if (backend.profilesGxUploads()) backend.beginGxUploadProfileFrame();
				executeGxGpuPass(&backend, nullptr, framebuffer, storage, nullptr, {fixture.scanout, fixture.output.vramReplacementSerial});
				GxUploadProfileFrame profile{};
				if (backend.readGxUploadProfileFrame(0u, profile)) {
					require(profile.commands == 0u && profile.logicalBytes == 0u && profile.hostCalls == 0u,
						"no CPU-to-VRAM counters are charged for software scanout");
					require(profile.softwareScanoutPixels == static_cast<u64>(state.width * state.height)
						&& profile.scanoutUploadCalls == 1u && profile.scanoutUploadBytes == profile.softwareScanoutPixels * sizeof(u32),
						"each scanout materializes and uploads only its actual surface");
					require(!backend.readGxUploadProfileFrame(profile.renderFrameSerial, profile), "do not expose the same frame twice");
				} else {
					require(!backend.profilesGxUploads(), "scanout exposes each opted-in profile frame");
				}
				const auto actual = backend.readColorTexture(texture, state.width, state.height);
				for (i32 y = 0; y < state.height; ++y) for (i32 x = 0; x < state.width; ++x) {
					const u32 pixel = expected[y * (state.width + 3) + x];
					const size_t at = (y * state.width + x) * 4u;
					require(actual[at] == static_cast<u8>(pixel >> 16u) && actual[at + 1u] == static_cast<u8>(pixel >> 8u)
						&& actual[at + 2u] == static_cast<u8>(pixel) && actual[at + 3u] == static_cast<u8>(pixel >> 24u),
						"scanout import preserves top-down channels, linear values, alpha and interlaced history");
				}
				for (i32 y = 0; y < state.height; ++y) for (i32 x = state.width; x < state.width + 3; ++x)
					require(expected[y * (state.width + 3) + x] == 0xaabbccddu, "scanout respects caller-owned row stride");
			}
		}
		backend.destroyRenderTarget(framebuffer);
		backend.destroyTexture(texture);
	}
	// Complete 16-bit values, including the mask bit, survive the CPU readback
	// path independently of the upload texture ring and display representation.
	std::array<u8, 14> actual{}, expected{};
	const GxGpuReadbackRequest request{1022u, 511u, 7u, 1u, 1u};
	backend.readGxGpuVram(request, actual.data());
	readGxGpuSoftwareVram(reference, request, expected.data());
	require(actual == expected && actual[0] == 0xfeu && actual[1] == 0xffu, "packet readback retains raw wrapping VRAM words");
	require(glGetError() == GL_NO_ERROR, "software GX import leaves no GL error");
}
}

int main() {
	const EGLDisplay display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
	require(eglInitialize(display, nullptr, nullptr), "initialize EGL");
	require(eglBindAPI(EGL_OPENGL_ES_API), "bind GLES");
	const EGLint attributes[]{EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
		EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8, EGL_NONE};
	EGLConfig config; EGLint count;
	require(eglChooseConfig(display, attributes, &config, 1, &count) && count == 1, "choose EGL config");
	const EGLint dimensions[]{EGL_WIDTH, 32, EGL_HEIGHT, 32, EGL_NONE};
	const EGLSurface surface = eglCreatePbufferSurface(display, config, dimensions);
	const EGLint contextAttributes[]{EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};
	const EGLContext context = eglCreateContext(display, config, EGL_NO_CONTEXT, contextAttributes);
	require(eglMakeCurrent(display, surface, surface, context), "make current");
	for (const bool profiling : {false, true}) {
		OpenGLES2Backend backend(32, 32, profiling, PSX_MACHINE_SPEC.gxGpuVramBytes);
		backend.setContextCallbacks([]() -> uintptr_t { return 0; }, eglGetProcAddress);
		for (unsigned epoch = 0; epoch < 2u; ++epoch) {
			backend.onContextReset();
			testPayloadProfile(backend);
			testScanoutImport(backend);
			backend.onContextDestroy();
		}
	}
	eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
	eglDestroyContext(display, context); eglDestroySurface(display, surface); eglTerminate(display);
	std::cout << "SOFTWARE-GX-GLES2:PASS import, raw readback, opt-in profile, resize, field history and context reset\n";
}
