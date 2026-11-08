#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gpu_local_memory.h"
#include "machine/cpu/cpu.h"
#include "machine/memory/memory.h"
#include "machine/devices/irq/controller.h"
#include "machine/scheduler/device.h"
#include "render/backend/gles2/backend.h"
#include "render/backend/pass/library.h"
#include "render/backend/software/gx_gpu_vram.h"
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
		for (u32 word = 0; word < 65536u; ++word) {
			const u32 at = ((512u + (word >> 8u)) * 1024u + 512u + (word & 255u)) * 2u;
			snapshot[at] = static_cast<u8>(word);
			snapshot[at + 1u] = static_cast<u8>(word >> 8u);
		}
		for (u32 index = 0; index < 256u; ++index) {
			const u32 paletteAt = (100u * 1024u + 512u + index) * 2u;
			snapshot[paletteAt] = snapshot[paletteAt + 1u] = static_cast<u8>(index);
			const u32 indexAt = (256u * 1024u + 640u) * 2u + index;
			snapshot[indexAt] = static_cast<u8>(index);
		}
		// A four-bit atlas and CLUT exercise texture-source
		// varyings and rectangle UV wrapping/flips, as used by glyphs.
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
	// A rectangle whose UVs cross 255->0 reads both ends of its page. The
	// narrow late upload lies outside the union of the wrapped endpoint UVs.
	const bool profiling = presenter.backend().type() == BackendType::OpenGLES2;
	if (profiling) static_cast<OpenGLES2Backend&>(presenter.backend()).beginGxCpuToVramProfileFrame();
	for (const u32 word : {
		0xe1000118u, 0x65808080u, (180u << 16u), 0u, 0x00010100u,
		0xa0000000u, 0x01000200u, 0x00010001u, 0x00007fffu,
		0x65808080u, (180u << 16u) | 300u, 254u, 0x00010004u,
	}) {
		fixture.gpu.writeGp0(word);
		fixture.scheduler.advanceTo(fixture.scheduler.currentNowCycles() + 10'000);
		fixture.gpu.onService(fixture.scheduler.currentNowCycles());
	}
	if (profiling) presenter.backend().executeGxGpuCommandDrain(fixture.gpu);
	fixture.gpu.presentReadyFrameOnVblankEdge();
	presenter.present(fixture.gpu.readDeviceOutput(), 0, 0);
	if (profiling) {
		auto& backend = static_cast<OpenGLES2Backend&>(presenter.backend());
		GxCpuToVramProfileFrame profile;
		require(backend.readGxCpuToVramProfileFrame(0u, profile)
			&& profile.commands == 1u && profile.logicalBytes == 2u,
			"uploads in a pre-presentation command drain remain in the host-call profile");
		const u64 previousSerial = profile.renderFrameSerial;
		backend.beginGxCpuToVramProfileFrame();
		require(backend.readGxCpuToVramProfileFrame(previousSerial, profile)
			&& profile.commands == 0u && profile.logicalBytes == 0u,
			"a new host-call profile retires the previous upload counters");
	}
	presenter.backend().captureGxGpuVramSnapshot(fixture.gpu);
	const auto wrappedBytes = fixture.gpu.readDeviceOutput().vramSnapshotBytes;
	require(wrappedBytes[180u * 1024u * 2u] == 0x1fu && wrappedBytes[180u * 1024u * 2u + 1u] == 0u,
		"a later atlas upload cannot change the earlier rectangle's sampled word");
	std::vector<u32> spriteWords{0xa0000000u, 0x01000200u, 0x00100010u};
	for (u32 pixel = 0; pixel < 256u; pixel += 2u) {
		const u32 x = pixel & 15u, y = pixel >> 4u;
		const u32 first = (x + 1u) | ((y + 1u) << 5u) | (((x + y) & 31u) << 10u);
		const u32 second = (x + 2u) | ((y + 1u) << 5u) | (((x + y + 1u) & 31u) << 10u);
		spriteWords.push_back(first | (second << 16u));
	}
	for (const auto [x, y] : std::array<std::pair<u32, u32>, 2>{{{180u, 160u}, {780u, 880u}}}) {
		for (const u32 word : {0x2d808080u, (y << 16u) | x, 15u,
			(y << 16u) | (x + 15u), 0x01180000u,
			((y + 15u) << 16u) | x, 0x00000f0fu,
			((y + 15u) << 16u) | (x + 15u), 0x00000f00u}) spriteWords.push_back(word);
	}
	for (const u32 word : spriteWords) {
		fixture.gpu.writeGp0(word);
		fixture.scheduler.advanceTo(fixture.scheduler.currentNowCycles() + 10'000);
		fixture.gpu.onService(fixture.scheduler.currentNowCycles());
	}
	fixture.gpu.presentReadyFrameOnVblankEdge();
	presenter.present(fixture.gpu.readDeviceOutput(), 0, 0);
	presenter.backend().captureGxGpuVramSnapshot(fixture.gpu);
	for (const u32 word : {
		// Both direct texture-mode encodings, every raw word, and forced mask.
		0xe1000908u, 0x65808080u, 0x01000000u, 0u, 0x01000100u,
		0xe6000001u, 0xe1000988u, 0x65808080u, 0x01000100u, 0u, 0x01000100u,
		0xe6000000u, 0xe100009au, 0x65808080u, 0x02580000u, 0x19200000u, 0x00010100u,
		0xe6000001u, 0x65808080u, 0x02590000u, 0x19200000u, 0x00010100u,
		0xe6000000u,
	}) {
		fixture.gpu.writeGp0(word);
		fixture.scheduler.advanceTo(fixture.scheduler.currentNowCycles() + 1'000'000);
		fixture.gpu.onService(fixture.scheduler.currentNowCycles());
	}
	fixture.gpu.presentReadyFrameOnVblankEdge();
	presenter.present(fixture.gpu.readDeviceOutput(), 0, 0);
	presenter.backend().captureGxGpuVramSnapshot(fixture.gpu);
	// Flipped palette4 rectangles at a nonzero page/CLUT and a screen X
	// beyond 256 must preserve the same source as the forward direction.
	std::vector<u32> bossWords{0xa0000000u, 0x00000380u, 0x00200014u};
	for (u32 y = 0; y < 32u; ++y) for (u32 x = 0; x < 20u; x += 2u) {
		const u32 first = 0x1234u ^ (x * 337u + y * 119u);
		const u32 second = 0x4321u ^ ((x + 1u) * 337u + y * 119u);
		bossWords.push_back((first & 0xffffu) | (second << 16u));
	}
	bossWords.insert(bossWords.end(), {0xa0000000u, 0x00e80380u, 0x00010010u});
	for (u32 i = 0; i < 16u; i += 2u)
		bossWords.push_back((0x0421u * i) | ((0x0421u * (i + 1u)) << 16u));
	bossWords.insert(bossWords.end(), {
		0xe100100eu, 0x65808080u, 0x00880110u, 0x3a38004fu, 0x00200050u,
		0xe100000eu, 0x65808080u, 0x00c80110u, 0x3a380000u, 0x00200050u,
	});
	for (const u32 word : bossWords) {
		fixture.gpu.writeGp0(word);
		fixture.scheduler.advanceTo(fixture.scheduler.currentNowCycles() + 1'000'000);
		fixture.gpu.onService(fixture.scheduler.currentNowCycles());
	}
	fixture.gpu.presentReadyFrameOnVblankEdge();
	presenter.present(fixture.gpu.readDeviceOutput(), 0, 0);
	presenter.backend().captureGxGpuVramSnapshot(fixture.gpu);
	const bool gles = presenter.backend().type() == BackendType::OpenGLES2;
	std::vector<u8> plain, toggled;
	if (gles) { plain.resize(256u * 256u * 4u); toggled.resize(plain.size()); }
	for (const u32 options : {1u, 2u, 4u, 8u, 16u, 32u, 64u, 127u}) {
		if (gles) {
			presenter.crt_postprocessing_enabled = false;
			presenter.present(fixture.gpu.readDeviceOutput(), 128, 0);
			glReadPixels(0, 0, 256, 256, GL_RGBA, GL_UNSIGNED_BYTE, plain.data());
			presenter.applyNoise = (options & 1u) != 0u;
			presenter.applyColorBleed = (options & 2u) != 0u;
			presenter.applyScanlines = (options & 4u) != 0u;
			presenter.applyBlur = (options & 8u) != 0u;
			presenter.applyGlow = (options & 16u) != 0u;
			presenter.applyFringing = (options & 32u) != 0u;
			presenter.applyAperture = (options & 64u) != 0u;
			presenter.crt_postprocessing_enabled = true;
			presenter.present(fixture.gpu.readDeviceOutput(), 128, 0);
			glReadPixels(0, 0, 256, 256, GL_RGBA, GL_UNSIGNED_BYTE, toggled.data());
			if (options == 1u) for (size_t at = 0; at < plain.size(); at += 4u) {
				if (plain[at] > 64u || plain[at + 1u] > 64u || plain[at + 2u] > 64u)
					require(toggled[at] > 32u || toggled[at + 1u] > 32u || toggled[at + 2u] > 32u,
						"CRT noise cannot turn a bright signal pixel black");
			}
		}
		// Submit fresh GX work after CRT used the GL state, not just another
		// post-process pass over an otherwise unchanged scanout texture.
		for (const u32 word : {0x6000ff00u, (820u << 16u) | (700u + options), 0x00010001u,
			0xe1000118u, 0x65808080u, (820u << 16u) | (700u + options), 0u, 0x00100010u}) {
			fixture.gpu.writeGp0(word);
			fixture.scheduler.advanceTo(fixture.scheduler.currentNowCycles() + 10'000);
			fixture.gpu.onService(fixture.scheduler.currentNowCycles());
		}
		fixture.gpu.presentReadyFrameOnVblankEdge();
		presenter.present(fixture.gpu.readDeviceOutput(), 129, 0);
		if (gles) {
			presenter.crt_postprocessing_enabled = false;
			presenter.present(fixture.gpu.readDeviceOutput(), 129, 0);
			glReadPixels(0, 0, 256, 256, GL_RGBA, GL_UNSIGNED_BYTE, toggled.data());
			require(toggled == plain, "disabling each CRT effect restores unfiltered output without restarting the core");
		}
	}
	// Zero RGB gain is still textured drawing: 0000H holes leave the target
	// alone, while every other word writes black with the selected mask bit.
	std::vector<u32> zeroGainWords{0xe6000000u, 0xa0000000u, 0x02000000u, 0x01000100u};
	for (u32 word = 0u; word < 65536u; word += 2u)
		zeroGainWords.push_back(word | ((word + 1u) << 16u));
	zeroGainWords.insert(zeroGainWords.end(), {
		0x6000ff00u, 0x02000300u, 0x01000100u,
		0x6000ff00u, 0x03000100u, 0x01000100u,
		0xe1000900u, 0x64000000u, 0x02000300u, 0u, 0x01000100u,
		0xe6000001u, 0x64000000u, 0x03000100u, 0u, 0x01000100u,
		// Unit-step UV variant and a mixed-color batch must choose their own
		// datapaths rather than assuming the first primitive's gain applies to all.
		0xe6000000u, 0xe1000900u,
		0x6000ff00u, 0x00c80060u, 0x00200020u,
		0x64000000u, 0x00c80060u, 0u, 0x00200020u,
		0x64000000u, 0x03200258u, 1u, 0x00080008u,
		0x64808080u, 0x0320026cu, 1u, 0x00080008u,
		// Palette4/8 source zeroes and mask bits use the same word rule.
		0x6000ff00u, 0x03200280u, 0x00080010u,
		0xe1000005u, 0x64000000u, 0x03200280u, 0x06140000u, 0x00080010u,
		0x6000ff00u, 0x032002b0u, 0x00010100u,
		0xe100009au, 0x64000000u, 0x032002b0u, 0x19200000u, 0x00010100u,
		// Eligible positive/negative dither offsets also saturate zero gain to black.
		0xe1000b00u, 0x2c000000u,
		0x00c800a0u, 0u, 0x00e800a0u, 0x0b00001fu,
		0x00c800c0u, 0x00001f00u, 0x00e800c0u, 0x00001f1fu,
		// Neutral gain is a word copy only with dithering off.
		0x2c808080u,
		0x00c800e0u, 0u, 0x00e800e0u, 0x0b00001fu,
		0x00c80100u, 0x00001f00u, 0x00e80100u, 0x00001f1fu,
	});
	for (const u32 word : zeroGainWords) {
		fixture.gpu.writeGp0(word);
		fixture.scheduler.advanceTo(fixture.scheduler.currentNowCycles() + 10'000);
		fixture.gpu.onService(fixture.scheduler.currentNowCycles());
	}
	fixture.gpu.presentReadyFrameOnVblankEdge();
	presenter.present(fixture.gpu.readDeviceOutput(), 130, 0);
	presenter.backend().captureGxGpuVramSnapshot(fixture.gpu);
	const auto bytes = fixture.gpu.readDeviceOutput().vramSnapshotBytes;
	for (u32 word = 0u; word < 65536u; ++word) {
		const size_t directAt = ((512u + (word >> 8u)) * 1024u + 768u + (word & 255u)) * 2u;
		const size_t forcedAt = ((768u + (word >> 8u)) * 1024u + 256u + (word & 255u)) * 2u;
		const u32 direct = bytes[directAt] | (bytes[directAt + 1u] << 8u);
		const u32 forced = bytes[forcedAt] | (bytes[forcedAt + 1u] << 8u);
		require(direct == (word == 0u ? 0x03e0u : word & 0x8000u), "zero gain preserves holes and the mask bit for every source word");
		require(forced == (word == 0u ? 0x03e0u : 0x8000u), "forced mask mode retains the zero-word hole at zero gain");
	}
	for (const u32 word : {0xe6000000u, 0xe1000900u,
		0x6000ff00u, 0x02000300u, 0x01000100u,
		0x64808080u, 0x02000300u, 0u, 0x01000100u}) {
		fixture.gpu.writeGp0(word);
		fixture.scheduler.advanceTo(fixture.scheduler.currentNowCycles() + 10'000);
		fixture.gpu.onService(fixture.scheduler.currentNowCycles());
	}
	// The final 65,536-pixel draw must complete its device interval too;
	// there are no following packet words to advance time on its behalf.
	fixture.scheduler.advanceTo(fixture.scheduler.currentNowCycles() + 1'000'000);
	fixture.gpu.onService(fixture.scheduler.currentNowCycles());
	fixture.gpu.presentReadyFrameOnVblankEdge();
	presenter.present(fixture.gpu.readDeviceOutput(), 131, 0);
	presenter.backend().captureGxGpuVramSnapshot(fixture.gpu);
	const auto neutralBytes = fixture.gpu.readDeviceOutput().vramSnapshotBytes;
	for (u32 word = 0u; word < 65536u; ++word) {
		const size_t at = ((512u + (word >> 8u)) * 1024u + 768u + (word & 255u)) * 2u;
		const u32 actual = neutralBytes[at] | (neutralBytes[at + 1u] << 8u);
		if (actual != (word == 0u ? 0x03e0u : word)) {
			throw std::runtime_error("neutral gain word " + std::to_string(word)
				+ " produced " + std::to_string(actual));
		}
	}
	// Exercise actual GP0 raster programs, not just an isolated GL equation:
	// every 32x32 channel pair, both old/source masks, all four mask modes,
	// per-texel semi-transparency and the transparent-zero/nonzero-black split.
	std::vector<u32> blendWords{0xe6000000u, 0xa0000000u, 512u, 0x00200080u};
	for (u32 y = 0; y < 32u; ++y) for (u32 x = 0; x < 128u; x += 2u) {
		const u32 source = y * 0x0421u | (x >= 64u ? 0x8000u : 0u);
		blendWords.push_back(source | (source << 16u));
	}
	for (const u32 word : blendWords) {
		fixture.gpu.writeGp0(word);
		fixture.scheduler.advanceTo(fixture.scheduler.currentNowCycles() + 10'000);
		fixture.gpu.onService(fixture.scheduler.currentNowCycles());
	}
	for (bool textured : {false, true}) for (u32 mode = 0; mode < 4; ++mode) for (u32 mask = 0; mask < 4; ++mask) {
		blendWords.clear();
		blendWords.insert(blendWords.end(), {0xe6000000u, 0xa0000000u, 0x01000280u, 0x00200080u});
		for (u32 y = 0; y < 32u; ++y) for (u32 x = 0; x < 128u; x += 2u) {
			const u32 flag = (x & 32u) != 0u ? 0x8000u : 0u;
			const u32 first = (x & 31u) * 0x0421u | flag;
			const u32 second = ((x + 1u) & 31u) * 0x0421u | flag;
			blendWords.push_back(first | (second << 16u));
		}
		blendWords.insert(blendWords.end(), {0xe6000000u | mask, 0xe1000108u | (mode << 5u)});
		if (textured) blendWords.insert(blendWords.end(), {0x67808080u, 0x01000280u, 0u, 0x00200080u});
		else for (u32 y = 0; y < 32u; ++y)
			blendWords.insert(blendWords.end(), {0x62000000u | (y * 8u * 0x010101u), ((256u + y) << 16u) | 640u, 0x00010080u});
		for (const u32 word : blendWords) {
			fixture.gpu.writeGp0(word);
			fixture.scheduler.advanceTo(fixture.scheduler.currentNowCycles() + 10'000);
			fixture.gpu.onService(fixture.scheduler.currentNowCycles());
		}
		fixture.scheduler.advanceTo(fixture.scheduler.currentNowCycles() + 100'000);
		fixture.gpu.onService(fixture.scheduler.currentNowCycles());
		fixture.gpu.presentReadyFrameOnVblankEdge();
		presenter.present(fixture.gpu.readDeviceOutput(), 132, 0);
		if (profiling) {
			GLint equation;
			glGetIntegerv(GL_BLEND_EQUATION_RGB, &equation);
			require(equation == GL_FUNC_ADD, "scanout restores its additive blend equation after GX subtract drawing");
		}
		presenter.backend().captureGxGpuVramSnapshot(fixture.gpu);
		const auto result = fixture.gpu.readDeviceOutput().vramSnapshotBytes;
		for (u32 y = 0; y < 32u; ++y) for (u32 x = 0; x < 128u; ++x) {
			const u32 destination = (x & 31u) * 0x0421u | ((x & 32u) != 0u ? 0x8000u : 0u);
			const u32 source = y * 0x0421u | (textured && x >= 64u ? 0x8000u : 0u);
			u32 expected = destination;
			if (!((mask & 2u) && (destination & 0x8000u)) && !(textured && source == 0u)) {
				const u32 color = !textured || (source & 0x8000u)
					? gxGpuSoftwareBlendRgb555(source, destination, mode) : source & 0x7fffu;
				expected = color | ((mask & 1u) ? 0x8000u : source & 0x8000u);
			}
			const size_t at = ((256u + y) * 1024u + 640u + x) * 2u;
			const u32 actual = result[at] | (result[at + 1u] << 8u);
			if (actual != expected) throw std::runtime_error("GP0 blend parity textured=" + std::to_string(textured)
				+ " mode=" + std::to_string(mode) + " mask=" + std::to_string(mask)
				+ " x=" + std::to_string(x) + " y=" + std::to_string(y)
				+ " expected=" + std::to_string(expected) + " actual=" + std::to_string(actual));
		}
	}
	// Readback and raw copies observe dirty drawing targets without requiring a
	// scanout/checkpoint first. A CPU upload into a cached region invalidates it.
	for (const u32 word : {
		0xe6000000u, 0x600000ffu, 0x01410081u, 0x00020003u,
		0xa0000000u, 0x01410083u, 0x00010001u, 0x00007c00u,
		0xe1000112u, 0x65808080u, 0x01410101u, 0x00004101u, 0x00020003u,
		0x80000000u, 0x01410101u, 0x014100c1u, 0x00020003u,
		0xa0000000u, 0x014100c2u, 0x00010001u, 0x000003e0u,
		0xc0000000u, 0x014100c1u, 0x00020003u,
	}) {
		fixture.gpu.writeGp0(word);
		fixture.scheduler.advanceTo(fixture.scheduler.currentNowCycles() + 10'000);
		fixture.gpu.onService(fixture.scheduler.currentNowCycles());
	}
	presenter.backend().executeGxGpuReadback(fixture.gpu);
	require(fixture.gpu.readGp0() == 0x03e0001fu, "GPUREAD sees a cache copy followed by a partial CPU upload");
	require(fixture.gpu.readGp0() == 0x001f7c00u, "GPUREAD sees a CPU upload into a dirty cached source before texturing/copying it");
	require(fixture.gpu.readGp0() == 0x001f001fu, "GPUREAD preserves row-major transfer order");
	fixture.gpu.presentReadyFrameOnVblankEdge();
	presenter.present(fixture.gpu.readDeviceOutput(), 132, 0);
	presenter.backend().captureGxGpuVramSnapshot(fixture.gpu);
	const auto saved = fixture.gpu.captureSaveState({});
	for (const u32 word : {0x6000ff00u, 0x01410081u, 0x00020003u}) {
		fixture.gpu.writeGp0(word);
		fixture.scheduler.advanceTo(fixture.scheduler.currentNowCycles() + 10'000);
		fixture.gpu.onService(fixture.scheduler.currentNowCycles());
	}
	fixture.gpu.presentReadyFrameOnVblankEdge();
	presenter.present(fixture.gpu.readDeviceOutput(), 132, 0);
	fixture.gpu.restoreSaveState(saved);
	presenter.present(fixture.gpu.readDeviceOutput(), 132, 0);
	presenter.backend().captureGxGpuVramSnapshot(fixture.gpu);
	const auto restored = fixture.gpu.readDeviceOutput().vramSnapshotBytes;
	require(std::equal(saved.vramBytes.begin(), saved.vramBytes.end(), restored.begin()), "a restored snapshot invalidates newer cached drawing words");
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
		auto software = std::make_unique<SoftwareBackend>(256, 256, PSX_MACHINE_SPEC.gxGpuVramBytes);
		const auto expected = render(std::move(software), referenceFixture);
		for (const auto targetMode : {GxGpuDrawTargetMode::FullVram, GxGpuDrawTargetMode::SmallNibbles,
			GxGpuDrawTargetMode::SmallRgb5, GxGpuDrawTargetMode::SmallRgb5Mali}) {
		if (targetMode == GxGpuDrawTargetMode::SmallRgb5Mali && !framebuffer) continue;
		TexturedModelFixture fixture;
		auto gles = std::make_unique<OpenGLES2Backend>(256, 256, true, PSX_MACHINE_SPEC.gxGpuVramBytes, targetMode);
		gles->setContextCallbacks([]() -> uintptr_t { return 0; }, eglGetProcAddress); gles->onContextReset();
		const auto actual = render(std::move(gles), fixture);
		const auto expectedVram = referenceFixture.gpu.readDeviceOutput().vramSnapshotBytes;
		const auto actualVram = fixture.gpu.readDeviceOutput().vramSnapshotBytes;
		require(actualVram[(180u * 1024u + 302u) * 2u] == 0xffu,
			"a wrapped texture rectangle samples the just-uploaded beginning of its page");
		require(expectedVram[(901u * 1024u + 197u) * 2u + 1u] == 3u,
			"the disjoint high-row rectangle actually changes VRAM");
		const auto mismatch = std::mismatch(expectedVram.begin(), expectedVram.end(), actualVram.begin());
		if (mismatch.first != expectedVram.end()) {
			const size_t byte = mismatch.first - expectedVram.begin();
			throw std::runtime_error("VRAM mismatch at byte " + std::to_string(byte)
				+ ": expected " + std::to_string(*mismatch.first) + ", actual " + std::to_string(*mismatch.second));
		}
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
		std::cout << "GX-TEXTURED:PASS software/GLES2 target=" << static_cast<int>(targetMode) << " " << glGetString(GL_RENDERER) << '\n';
		}
	}
	if (framebuffer) bmsx_video_context_close();
	else {
		eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
		eglDestroyContext(display, context); eglDestroySurface(display, surface); eglTerminate(display);
	}
}
