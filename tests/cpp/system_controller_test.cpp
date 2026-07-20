#include "machine/bus/io.h"
#include "machine/cpu/instruction_format.h"
#include "machine/cpu/opcode_info.h"
#include "machine/devices/gx/gpu_display.h"
#include "machine/devices/gx/gpu_pcrtc.h"
#include "machine/firmware/boot_primitives.h"
#include "machine/machine.h"
#include "machine/memory/memory.h"
#include "machine/model_registry.h"
#include "machine/program/loader.h"
#include "machine/runtime/boot_timing.h"
#include "machine/runtime/input.h"
#include "machine/runtime/machine_state.h"
#include "machine/runtime/runtime.h"
#include "machine/scheduler/device.h"

#include <array>
#include <span>
#include <stdexcept>
#include <vector>

namespace {

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

class SystemResetInputSource final : public bmsx::RuntimeInputSource {
public:
	void setRuntimeInputFrameDurationMs(bmsx::f64) override {}
	void sampleInputControllerSnapshot(bmsx::f64, bmsx::InputControllerSnapshot&) override {}
	auto supervisorRequestLineHigh() const -> bool override { return false; }
	void applyInputControllerVibrationEffect(bmsx::i32, bmsx::f64, bmsx::f32) override {}
};

struct ProgramImageFixture {
	std::vector<bmsx::u8> code;
	bmsx::ProgramImage image;
};

ProgramImageFixture makeProgramImageWithResetInstruction(bmsx::OpCode opcode) {
	ProgramImageFixture fixture;
	bmsx::ProgramImage& image = fixture.image;
	image.placement.dataBaseAddress = bmsx::PROGRAM_STATIC_RAM_BASE;
	image.placement.bssBaseAddress = bmsx::PROGRAM_STATIC_RAM_BASE;
	fixture.code.resize(bmsx::INSTRUCTION_BYTES * 2u);
	bmsx::writeInstruction(
		std::span<bmsx::u8>(fixture.code),
		0,
		static_cast<bmsx::u8>(bmsx::OpCode::RET),
		0,
		0,
		0
	);
	bmsx::writeInstruction(
		std::span<bmsx::u8>(fixture.code),
		1,
		static_cast<bmsx::u8>(opcode),
		0,
		0,
		0
	);
	bmsx::Proto sectionInitializer;
	sectionInitializer.entryPC = 0;
	sectionInitializer.codeLen = bmsx::INSTRUCTION_BYTES;
	sectionInitializer.maxStack = 1;
	image.sections.text.protos.push_back(sectionInitializer);
	bmsx::Proto reset;
	reset.entryPC = bmsx::INSTRUCTION_BYTES;
	reset.codeLen = bmsx::INSTRUCTION_BYTES;
	reset.maxStack = 1;
	image.sections.text.protos.push_back(reset);
	image.sections.text.code = fixture.code;
	image.vectors.sectionInitProtoIndex = 0;
	image.vectors.resetProtoIndex = 1;
	return fixture;
}

ProgramImageFixture makeCartProgramImageWithResetInstruction(const bmsx::ProgramImage& systemImage, bmsx::OpCode opcode) {
	ProgramImageFixture fixture = makeProgramImageWithResetInstruction(opcode);
	bmsx::ProgramImage& image = fixture.image;
	image.placement.textBasePc = static_cast<int>(systemImage.sections.text.code.size());
	const int protoBaseIndex = static_cast<int>(systemImage.sections.text.protos.size());
	image.placement.protoBaseIndex = protoBaseIndex;
	image.placement.constBaseIndex = static_cast<int>(systemImage.sections.rodata.constPool.size());
	image.placement.dataBaseAddress = systemImage.placement.bssBaseAddress + static_cast<bmsx::u32>(systemImage.sections.bss.byteCount);
	image.placement.bssBaseAddress = image.placement.dataBaseAddress;
	for (bmsx::Proto& proto : image.sections.text.protos) {
		proto.entryPC += image.placement.textBasePc;
	}
	image.vectors.resetProtoIndex += protoBaseIndex;
	image.vectors.sectionInitProtoIndex += protoBaseIndex;
	image.vectors.irqProtoIndex += protoBaseIndex;
	image.vectors.exceptionProtoIndex += protoBaseIndex;
	image.symbols = systemImage.symbols;
	return fixture;
}

struct SystemRuntimeFixture {
	std::array<bmsx::u8, 1> emptyRom{{0}};
	bmsx::ResolvedRuntimeTiming timing;
	SystemResetInputSource input;
	bmsx::Runtime runtime;

	SystemRuntimeFixture()
		: timing(bmsx::resolveRuntimeTiming(bmsx::PSX_MACHINE_SPEC.cpuFreqHz))
		, runtime(
			bmsx::RuntimeOptions{
				{ emptyRom.data(), 0u },
				{ emptyRom.data(), 0u },
				timing.pcrtcRunning,
				timing.ufpsScaled,
				timing.cpuHz,
				timing.cycleBudgetPerFrame,
				timing.totalHalfLines,
				timing.activeDisplayHalfLines,
				timing.geoWorkUnitsPerSec,
			},
			input
		) {
	}
};

void testResetCommandLatch() {
	std::array<bmsx::u8, 1> emptyRom{{0}};
	bmsx::Memory memory(bmsx::MemoryInit{ { emptyRom.data(), 0u }, { emptyRom.data(), 0u } });
	SystemResetInputSource input;
	bmsx::Machine machine(memory, input);
	machine.resetDevices();
	bmsx::SystemController& controller = machine.systemController;

	memory.writeMappedU32LE(bmsx::IO_SYS_CONTROL, bmsx::SYS_CONTROL_RESET);
	require(memory.readIoU32(bmsx::IO_SYS_CONTROL) == 0u, "system control command register is self-clearing");
	require(controller.captureState().resetRequested, "system reset command latches a reset request");

	const bmsx::SystemControllerState state = controller.captureState();
	controller.reset();
	controller.restoreState(state);
	require(controller.takeResetRequest(), "save-state restores a pending system reset");
	require(!controller.takeResetRequest(), "consuming a system reset clears the latch");
}

void testRuntimeSystemRebootBoundary() {
	SystemRuntimeFixture fixture;
	bmsx::Runtime& runtime = fixture.runtime;
	runtime.resetRuntimeForProgramReload();
	runtime.enterSystemFirmware();
	ProgramImageFixture systemFixture = makeProgramImageWithResetInstruction(bmsx::OpCode::RET);
	bmsx::ProgramImage& systemImage = systemFixture.image;
	for (const bmsx::LuaBootPrimitive& primitive : bmsx::LUA_BOOT_PRIMITIVES) {
		systemImage.symbols.systemGlobalNames.emplace_back(primitive.name);
	}
	ProgramImageFixture cartFixture = makeCartProgramImageWithResetInstruction(systemImage, bmsx::OpCode::RET);
	const bmsx::ProgramImage& cartImage = cartFixture.image;
	runtime.boot(
		systemImage,
		{},
		&cartImage,
		{},
		bmsx::ProgramBootTarget::System
	);

	require(runtime.isInitialized(), "linked system program initializes before the first frame");
	require(!runtime.cartProgramStarted, "linked boot begins in system firmware");
	bmsx::FrameSchedulerState& frameScheduler = runtime.frameScheduler;
	const bmsx::f64 frameDurationMs = runtime.timing.frameDurationMs;
	frameScheduler.run(runtime, frameDurationMs);
	require(runtime.cartProgramStarted, "system root return starts the preserved cart entry");

	runtime.machine.memory.writeMappedU32LE(bmsx::IO_SYS_CONTROL, bmsx::SYS_CONTROL_RESET);
	frameScheduler.run(runtime, frameDurationMs);
	require(!runtime.cartProgramStarted, "system reset restarts the system program before cart execution");
	require(!runtime.machine.systemController.captureState().resetRequested, "runtime boundary consumes the system reset latch");
	require(frameScheduler.lastTickSequence == 0, "system reset clears scheduler sequence state");
	require(runtime.isInitialized(), "system program is pending after reset");

	frameScheduler.run(runtime, frameDurationMs);
	require(runtime.cartProgramStarted, "rebooted system root can hand off to the original cart entry");
}

void testHostDeltaGrantsOneFractionallyRetainedMachineBudget() {
	SystemRuntimeFixture fixture;
	bmsx::Runtime& runtime = fixture.runtime;
	runtime.resetRuntimeForProgramReload();
	runtime.enterSystemFirmware();
	ProgramImageFixture systemFixture = makeProgramImageWithResetInstruction(bmsx::OpCode::HALT);
	bmsx::ProgramImage& systemImage = systemFixture.image;
	for (const bmsx::LuaBootPrimitive& primitive : bmsx::LUA_BOOT_PRIMITIVES) {
		systemImage.symbols.systemGlobalNames.emplace_back(primitive.name);
	}
	ProgramImageFixture cartFixture = makeCartProgramImageWithResetInstruction(systemImage, bmsx::OpCode::HALT);
	const bmsx::ProgramImage& cartImage = cartFixture.image;
	runtime.boot(
		systemImage,
		{},
		&cartImage,
		{},
		bmsx::ProgramBootTarget::System
	);
	const bmsx::u32 smode1Address = bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_SMODE1_LOW);
	const bmsx::u32 smode1 = runtime.machine.memory.readMappedU32LE(smode1Address);
	runtime.machine.memory.writeMappedU32LE(smode1Address, smode1 | bmsx::GX_GPU_PCRTC_SMODE1_SINT);
	runtime.machine.runDeviceService(bmsx::DEVICE_SERVICE_GPU);
	runtime.machine.scheduler.cancelDeviceService(bmsx::DEVICE_SERVICE_APU);
	runtime.machine.scheduler.cancelDeviceService(bmsx::DEVICE_SERVICE_APU_TRANSFER);

	runtime.frameScheduler.run(runtime, 50.03125);

	require(runtime.frameLoop.frameActive, "host delta starts one in-flight machine budget while PCRTC is stopped");
	require(runtime.frameLoop.frameState.cycleBudgetGranted == 1'694'498, "host delta grants its complete machine-cycle budget once");
	// 33,868,800 Hz doesn't divide 1000 as cleanly as the old 50,000,000 Hz did,
	// so the exact remainder carries floating-point noise past a few decimal
	// digits; 0x1.9999999cp-2 is the precise double this computation lands on.
	require(runtime.frameScheduler.captureState().cycleGrantRemainder == 0x1.9999999cp-2, "host delta retains its fractional machine cycle");
}

void testRuntimeRestorePreservesInFlightFrameBudgetAndResetsHostClock() {
	SystemRuntimeFixture fixture;
	bmsx::Runtime& runtime = fixture.runtime;
	bmsx::FrameLoopState& frameLoop = runtime.frameLoop;
	frameLoop.beginFrameState(runtime, 23'456, 34'567);
	frameLoop.frameState.updateExecuted = true;
	frameLoop.frameState.luaFaulted = true;
	frameLoop.frameState.cycleBudgetRemaining = 12'345;
	frameLoop.frameState.activeCpuUsedCycles = 45'678;
	frameLoop.frameDeltaMs = 20.096;
	frameLoop.currentTimeSeconds = 0.9875;
	const bmsx::RuntimeMachineState snapshot = bmsx::captureRuntimeMachineState(runtime);

	frameLoop.frameActive = false;
	frameLoop.frameState = bmsx::FrameState{false, false, 99, 98, 97, 96};
	frameLoop.frameDeltaMs = 1.0;
	frameLoop.currentTimeSeconds = 2.0;
	bmsx::applyRuntimeMachineState(runtime, snapshot);

	const bmsx::FrameLoopStateSnapshot restored = frameLoop.captureState();
	require(restored.frameActive == snapshot.frameLoop.frameActive, "runtime restore preserves in-flight frame activity");
	require(restored.frameState.updateExecuted == snapshot.frameLoop.frameState.updateExecuted, "runtime restore preserves in-flight update completion");
	require(restored.frameState.luaFaulted == snapshot.frameLoop.frameState.luaFaulted, "runtime restore preserves in-flight Lua fault state");
	require(restored.frameState.cycleBudgetRemaining == snapshot.frameLoop.frameState.cycleBudgetRemaining, "runtime restore preserves remaining in-flight cycles");
	require(restored.frameState.cycleBudgetGranted == snapshot.frameLoop.frameState.cycleBudgetGranted, "runtime restore preserves granted in-flight cycles");
	require(restored.frameState.cycleCarryGranted == snapshot.frameLoop.frameState.cycleCarryGranted, "runtime restore preserves carried in-flight cycles");
	require(restored.frameState.activeCpuUsedCycles == snapshot.frameLoop.frameState.activeCpuUsedCycles, "runtime restore preserves used in-flight cycles");
	require(restored.frameDeltaMs == snapshot.frameLoop.frameDeltaMs, "runtime restore preserves in-flight frame duration");
	require(frameLoop.currentTimeSeconds == 0.0, "runtime restore resets the host clock outside machine state");
	require(!runtime.vblank.tickCompleted(), "runtime restore prepares the next physical VBlank edge");
}

} // namespace

int main() {
	testResetCommandLatch();
	testRuntimeSystemRebootBoundary();
	testRuntimeRestorePreservesInFlightFrameBudgetAndResetsHostClock();
	testHostDeltaGrantsOneFractionallyRetainedMachineBudget();
	return 0;
}
