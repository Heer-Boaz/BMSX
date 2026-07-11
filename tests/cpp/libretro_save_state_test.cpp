#include "core/machine_manager.h"
#include "input/manager.h"
#include "input/player.h"
#include "machine/bus/io.h"
#include "machine/devices/input/contracts.h"
#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gte.h"
#include "machine/memory/map.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state.h"
#include "machine/runtime/save_state/codec.h"
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

void testLibretroSaveStateRoundTrip() {
	bmsx::LibretroPlatform platform(bmsx::BackendType::Software);
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

	const uint32_t savedGp0Word = (bmsx::GX_GPU_GP0_SET_DRAW_MODE << 24u) | 0x123u;
	memory.writeMappedU32LE(bmsx::IO_GX_GPU_GP0, savedGp0Word);
	memory.writeMappedU32LE(bmsx::IO_GX_GPU_GP1, bmsx::GX_GPU_GP1_SET_DISPLAY_MODE << 24u);
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
	memory.writeMappedU32LE(bmsx::IO_GX_GPU_GP0, (bmsx::GX_GPU_GP0_SET_DRAW_MODE << 24u) | 0x456u);
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
	require(runtime.timing.gpuDisplayModeWord == 0u, "libretro loadState should restore runtime GPU display timing word");
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
	bmsx::LibretroPlatform platform(bmsx::BackendType::Software);
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

void testInputSnapshotReflectsHeldKey() {
	bmsx::LibretroPlatform platform(bmsx::BackendType::Software);
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

} // namespace

int main() {
	testLibretroSaveStateRoundTrip();
	testDmaCodecRejectsQueuesBeyondHardwareCapacity();
	testInputSnapshotReflectsHeldKey();
	return 0;
}
