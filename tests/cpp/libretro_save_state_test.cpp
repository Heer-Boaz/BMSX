#include "core/machine_manager.h"
#include "common/endian.h"
#include "input/gamepad_buttons.h"
#include "input/hid_keys.h"
#include "input/manager.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/cartridge.h"
#include "machine/devices/input/contracts.h"
#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gpu_display.h"
#include "machine/devices/gx/gte.h"
#include "machine/model_registry.h"
#include "spec/bmsx/memory_map.h"
#include "machine/runtime/boot_timing.h"
#include "machine/runtime/cpu_executor.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state.h"
#include "machine/runtime/save_state/codec.h"
#include "machine/runtime/timing/index.h"
#include "platform.h"
#include "support/boot_rom_fixture.h"

#include <algorithm>
#include <array>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <limits>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace {

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

void discardRetroLog(enum retro_log_level, const char*, ...) {
}

std::vector<std::string> capturedLogs;

void captureRetroLog(enum retro_log_level, const char* format, ...) {
	std::array<char, 4096> buffer;
	va_list args;
	va_start(args, format);
	std::vsnprintf(buffer.data(), buffer.size(), format, args);
	va_end(args);
	capturedLogs.emplace_back(buffer.data());
}

bool capturedLogContains(std::string_view text) {
	for (const std::string& line : capturedLogs) {
		if (line.find(text) != std::string::npos) {
			return true;
		}
	}
	return false;
}

void discardInputPoll() {
}

int16_t discardInputState(unsigned, unsigned, unsigned, unsigned) {
	return 0;
}

bool supervisorRequestLineHigh = false;

bool RETRO_CALLCONV readSupervisorRequestLine() {
	return supervisorRequestLineHigh;
}

uint16_t gamepadState = 0u;

int16_t gamepadInputState(unsigned port, unsigned device, unsigned, unsigned id) {
	if (port == 0u && device == RETRO_DEVICE_JOYPAD) {
		return (gamepadState & (1u << id)) != 0u ? 1 : 0;
	}
	return 0;
}

unsigned geometryChangeCount = 0u;
unsigned avInfoChangeCount = 0u;

bool captureEnvironment(unsigned command, void* data) {
	if (command == RETRO_ENVIRONMENT_SET_GEOMETRY) {
		(void)data;
		geometryChangeCount += 1u;
	} else if (command == RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO) {
		avInfoChangeCount += 1u;
	}
	return true;
}

void testLibretroSaveStateRoundTrip() {
	retro_system_av_info avInfo{};
	bmsx::LibretroPlatform platform(
		bmsx::BackendType::Software,
		avInfo,
		readSupervisorRequestLine,
		false);
	platform.setLogCallback(discardRetroLog);
	require(platform.getStateSize() == 0u, "libretro state size should be zero before a ROM is loaded");
	require(platform.machineManager()->loadSystemRomOwned(bmsx::test::makeMinimalBootRom(bmsx::RomImageDomain::System)), "libretro should load the system firmware ROM");

	const std::vector<bmsx::u8> rom = bmsx::test::makeMinimalBootRom(
		bmsx::RomImageDomain::Cartridge,
		bmsx::CARTRIDGE_BOARD_RAM,
		16u);
	require(platform.loadRom(rom.data(), rom.size()), "libretro should load and boot a program cart ROM");
	require(platform.machineManager()->romLoaded(), "MachineManager should mark the cart ROM loaded");
	require(platform.machineManager()->hasRuntime(), "MachineManager should own a runtime after cart boot");

	bmsx::Runtime& runtime = platform.machineManager()->runtime();
	auto& scheduler = runtime.machine.scheduler;
	const size_t stateSize = platform.getStateSize();
	require(
		stateSize == 8u + bmsx::runtimeSaveStateWireCapacity(16u),
		"libretro state size should include the inserted cartridge RAM capacity");

	bmsx::Memory& memory = runtime.machine.memory;
	memory.writeMappedU32LE(bmsx::CART_RAM_BASE, 0x89abcdefu);
	memory.writeMappedU32LE(bmsx::GEO_SCRATCH_BASE, 0x11223344u);
	memory.writeMappedU32LE(bmsx::IO_IRQ_MASK, bmsx::IRQ_VBLANK);
	runtime.machine.irqController.raise(bmsx::IRQ_VBLANK);
	runtime.machine.gxGte.writeDataRegister(30u, 1u);
	runtime.machine.gxGte.writeControlRegister(0u, 1u);
	memory.writeMappedU32LE(bmsx::IO_GX_GTE_COMMAND, bmsx::GX_GTE_FN_DPCS);
	memory.writeMappedU32LE(bmsx::IO_GX_GTE_PLUS_BASE + bmsx::GX_GTE_PLUS_ADD_XY * bmsx::IO_WORD_SIZE, 0xffec000au);
	memory.writeMappedU32LE(bmsx::IO_GX_GTE_PLUS_BASE + bmsx::GX_GTE_PLUS_MUL_XY * bmsx::IO_WORD_SIZE, 0x000c0008u);
	memory.writeMappedU32LE(bmsx::IO_GX_GTE_PLUS_BASE + bmsx::GX_GTE_PLUS_SCALAR * bmsx::IO_WORD_SIZE, 0x0800u);
	memory.writeMappedU32LE(bmsx::IO_GX_GTE_PLUS_BASE + bmsx::GX_GTE_PLUS_COMMAND * bmsx::IO_WORD_SIZE, bmsx::GX_GTE_PLUS_FN_VMAD3);
	require(memory.readMappedU32LE(bmsx::IO_GX_GTE_CYCLES) == bmsx::GX_GTE_CYCLES_DPCS, "GTE command should publish DPCS cycles before saveState");
	require(memory.readMappedU32LE(bmsx::IO_GX_GTE_PLUS_BASE + bmsx::GX_GTE_PLUS_RESULT_XY * bmsx::IO_WORD_SIZE) == 0u, "GTE+ command should retain VMAD3 result before completion");
	require(memory.readMappedU32LE(bmsx::IO_GX_GTE_PLUS_BASE + bmsx::GX_GTE_PLUS_CYCLES * bmsx::IO_WORD_SIZE) == (bmsx::GX_GTE_PLUS_CYCLES_BUSY | bmsx::GX_GTE_PLUS_CYCLES_VMAD3), "GTE+ command should publish busy timing before completion");
	bmsx::advanceRuntimeTime(runtime, bmsx::GX_GTE_PLUS_CYCLES_VMAD3);
	require(memory.readMappedU32LE(bmsx::IO_GX_GTE_PLUS_BASE + bmsx::GX_GTE_PLUS_RESULT_XY * bmsx::IO_WORD_SIZE) == 0xfff2000eu, "GTE+ command should publish VMAD3 result before saveState");
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
	std::array<uint32_t, 20> dmaWords{};
	dmaWords[0] = bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u;
	dmaWords[1] = 0x00020010u;
	dmaWords[2] = (1u << 16u) | 34u;
	for (size_t index = 3u; index < dmaWords.size(); index += 1u) {
		dmaWords[index] = static_cast<uint32_t>(index * 0x11111111u);
	}
	for (size_t index = 0; index < dmaWords.size(); index += 1u) {
		memory.writeMappedU32LE(dmaSource + static_cast<uint32_t>(index * 4u), dmaWords[index]);
	}
	runtime.machine.dmaController.setTiming(0, 1, 0, 0, 0, scheduler.currentNowCycles());
	runtime.machine.gxGpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	memory.writeMappedU32LE(bmsx::IO_DMA0_READ_ADDR, dmaSource);
	memory.writeMappedU32LE(bmsx::IO_DMA0_WRITE_ADDR, bmsx::IO_GX_GPU_GP0);
	memory.writeMappedU32LE(bmsx::IO_DMA0_TRANSFER_COUNT, static_cast<uint32_t>(dmaWords.size()));
	memory.writeMappedU32LE(bmsx::IO_DMA0_CONTROL, 0x00003c41u);
	memory.writeMappedU32LE(bmsx::IO_DMA0_TRIGGER, bmsx::DMA_TRIGGER_START);
	const bmsx::i64 firstDmaServiceCycle = scheduler.currentNowCycles() + 1;
	scheduler.advanceTo(firstDmaServiceCycle);
	runtime.machine.dmaController.onService(firstDmaServiceCycle);
	require(memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_BUSY, "DMA should remain in flight at saveState");
	require(memory.readIoU32(bmsx::IO_DMA0_TRANSFER_COUNT) == 4u, "DMA should save with four live word transfers remaining");
	require(memory.readIoU32(bmsx::IO_DMA0_READ_ADDR) == dmaSource + 64u, "DMA should save its live read address");
	require(!memory.mappedWriteReady(bmsx::IO_GX_GPU_GP0), "in-flight DMA should own GP0 at saveState");
	const uint32_t savedGp0Latch = runtime.machine.gxGpu.captureState().gp0Word;
	const size_t gpuStateSize = platform.getStateSize();
	std::vector<bmsx::u8> saved(gpuStateSize);
	require(platform.saveState(saved.data(), saved.size()), "libretro saveState should serialize initialized runtime state");
	const size_t savedPayloadBytes = bmsx::readLE32(saved.data() + 4u);
	bmsx::RuntimeSaveState savedState = bmsx::decodeRuntimeSaveState(
		saved.data() + 8u,
		savedPayloadBytes,
		runtime.machine.cartridgeController.ramByteCount());
	savedState.cpuState.memoryWriteBlocked = true;
	savedState.cpuState.memoryWriteBlockedAddress = bmsx::IO_GX_GPU_GP0;
	const std::vector<bmsx::u8> blockedPayload = bmsx::encodeRuntimeSaveState(savedState);
	bmsx::writeLE32(saved.data() + 4u, static_cast<uint32_t>(blockedPayload.size()));
	std::memcpy(saved.data() + 8u, blockedPayload.data(), blockedPayload.size());
	std::memset(saved.data() + 8u + blockedPayload.size(), 0, saved.size() - 8u - blockedPayload.size());
	const bmsx::DmaControllerState mutatingDmaState = runtime.machine.dmaController.captureState();
	const bmsx::i64 dmaMutationCycle = scheduler.currentNowCycles() + mutatingDmaState.scheduledBlockCycles;
	scheduler.advanceTo(dmaMutationCycle);
	runtime.machine.dmaController.onService(dmaMutationCycle);
	require(memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_DONE, "DMA mutation should complete before loadState");
	require(memory.readIoU32(bmsx::IO_DMA0_TRANSFER_COUNT) == 0u, "DMA mutation should consume the live word count");

	memory.writeMappedU32LE(bmsx::GEO_SCRATCH_BASE, 0xaabbccddu);
	memory.writeMappedU32LE(bmsx::CART_RAM_BASE, 0u);
	memory.writeMappedU32LE(bmsx::IO_GX_GPU_GP1, bmsx::GX_GPU_GP1_RESET << 24u);
	memory.writeMappedU32LE(bmsx::IO_GX_GPU_GP0, (bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x456u);
	runtime.machine.gxGpu.onService(std::numeric_limits<bmsx::i64>::max() >> 1u);
	std::vector<bmsx::u8> mutatedVram(bmsx::GX_GPU_VRAM_BYTE_COUNT, 0xa5u);
	runtime.machine.gxGpu.replaceVramSnapshotBytes(mutatedVram.data());
	runtime.machine.irqController.reset();
	runtime.machine.gxGte.writeDataRegister(30u, 2u);
	runtime.machine.gxGte.writeControlRegister(0u, 2u);
	memory.writeMappedU32LE(bmsx::IO_GX_GTE_COMMAND, bmsx::GX_GTE_FN_RTPS);
	memory.writeMappedU32LE(bmsx::IO_GX_GTE_PLUS_BASE + bmsx::GX_GTE_PLUS_ADD_XY * bmsx::IO_WORD_SIZE, 0x00020001u);
	memory.writeMappedU32LE(bmsx::IO_GX_GTE_PLUS_BASE + bmsx::GX_GTE_PLUS_COMMAND * bmsx::IO_WORD_SIZE, bmsx::GX_GTE_PLUS_FN_VMAD3);
	require(memory.readMappedU32LE(bmsx::GEO_SCRATCH_BASE) == 0xaabbccddu, "RAM mutation should be visible before loadState");
	require(runtime.machine.gxGpu.readDrawModeWord() == 0x456u, "GX-GPU draw-mode mutation should be visible before loadState");
	require(runtime.machine.gxGpu.readVramSnapshotBytes()[0u] == 0xa5u, "GX-GPU VRAM mutation should be visible before loadState");
	require(!runtime.machine.irqController.hasAssertedMaskableInterruptLine(), "IRQ reset should clear the maskable line before loadState");
	require(memory.readIoU32(bmsx::IO_IRQ_MASK) == 0u, "IRQ reset should clear the vector mask before loadState");

	require(platform.loadState(saved.data(), saved.size()), "libretro loadState should apply runtime state bytes");
	require(memory.readMappedU32LE(bmsx::GEO_SCRATCH_BASE) == 0x11223344u, "libretro loadState should restore RAM through Runtime save state");
	require(memory.readMappedU32LE(bmsx::CART_RAM_BASE) == 0x89abcdefu, "libretro loadState should restore physical cartridge RAM");
	require(runtime.machine.gxGpu.captureState().gp0Word == savedGp0Latch, "libretro loadState should restore GX-GPU GP0 word");
	require(runtime.machine.gxGpu.readDrawModeWord() == 0x123u, "libretro loadState should restore GX-GPU raw draw-mode state");
	const auto& restoredVram = runtime.machine.gxGpu.readVramSnapshotBytes();
	require(std::equal(expectedVram.begin(), expectedVram.end(), restoredVram.begin()), "libretro loadState should restore GX-owned raw VRAM");
	require(runtime.machine.gxGpu.readDisplayModeWord() == 0u, "libretro loadState should restore GX-GPU display mode word");
	require((runtime.machine.gxGpu.readStatus() & bmsx::GX_GPU_STATUS_PAL_MODE) == 0u, "libretro loadState should restore GX-GPU GPUSTAT PAL bit");
	require(runtime.timing.pcrtcRevision == runtime.machine.gxGpu.readDeviceOutput().pcrtcTiming.revision, "libretro loadState should restore runtime timing from the physical PCRTC owner");
	require(runtime.machine.irqController.hasAssertedMaskableInterruptLine(), "libretro loadState should restore asserted IRQ line state");
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_VBLANK) != 0u, "libretro loadState should restore cart-visible IRQ flags");
	require(memory.readIoU32(bmsx::IO_IRQ_MASK) == bmsx::IRQ_VBLANK, "libretro loadState should restore IRQ_MASK");
	require(runtime.machine.gxGte.readDataRegister(30u) == 1u, "libretro loadState should restore GX-GTE data register words");
	require(runtime.machine.gxGte.readControlRegister(0u) == 1u, "libretro loadState should restore GX-GTE control register words");
	require(memory.readMappedU32LE(bmsx::IO_GX_GTE_CYCLES) == bmsx::GX_GTE_CYCLES_DPCS, "libretro loadState should restore GX-GTE CYCLES latch");
	require(memory.readMappedU32LE(bmsx::IO_GX_GTE_PLUS_BASE + bmsx::GX_GTE_PLUS_RESULT_XY * bmsx::IO_WORD_SIZE) == 0xfff2000eu, "libretro loadState should restore GX-GTE+ VMAD3 results");
	require(memory.readMappedU32LE(bmsx::IO_GX_GTE_PLUS_BASE + bmsx::GX_GTE_PLUS_CYCLES * bmsx::IO_WORD_SIZE) == bmsx::GX_GTE_PLUS_CYCLES_VMAD3, "libretro loadState should restore GX-GTE+ CYCLES latch");
	require(memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_BUSY, "libretro loadState should restore in-flight DMA status");
	require(memory.readIoU32(bmsx::IO_DMA0_TRANSFER_COUNT) == 4u, "libretro loadState should restore the live DMA word count");
	require(memory.readIoU32(bmsx::IO_DMA0_READ_ADDR) == dmaSource + 64u, "libretro loadState should restore the live DMA read address");
	require(!memory.mappedWriteReady(bmsx::IO_GX_GPU_GP0), "restored DMA should retain GP0 ownership");
	require(runtime.machine.cpu.isMemoryWriteBlocked(), "restored GP0 store should remain blocked while DMA owns the port");
	const bmsx::DmaControllerState restoredDmaState = runtime.machine.dmaController.captureState();
	const int64_t dmaResumeCycle = scheduler.currentNowCycles() + restoredDmaState.scheduledBlockCycles;
	scheduler.advanceTo(dmaResumeCycle);
	runtime.machine.dmaController.onService(dmaResumeCycle);
	require(memory.readIoU32(bmsx::IO_DMA0_STATUS) == bmsx::DMA_STATUS_DONE, "restored DMA should complete the GP0 packet");
	require(memory.readIoU32(bmsx::IO_DMA0_TRANSFER_COUNT) == 0u, "restored DMA should consume its retained word count");
	require(!runtime.machine.cpu.isMemoryWriteBlocked(), "DMA completion should release the restored GP0 store");
	const bmsx::GxGpuCommandBuffer& restoredCommands = runtime.machine.gxGpu.readDeviceOutput().commandBuffer;
	require(restoredCommands.commandKind[restoredCommands.commandCount - 1u] == bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, "restored DMA should complete the retained GX-GPU packet");

}

void testLibretroFaultDiagnosticsStayAtHostBoundary() {
	retro_system_av_info avInfo{};
	bmsx::LibretroPlatform platform(
		bmsx::BackendType::Software,
		avInfo,
		readSupervisorRequestLine,
		false);
	platform.setLogCallback(captureRetroLog);
	platform.setInputPollCallback(discardInputPoll);
	platform.setInputStateCallback(discardInputState);
	capturedLogs.clear();
	require(
		platform.machineManager()->loadSystemRomOwned(
			bmsx::test::makeMinimalDiagnosticBootRom(bmsx::RomImageDomain::System)
		),
		"libretro should load symbol-bearing system firmware for runtime diagnostics");
	const std::vector<bmsx::u8> rom =
		bmsx::test::makeMinimalBootRom(bmsx::RomImageDomain::Cartridge);
	require(
		platform.loadRom(rom.data(), rom.size()),
		"libretro should boot symbol-bearing firmware for runtime diagnostics");

	platform.microtaskQueue()->queueMicrotask([] {
		throw std::runtime_error("injected native frame fault");
	});
	require(!platform.runFrame(), "a faulted libretro frame should not report a presentation");
	require(
		!platform.running(),
		"the libretro host should stop after a native frame exception");
	require(
		capturedLogContains("Runtime error: injected native frame fault"),
		"the libretro host should log the native exception");
	require(
		capturedLogContains("debug: pc=") && capturedLogContains(" op=HALT"),
		"the libretro host should disassemble the faulting instruction");
	require(
		capturedLogContains("debug: instr="),
		"the libretro host should log the complete faulting instruction");
	require(
		capturedLogContains("debug: source=test/boot.lua:3:5"),
		"the libretro host should resolve the optional source symbols");
	require(
		capturedLogContains("at test.boot (test/boot.lua:3:5)"),
		"the libretro host should format the physical CPU frame with tooling symbols");
}

void testGpureadCodecStoresReadyBytesAndRejectsBackendPhase() {
	retro_system_av_info avInfo{};
	bmsx::LibretroPlatform platform(
		bmsx::BackendType::Software,
		avInfo,
		readSupervisorRequestLine,
		false);
	platform.setLogCallback(discardRetroLog);
	require(platform.machineManager()->loadSystemRomOwned(bmsx::test::makeMinimalBootRom(bmsx::RomImageDomain::System)), "libretro should load the system firmware ROM for GPUREAD codec validation");
	const std::vector<bmsx::u8> rom = bmsx::test::makeMinimalBootRom(bmsx::RomImageDomain::Cartridge);
	require(platform.loadRom(rom.data(), rom.size()), "libretro should load a program cart ROM for GPUREAD codec validation");
	const size_t cartridgeRamByteCount =
		platform.machineManager()->runtime().machine.cartridgeController.ramByteCount();
	bmsx::RuntimeSaveState ready = bmsx::captureRuntimeSaveState(platform.machineManager()->runtime());
	bmsx::GxGpuCommandBufferState& readyReadback = ready.machineState.machine.gxGpu.commandBuffer;
	bmsx::CpuProtectedCallState protectedCall;
	protectedCall.kind = bmsx::ProtectedCallKind::XPCallHandler;
	protectedCall.callerFrameIndex = 2;
	protectedCall.targetFrameIndex = -1;
	protectedCall.returnsToProtectedParent = true;
	protectedCall.callBase = 4;
	protectedCall.returnCount = 3;
	protectedCall.handlerRegister = 7;
	ready.cpuState.protectedCalls.push_back(protectedCall);
	readyReadback.readbackPhase = bmsx::GX_GPU_READBACK_READY;
	readyReadback.readbackX = 1023u;
	readyReadback.readbackY = 511u;
	readyReadback.readbackWidth = 3u;
	readyReadback.readbackHeight = 1u;
	readyReadback.readbackPixelCursor = 1u;
	readyReadback.readbackPixelBytes = { 0x11u, 0x11u, 0x22u, 0x22u, 0x33u, 0x33u };
	const bmsx::RuntimeSaveState decodedReady = bmsx::decodeRuntimeSaveState(
		bmsx::encodeRuntimeSaveState(ready),
		cartridgeRamByteCount);
	const bmsx::CpuProtectedCallState& decodedProtectedCall = decodedReady.cpuState.protectedCalls[0];
	require(decodedProtectedCall.kind == bmsx::ProtectedCallKind::XPCallHandler, "native codec preserves protected-call phase");
	require(decodedProtectedCall.callerFrameIndex == 2 && decodedProtectedCall.targetFrameIndex == -1, "native codec preserves protected-call frame references");
	require(decodedProtectedCall.returnsToProtectedParent && decodedProtectedCall.callBase == 4 && decodedProtectedCall.returnCount == 3 && decodedProtectedCall.handlerRegister == 7, "native codec preserves protected-call return state");
	const bmsx::GxGpuCommandBufferState& decodedReadyReadback = decodedReady.machineState.machine.gxGpu.commandBuffer;
	require(decodedReadyReadback.readbackPhase == bmsx::GX_GPU_READBACK_READY, "native codec preserves READY GPUREAD phase");
	require(decodedReadyReadback.readbackPixelCursor == 1u, "native codec preserves READY GPUREAD cursor");
	require(decodedReadyReadback.readbackPixelBytes == readyReadback.readbackPixelBytes, "native codec preserves READY GPUREAD bytes");

	bmsx::RuntimeSaveState submitted = bmsx::captureRuntimeSaveState(platform.machineManager()->runtime());
	bmsx::GxGpuCommandBufferState& submittedReadback = submitted.machineState.machine.gxGpu.commandBuffer;
	submittedReadback.readbackPhase = bmsx::GX_GPU_READBACK_SUBMITTED;
	submittedReadback.readbackWidth = bmsx::GX_GPU_VRAM_WIDTH;
	submittedReadback.readbackHeight = bmsx::GX_GPU_TRANSFER_MAX_HEIGHT;
	submittedReadback.readbackPixelBytes.clear();
	bool rejected = false;
	try {
		(void)bmsx::decodeRuntimeSaveState(
			bmsx::encodeRuntimeSaveState(submitted),
			cartridgeRamByteCount);
	}
	catch (const std::exception&) {
		rejected = true;
	}
	require(rejected, "native codec rejects backend-only SUBMITTED GPUREAD phase");

	bmsx::RuntimeSaveState oversized = bmsx::captureRuntimeSaveState(platform.machineManager()->runtime());
	const size_t wireCapacity = bmsx::runtimeSaveStateWireCapacity(cartridgeRamByteCount);
	oversized.machineState.machine.gxGpu.vramBytes.resize(wireCapacity);
	rejected = false;
	try {
		(void)bmsx::encodeRuntimeSaveState(oversized);
	}
	catch (const std::exception&) {
		rejected = true;
	}
	require(rejected, "native codec rejects payloads beyond the current-format wire capacity");
	oversized.machineState.machine.gxGpu.vramBytes.clear();
	std::vector<bmsx::u8> oversizedWire(wireCapacity + 1u);
	rejected = false;
	try {
		(void)bmsx::decodeRuntimeSaveState(oversizedWire, cartridgeRamByteCount);
	}
	catch (const std::exception&) {
		rejected = true;
	}
	require(rejected, "native codec rejects oversized current-format wire input before decoding");
}

void testLibretroStateEnvelopeSupportsMaximumGpuread() {
	retro_system_av_info avInfo{};
	bmsx::LibretroPlatform platform(
		bmsx::BackendType::Software,
		avInfo,
		readSupervisorRequestLine,
		false);
	platform.setLogCallback(discardRetroLog);
	require(platform.machineManager()->loadSystemRomOwned(bmsx::test::makeMinimalBootRom(bmsx::RomImageDomain::System)), "libretro should load the system firmware ROM for GPUREAD envelope validation");
	const std::vector<bmsx::u8> rom = bmsx::test::makeMinimalBootRom(bmsx::RomImageDomain::Cartridge);
	require(platform.loadRom(rom.data(), rom.size()), "libretro should load a program cart ROM for GPUREAD envelope validation");
	const size_t stateSize = platform.getStateSize();
	bmsx::GxGpu& gpu = platform.machineManager()->runtime().machine.gxGpu;
	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	gpu.writeGp0(0u);
	gpu.writeGp0(0u);
	gpu.onService(platform.machineManager()->runtime().machine.scheduler.currentNowCycles() + 1);
	gpu.presentReadyFrameOnVblankEdge();
	require(platform.getStateSize() == stateSize, "libretro state envelope remains fixed with maximum READY GPUREAD payload");
	std::vector<bmsx::u8> state(stateSize + 16u);
	require(platform.saveState(state.data(), state.size()), "libretro fixed envelope should contain maximum GPUREAD payload");
	require(platform.loadState(state.data(), state.size()), "libretro fixed envelope decodes its explicit payload length from a larger caller buffer");
}

void testInputSnapshotReflectsHeldKey() {
	retro_system_av_info avInfo{};
	bmsx::LibretroPlatform platform(
		bmsx::BackendType::Software,
		avInfo,
		readSupervisorRequestLine,
		false);
	platform.setLogCallback(discardRetroLog);

	bmsx::Input input(*platform.inputHub(), *platform.lifecycle());
	auto& inputHub = *static_cast<bmsx::LibretroInputHub*>(platform.inputHub());
	inputHub.postKeyboardEvent(RETROK_x, true);
	input.pollInput();
	bmsx::InputControllerSnapshot snapshot;
	input.sampleInputControllerSnapshot(0.0, snapshot);

	// KeyX is USB HID usage 27; the raw ICU keyboard bitmap indexes by usage.
	constexpr uint32_t usage = 27u;
	require((snapshot.keyWords[usage >> 5u] & (1u << (usage & 31u))) != 0u,
		"raw ICU snapshot should set the keyboard bit for a held key");
}

void testLibretroSupervisorRequestIsSeparateFromGameplay() {
	supervisorRequestLineHigh = false;
	retro_system_av_info avInfo{};
	bmsx::LibretroPlatform platform(
		bmsx::BackendType::Software,
		avInfo,
		readSupervisorRequestLine,
		false);
	platform.setLogCallback(discardRetroLog);
	platform.setInputPollCallback(discardInputPoll);
	platform.setInputStateCallback(gamepadInputState);
	bmsx::Input input(*platform.inputHub(), *platform.lifecycle());
	auto& inputHub = *static_cast<bmsx::LibretroInputHub*>(platform.inputHub());
	int requestEdgesDown = 0;
	int requestEdgesUp = 0;
	bmsx::SubscriptionHandle edgeSubscription = platform.inputHub()->subscribe([&](const bmsx::InputEvt& evt) {
		if (evt.type == bmsx::InputEvtType::SupervisorRequestDown) {
			requestEdgesDown += 1;
		} else if (evt.type == bmsx::InputEvtType::SupervisorRequestUp) {
			requestEdgesUp += 1;
		}
	});

	gamepadState =
		(1u << RETRO_DEVICE_ID_JOYPAD_DOWN) |
		(1u << RETRO_DEVICE_ID_JOYPAD_SELECT);
	inputHub.poll();
	input.pollInput();
	require(!input.supervisorRequestLineHigh(), "RetroPad gameplay must not assert the supervisor-request line");
	require(requestEdgesDown == 0 && requestEdgesUp == 0, "RetroPad gameplay must not emit supervisor-request edges");
	bmsx::InputControllerSnapshot snapshot;
	input.sampleInputControllerSnapshot(0.0, snapshot);
	const uint32_t gameplayButtons =
		(1u << static_cast<uint32_t>(bmsx::GamepadButton::Down)) |
		(1u << static_cast<uint32_t>(bmsx::GamepadButton::Select));
	require((snapshot.pads[0].buttons & gameplayButtons) == gameplayButtons,
		"RetroPad Down and Select must remain ordinary cart-visible gameplay buttons");

	gamepadState = 0u;
	inputHub.poll();
	input.pollInput();
	supervisorRequestLineHigh = true;
	inputHub.poll();
	input.pollInput();
	require(input.supervisorRequestLineHigh(), "the negotiated host line should assert the supervisor request");
	require(requestEdgesDown == 1 && requestEdgesUp == 0, "the negotiated host line should emit one rising edge");
	inputHub.poll();
	input.pollInput();
	require(requestEdgesDown == 1 && requestEdgesUp == 0, "a held host line must not repeat its rising edge");

	inputHub.postKeyboardEvent(RETROK_F2, true);
	supervisorRequestLineHigh = false;
	inputHub.poll();
	input.pollInput();
	require(input.supervisorRequestLineHigh(), "F2 should keep the shared request line high as the host line falls");
	require(requestEdgesDown == 1 && requestEdgesUp == 0, "a host release crossing an F2 press must not publish false edges");
	input.sampleInputControllerSnapshot(0.0, snapshot);
	require((snapshot.keyWords[bmsx::HID_USAGE_F2 >> 5u] & (1u << (bmsx::HID_USAGE_F2 & 31u))) != 0u,
		"libretro F2 must remain an ordinary cart-visible HID key while asserting the supervisor line");

	inputHub.postKeyboardEvent(RETROK_F2, false);
	supervisorRequestLineHigh = true;
	inputHub.poll();
	input.pollInput();
	require(input.supervisorRequestLineHigh(), "the host should keep the shared request line high as F2 falls");
	require(requestEdgesDown == 1 && requestEdgesUp == 0, "an F2 release crossing a host press must not publish false edges");

	inputHub.postKeyboardEvent(RETROK_F2, true);
	supervisorRequestLineHigh = false;
	inputHub.poll();
	input.pollInput();
	require(input.supervisorRequestLineHigh(), "F2 should retain the line through the reverse crossing transition");
	require(requestEdgesDown == 1 && requestEdgesUp == 0, "the reverse crossing transition must keep one continuous request pulse");

	inputHub.postKeyboardEvent(RETROK_F2, false);
	inputHub.poll();
	input.pollInput();
	require(!input.supervisorRequestLineHigh(), "releasing F2 should deassert the supervisor-request line");
	require(requestEdgesDown == 1 && requestEdgesUp == 1, "overlapping host and F2 sources should emit one complete supervisor-request pulse");
	input.sampleInputControllerSnapshot(0.0, snapshot);
	require((snapshot.keyWords[bmsx::HID_USAGE_F2 >> 5u] & (1u << (bmsx::HID_USAGE_F2 & 31u))) == 0u,
		"releasing libretro F2 must clear its ordinary HID key");

	edgeSubscription.unsubscribe();
}

void testLibretroTracksPublishedNativeOutputGeometry() {
	retro_system_av_info avInfo{};
	avInfo.geometry.base_width = 320u;
	avInfo.geometry.base_height = 240u;
	avInfo.geometry.max_width = 1920u;
	avInfo.geometry.max_height = 1080u;
	avInfo.geometry.aspect_ratio = static_cast<float>(bmsx::GX_GPU_DISPLAY_ASPECT_WIDTH) / static_cast<float>(bmsx::GX_GPU_DISPLAY_ASPECT_HEIGHT);
	geometryChangeCount = 0u;
	avInfoChangeCount = 0u;
	bmsx::LibretroPlatform platform(
		bmsx::BackendType::Software,
		avInfo,
		readSupervisorRequestLine,
		false);
	platform.setEnvironmentCallback(captureEnvironment);
	platform.setLogCallback(discardRetroLog);
	platform.setInputPollCallback(discardInputPoll);
	platform.setInputStateCallback(discardInputState);
	require(platform.machineManager()->loadSystemRomOwned(bmsx::test::makeMinimalBootRom(bmsx::RomImageDomain::System)), "libretro should load the system firmware ROM for native geometry validation");
	const std::vector<bmsx::u8> rom = bmsx::test::makeMinimalBootRom(bmsx::RomImageDomain::Cartridge);
	require(platform.loadRom(rom.data(), rom.size()), "libretro should load a program cart ROM for native geometry validation");
	platform.setPlatformPaused(true);

	bmsx::Runtime& runtime = platform.machineManager()->runtime();
	bmsx::GxGpu& gpu = runtime.machine.gxGpu;
	bmsx::Memory& memory = runtime.machine.memory;
	const uint32_t range192 = ((35u + 192u) << 10u) | 35u;
	const uint32_t range212 = ((35u + 212u) << 10u) | 35u;
	gpu.writeGp1((bmsx::GX_GPU_GP1_DISPLAY_MODE << 24u) | bmsx::PSX_GPU_DISPLAY_MODE_PAL_WORD);
	gpu.writeGp1((bmsx::GX_GPU_GP1_VERTICAL_DISPLAY_RANGE << 24u) | range192);
	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_DISPLAY1_HIGH), 1023u | (191u << 12u));
	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_PMODE_LOW), 0x0000ff21u);
	gpu.presentReadyFrameOnVblankEdge();
	require(platform.runFrame(), "libretro paused frame should present the published 192-line output");
	require(platform.getFramebuffer().width == 256u && platform.getFramebuffer().height == 192u, "libretro framebuffer should resize to native 256x192");
	require(avInfo.geometry.base_width == 256u && avInfo.geometry.base_height == 192u, "libretro AV cache should track the published 256x192 output");
	require(avInfo.geometry.max_width == 1920u && avInfo.geometry.max_height == 1080u, "libretro AV cache should retain the standard display envelope");
	require(avInfo.geometry.aspect_ratio == static_cast<float>(bmsx::GX_GPU_DISPLAY_ASPECT_WIDTH) / static_cast<float>(bmsx::GX_GPU_DISPLAY_ASPECT_HEIGHT), "libretro AV cache should retain the model aspect ratio");

	require(platform.runFrame(), "libretro paused frame should hold the unchanged 192-line output");

	const uint32_t alternateHorizontalRange = 0x00c6e27eu;
	gpu.writeGp1((bmsx::GX_GPU_GP1_HORIZONTAL_DISPLAY_RANGE << 24u) | alternateHorizontalRange);
	gpu.presentReadyFrameOnVblankEdge();
	require(platform.runFrame(), "libretro paused frame should consume the changed horizontal timing range");
	require(gpu.readDeviceOutput().horizontalDisplayRangeWord == alternateHorizontalRange, "GX-GPU should publish the changed horizontal timing range as raw state");
	require(platform.getFramebuffer().width == 256u && platform.getFramebuffer().height == 192u, "horizontal timing range must not resize the native framebuffer");

	gpu.writeGp1((bmsx::GX_GPU_GP1_VERTICAL_DISPLAY_RANGE << 24u) | range212);
	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_DISPLAY1_HIGH), 1023u | (211u << 12u));
	require(gpu.readVerticalDisplayRangeWord() == range212, "GX-GPU live vertical range should retain the pending 212-line write");
	require(gpu.readDeviceOutput().verticalDisplayRangeWord == range192, "GX-GPU published output should retain 192 lines until the next vblank latch");
	require(gpu.readDeviceOutput().pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY1_HIGH] == (1023u | (191u << 12u)), "GX-GPU published PCRTC output should retain 192 lines until the next vblank latch");
	const size_t stateSize = platform.getStateSize();
	std::vector<bmsx::u8> saved(stateSize);
	require(platform.saveState(saved.data(), saved.size()), "libretro should save pending live 212-line state with published 192-line output");
	gpu.presentReadyFrameOnVblankEdge();
	require(platform.runFrame(), "libretro paused frame should present the published 212-line output");
	require(platform.getFramebuffer().width == 256u && platform.getFramebuffer().height == 212u, "libretro framebuffer should resize to native 256x212");
	require(avInfo.geometry.base_width == 256u && avInfo.geometry.base_height == 212u, "libretro AV cache should track the published 256x212 output");

	require(platform.loadState(saved.data(), saved.size()), "libretro should restore the published 192-line output state");
	require(gpu.readVerticalDisplayRangeWord() == range212, "libretro state restore should preserve the pending live 212-line range");
	require(gpu.readDeviceOutput().verticalDisplayRangeWord == range192, "libretro state restore should preserve the published 192-line range");
	require(memory.readMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_DISPLAY1_HIGH)) == (1023u | (211u << 12u)), "libretro state restore should preserve pending live PCRTC geometry");
	require(gpu.readDeviceOutput().pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY1_HIGH] == (1023u | (191u << 12u)), "libretro state restore should preserve published PCRTC geometry");
	require(runtime.timing.pcrtcRevision == gpu.readDeviceOutput().pcrtcTiming.revision, "libretro state restore should restore the physical PCRTC timing revision");
	require(platform.runFrame(), "libretro paused frame should present restored 192-line output");
	require(platform.getFramebuffer().width == 256u && platform.getFramebuffer().height == 192u, "libretro restore should resize the framebuffer to restored native geometry");
	require(avInfo.geometry.base_width == 256u && avInfo.geometry.base_height == 192u, "libretro AV cache should track restored native geometry");

	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_SMODE1_LOW), 0x40206504u);
	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_SMODE2_LOW), bmsx::GX_GPU_PCRTC_SMODE2_INT);
	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_SYNCV_LOW), 0x02101401u);
	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_DISPLAY1_LOW), 0u);
	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_DISPLAY1_HIGH), 1919u | (1079u << 12u));
	gpu.presentReadyFrameOnVblankEdge();
	require(platform.runFrame(), "libretro paused frame should present the published PS2 1080i output");
	require(avInfo.geometry.base_width == 1920u && avInfo.geometry.base_height == 1080u, "libretro AV cache should expose native PS2 1080i");
	require(avInfo.geometry.max_width == 1920u && avInfo.geometry.max_height == 1080u, "libretro AV cache should retain the standard PS2 output envelope");
	require(platform.getFramebuffer().width == 1920u && platform.getFramebuffer().height == 1080u, "libretro framebuffer should resize to native PS2 1080i");

	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_DISPLAY1_HIGH), 1920u | (1080u << 12u));
	gpu.presentReadyFrameOnVblankEdge();
	require(platform.runFrame(), "libretro paused frame should present raw output beyond the standard PS2 envelope");
	require(avInfo.geometry.base_width == 1921u && avInfo.geometry.base_height == 1081u, "libretro AV cache should expose the expanded raw output");
	require(avInfo.geometry.max_width == 1921u && avInfo.geometry.max_height == 1081u, "libretro AV cache should grow its maximum geometry to the raw output");
	require(platform.getFramebuffer().width == 1921u && platform.getFramebuffer().height == 1081u, "libretro framebuffer should follow raw output beyond the standard envelope");
	require(geometryChangeCount == 0u && avInfoChangeCount == 0u, "the platform view stack must leave libretro environment notifications to retro_run");
}

void testPhysicalPcrtcTimingPublishesAtServiceAndPresentationAtVblank() {
	retro_system_av_info avInfo{};
	bmsx::LibretroPlatform platform(
		bmsx::BackendType::Software,
		avInfo,
		readSupervisorRequestLine,
		false);
	platform.setLogCallback(discardRetroLog);
	require(platform.machineManager()->loadSystemRomOwned(bmsx::test::makeMinimalBootRom(bmsx::RomImageDomain::System)), "libretro should load the system firmware ROM for physical PCRTC timing validation");
	const std::vector<bmsx::u8> rom = bmsx::test::makeMinimalBootRom(bmsx::RomImageDomain::Cartridge);
	require(platform.loadRom(rom.data(), rom.size()), "libretro should load a program cart ROM for physical PCRTC timing validation");

	bmsx::Runtime& runtime = platform.machineManager()->runtime();
	bmsx::GxGpu& gpu = runtime.machine.gxGpu;
	bmsx::DeviceScheduler& scheduler = runtime.machine.scheduler;
	runtime.machine.scheduler.cancelDeviceService(bmsx::DEVICE_SERVICE_APU);
	runtime.machine.scheduler.cancelDeviceService(bmsx::DEVICE_SERVICE_APU_TRANSFER);
	constexpr bmsx::u32 slowSynch2Word = 0x004f84bcu;
	const bmsx::u32 synch2Address = bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_SYNCH2_LOW);

	runtime.machine.memory.writeMappedU32LE(synch2Address, slowSynch2Word);
	require(runtime.timing.ufpsScaled == bmsx::GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED, "PCRTC timing writes wait for the scheduled hardware service");
	bmsx::runDueRuntimeTimers(runtime);
	require(runtime.timing.ufpsScaled == 39'808'917, "runtime timing follows the live physical PCRTC clock");
	const bmsx::i64 slowCycleBudget = bmsx::calcCyclesPerFrameScaled(runtime.timing.cpuHz, 39'808'917);
	require(runtime.timing.cycleBudgetPerFrame == slowCycleBudget, "runtime frame telemetry follows the next physical PCRTC VBlank budget");
	bmsx::GxGpuState gpuState = gpu.captureState();
	require(gpuState.pcrtc.registerWords[bmsx::GX_GPU_PCRTC_SYNCH2_LOW] == slowSynch2Word, "PCRTC live timing word publishes at device service");
	require(gpuState.pcrtc.presentWords[bmsx::GX_GPU_PCRTC_SYNCH2_LOW] != slowSynch2Word, "PCRTC presentation timing waits for VBlank");

	for (int edge = 0; edge < 2; edge += 1) {
		const bmsx::i64 deadline = scheduler.nextDeadline();
		scheduler.advanceTo(deadline);
		bmsx::runDueRuntimeTimers(runtime);
	}
	gpuState = gpu.captureState();
	require(gpuState.pcrtc.presentWords[bmsx::GX_GPU_PCRTC_SYNCH2_LOW] == slowSynch2Word, "PCRTC presentation timing latches at the physical VBlank edge");

	const bmsx::i64 nextDeadline = scheduler.nextDeadline();
	const bmsx::u32 timingRevision = gpu.readDeviceOutput().pcrtcTiming.revision;
	gpu.writeGp1(bmsx::GX_GPU_GP1_DISPLAY_MODE << 24u);
	gpu.writeGp1((bmsx::GX_GPU_GP1_VERTICAL_DISPLAY_RANGE << 24u) | 0x00038020u);
	require(gpu.readDeviceOutput().pcrtcTiming.revision == timingRevision, "legacy GP1 display words cannot alter the physical PCRTC clock");
	require(scheduler.nextDeadline() == nextDeadline, "legacy GP1 display words cannot reschedule the physical PCRTC beam");
	require(runtime.timing.cycleBudgetPerFrame == slowCycleBudget, "legacy GP1 display words cannot alter the runtime PCRTC budget");
}

void testRuntimePreservesGxGpuGp1ReadinessBinding() {
	retro_system_av_info avInfo{};
	bmsx::LibretroPlatform platform(
		bmsx::BackendType::Software,
		avInfo,
		readSupervisorRequestLine,
		false);
	platform.setLogCallback(discardRetroLog);
	require(platform.machineManager()->loadSystemRomOwned(bmsx::test::makeMinimalBootRom(bmsx::RomImageDomain::System)), "libretro should load the system firmware ROM for GP1 readiness validation");
	const std::vector<bmsx::u8> rom = bmsx::test::makeMinimalBootRom(bmsx::RomImageDomain::Cartridge);
	require(platform.loadRom(rom.data(), rom.size()), "libretro should load a program cart ROM for GP1 readiness validation");

	bmsx::Runtime& runtime = platform.machineManager()->runtime();
	require(runtime.machine.memory.mappedWriteReady(bmsx::IO_GX_GPU_GP1), "GP1 should accept writes before supervisor quiesce");
	runtime.machine.gxGpu.beginSupervisorControlQuiesce();
	require(!runtime.machine.memory.mappedWriteReady(bmsx::IO_GX_GPU_GP1), "the GX-GPU GP1 owner should close writes during supervisor quiesce");
}

} // namespace

int main() {
	testLibretroSaveStateRoundTrip();
	testLibretroFaultDiagnosticsStayAtHostBoundary();
	testGpureadCodecStoresReadyBytesAndRejectsBackendPhase();
	testLibretroStateEnvelopeSupportsMaximumGpuread();
	testInputSnapshotReflectsHeldKey();
	testLibretroSupervisorRequestIsSeparateFromGameplay();
	testLibretroTracksPublishedNativeOutputGeometry();
	testPhysicalPcrtcTimingPublishesAtServiceAndPresentationAtVblank();
	testRuntimePreservesGxGpuGp1ReadinessBinding();
	return 0;
}
