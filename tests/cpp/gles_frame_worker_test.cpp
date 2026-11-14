#include "gles_frame_worker.h"
#include "bmsx_libretro.h"
#include "common/endian.h"
#include "machine/runtime/save_state/codec.h"
#include "input.h"
#include "host_overlay_menu.h"
#include "presentation_state.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state.h"
#include "render/backend/gles2/backend.h"
#include "render/backend/pass/library.h"
#include "render/video_presenter.h"
#include "render/shared/bmsx_font.h"
#include "spec/blua32/builtin.h"
#include "spec/gx/pcrtc.h"
#include "machine/devices/gx/gpu_local_memory.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/opcode.h"
#include "support/blua32_test_rom.h"
#include "support/cartridge_fixture.h"

#include <EGL/egl.h>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <iostream>
#include <filesystem>
#include <fstream>
#include <cstring>
#include <mutex>
#include <stdexcept>
#include <thread>

namespace {
using namespace bmsx;
void require(bool value, const char* message) { if (!value) throw std::runtime_error(message); }
struct ConsumerFailure {};
struct Observation {
	std::mutex mutex;
	std::condition_variable ready;
	std::atomic<unsigned> emitted{0};
	std::atomic<bool> wrongThread{false};
	std::thread::id contextThread = std::this_thread::get_id();
	unsigned overlapCommandCount = 384u;
	bool delayFirstDraw = false;
	bool overlapped = false;
	bool throwOnDraw = false;
	bool throwDuringPresentation = false;
	bool throwOnEmission = false;
	unsigned drawCalls = 0;
	unsigned rumbleCalls = 0;
	bool acceptRumble = true;
};
Observation* observation = nullptr;
}
extern "C" void __real_glDrawArrays(GLenum, GLint, GLsizei);
extern "C" void __wrap_glDrawArrays(GLenum mode, GLint first, GLsizei count) {
	if (observation) {
		++observation->drawCalls;
		if (std::this_thread::get_id() != observation->contextThread) observation->wrongThread = true;
		if (observation->delayFirstDraw) {
			observation->delayFirstDraw = false;
			std::unique_lock lock(observation->mutex);
			require(observation->ready.wait_for(lock, std::chrono::seconds(10), [] { return observation->emitted.load() >= observation->overlapCommandCount; }),
				"the producer continues through two more batches while the first GL draw is delayed");
			observation->overlapped = true;
		}
		if (observation->throwOnDraw) {
			GLint viewport[4];
			glGetIntegerv(GL_VIEWPORT, viewport);
			if (!observation->throwDuringPresentation || viewport[2] == 256) throw ConsumerFailure{};
		}
	}
	__real_glDrawArrays(mode, first, count);
}
namespace {

// A libretro frontend owns GL between callbacks; none of these writes pass
// through the core cache. Keep this adversarial owner distinct from GX work.
void mutateFrontendGlState() {
	glBindFramebuffer(GL_FRAMEBUFFER, 0);
	glUseProgram(0);
	glBindBuffer(GL_ARRAY_BUFFER, 0);
	glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, 0);
	for (unsigned unit = 0; unit < 8; ++unit) {
		glActiveTexture(GL_TEXTURE0 + unit);
		glBindTexture(GL_TEXTURE_2D, 0);
	}
	glViewport(3, 5, 7, 9);
	glEnable(GL_SCISSOR_TEST);
	glScissor(0, 0, 0, 0);
	glColorMask(GL_FALSE, GL_FALSE, GL_FALSE, GL_FALSE);
	glEnable(GL_DITHER);
	glPixelStorei(GL_PACK_ALIGNMENT, 8);
}

struct Script {
	test::Blua32TestImage image;
	std::vector<u32> code;
	Script() {
		for (const LuaBootPrimitive& primitive : LUA_BOOT_PRIMITIVES) image.systemGlobalNames.emplace_back(primitive.name);
	}
	void constant(unsigned reg, u32 word) {
		const u32 index = static_cast<u32>(image.constants.size());
		image.constants.emplace_back(static_cast<f64>(word));
		code.push_back(packInstructionWord(static_cast<u8>(OpCode::LOADK), reg, (index >> 6u) & 63u, index & 63u, index >> 12u));
	}
	void write(u32 address, u32 word) {
		constant(0, word); constant(1, address);
		code.push_back(packInstructionWord(static_cast<u8>(OpCode::STORE_MEM), 0, 1, static_cast<u8>(MemoryAccessKind::U32LE)));
	}
	void gp0(std::initializer_list<u32> words) { for (u32 word : words) write(IO_GX_GPU_GP0, word); }
	test::Blua32TestRom finish() {
		code.push_back(packInstructionWord(static_cast<u8>(OpCode::HALT), 0, 0, 0));
		image.text.resize(code.size() * INSTRUCTION_BYTES);
		for (size_t i = 0; i < code.size(); ++i) writeInstructionWord(image.text, i, code[i]);
		image.functions.push_back({.firstWord = 0, .wordCount = static_cast<u32>(code.size()), .maxStack = 8});
		return test::encodeBlua32TestRom(RomImageDomain::System, image);
	}
};

constexpr u32 ReadbackResult = DYNAMIC_RAM_BASE + 0x100;
constexpr u32 Finished = ReadbackResult + 4;
constexpr u32 ResetMarker = Finished + 4;
constexpr u32 DmaResult = ResetMarker + 4;
constexpr u32 ReadbackTail = DmaResult + 8u;
constexpr u32 UploadPacket = DYNAMIC_RAM_BASE + 0x10000u;

test::Blua32TestRom makeStream(bool supervisor = false, bool reset = false, bool largeUpload = false) {
	Script script;
	size_t resetJump = 0;
	if (reset) {
		script.constant(1, ResetMarker);
		script.code.push_back(packInstructionWord(static_cast<u8>(OpCode::LOAD_MEM), 2, 1, static_cast<u8>(MemoryAccessKind::U32LE)));
		script.constant(3, 1u);
		script.code.push_back(packInstructionWord(static_cast<u8>(OpCode::EQ), 1, 2, 3));
		resetJump = script.code.size();
		script.code.push_back(0u);
	}
	script.write(IO_GX_GPU_GP1, 0x09000001u);
	script.gp0({0xe3000000u, 0xe40fffffu});
	if (largeUpload) {
		script.write(IO_GX_GPU_GP1, 0x04000002u);
		script.write(IO_DMA0_READ_ADDR, UploadPacket);
		script.write(IO_DMA0_TRANSFER_COUNT, GX_GPU_COMMAND_MAX_UPLOAD_WORD_COUNT);
		script.write(IO_DMA0_CONTROL, DMA_ROUTE_TO_GPU);
		script.write(IO_DMA0_TRIGGER, DMA_TRIGGER_START);
	}
	for (u32 i = 0; i < 640; ++i) {
		const u32 xy = ((i / 32u) << 16u) | ((i % 32u) * 8u);
		script.gp0({0x60000000u | ((i * 39293u) & 0xffffffu), xy, 0x00010008u});
	}
	if (reset) {
		script.write(ResetMarker, 1u);
		script.write(IO_SYS_CONTROL, SYS_CONTROL_RESET);
		const u32 distance = static_cast<u32>(script.code.size() - resetJump - 1u);
		script.code[resetJump] = packInstructionWord(static_cast<u8>(OpCode::JMP), 0, (distance >> 6u) & 63u, distance & 63u, distance >> 12u);
		script.write(IO_GX_GPU_GP1, 0x09000001u);
		script.gp0({0xe3000000u, 0xe40fffffu});
	}
	for (const auto [index, word] : std::array<std::pair<u32, u32>, 4>{{
		{GX_GPU_PCRTC_PMODE_LOW, 0x0000ff21u},
		{GX_GPU_PCRTC_DISPFB1_LOW, (16u << 9u) | (GX_GPU_PSMGX16 << 15u)},
		{GX_GPU_PCRTC_DISPLAY1_LOW, 3u << 23u},
		{GX_GPU_PCRTC_DISPLAY1_HIGH, 1023u | (255u << 12u)},
	}}) script.write(gxGpuPcrtcRegisterAddress(index), word);
	if (supervisor) {
		script.write(IO_SYS_CONTROL, SYS_CONTROL_SUPERVISOR_FAULT);
		script.write(IO_SYS_CONTROL, SYS_CONTROL_SUPERVISOR_LEAVE);
	}
	for (unsigned effect = 0; effect < 2; ++effect) {
		script.write(IO_INP_OUTPUT_PORT, 0u);
		script.write(IO_INP_OUTPUT_INTENSITY_Q16, 0x10000u);
		script.write(IO_INP_OUTPUT_DURATION_MS, 10u);
		script.write(IO_INP_OUTPUT_CTRL, 1u);
	}
	// A raw upload after several producer-buffer retirements, then dependent
	// drawing/copy/readback. Low/high halves are deliberately different.
	script.gp0({0xa0000000u, 0x01000200u, 0x00010004u, 0x03e0001fu, 0xfc007c00u});
	script.gp0({0xe1000118u, 0x65000000u, 0x00200000u, 0u, 0x00010004u});
	script.gp0({0x80000000u, 0x00200000u, 0x00300000u, 0x00010004u});
	script.gp0({0xc0000000u, 0x00300000u, 0x00010003u});
	script.constant(1, IO_GX_GPU_GP0);
	script.code.push_back(packInstructionWord(static_cast<u8>(OpCode::LOAD_MEM), 2, 1, static_cast<u8>(MemoryAccessKind::U32LE)));
	script.constant(1, ReadbackResult);
	script.code.push_back(packInstructionWord(static_cast<u8>(OpCode::STORE_MEM), 2, 1, static_cast<u8>(MemoryAccessKind::U32LE)));
	if (supervisor) {
		script.write(IO_SYS_CONTROL, SYS_CONTROL_SUPERVISOR_FAULT);
		script.write(IO_SYS_CONTROL, SYS_CONTROL_SUPERVISOR_LEAVE);
	}
	script.constant(1, IO_GX_GPU_GP0);
	script.code.push_back(packInstructionWord(static_cast<u8>(OpCode::LOAD_MEM), 2, 1, static_cast<u8>(MemoryAccessKind::U32LE)));
	script.constant(1, ReadbackTail);
	script.code.push_back(packInstructionWord(static_cast<u8>(OpCode::STORE_MEM), 2, 1, static_cast<u8>(MemoryAccessKind::U32LE)));
	// A separate ordered readback is consumed by the actual DMA device.
	script.write(IO_GX_GPU_GP1, 0x04000003u);
	script.gp0({0xc0000000u, 0x00300000u, 0x00010003u});
	script.write(IO_DMA0_WRITE_ADDR, DmaResult);
	script.write(IO_DMA0_TRANSFER_COUNT, 2u);
	script.write(IO_DMA0_CONTROL, DMA_ROUTE_FROM_GPU);
	script.write(IO_DMA0_TRIGGER, DMA_TRIGGER_START);
	// GP1 clear publishes an incomplete wrapping upload's consumed words only.
	script.gp0({0xa0000000u, 0x03ff03ffu, 0x00020003u, 0x22221111u, 0x44443333u});
	script.write(IO_GX_GPU_GP1, 0x01000000u);
	// This visible trailing primitive is below the publication threshold. Only
	// the selected Present packet, not an earlier 128-command drain, draws it.
	script.gp0({0x600000ffu, 0x00400004u, 0x00010008u});
	script.write(Finished, 1u);
	return script.finish();
}

class TestVideoOutput final : public VideoOutput {
public:
	using VideoOutput::VideoOutput;
	void setDisplaySize(i32, i32, i32, i32) override {}
};

struct FrameBoundary {
	i64 cycles;
	u32 pc;
	std::optional<u32> committedFrame;
	bool operator==(const FrameBoundary&) const = default;
};

struct Result { std::vector<u8> vram; std::vector<u8> scanout; u32 readback; u32 readbackTail; i64 cycles; u32 pc; u32 finished; u32 dma; u32 dmaTail; unsigned rumbleCalls; std::vector<FrameBoundary> boundaries; };

Result runStream(const test::Blua32TestRom& rom, bool threaded, GxGpuDrawTargetMode mode, unsigned frames = 2, bool acceptRumble = true, bool lifecycle = false, bool largeUpload = false) {
	Observation observed;
	observed.acceptRumble = acceptRumble;
	if (largeUpload) observed.overlapCommandCount = 257u;
	observation = &observed;
	LibretroInput input([]() -> bool { return false; });
	input.installRumbleInterface({[](unsigned port, retro_rumble_effect, uint16_t strength) -> bool {
		if (std::this_thread::get_id() != observation->contextThread) observation->wrongThread = true;
		require(port == 0u && strength == 0xffffu, "frontend receives exact rumble port and raw intensity");
		++observation->rumbleCalls;
		return observation->acceptRumble;
	}});
	Runtime runtime({rom.bytes, test::cartridgeSlots(), PSX_MACHINE_SPEC}, input);
	runtime.boot();
	if (largeUpload) {
		runtime.machine.memory.writeU32(UploadPacket, 0xa0000000u);
		runtime.machine.memory.writeU32(UploadPacket + 4u, 0u);
		runtime.machine.memory.writeU32(UploadPacket + 8u, 0u);
		for (u32 word = 3u; word < GX_GPU_COMMAND_MAX_UPLOAD_WORD_COUNT; ++word)
			runtime.machine.memory.writeU32(UploadPacket + word * 4u, word * 39293u);
	}
	TestVideoOutput output(256, 256);
	std::unique_ptr<GPUBackend> backend;
	if (threaded) {
		auto gles = std::make_unique<OpenGLES2Backend>(256, 256, false, PSX_MACHINE_SPEC.gxGpuVramBytes, mode);
		gles->setContextCallbacks([]() -> uintptr_t { return 0; }, eglGetProcAddress);
		gles->onContextReset(); backend = std::move(gles);
	} else backend = std::make_unique<SoftwareBackend>(256, 256, PSX_MACHINE_SPEC.gxGpuVramBytes);
	backend->resizePresentationTarget(256, 256);
	VideoPresenter presenter(output, std::move(backend), 256, 256);
	presenter.installRenderPipeline(std::make_unique<RenderPassLibrary>(&presenter.backend(), &presenter));
	presenter.initializeDefaultTextures();
	presenter.crt_postprocessing_enabled = false;
	bmsx::Font font;
	presenter.default_font = &font;
	RenderPresentationState presentation;
	OnScreenKeyboard keyboard(input, NATIVE_KEYBOARD_PAGES);
	HostOnScreenKeyboard keyboardView(keyboard);
	HostKeyboardInteraction keyboardInteraction(keyboard, keyboardView);
	HostOverlayMenu menu(input, keyboardInteraction);
	// The RGB5 queued route also consumes machine usage captured in its packet.
	// Its completed history must still match the overlay-free software image.
	presenter.showResourceUsageGizmo = threaded && mode == GxGpuDrawTargetMode::SmallRgb5;
	std::vector<FrameBoundary> boundaries;
	std::unique_ptr<GlesFrameWorker> worker;
	if (threaded) {
		observation = &observed; observed.delayFirstDraw = true;
		runtime.machine.gxGpu.setOperationObserver({[](void* context, const GxGpuCommandBuffer&, size_t, i64, std::span<const u32>) {
			auto& value = *static_cast<Observation*>(context);
			if (std::this_thread::get_id() == value.contextThread) value.wrongThread = true;
			{
				std::lock_guard lock(value.mutex);
				++value.emitted;
			}
			value.ready.notify_one();
		}, &observed});
		worker = std::make_unique<GlesFrameWorker>(runtime, presenter, input, presentation, menu);
		for (unsigned frame = 0; frame < frames; ++frame) {
			presentation.beginHostFrame();
			worker->run(static_cast<f64>(frame + 1u) / 60.0, 1.0 / 60.0);
			boundaries.push_back({runtime.machine.scheduler.nowCycles(), runtime.machine.cpu.readFramePc(runtime.machine.cpu.getFrameDepth() - 1), presenter.gameFrameSequence()});
		}
		require(observed.overlapped && !observed.wrongThread, "guest progress and GLES calls have distinct exclusive owners");
	} else for (unsigned frame = 0; frame < frames; ++frame) {
		presentation.beginHostFrame();
		const i64 previousTick = runtime.frameScheduler.lastTickSequence;
		runtime.frameScheduler.run(runtime, 1000.0 / 60.0);
		while (runtime.machine.gxGpu.backendServicePending()) {
			if (runtime.machine.gxGpu.backendCommandDrainPending()) presenter.backend().executeGxGpuCommandDrain(runtime.machine.gxGpu);
			else presenter.backend().executeGxGpuReadback(runtime.machine.gxGpu);
			runtime.frameScheduler.synchronizeBackendService(runtime);
			runtime.frameScheduler.run(runtime, 0.0);
		}
		presentation.syncAfterRuntimeUpdate(runtime, previousTick);
		presentation.render(presenter, runtime, static_cast<f64>(frame + 1u) / 60.0, 1.0 / 60.0, false);
		boundaries.push_back({runtime.machine.scheduler.nowCycles(), runtime.machine.cpu.readFramePc(runtime.machine.cpu.getFrameDepth() - 1), presenter.gameFrameSequence()});
	}
	require(presenter.gameFrameSequence().has_value(), "the frame path commits history without a later live-device render");
	const auto scanout = presenter.captureGameFrame();
	const size_t tailPixel = (64u * static_cast<size_t>(scanout.width) + 4u) * 4u;
	require(scanout.pixels[tailPixel] == 255u && scanout.pixels[tailPixel + 1u] == 0u && scanout.pixels[tailPixel + 2u] == 0u,
		"the below-threshold final primitive is visible in the actual presented history before snapshot readback");
	const u32 finished = runtime.machine.memory.readMappedU32LE(Finished);
	const auto cycles = runtime.machine.scheduler.nowCycles();
	const auto pc = runtime.machine.cpu.readFramePc(runtime.machine.cpu.getFrameDepth() - 1);
	presenter.backend().captureGxGpuVramSnapshot(runtime.machine.gxGpu);
	const auto bytes = runtime.machine.gxGpu.readDeviceOutput().vramSnapshotBytes;
	Result result{{bytes.begin(), bytes.end()}, scanout.pixels, runtime.machine.memory.readMappedU32LE(ReadbackResult), runtime.machine.memory.readMappedU32LE(ReadbackTail), cycles, pc, finished, runtime.machine.memory.readMappedU32LE(DmaResult), runtime.machine.memory.readMappedU32LE(DmaResult + 4u), observed.rumbleCalls, std::move(boundaries)};
	require(!observed.wrongThread, "frontend rumble stays on the context thread");
	if (lifecycle) {
		const auto saved = captureRuntimeSaveState(runtime);
		auto& gles = static_cast<OpenGLES2Backend&>(presenter.backend());
		const auto committedSequence = presenter.gameFrameSequence();
		presentation.beginHostFrame();
		require(runtime.isDrawPending() && worker->run(1.0, 0.0),
			"a zero-grant active entry publishes its partial frame through the queue");
		require(presenter.presentationMode == VideoPresenter::PresentationMode::Partial && !presenter.commitPresentationFrame
			&& presenter.gameFrameSequence() == committedSequence && presenter.captureGameFrame().pixels == result.scanout,
			"a queued partial frame does not replace completed history");
		runtime.suspendExecution();
		presentation.beginHostFrame();
		presentation.requestHeldPresentation();
		require(worker->run(1.0, 0.0), "a suspended machine publishes an explicit held repaint through the queue");
		require(presenter.presentationMode == VideoPresenter::PresentationMode::Completed && !presenter.commitPresentationFrame
			&& presenter.gameFrameSequence() == committedSequence && presenter.captureGameFrame().pixels == result.scanout
			&& runtime.machine.scheduler.nowCycles() == result.cycles,
			"a queued held repaint preserves completed history and does not advance the machine");
		applyRuntimeSaveState(runtime, saved);
		presenter.releaseRenderPipeline(); presenter.clearTextures(); gles.onContextDestroy();
		gles.onContextReset();
		presenter.installRenderPipeline(std::make_unique<RenderPassLibrary>(&gles, &presenter));
		presenter.initializeDefaultTextures();
		mutateFrontendGlState();
		gles.invalidateContextState();
		worker->run(1.0, 0.0);
		gles.captureGxGpuVramSnapshot(runtime.machine.gxGpu);
		require(std::equal(result.vram.begin(), result.vram.end(), runtime.machine.gxGpu.readVramSnapshotBytes().begin()),
			"a rebuilt GL context consumes the checkpoint with the persistent worker still alive");
		auto replacement = result.vram; replacement[0] ^= 0x7fu;
		runtime.machine.gxGpu.replaceVramSnapshotBytes(replacement);
		mutateFrontendGlState();
		gles.invalidateContextState();
		worker->run(1.0, 0.0);
		gles.captureGxGpuVramSnapshot(runtime.machine.gxGpu);
		require(std::equal(replacement.begin(), replacement.end(), runtime.machine.gxGpu.readVramSnapshotBytes().begin()),
			"external replacement is published before another frame job");
		applyRuntimeSaveState(runtime, saved);
		mutateFrontendGlState();
		gles.invalidateContextState();
		worker->run(1.0, 0.0);
		gles.captureGxGpuVramSnapshot(runtime.machine.gxGpu);
		require(std::equal(result.vram.begin(), result.vram.end(), runtime.machine.gxGpu.readVramSnapshotBytes().begin()),
			"save-state restore cannot be acknowledged by an older publication generation");
		// Only this 3x2 rectangle is dirty since the last checkpoint. An external
		// eight-byte pack alignment must not insert padding into its RGBA rows.
		for (u32 word : {0xe1000000u, 0x600000ffu, 0x001d000bu, 0x00020003u}) {
			runtime.machine.gxGpu.writeGp0(word);
			runtime.machine.scheduler.advanceTo(runtime.machine.scheduler.currentNowCycles() + 10'000);
			runtime.machine.gxGpu.onService(runtime.machine.scheduler.currentNowCycles());
		}
		mutateFrontendGlState();
		gles.invalidateContextState();
		gles.captureGxGpuVramSnapshot(runtime.machine.gxGpu);
		const auto narrow = runtime.machine.gxGpu.readVramSnapshotBytes();
		for (u32 y = 29u; y < 31u; ++y) for (u32 x = 11u; x < 14u; ++x)
			require(readLE16(narrow.data() + (y * 1024u + x) * 2u) == 0x001fu,
				"odd-width dirty snapshot rows remain tightly packed after frontend pixel-store changes");
		const std::array<f32, 4> red{1, 0, 0, 1};
		auto texture = gles.createColorTexture(3, 2, &red);
		mutateFrontendGlState();
		gles.invalidateContextState();
		const auto pixels = gles.readColorTexture(texture, 3, 2);
		for (size_t pixel = 0; pixel < pixels.size(); pixel += 4u)
			require(pixels[pixel] == 255 && pixels[pixel + 1u] == 0 && pixels[pixel + 2u] == 0 && pixels[pixel + 3u] == 255,
				"odd-width color capture uses its tightly packed caller-owned capacity");
		gles.destroyTexture(texture);
	}
	worker.reset();
	observation = nullptr;
	if (threaded) {
		presenter.releaseRenderPipeline(); presenter.clearTextures();
		static_cast<OpenGLES2Backend&>(presenter.backend()).onContextDestroy();
	}
	return result;
}

enum class FailedSubmissionOwner { Producer, Consumer, PresentationConsumer };

void testSubmissionFailure(const test::Blua32TestRom& rom, FailedSubmissionOwner failedOwner) {
	struct ProducerFailure {};
	Observation observed;
	observed.delayFirstDraw = true;
	observed.throwOnDraw = failedOwner != FailedSubmissionOwner::Producer;
	observed.throwDuringPresentation = failedOwner == FailedSubmissionOwner::PresentationConsumer;
	observed.throwOnEmission = failedOwner == FailedSubmissionOwner::Producer;
	observation = &observed;
	LibretroInput input([]() -> bool { return false; });
	Runtime runtime({rom.bytes, test::cartridgeSlots(), PSX_MACHINE_SPEC}, input);
	runtime.boot();
	auto ownedBackend = std::make_unique<OpenGLES2Backend>(256, 256, false, PSX_MACHINE_SPEC.gxGpuVramBytes, GxGpuDrawTargetMode::FullVram);
	auto& backend = *ownedBackend;
	backend.setContextCallbacks([]() -> uintptr_t { return 0; }, eglGetProcAddress);
	backend.onContextReset();
	TestVideoOutput output(256, 256);
	VideoPresenter presenter(output, std::move(ownedBackend), 256, 256);
	presenter.installRenderPipeline(std::make_unique<RenderPassLibrary>(&backend, &presenter));
	presenter.initializeDefaultTextures();
	presenter.crt_postprocessing_enabled = false;
	bmsx::Font font;
	presenter.default_font = &font;
	RenderPresentationState presentation;
	OnScreenKeyboard keyboard(input, NATIVE_KEYBOARD_PAGES);
	HostOnScreenKeyboard keyboardView(keyboard);
	HostKeyboardInteraction keyboardInteraction(keyboard, keyboardView);
	HostOverlayMenu menu(input, keyboardInteraction);
	runtime.machine.gxGpu.setOperationObserver({[](void* context, const GxGpuCommandBuffer&, size_t, i64, std::span<const u32>) {
		auto& value = *static_cast<Observation*>(context);
		unsigned count;
		{
			std::lock_guard lock(value.mutex);
			count = ++value.emitted;
		}
		value.ready.notify_one();
		// Two prefixes are already published, while the frontend's first draw
		// is waiting. A producer exception must still join both publications.
		if (value.throwOnEmission && count == value.overlapCommandCount) throw ProducerFailure{};
	}, &observed});
	{
		GlesFrameWorker worker(runtime, presenter, input, presentation, menu);
		if (failedOwner == FailedSubmissionOwner::PresentationConsumer) {
			observed.throwOnDraw = false;
			worker.run(1.0 / 60.0, 1.0 / 60.0);
			observed.throwOnDraw = true;
		}
		bool receivedExpectedFailure = false;
		try { worker.run(1.0 / 60.0, 1.0 / 60.0); }
		catch (const ProducerFailure&) { receivedExpectedFailure = failedOwner == FailedSubmissionOwner::Producer; }
		catch (const ConsumerFailure&) { receivedExpectedFailure = failedOwner != FailedSubmissionOwner::Producer; }
		#if BMSX_GLES2_SOFTWARE_GX
		// CPU command consumption has no GL draw to delay before a producer
		// exception. Presentation still exercises the GL consumer error path.
		require(receivedExpectedFailure, "the original submission error returns after published CPU work");
#else
		require(receivedExpectedFailure && observed.overlapped, "the original submission error returns after overlapping published work");
#endif
		if (failedOwner == FailedSubmissionOwner::Producer) {
			// GLES readback packs two 16-bit pixels per RGBA8 output word.
			std::array<u8, 4> pixel{};
			backend.readGxGpuVram({64u, 6u, 1u, 1u, 1u}, pixel.data());
			require(readLE16(pixel.data()) == 0x3bb5u, "the second published prefix reaches VRAM before the producer error returns");
		}
		if (failedOwner == FailedSubmissionOwner::Producer) {
			runtime.machine.gxGpu.beginSupervisorQuiesce();
			require(!runtime.machine.gxGpu.backendSubmissionFencePending(),
				"a producer error cannot leave an already consumed publication holding the supervisor fence");
		} else {
			if (failedOwner == FailedSubmissionOwner::PresentationConsumer)
				require(runtime.machine.memory.readMappedU32LE(Finished) == 1u, "presentation failure occurs after guest completion and tail publication, not an early command draw");
			const auto cycles = runtime.machine.scheduler.nowCycles();
			const auto pc = runtime.machine.cpu.readFramePc(runtime.machine.cpu.getFrameDepth() - 1);
			const auto emitted = observed.emitted.load();
			const auto draws = observed.drawCalls;
			bool rejected = false;
			try { worker.run(1.0 / 60.0, 1.0 / 60.0); }
			catch (const ConsumerFailure&) { rejected = true; }
			require(rejected, "a second run preserves the original permanent consumer failure");
			require(runtime.machine.scheduler.nowCycles() == cycles && runtime.machine.cpu.readFramePc(runtime.machine.cpu.getFrameDepth() - 1) == pc
				&& observed.emitted.load() == emitted && observed.drawCalls == draws,
				"a poisoned stream rejects another job before guest execution or GL submission");
			// Request quiescence only after retrying, so the assertion above is
			// not satisfied merely because a supervisor fence blocked execution.
			runtime.machine.gxGpu.beginSupervisorQuiesce();
			require(runtime.machine.gxGpu.backendSubmissionFencePending(),
				"neither a consumer error nor rejected re-entry acknowledges discarded publications as valid VRAM");
		}
	}
	require(!observed.wrongThread, "failed submission teardown joins without moving GL to the producer");
	observation = nullptr;
	presenter.releaseRenderPipeline();
	presenter.clearTextures();
	backend.onContextDestroy();
	std::cout << "GX-WORKER:PASS " << (failedOwner == FailedSubmissionOwner::Producer ? "producer exception completion barrier" : "consumer poison and joined teardown") << '\n';
}


std::string frontendSystemDirectory;
retro_hw_render_callback frontendHardware{};
std::thread::id frontendThread;
unsigned frontendFrames = 0;
bool frontendShutdown = false;
retro_game_geometry frontendGeometry{};
GLuint frontendFramebuffer = 0u, frontendTexture = 0u;
unsigned frontendTargetWidth = 0u, frontendTargetHeight = 0u;
unsigned frontendSequence = 0u, frontendGeometrySequence = 0u, frontendFramebufferSequence = 0u;
bool frontendInsideRun = false, frontendCapture = false;
unsigned frontendVideoWidth = 0u, frontendVideoHeight = 0u;
std::vector<u8> frontendPixels;

uintptr_t frontendGetFramebuffer() {
	require(frontendInsideRun, "frontend framebuffer acquisition belongs to retro_run");
	if (frontendCapture && frontendFramebufferSequence == 0u) frontendFramebufferSequence = ++frontendSequence;
	if (frontendTargetWidth != frontendGeometry.base_width || frontendTargetHeight != frontendGeometry.base_height) {
		frontendTargetWidth = frontendGeometry.base_width;
		frontendTargetHeight = frontendGeometry.base_height;
		glActiveTexture(GL_TEXTURE0);
		glBindTexture(GL_TEXTURE_2D, frontendTexture);
		glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, frontendTargetWidth, frontendTargetHeight, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
		glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
		glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
		glBindFramebuffer(GL_FRAMEBUFFER, frontendFramebuffer);
		glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, frontendTexture, 0);
		require(glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE, "frontend-owned presentation attachment is complete");
	}
	return frontendFramebuffer;
}

bool frontendEnvironment(unsigned command, void* data) {
	require(std::this_thread::get_id() == frontendThread, "libretro environment callbacks remain on the frontend thread");
	switch (command) {
	case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT:
		return *static_cast<retro_pixel_format*>(data) == RETRO_PIXEL_FORMAT_XRGB8888;
	case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY:
		*static_cast<const char**>(data) = frontendSystemDirectory.c_str(); return true;
	case RETRO_ENVIRONMENT_GET_VARIABLE: {
		auto& variable = *static_cast<retro_variable*>(data);
		if (std::strcmp(variable.key, "bmsx_render_backend") == 0) variable.value = "gles2";
		else if (std::strcmp(variable.key, "bmsx_rewind_recording") == 0) variable.value = "off";
		else if (std::strcmp(variable.key, "bmsx_crt_postprocessing") == 0) variable.value = "off";
		else return false;
		return true;
	}
	case RETRO_ENVIRONMENT_SET_HW_RENDER: {
		auto& callback = *static_cast<retro_hw_render_callback*>(data);
		callback.get_current_framebuffer = frontendGetFramebuffer;
		callback.get_proc_address = [](const char* name) -> retro_proc_address_t { return eglGetProcAddress(name); };
		frontendHardware = callback;
		return true;
	}
	case RETRO_ENVIRONMENT_SET_GEOMETRY:
	case RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO:
		require(frontendInsideRun, "video environment notifications belong to retro_run, never retro_unserialize");
		frontendGeometry = command == RETRO_ENVIRONMENT_SET_GEOMETRY
			? *static_cast<retro_game_geometry*>(data)
			: static_cast<retro_system_av_info*>(data)->geometry;
		frontendGeometrySequence = ++frontendSequence;
		return true;
	case RETRO_ENVIRONMENT_SHUTDOWN:
		frontendShutdown = true; return true;
	default: return false;
	}
}

void testLibretroEntry(const test::Blua32TestRom& rom, bool threaded) {
	frontendThread = std::this_thread::get_id();
	frontendFrames = 0u;
	frontendShutdown = false;
	frontendTargetWidth = frontendTargetHeight = 0u;
	const auto directory = std::filesystem::temp_directory_path() / "bmsx_gles_frame_worker_test";
	std::filesystem::create_directories(directory);
	frontendSystemDirectory = directory.string();
	{
		std::ofstream bios(directory / "bmsx-bios.rom", std::ios::binary);
		bios.write(reinterpret_cast<const char*>(rom.bytes.data()), rom.bytes.size());
	}
	const auto cart = test::encodeBlua32TestDataRom();
	const auto cartPath = (directory / "data.rom").string();
	{
		std::ofstream file(cartPath, std::ios::binary);
		file.write(reinterpret_cast<const char*>(cart.data()), cart.size());
	}
	setenv("BMSX_GLES2_THREADED", threaded ? "1" : "0", 1);
	glGenFramebuffers(1, &frontendFramebuffer);
	glGenTextures(1, &frontendTexture);
	retro_set_environment(frontendEnvironment);
	retro_set_video_refresh([](const void* data, unsigned width, unsigned height, size_t) {
		require(std::this_thread::get_id() == frontendThread, "video callback remains on frontend thread");
		require(data == nullptr || data == RETRO_HW_FRAME_BUFFER_VALID, "GLES publishes hardware frames");
		if (frontendCapture) {
			require(data == RETRO_HW_FRAME_BUFFER_VALID, "the first restored run publishes its image, not a duplicate");
			frontendVideoWidth = width; frontendVideoHeight = height;
			frontendPixels.resize(static_cast<size_t>(frontendTargetWidth) * frontendTargetHeight * 4u);
			glBindFramebuffer(GL_FRAMEBUFFER, frontendFramebuffer);
			glPixelStorei(GL_PACK_ALIGNMENT, 1);
			glReadPixels(0, 0, frontendTargetWidth, frontendTargetHeight, GL_RGBA, GL_UNSIGNED_BYTE, frontendPixels.data());
		}
		++frontendFrames;
	});
	retro_set_audio_sample_batch([](const int16_t*, size_t frames) -> size_t {
		require(std::this_thread::get_id() == frontendThread, "audio callback remains on frontend thread");
		return frames;
	});
	retro_set_input_poll([] { require(std::this_thread::get_id() == frontendThread, "input polling remains on frontend thread"); });
	retro_set_input_state([](unsigned, unsigned, unsigned, unsigned) -> int16_t { return 0; });
	retro_init();
	retro_system_av_info av{};
	retro_get_system_av_info(&av);
	frontendGeometry = av.geometry;
	const retro_game_info game{cartPath.c_str(), nullptr, 0, nullptr};
	require(retro_load_game(&game), "the real libretro entry admits the generated fixture");
	require(frontendHardware.context_reset != nullptr, "the frontend owns actual context lifecycle callbacks");
	frontendHardware.context_reset();
	bool programmedGeometryPresented = false;
	for (unsigned frame = 0; frame < 2; ++frame) {
		frontendSequence = frontendGeometrySequence = frontendFramebufferSequence = 0u;
		frontendCapture = frontendInsideRun = true;
		mutateFrontendGlState();
		retro_run();
		frontendCapture = frontendInsideRun = false;
		if (frontendGeometrySequence != 0u) {
			require(frontendGeometrySequence < frontendFramebufferSequence,
				"guest-programmed geometry reaches the frontend before its first framebuffer acquisition");
			require(frontendTargetWidth == 256u && frontendTargetHeight == 256u && frontendVideoWidth == 256u && frontendVideoHeight == 256u,
				"the first guest-programmed attachment and callback use the selected 256x256 extent");
			const size_t tailPixel = ((255u - 64u) * 256u + 4u) * 4u;
			require(frontendPixels[tailPixel] == 255u && frontendPixels[tailPixel + 1u] == 0u && frontendPixels[tailPixel + 2u] == 0u,
				"the first guest-programmed framebuffer contains the guest's trailing red primitive");
			programmedGeometryPresented = true;
		}
	}
	require(programmedGeometryPresented, "the actual guest program changes the frontend's reset geometry");
	require(frontendFrames == 2u && !frontendShutdown, "retro_run publishes without shutting down");
	frontendInsideRun = true;
	std::vector<u8> envelope(retro_serialize_size());
	mutateFrontendGlState();
	require(retro_serialize(envelope.data(), envelope.size()), "serialization follows the completed worker barrier");
	const auto state = decodeRuntimeSaveState(std::span<const u8>(envelope.data() + 8u, readLE32(envelope.data() + 4u)),
		PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
	require(readLE32(state.machineState.machine.memory.ram.data() + (Finished - RAM_BASE)) == 1u,
		"real threaded libretro executes the guest through readback completion");
	// serialize repopulates bindings even after endFrame invalidated them.
	// Restore changes the source epoch without touching GL, so the next job
	// must reacquire the frontend's clobbered state before publishing bytes.
	mutateFrontendGlState();
	require(retro_unserialize(envelope.data(), envelope.size()), "restore after external GL mutation succeeds");
	retro_run();
	std::vector<u8> restoredEnvelope(retro_serialize_size());
	mutateFrontendGlState();
	require(retro_serialize(restoredEnvelope.data(), restoredEnvelope.size()), "capture reacquires context ownership after restored execution");
	const auto restored = decodeRuntimeSaveState(std::span<const u8>(restoredEnvelope.data() + 8u, readLE32(restoredEnvelope.data() + 4u)),
		PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
	require(restored.machineState.machine.gxGpu.vramBytes == state.machineState.machine.gxGpu.vramBytes,
		"frontend GL writes after a snapshot cannot corrupt the next job's VRAM");
	mutateFrontendGlState();
	frontendHardware.context_destroy();
	frontendHardware.context_reset();
	retro_run();
	require(retro_unserialize(envelope.data(), envelope.size()), "external restore reaches an idle worker");
	retro_run();
	mutateFrontendGlState();
	retro_reset();
	// Capturing the reboot before executing it publishes the replacement VRAM
	// and leaves its viewport/texture bindings cached. The following frontend
	// hand-off must be honored before the worker's first ordinary draw.
	std::vector<u8> rebootEnvelope(retro_serialize_size());
	require(retro_serialize(rebootEnvelope.data(), rebootEnvelope.size()), "capture the reboot boundary before guest execution");
	mutateFrontendGlState();
	retro_run();
	retro_run();
	require(retro_serialize(rebootEnvelope.data(), rebootEnvelope.size()), "capture the replayed guest after frontend GL mutation");
	const auto rebooted = decodeRuntimeSaveState(std::span<const u8>(rebootEnvelope.data() + 8u, readLE32(rebootEnvelope.data() + 4u)),
		PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
	require(rebooted.machineState.machine.gxGpu.vramBytes == state.machineState.machine.gxGpu.vramBytes,
		"pre-presentation GX draws reacquire a viewport and texture state cached by an earlier external snapshot");
	require(!frontendShutdown, "context recreation, restore and reboot retain frontend ownership");
	frontendHardware.context_destroy();
	retro_unload_game(); retro_deinit();
	frontendInsideRun = false;
	// Restore a saved raw scanout into a fresh core whose frontend still owns
	// its reset 320x240 geometry. No guest draw is needed to repair this frame.
	auto scene = state;
	auto& gpu = scene.machineState.machine.gxGpu;
	for (auto* words : {&gpu.pcrtc.registerWords, &gpu.pcrtc.presentWords})
		(*words)[GX_GPU_PCRTC_DISPLAY1_HIGH] = 1023u | (191u << 12u);
	std::vector<u8> expectedPixels(256u * 192u * 4u);
	for (u32 y = 0u; y < 192u; ++y) for (u32 x = 0u; x < 256u; ++x) {
		const u32 red = (x / 17u) & 1u, green = (y / 13u) & 1u, blue = ((x / 29u) + (y / 19u)) & 1u;
		writeLE16(gpu.vramBytes.data() + (y * 1024u + x) * 2u, static_cast<u16>(red * 31u | (green * 31u << 5u) | (blue * 31u << 10u)));
		const size_t at = (y * 256u + x) * 4u;
		expectedPixels[at] = red * 255u; expectedPixels[at + 1u] = green * 255u;
		expectedPixels[at + 2u] = blue * 255u; expectedPixels[at + 3u] = 255u;
	}
	const size_t sceneBytes = encodeRuntimeSaveState(scene, std::span<u8>(envelope).subspan(8u));
	require(sceneBytes != 0u, "the saved raw scanout fits the existing libretro envelope");
	writeLE32(envelope.data() + 4u, static_cast<u32>(sceneBytes));
	{
		setenv("BMSX_GLES2_THREADED", threaded ? "1" : "0", 1);
		retro_init();
		retro_get_system_av_info(&av);
		frontendGeometry = av.geometry;
		require(frontendGeometry.base_width == 320u && frontendGeometry.base_height == 240u, "a fresh frontend begins with reset geometry");
		require(retro_load_game(&game), "fresh core admits the saved scene's cartridge");
		frontendHardware.context_reset();
		frontendSequence = frontendGeometrySequence = frontendFramebufferSequence = 0u;
		require(retro_unserialize(envelope.data(), envelope.size()), "a fresh core restores the saved 256x192 scene");
		require(frontendSequence == 0u, "restore neither acquires a frontend target nor publishes video parameters");
		frontendCapture = frontendInsideRun = true;
		mutateFrontendGlState();
		retro_run();
		frontendCapture = frontendInsideRun = false;
		require(frontendGeometrySequence != 0u && frontendGeometrySequence < frontendFramebufferSequence,
			"restored geometry reaches the frontend before its first framebuffer acquisition");
		require(frontendTargetWidth == 256u && frontendTargetHeight == 192u && frontendVideoWidth == 256u && frontendVideoHeight == 192u,
			"the first restored attachment and video callback both use the saved 256x192 extent");
		for (u32 y = 0u; y < 192u; ++y) for (u32 x = 0u; x < 256u; ++x) {
			const size_t actual = ((191u - y) * 256u + x) * 4u, expected = (y * 256u + x) * 4u;
			require(std::equal(expectedPixels.begin() + expected, expectedPixels.begin() + expected + 4u, frontendPixels.begin() + actual),
				"the first restored presentation contains every saved pattern pixel in the correct orientation");
		}
		require(!frontendShutdown, "restored geometry retains the hardware context");
		frontendHardware.context_destroy();
		retro_unload_game(); retro_deinit();
		std::cout << "GX-WORKER:PASS first restored frontend framebuffer " << (threaded ? "threaded" : "direct") << '\n';
	}
	glBindFramebuffer(GL_FRAMEBUFFER, 0u);
	glDeleteFramebuffers(1, &frontendFramebuffer);
	glDeleteTextures(1, &frontendTexture);
	unsetenv("BMSX_GLES2_THREADED");
	std::filesystem::remove_all(directory);
	std::cout << "GX-WORKER:PASS libretro-entry lifecycle\n";
}

} // namespace
int main() {
	EGLDisplay display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
	require(eglInitialize(display, nullptr, nullptr), "initialize EGL");
	require(eglBindAPI(EGL_OPENGL_ES_API), "bind GLES");
	const EGLint attributes[]{EGL_SURFACE_TYPE, EGL_PBUFFER_BIT, EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
		EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 8, EGL_NONE};
	EGLConfig config; EGLint count;
	require(eglChooseConfig(display, attributes, &config, 1, &count) && count == 1, "choose EGL config");
	const EGLint dimensions[]{EGL_WIDTH, 256, EGL_HEIGHT, 256, EGL_NONE};
	EGLSurface surface = eglCreatePbufferSurface(display, config, dimensions);
	const EGLint contextAttributes[]{EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE};
	EGLContext context = eglCreateContext(display, config, EGL_NO_CONTEXT, contextAttributes);
	require(eglMakeCurrent(display, surface, surface, context), "make context current");
	const auto rom = makeStream();
	testSubmissionFailure(rom, FailedSubmissionOwner::Producer);
#if !BMSX_GLES2_SOFTWARE_GX
	// Only hardware GX command batches issue GL draws before presentation.
	testSubmissionFailure(rom, FailedSubmissionOwner::Consumer);
#endif
	testSubmissionFailure(rom, FailedSubmissionOwner::PresentationConsumer);
	const auto expected = runStream(rom, false, GxGpuDrawTargetMode::FullVram);
	bool visibleColor = false;
	for (size_t pixel = 0; pixel < expected.scanout.size(); pixel += 4u)
		visibleColor |= (expected.scanout[pixel] | expected.scanout[pixel + 1u] | expected.scanout[pixel + 2u]) != 0u;
	require(visibleColor, "scanout parity covers visible rendered pixels, not an all-black frame");
	for (auto mode : {GxGpuDrawTargetMode::FullVram, GxGpuDrawTargetMode::SmallNibbles, GxGpuDrawTargetMode::SmallRgb5}) {
		const auto actual = runStream(rom, true, mode, 2, true, true);
		require(actual.finished == 1u && expected.finished == 1u, "the actual guest program reaches its completion marker");
		require(actual.scanout == expected.scanout, "completed-frame scanout matches direct execution before snapshot capture");
		require(actual.vram == expected.vram, "immutable queued commands match software VRAM including wrapping partial uploads");
		require(actual.readback == expected.readback && actual.readback == 0x03e0001fu, "readback completion returns the correct ordered raw words to the guest");
		require(actual.readbackTail == expected.readbackTail && actual.readbackTail == 0x00007c00u, "queued odd CPU readback retains its unread last pixel");
		require(actual.boundaries == expected.boundaries && actual.cycles == expected.cycles && actual.pc == expected.pc, "submission latency does not change guest cycle or PC boundaries");
		require(actual.dma == expected.dma && actual.dma == actual.readback, "DMA receives ordered readback words through the machine-thread device owner");
		require(actual.dmaTail == expected.dmaTail && actual.dmaTail == 0x00007c00u, "an odd final readback pixel produces a zero high halfword through DMA");
		require(actual.rumbleCalls == 4u && expected.rumbleCalls == 4u, "both vibration effects reach both frontend motors");
		std::cout << "GX-WORKER:PASS target=" << static_cast<int>(mode) << '\n';
	}
	const auto rejected = runStream(rom, true, GxGpuDrawTargetMode::FullVram, 2, false);
	require(rejected.rumbleCalls == 2u, "frontend rejection updates support before a later guest vibration effect");
	const auto resetRom = makeStream(false, true);
	const auto resetDirect = runStream(resetRom, false, GxGpuDrawTargetMode::FullVram, 3);
	const auto resetWorker = runStream(resetRom, true, GxGpuDrawTargetMode::FullVram, 3);
	require(resetWorker.boundaries == resetDirect.boundaries && resetWorker.finished == 1u && resetWorker.vram == resetDirect.vram && resetWorker.readback == resetDirect.readback
		&& resetWorker.pc == resetDirect.pc && resetWorker.cycles == resetDirect.cycles,
		"system reset with queued prior commands replaces VRAM before the new generation runs");
	const auto largeRom = makeStream(false, false, true);
	const auto largeDirect = runStream(largeRom, false, GxGpuDrawTargetMode::FullVram, 8, true, false, true);
	const auto largeWorker = runStream(largeRom, true, GxGpuDrawTargetMode::SmallNibbles, 8, true, false, true);
	require(largeWorker.boundaries == largeDirect.boundaries && largeWorker.finished == 1u && largeWorker.vram == largeDirect.vram && largeWorker.scanout == largeDirect.scanout
		&& largeWorker.cycles == largeDirect.cycles && largeWorker.pc == largeDirect.pc,
		"a maximal DMA upload owns its full payload across bounded publication and later dependent commands");
	testLibretroEntry(rom, false);
	testLibretroEntry(rom, true);
	const auto supervisorRom = makeStream(true);
	const auto supervisorDirect = runStream(supervisorRom, false, GxGpuDrawTargetMode::FullVram);
	const auto supervisorWorker = runStream(supervisorRom, true, GxGpuDrawTargetMode::FullVram);
	std::cout << "supervisor direct done=" << supervisorDirect.finished << " pc=" << supervisorDirect.pc << " cycles=" << supervisorDirect.cycles
		<< " worker done=" << supervisorWorker.finished << " pc=" << supervisorWorker.pc << " cycles=" << supervisorWorker.cycles << std::endl;
	require(supervisorDirect.boundaries == supervisorWorker.boundaries && supervisorDirect.pc == supervisorWorker.pc && supervisorDirect.cycles == supervisorWorker.cycles,
		"supervisor transitions preserve the same guest boundary");
	require(supervisorWorker.finished == 1u && supervisorWorker.readbackTail == 0x00007c00u
		&& supervisorWorker.vram == supervisorDirect.vram && supervisorWorker.scanout == supervisorDirect.scanout,
		"quiesce fences queued work and parks the unread READY pixel across supervisor entry/leave");
	std::cout << "GX-WORKER:PASS supervisor READY fence, reset, DMA, odd readback and maximal payload\n";
	require(glGetError() == GL_NO_ERROR, "threaded execution leaves no GLES error");
	eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
	eglDestroyContext(display, context); eglDestroySurface(display, surface); eglTerminate(display);
}
