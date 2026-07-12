#include "core/machine_manager.h"
#include "input/manager.h"
#include "input/player.h"
#include "machine/bus/io.h"
#include "machine/devices/input/contracts.h"
#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gpu_display.h"
#include "machine/devices/gx/gte.h"
#include "machine/model_registry.h"
#include "machine/memory/map.h"
#include "machine/runtime/boot_timing.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state.h"
#include "machine/runtime/save_state/codec.h"
#include "machine/runtime/timing/index.h"
#include "platform.h"
#include "support/program_cart_fixture.h"

#include <algorithm>
#include <cstdint>
#include <stdexcept>
#include <vector>

namespace {

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

void discardRetroLog(enum retro_log_level, const char*, ...) {
}

void discardInputPoll() {
}

int16_t discardInputState(unsigned, unsigned, unsigned, unsigned) {
	return 0;
}

unsigned geometryChangeCount = 0u;
retro_game_geometry lastGeometry{};

bool captureEnvironment(unsigned command, void* data) {
	if (command == RETRO_ENVIRONMENT_SET_GEOMETRY) {
		lastGeometry = *static_cast<retro_game_geometry*>(data);
		geometryChangeCount += 1u;
	}
	return true;
}

void testLibretroSaveStateRoundTrip() {
	retro_system_av_info avInfo{};
	bmsx::LibretroPlatform platform(bmsx::BackendType::Software, avInfo);
	platform.setLogCallback(discardRetroLog);
	require(platform.getStateSize() == 0u, "libretro state size should be zero before a ROM is loaded");

	const std::vector<bmsx::u8> rom = bmsx::test::makeMinimalProgramCartRom();
	require(platform.loadRom(rom.data(), rom.size()), "libretro should load and boot a program cart ROM");
	require(platform.machineManager()->romLoaded(), "MachineManager should mark the cart ROM loaded");
	require(platform.machineManager()->hasRuntime(), "MachineManager should own a runtime after cart boot");

	bmsx::Runtime& runtime = platform.machineManager()->runtime();
	require(runtime.isInitialized(), "cart program boot should initialize the runtime");
	const size_t stateSize = platform.getStateSize();
	require(stateSize > 0u, "libretro state size should come from initialized runtime state");

	bmsx::Memory& memory = runtime.machine.memory;
	memory.writeMappedU32LE(bmsx::GEO_SCRATCH_BASE, 0x11223344u);
	memory.writeMappedU32LE(bmsx::IO_IRQ_MASK, bmsx::IRQ_VBLANK);
	runtime.machine.irqController.raise(bmsx::IRQ_VBLANK);
	runtime.machine.gxGte.writeDataRegister(30u, 1u);
	runtime.machine.gxGte.writeControlRegister(0u, 1u);
	memory.writeMappedU32LE(bmsx::IO_GX_GTE_COMMAND, bmsx::GX_GTE_FN_DPCS);
	require(memory.readMappedU32LE(bmsx::IO_GX_GTE_CYCLES) == bmsx::GX_GTE_CYCLES_DPCS, "GTE command should publish DPCS cycles before saveState");
	require(platform.getStateSize() == stateSize, "libretro state size should remain stable across RAM and device-register changes");

	const uint32_t savedGp0Word = (bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x123u;
	memory.writeMappedU32LE(bmsx::IO_GX_GPU_GP0, savedGp0Word);
	memory.writeMappedU32LE(bmsx::IO_GX_GPU_GP1, bmsx::GX_GPU_GP1_DISPLAY_MODE << 24u);
	std::vector<bmsx::u8> expectedVram(bmsx::GX_GPU_VRAM_BYTE_COUNT);
	expectedVram[0u] = 0x12u;
	expectedVram[0x45678u] = 0x34u;
	expectedVram.back() = 0x56u;
	runtime.machine.gxGpu.replaceVramSnapshotBytes(expectedVram.data());
	const uint32_t dmaSource = bmsx::GEO_SCRATCH_BASE + 0x100u;
	const uint32_t dmaWords[] = {
		bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u,
		0x00020010u,
		0x00020003u,
		0x22221111u,
		0x44443333u,
		0x66665555u,
	};
	for (size_t index = 0; index < std::size(dmaWords); index += 1u) {
		memory.writeMappedU32LE(dmaSource + static_cast<uint32_t>(index * 4u), dmaWords[index]);
	}
	runtime.machine.dmaController.setTiming(1, 8, runtime.machine.scheduler.currentNowCycles());
	memory.writeMappedU32LE(bmsx::IO_DMA_SRC, dmaSource);
	memory.writeMappedU32LE(bmsx::IO_DMA_DST, bmsx::IO_GX_GPU_GP0);
	memory.writeMappedU32LE(bmsx::IO_DMA_LEN, sizeof(dmaWords));
	memory.writeMappedU32LE(bmsx::IO_DMA_CTRL, bmsx::DMA_CTRL_START);
	runtime.machine.dmaController.accrueCycles(1, runtime.machine.scheduler.currentNowCycles() + 1);
	runtime.machine.dmaController.onService(runtime.machine.scheduler.currentNowCycles() + 1);
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == bmsx::DMA_STATUS_BUSY, "DMA should remain in flight at saveState");
	require(memory.readIoU32(bmsx::IO_DMA_WRITTEN) == 8u, "DMA should save after the first GP0 packet slice");
	const uint32_t savedGp0Latch = runtime.machine.gxGpu.captureState().gp0Word;
	const size_t gpuStateSize = platform.getStateSize();
	std::vector<bmsx::u8> saved(gpuStateSize);
	require(platform.saveState(saved.data(), saved.size()), "libretro saveState should serialize initialized runtime state");
	runtime.machine.dmaController.accrueCycles(100, runtime.machine.scheduler.currentNowCycles() + 100);
	runtime.machine.dmaController.onService(runtime.machine.scheduler.currentNowCycles() + 100);
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == bmsx::DMA_STATUS_DONE, "DMA mutation should complete before loadState");
	require(memory.readIoU32(bmsx::IO_DMA_WRITTEN) == sizeof(dmaWords), "DMA mutation should publish complete progress before loadState");

	memory.writeMappedU32LE(bmsx::GEO_SCRATCH_BASE, 0xaabbccddu);
	memory.writeMappedU32LE(bmsx::IO_GX_GPU_GP1, bmsx::GX_GPU_GP1_RESET << 24u);
	memory.writeMappedU32LE(bmsx::IO_GX_GPU_GP0, (bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x456u);
	std::vector<bmsx::u8> mutatedVram(bmsx::GX_GPU_VRAM_BYTE_COUNT, 0xa5u);
	runtime.machine.gxGpu.replaceVramSnapshotBytes(mutatedVram.data());
	runtime.machine.irqController.reset();
	runtime.machine.gxGte.writeDataRegister(30u, 2u);
	runtime.machine.gxGte.writeControlRegister(0u, 2u);
	memory.writeMappedU32LE(bmsx::IO_GX_GTE_COMMAND, bmsx::GX_GTE_FN_RTPS);
	require(memory.readMappedU32LE(bmsx::GEO_SCRATCH_BASE) == 0xaabbccddu, "RAM mutation should be visible before loadState");
	require(runtime.machine.gxGpu.readDrawModeWord() == 0x456u, "GX-GPU draw-mode mutation should be visible before loadState");
	require(runtime.machine.gxGpu.readVramSnapshotBytes()[0u] == 0xa5u, "GX-GPU VRAM mutation should be visible before loadState");
	require(!runtime.machine.irqController.hasAssertedMaskableInterruptLine(), "IRQ reset should clear the maskable line before loadState");
	require(memory.readIoU32(bmsx::IO_IRQ_MASK) == 0u, "IRQ reset should clear the vector mask before loadState");

	require(platform.loadState(saved.data(), saved.size()), "libretro loadState should apply runtime state bytes");
	require(memory.readMappedU32LE(bmsx::GEO_SCRATCH_BASE) == 0x11223344u, "libretro loadState should restore RAM through Runtime save state");
	require(runtime.machine.gxGpu.captureState().gp0Word == savedGp0Latch, "libretro loadState should restore GX-GPU GP0 word");
	require(runtime.machine.gxGpu.readDrawModeWord() == 0x123u, "libretro loadState should restore GX-GPU raw draw-mode state");
	const auto& restoredVram = runtime.machine.gxGpu.readVramSnapshotBytes();
	require(std::equal(expectedVram.begin(), expectedVram.end(), restoredVram.begin()), "libretro loadState should restore GX-owned raw VRAM");
	require(runtime.machine.gxGpu.readDisplayModeWord() == 0u, "libretro loadState should restore GX-GPU display mode word");
	require((runtime.machine.gxGpu.readStatus() & bmsx::GX_GPU_STATUS_PAL_MODE) == 0u, "libretro loadState should restore GX-GPU GPUSTAT PAL bit");
	require(runtime.timing.gpuDisplayModeWord == bmsx::GX_GPU_RESET_DISPLAY_MODE_WORD, "libretro loadState should derive runtime timing from the restored published GPU mode");
	require(runtime.machine.irqController.hasAssertedMaskableInterruptLine(), "libretro loadState should restore asserted IRQ line state");
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_VBLANK) != 0u, "libretro loadState should restore cart-visible IRQ flags");
	require(memory.readIoU32(bmsx::IO_IRQ_MASK) == bmsx::IRQ_VBLANK, "libretro loadState should restore IRQ_MASK");
	require(runtime.machine.gxGte.readDataRegister(30u) == 1u, "libretro loadState should restore GX-GTE data register words");
	require(runtime.machine.gxGte.readControlRegister(0u) == 1u, "libretro loadState should restore GX-GTE control register words");
	require(memory.readMappedU32LE(bmsx::IO_GX_GTE_CYCLES) == bmsx::GX_GTE_CYCLES_DPCS, "libretro loadState should restore GX-GTE CYCLES latch");
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == bmsx::DMA_STATUS_BUSY, "libretro loadState should restore in-flight DMA status");
	require(memory.readIoU32(bmsx::IO_DMA_WRITTEN) == 8u, "libretro loadState should restore in-flight DMA progress");
	const int64_t dmaResumeCycle = runtime.machine.scheduler.currentNowCycles() + 100;
	runtime.machine.dmaController.accrueCycles(100, dmaResumeCycle);
	runtime.machine.dmaController.onService(dmaResumeCycle);
	require(memory.readIoU32(bmsx::IO_DMA_STATUS) == bmsx::DMA_STATUS_DONE, "restored DMA should complete the GP0 packet");
	require(memory.readIoU32(bmsx::IO_DMA_WRITTEN) == sizeof(dmaWords), "restored DMA should publish the complete byte count");
	const bmsx::GxGpuCommandBuffer& restoredCommands = *runtime.machine.gxGpu.readDeviceOutput().commandBuffer;
	require(restoredCommands.commandKind[restoredCommands.commandCount - 1u] == bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, "restored DMA should complete the retained GX-GPU packet");

}

void testDmaCodecRejectsQueuesBeyondHardwareCapacity() {
	retro_system_av_info avInfo{};
	bmsx::LibretroPlatform platform(bmsx::BackendType::Software, avInfo);
	platform.setLogCallback(discardRetroLog);
	const std::vector<bmsx::u8> rom = bmsx::test::makeMinimalProgramCartRom();
	require(platform.loadRom(rom.data(), rom.size()), "libretro should load a program cart ROM for codec validation");
	bmsx::RuntimeSaveState state = bmsx::captureRuntimeSaveState(platform.machineManager()->runtime());
	state.machineState.machine.dma.queue.resize(bmsx::DMA_JOB_QUEUE_CAPACITY + 1u);
	const std::vector<bmsx::u8> encoded = bmsx::encodeRuntimeSaveState(state);
	bool rejected = false;
	try {
		(void)bmsx::decodeRuntimeSaveState(encoded);
	} catch (const std::runtime_error&) {
		rejected = true;
	}
	require(rejected, "save-state codec should reject DMA queues beyond the hardware FIFO capacity");
}

void testGpureadCodecStoresReadyBytesAndRejectsBackendPhase() {
	retro_system_av_info avInfo{};
	bmsx::LibretroPlatform platform(bmsx::BackendType::Software, avInfo);
	platform.setLogCallback(discardRetroLog);
	const std::vector<bmsx::u8> rom = bmsx::test::makeMinimalProgramCartRom();
	require(platform.loadRom(rom.data(), rom.size()), "libretro should load a program cart ROM for GPUREAD codec validation");
	bmsx::RuntimeSaveState ready = bmsx::captureRuntimeSaveState(platform.machineManager()->runtime());
	bmsx::GxGpuCommandBufferState& readyReadback = ready.machineState.machine.gxGpu.commandBuffer;
	readyReadback.readbackPhase = bmsx::GX_GPU_READBACK_READY;
	readyReadback.readbackX = 1023u;
	readyReadback.readbackY = 511u;
	readyReadback.readbackWidth = 3u;
	readyReadback.readbackHeight = 1u;
	readyReadback.readbackPixelCursor = 1u;
	readyReadback.readbackPixelBytes = { 0x11u, 0x11u, 0x22u, 0x22u, 0x33u, 0x33u };
	const bmsx::RuntimeSaveState decodedReady = bmsx::decodeRuntimeSaveState(bmsx::encodeRuntimeSaveState(ready));
	const bmsx::GxGpuCommandBufferState& decodedReadyReadback = decodedReady.machineState.machine.gxGpu.commandBuffer;
	require(decodedReadyReadback.readbackPhase == bmsx::GX_GPU_READBACK_READY, "native codec preserves READY GPUREAD phase");
	require(decodedReadyReadback.readbackPixelCursor == 1u, "native codec preserves READY GPUREAD cursor");
	require(decodedReadyReadback.readbackPixelBytes == readyReadback.readbackPixelBytes, "native codec preserves READY GPUREAD bytes");

	bmsx::RuntimeSaveState submitted = bmsx::captureRuntimeSaveState(platform.machineManager()->runtime());
	bmsx::GxGpuCommandBufferState& submittedReadback = submitted.machineState.machine.gxGpu.commandBuffer;
	submittedReadback.readbackPhase = bmsx::GX_GPU_READBACK_SUBMITTED;
	submittedReadback.readbackWidth = bmsx::GX_GPU_VRAM_WIDTH;
	submittedReadback.readbackHeight = bmsx::GX_GPU_VRAM_HEIGHT;
	submittedReadback.readbackPixelBytes.clear();
	bool rejected = false;
	try {
		(void)bmsx::decodeRuntimeSaveState(bmsx::encodeRuntimeSaveState(submitted));
	}
	catch (const std::exception&) {
		rejected = true;
	}
	require(rejected, "native codec rejects backend-only SUBMITTED GPUREAD phase");

	bmsx::RuntimeSaveState oversized = bmsx::captureRuntimeSaveState(platform.machineManager()->runtime());
	oversized.machineState.machine.gxGpu.vramBytes.resize(bmsx::RUNTIME_SAVE_STATE_WIRE_CAPACITY);
	rejected = false;
	try {
		(void)bmsx::encodeRuntimeSaveState(oversized);
	}
	catch (const std::exception&) {
		rejected = true;
	}
	require(rejected, "native codec rejects payloads beyond the current-format wire capacity");
	oversized.machineState.machine.gxGpu.vramBytes.clear();
	std::vector<bmsx::u8> oversizedWire(bmsx::RUNTIME_SAVE_STATE_WIRE_CAPACITY + 1u);
	rejected = false;
	try {
		(void)bmsx::decodeRuntimeSaveState(oversizedWire);
	}
	catch (const std::exception&) {
		rejected = true;
	}
	require(rejected, "native codec rejects oversized current-format wire input before decoding");
}

void testLibretroStateEnvelopeSupportsMaximumGpuread() {
	retro_system_av_info avInfo{};
	bmsx::LibretroPlatform platform(bmsx::BackendType::Software, avInfo);
	platform.setLogCallback(discardRetroLog);
	const std::vector<bmsx::u8> rom = bmsx::test::makeMinimalProgramCartRom();
	require(platform.loadRom(rom.data(), rom.size()), "libretro should load a program cart ROM for GPUREAD envelope validation");
	const size_t stateSize = platform.getStateSize();
	bmsx::GxGpu& gpu = platform.machineManager()->runtime().machine.gxGpu;
	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	gpu.writeGp0(0u);
	gpu.writeGp0(0u);
	gpu.presentReadyFrameOnVblankEdge();
	require(platform.getStateSize() == stateSize, "libretro state envelope remains fixed with maximum READY GPUREAD payload");
	std::vector<bmsx::u8> state(stateSize + 16u);
	require(platform.saveState(state.data(), state.size()), "libretro fixed envelope should contain maximum GPUREAD payload");
	require(platform.loadState(state.data(), state.size()), "libretro fixed envelope decodes its explicit payload length from a larger caller buffer");
}

void testInputSnapshotReflectsHeldKey() {
	retro_system_av_info avInfo{};
	bmsx::LibretroPlatform platform(bmsx::BackendType::Software, avInfo);
	platform.setLogCallback(discardRetroLog);

	bmsx::Input& input = bmsx::Input::instance();
	platform.postKeyboardEvent("KeyX", true);
	input.pollInput();
	bmsx::InputControllerSnapshot snapshot;
	input.sampleInputControllerSnapshot(0.0, snapshot);

	// KeyX is USB HID usage 27; the raw ICU keyboard bitmap indexes by usage.
	constexpr uint32_t usage = 27u;
	require((snapshot.keyWords[usage >> 5u] & (1u << (usage & 31u))) != 0u,
		"raw ICU snapshot should set the keyboard bit for a held key");
}

void testLibretroTracksPublishedNativeOutputGeometry() {
	retro_system_av_info avInfo{};
	avInfo.geometry.base_width = 320u;
	avInfo.geometry.base_height = 240u;
	avInfo.geometry.max_width = static_cast<unsigned>(bmsx::PSX_GPU_MAX_DISPLAY_WIDTH);
	avInfo.geometry.max_height = static_cast<unsigned>(bmsx::PSX_GPU_MAX_DISPLAY_HEIGHT);
	avInfo.geometry.aspect_ratio = static_cast<float>(bmsx::PSX_GPU_DISPLAY_ASPECT_WIDTH) / static_cast<float>(bmsx::PSX_GPU_DISPLAY_ASPECT_HEIGHT);
	geometryChangeCount = 0u;
	lastGeometry = {};
	bmsx::LibretroPlatform platform(bmsx::BackendType::Software, avInfo);
	platform.setEnvironmentCallback(captureEnvironment);
	platform.setLogCallback(discardRetroLog);
	platform.setInputPollCallback(discardInputPoll);
	platform.setInputStateCallback(discardInputState);
	const std::vector<bmsx::u8> rom = bmsx::test::makeMinimalProgramCartRom();
	require(platform.loadRom(rom.data(), rom.size()), "libretro should load a program cart ROM for native geometry validation");
	platform.machineManager()->start();
	platform.setPlatformPaused(true);

	bmsx::Runtime& runtime = platform.machineManager()->runtime();
	bmsx::GxGpu& gpu = runtime.machine.gxGpu;
	const uint32_t range192 = ((35u + 192u) << 10u) | 35u;
	const uint32_t range212 = ((35u + 212u) << 10u) | 35u;
	gpu.writeGp1((bmsx::GX_GPU_GP1_DISPLAY_MODE << 24u) | bmsx::PSX_GPU_DISPLAY_MODE_PAL_WORD);
	gpu.writeGp1((bmsx::GX_GPU_GP1_VERTICAL_DISPLAY_RANGE << 24u) | range192);
	gpu.presentReadyFrameOnVblankEdge();
	require(platform.runFrame(), "libretro paused frame should present the published 192-line output");
	require(geometryChangeCount == 1u, "libretro should publish one geometry transition for 256x192");
	require(lastGeometry.base_width == 256u && lastGeometry.base_height == 192u, "libretro geometry transition should expose native 256x192");
	require(lastGeometry.max_width == static_cast<unsigned>(bmsx::PSX_GPU_MAX_DISPLAY_WIDTH), "libretro geometry should retain the maximum display width");
	require(lastGeometry.max_height == static_cast<unsigned>(bmsx::PSX_GPU_MAX_DISPLAY_HEIGHT), "libretro geometry should retain the maximum display height");
	require(lastGeometry.aspect_ratio == static_cast<float>(bmsx::PSX_GPU_DISPLAY_ASPECT_WIDTH) / static_cast<float>(bmsx::PSX_GPU_DISPLAY_ASPECT_HEIGHT), "libretro geometry should retain the model aspect ratio");
	require(platform.getFramebuffer().width == 256u && platform.getFramebuffer().height == 192u, "libretro framebuffer should resize to native 256x192");
	require(avInfo.geometry.base_width == 256u && avInfo.geometry.base_height == 192u, "libretro AV cache should track the published 256x192 output");

	require(platform.runFrame(), "libretro paused frame should hold the unchanged 192-line output");
	require(geometryChangeCount == 1u, "libretro should not republish unchanged native geometry");

	const uint32_t alternateHorizontalRange = 0x00c6e27eu;
	gpu.writeGp1((bmsx::GX_GPU_GP1_HORIZONTAL_DISPLAY_RANGE << 24u) | alternateHorizontalRange);
	gpu.presentReadyFrameOnVblankEdge();
	require(platform.runFrame(), "libretro paused frame should consume the changed horizontal timing range");
	require(gpu.readDeviceOutput().horizontalDisplayRangeWord == alternateHorizontalRange, "GX-GPU should publish the changed horizontal timing range as raw state");
	require(geometryChangeCount == 1u, "horizontal timing range must not act as a logical-width transition");
	require(platform.getFramebuffer().width == 256u && platform.getFramebuffer().height == 192u, "horizontal timing range must not resize the native framebuffer");

	gpu.writeGp1((bmsx::GX_GPU_GP1_VERTICAL_DISPLAY_RANGE << 24u) | range212);
	require(gpu.readVerticalDisplayRangeWord() == range212, "GX-GPU live vertical range should retain the pending 212-line write");
	require(gpu.readDeviceOutput().verticalDisplayRangeWord == range192, "GX-GPU published output should retain 192 lines until the next vblank latch");
	const size_t stateSize = platform.getStateSize();
	std::vector<bmsx::u8> saved(stateSize);
	require(platform.saveState(saved.data(), saved.size()), "libretro should save pending live 212-line state with published 192-line output");
	gpu.presentReadyFrameOnVblankEdge();
	require(platform.runFrame(), "libretro paused frame should present the published 212-line output");
	require(geometryChangeCount == 2u, "libretro should publish one geometry transition back to 256x212");
	require(platform.getFramebuffer().width == 256u && platform.getFramebuffer().height == 212u, "libretro framebuffer should resize to native 256x212");
	require(avInfo.geometry.base_width == 256u && avInfo.geometry.base_height == 212u, "libretro AV cache should track the published 256x212 output");

	require(platform.loadState(saved.data(), saved.size()), "libretro should restore the published 192-line output state");
	require(gpu.readVerticalDisplayRangeWord() == range212, "libretro state restore should preserve the pending live 212-line range");
	require(gpu.readDeviceOutput().verticalDisplayRangeWord == range192, "libretro state restore should preserve the published 192-line range");
	require(runtime.timing.gpuVerticalDisplayRangeWord == range192, "libretro state restore should derive runtime timing from the restored published vertical range");
	require(platform.runFrame(), "libretro paused frame should present restored 192-line output");
	require(geometryChangeCount == 3u, "libretro restore should publish one transition to restored 256x192 geometry");
	require(platform.getFramebuffer().width == 256u && platform.getFramebuffer().height == 192u, "libretro restore should resize the framebuffer to restored native geometry");
	require(avInfo.geometry.base_width == 256u && avInfo.geometry.base_height == 192u, "libretro AV cache should track restored native geometry");
}

void testPublishedDisplayTimingAppliesAtFrameEnd() {
	const bmsx::ResolvedRuntimeTiming pal240 = bmsx::resolveRuntimeTiming(5000000, bmsx::GX_GPU_RESET_DISPLAY_MODE_WORD);
	const bmsx::ResolvedRuntimeTiming ntsc240 = bmsx::resolveRuntimeTiming(5000000, bmsx::GX_GPU_RESET_DISPLAY_MODE_WORD & ~bmsx::PSX_GPU_DISPLAY_MODE_PAL_BIT);
	require(pal240.vblankCycles == 23323, "PAL 240-line mode should expose 23323 vblank cycles at 5MHz");
	require(ntsc240.vblankCycles == 7005, "NTSC 240-line mode should expose 7005 vblank cycles at 5MHz");
	require(bmsx::resolveVblankCycles(5000000, bmsx::PAL_REFRESH_UFPS_SCALED, bmsx::PAL_TOTAL_SCANLINES, 212) == 32269, "PAL 212-line mode should expose 32269 vblank cycles at 5MHz");
	require(bmsx::resolveVblankCycles(5000000, bmsx::NTSC_REFRESH_UFPS_SCALED, bmsx::NTSC_TOTAL_SCANLINES, 212) == 15920, "NTSC 212-line mode should expose 15920 vblank cycles at 5MHz");
	require(bmsx::resolveVblankCycles(5000000, bmsx::PAL_REFRESH_UFPS_SCALED, bmsx::PAL_TOTAL_SCANLINES, 192) == 38659, "PAL 192-line mode should expose 38659 vblank cycles at 5MHz");
	require(bmsx::resolveVblankCycles(5000000, bmsx::NTSC_REFRESH_UFPS_SCALED, bmsx::NTSC_TOTAL_SCANLINES, 192) == 22287, "NTSC 192-line mode should expose 22287 vblank cycles at 5MHz");

	retro_system_av_info avInfo{};
	bmsx::LibretroPlatform platform(bmsx::BackendType::Software, avInfo);
	platform.setLogCallback(discardRetroLog);
	const std::vector<bmsx::u8> rom = bmsx::test::makeMinimalProgramCartRom();
	require(platform.loadRom(rom.data(), rom.size()), "libretro should load a program cart ROM for published timing validation");
	bmsx::Runtime& runtime = platform.machineManager()->runtime();
	bmsx::applyRuntimeTiming(runtime, pal240);
	bmsx::GxGpu& gpu = runtime.machine.gxGpu;
	const uint32_t range192 = ((35u + 192u) << 10u) | 35u;
	const uint32_t range212 = ((35u + 212u) << 10u) | 35u;

	gpu.writeGp1((bmsx::GX_GPU_GP1_VERTICAL_DISPLAY_RANGE << 24u) | range192);
	require(runtime.timing.gpuVerticalDisplayRangeWord == bmsx::GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD, "GP1 vertical range write should not change runtime timing before publication");
	runtime.vblank.handleBeginTimer(runtime);
	require(gpu.readDeviceOutput().verticalDisplayRangeWord == range192, "vblank begin should latch the live 192-line range for presentation");
	require(runtime.timing.gpuVerticalDisplayRangeWord == bmsx::GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD, "vblank begin should not change current-frame timing");
	runtime.machine.scheduler.reset();
	runtime.vblank.handleEndTimer(runtime);
	require(runtime.timing.gpuVerticalDisplayRangeWord == range192, "vblank end should apply the published 192-line range to next-frame timing");
	require(runtime.machine.scheduler.nextDeadline() == 61341, "PAL 192-line mode should expose 38659 vblank cycles at 5MHz");

	gpu.writeGp1((bmsx::GX_GPU_GP1_VERTICAL_DISPLAY_RANGE << 24u) | range212);
	require(runtime.timing.gpuVerticalDisplayRangeWord == range192, "pending 212-line GP1 write should leave 192-line timing active");
	runtime.vblank.handleBeginTimer(runtime);
	require(runtime.timing.gpuVerticalDisplayRangeWord == range192, "212-line range latch should wait until frame end before changing timing");
	runtime.machine.scheduler.reset();
	runtime.vblank.handleEndTimer(runtime);
	require(runtime.timing.gpuVerticalDisplayRangeWord == range212, "frame end should activate published PAL 212-line timing");
	require(runtime.machine.scheduler.nextDeadline() == 67731, "PAL 212-line frame scheduling should start vblank after 67731 active cycles");

	gpu.writeGp1(bmsx::GX_GPU_GP1_DISPLAY_MODE << 24u);
	gpu.writeGp1((bmsx::GX_GPU_GP1_VERTICAL_DISPLAY_RANGE << 24u) | range192);
	require(runtime.timing.gpuDisplayModeWord == bmsx::GX_GPU_RESET_DISPLAY_MODE_WORD, "GP1 display-mode write should not change runtime timing before publication");
	runtime.vblank.handleBeginTimer(runtime);
	require(runtime.timing.gpuDisplayModeWord == bmsx::GX_GPU_RESET_DISPLAY_MODE_WORD, "NTSC display-mode latch should wait until frame end before changing timing");
	runtime.machine.scheduler.reset();
	runtime.vblank.handleEndTimer(runtime);
	require(runtime.timing.gpuDisplayModeWord == bmsx::PSX_GPU_DISPLAY_MODE_NTSC_WORD, "frame end should activate published NTSC timing");
	require(runtime.timing.gpuVerticalDisplayRangeWord == range192, "frame end should activate published NTSC 192-line timing");
	require(runtime.machine.scheduler.nextDeadline() == 61129, "NTSC 192-line mode should expose 22287 vblank cycles at 5MHz");

	gpu.writeGp1((bmsx::GX_GPU_GP1_VERTICAL_DISPLAY_RANGE << 24u) | range212);
	runtime.vblank.handleBeginTimer(runtime);
	runtime.machine.scheduler.reset();
	runtime.vblank.handleEndTimer(runtime);
	require(runtime.timing.gpuVerticalDisplayRangeWord == range212, "frame end should activate published NTSC 212-line timing");
	require(runtime.machine.scheduler.nextDeadline() == 67496, "NTSC 212-line frame scheduling should start vblank after 67496 active cycles");
}

} // namespace

int main() {
	testLibretroSaveStateRoundTrip();
	testDmaCodecRejectsQueuesBeyondHardwareCapacity();
	testGpureadCodecStoresReadyBytesAndRejectsBackendPhase();
	testLibretroStateEnvelopeSupportsMaximumGpuread();
	testInputSnapshotReflectsHeldKey();
	testLibretroTracksPublishedNativeOutputGeometry();
	testPublishedDisplayTimingAppliesAtFrameEnd();
	return 0;
}
