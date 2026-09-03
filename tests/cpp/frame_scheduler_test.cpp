#include "machine/cpu/cpu.h"
#include "machine/devices/input/contracts.h"
#include "machine/runtime/cpu_executor.h"
#include "machine/runtime/runtime.h"
#include "machine/scheduler/frame.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/memory_map.h"
#include "spec/bmsx/model.h"
#include "spec/gx/pcrtc.h"
#include "spec/gx/gp0.h"
#include "support/boot_rom_fixture.h"
#include "support/cartridge_fixture.h"

#include <array>
#include <stdexcept>
#include <vector>

namespace {

constexpr bmsx::u32 TEST_KEY_USAGE = 59u;

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

class TickInputSource final : public bmsx::InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(bmsx::InputControllerSnapshot& snapshot) override {
		sampleCount += 1;
		if (keyDown) {
			snapshot.keyWords[TEST_KEY_USAGE >> 5u] |= 1u << (TEST_KEY_USAGE & 31u);
		}
	}

	auto supervisorRequestLineHigh() const -> bool override {
		return false;
	}

	void applyInputControllerVibrationEffect(bmsx::i32, bmsx::f64, bmsx::f32) override {
	}

	int sampleCount = 0;
	bool keyDown = false;
};

struct TickRuntimeFixture {
	std::vector<bmsx::u8> systemRom = bmsx::test::makeMinimalBootRom(
		bmsx::RomImageDomain::System
	);
	TickInputSource input;
	bmsx::Runtime runtime;

	TickRuntimeFixture()
		: runtime(
			bmsx::RuntimeOptions{
				systemRom,
				bmsx::test::cartridgeSlots(),
				bmsx::PSX_MACHINE_SPEC,
			},
			input
		) {
		runtime.boot();
	}
};

void testBoundedLogicalTickRetainsCycleCarry() {
	TickRuntimeFixture fixture;
	bmsx::Runtime& runtime = fixture.runtime;
	bmsx::FrameSchedulerState& scheduler = runtime.frameScheduler;
	const bmsx::f64 partialDeltaMs = runtime.timing.frameDurationMs / 4.0;

	scheduler.run(runtime, partialDeltaMs);
	require(scheduler.lastTickSequence == 0, "partial host delta stops before VBlank");
	require(runtime.frameLoop.frameActive, "partial host delta retains the in-flight frame");
	const bmsx::i64 partialBudget = runtime.frameLoop.frameState.cycleBudgetGranted;
	const bmsx::f64 grantRemainder = scheduler.captureState().cycleGrantRemainder;
	const bmsx::i64 firstTickBudget = runtime.timing.cycleBudgetPerFrame;

	require(scheduler.runToNextLogicalTick(runtime), "bounded execution reaches the next logical tick");
	require(scheduler.lastTickSequence == 1, "bounded execution advances exactly one tick sequence");
	require(
		scheduler.lastTickBudgetGranted == partialBudget + firstTickBudget,
		"bounded execution extends the active frame by one PCRTC tick budget"
	);
	require(
		scheduler.captureState().cycleGrantRemainder == grantRemainder,
		"bounded execution does not consume the host grant remainder"
	);
	require(
		scheduler.captureState().carriedCycleBudget == scheduler.lastTickBudgetRemaining,
		"the unused whole-cycle budget remains scheduler carry"
	);
	const bmsx::i64 carriedBudget = scheduler.lastTickBudgetRemaining;

	require(scheduler.runToNextLogicalTick(runtime), "a second bounded execution reaches the following tick");
	require(scheduler.lastTickSequence == 2, "each bounded execution advances one monotone tick");
	require(
		scheduler.lastTickBudgetGranted == carriedBudget + firstTickBudget,
		"the next explicit grant is distinct from retained whole-cycle carry"
	);
	require(
		runtime.frameLoop.frameState.cycleCarryGranted == carriedBudget,
		"frame telemetry records only previously retained cycles as carry"
	);
	require(
		scheduler.lastTickBudgetRemaining == carriedBudget,
		"successive tick grants preserve the existing beam-phase carry"
	);
	require(
		scheduler.captureState().cycleGrantRemainder == grantRemainder,
		"successive bounded execution leaves host fractional time unchanged"
	);
}

void testBoundedLogicalTickResumesBackendFenceWithoutAnotherGrant() {
	TickRuntimeFixture fixture;
	bmsx::Runtime& runtime = fixture.runtime;
	bmsx::FrameSchedulerState& scheduler = runtime.frameScheduler;
	bmsx::GxGpu& gpu = runtime.machine.gxGpu;
	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	gpu.writeGp0(0u);
	gpu.writeGp0((1u << 16u) | 1u);

	require(!scheduler.runToNextLogicalTick(runtime), "backend fence suspends bounded execution");
	require(gpu.backendServiceBlocksMachine(), "scheduled GPUREAD reaches the backend fence");
	require(scheduler.lastTickSequence == 0, "backend fence precedes the target VBlank");
	require(
		runtime.frameLoop.frameState.cycleBudgetGranted == runtime.timing.cycleBudgetPerFrame,
		"bounded execution grants one PCRTC period before suspension"
	);
	const bmsx::FrameSchedulerStateSnapshot suspendedState = scheduler.captureState();
	require(suspendedState.logicalTickRunPending, "bounded operation retains its pending state");
	require(suspendedState.logicalTickRunTargetSequence == 1, "bounded operation retains its VBlank target");

	const bmsx::GxGpuDeviceOutput& output = gpu.readDeviceOutput();
	bmsx::GxGpuReadbackPort& readback = output.readbackPort;
	require(
		readback.claimReadback(output.commandBuffer.executedCommandCount),
		"backend claims the readback fence"
	);
	readback.completeReadback(readback.token());
	require(scheduler.runToNextLogicalTick(runtime), "bounded execution resumes after backend service");
	require(scheduler.lastTickSequence == 1, "resumed execution reaches its original target");
	require(
		scheduler.lastTickBudgetGranted == runtime.timing.cycleBudgetPerFrame,
		"resumption does not grant a second PCRTC period"
	);
	const bmsx::FrameSchedulerStateSnapshot completedState = scheduler.captureState();
	require(!completedState.logicalTickRunPending, "completed operation clears its pending state");
	require(completedState.logicalTickRunTargetSequence == 0, "completed operation clears its target");
}

void testScheduledBoundedTickRetainsPartialMachineProgress() {
	TickRuntimeFixture fixture;
	bmsx::Runtime& runtime = fixture.runtime;
	bmsx::FrameSchedulerState& scheduler = runtime.frameScheduler;
	const bmsx::f64 halfFrameMs = runtime.timing.frameDurationMs / 2.0;

	require(
		!scheduler.runScheduledToNextLogicalTick(runtime, 0.0),
		"scheduled bounded execution requires host time"
	);
	require(!runtime.frameLoop.frameActive, "zero host time does not open a machine frame");
	require(
		!scheduler.runScheduledToNextLogicalTick(runtime, halfFrameMs),
		"a partial host frame stops before VBlank"
	);
	require(scheduler.lastTickSequence == 0, "partial host time does not publish a logical tick");
	require(runtime.frameLoop.frameActive, "partial host time retains the machine frame");
	require(
		scheduler.runScheduledToNextLogicalTick(runtime, halfFrameMs),
		"the next host delta completes the retained machine frame"
	);
	require(scheduler.lastTickSequence == 1, "scheduled bounded execution publishes one tick");
	require(
		scheduler.lastTickBudgetGranted == static_cast<bmsx::i64>(
			runtime.timing.frameDurationMs * runtime.timing.cpuCyclesPerMillisecond
		),
		"scheduled bounded execution grants only accepted host time"
	);
}

void testScheduledBoundedTickExposesEveryCatchUpBoundary() {
	TickRuntimeFixture fixture;
	bmsx::Runtime& runtime = fixture.runtime;
	bmsx::FrameSchedulerState& scheduler = runtime.frameScheduler;
	const bmsx::f64 hostDeltaMs = runtime.timing.frameDurationMs * 4.0;

	for (bmsx::i64 expectedSequence = 1; expectedSequence <= 4; ++expectedSequence) {
		fixture.input.keyDown = (expectedSequence & 1) != 0;
		runtime.machine.memory.writeMappedU32LE(bmsx::IO_INP_CTRL, bmsx::INP_CTRL_ARM);
		require(
			scheduler.runScheduledToNextLogicalTick(
				runtime,
				expectedSequence == 1 ? hostDeltaMs : 0.0
			),
			"retained host carry reaches the next prepared boundary"
		);
		require(
			scheduler.lastTickSequence == expectedSequence,
			"scheduled bounded execution exposes each logical tick"
		);
	}
	require(fixture.input.sampleCount == 4, "each catch-up boundary samples ICU input once");
	require(
		!scheduler.runScheduledToNextLogicalTick(runtime, 0.0),
		"drained host carry cannot fabricate another logical tick"
	);
}

void testScheduledBoundedTickResumesBackendFenceWithAcceptedHostGrant() {
	TickRuntimeFixture fixture;
	bmsx::Runtime& runtime = fixture.runtime;
	bmsx::FrameSchedulerState& scheduler = runtime.frameScheduler;
	bmsx::GxGpu& gpu = runtime.machine.gxGpu;
	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	gpu.writeGp0(0u);
	gpu.writeGp0((1u << 16u) | 1u);

	require(
		!scheduler.runScheduledToNextLogicalTick(runtime, runtime.timing.frameDurationMs),
		"backend fence suspends scheduled bounded execution"
	);
	require(gpu.backendServiceBlocksMachine(), "scheduled execution reaches the backend fence");
	const bmsx::i64 grantedBudget = runtime.frameLoop.frameState.cycleBudgetGranted;
	const bmsx::GxGpuDeviceOutput& output = gpu.readDeviceOutput();
	bmsx::GxGpuReadbackPort& readback = output.readbackPort;
	require(
		readback.claimReadback(output.commandBuffer.executedCommandCount),
		"backend claims the scheduled readback fence"
	);
	readback.completeReadback(readback.token());
	require(
		scheduler.runScheduledToNextLogicalTick(runtime, 0.0),
		"scheduled bounded execution resumes without another host delta"
	);
	require(scheduler.lastTickSequence == 1, "resumed scheduled execution reaches its target");
	require(
		scheduler.lastTickBudgetGranted == grantedBudget,
		"backend resumption preserves the accepted host grant"
	);
}

void testScheduledBoundedTickMatchesCommonHostRates() {
	constexpr std::array<int, 3> HOST_RATES = {60, 120, 144};
	bmsx::i64 expectedTickSequence = -1;
	bmsx::i64 expectedMachineCycles = -1;
	for (const int rate : HOST_RATES) {
		TickRuntimeFixture fixture;
		bmsx::Runtime& runtime = fixture.runtime;
		bmsx::FrameSchedulerState& scheduler = runtime.frameScheduler;
		for (int hostFrame = 0; hostFrame < rate; ++hostFrame) {
			bool completed = scheduler.runScheduledToNextLogicalTick(
				runtime,
				1000.0 / static_cast<bmsx::f64>(rate)
			);
			while (completed) {
				completed = scheduler.runScheduledToNextLogicalTick(runtime, 0.0);
			}
		}
		if (expectedTickSequence < 0) {
			expectedTickSequence = scheduler.lastTickSequence;
			expectedMachineCycles = runtime.machine.scheduler.nowCycles();
		} else {
			require(
				scheduler.lastTickSequence == expectedTickSequence,
				"common host rates publish the same logical tick count"
			);
			require(
				runtime.machine.scheduler.nowCycles() == expectedMachineCycles,
				"common host rates consume the same machine time"
			);
		}
	}
	require(expectedTickSequence == 49, "one PAL wall second publishes 49 complete VBlanks");
	require(expectedMachineCycles == bmsx::PSX_CPU_FREQ_HZ, "one wall second advances one CPU second");
}

void testBoundedLogicalTickExtendsExhaustedRetainedGrant() {
	TickRuntimeFixture fixture;
	bmsx::Runtime& runtime = fixture.runtime;
	bmsx::FrameSchedulerState& scheduler = runtime.frameScheduler;
	runtime.frameLoop.beginFrameState(runtime, 0, 0);
	bmsx::FrameSchedulerStateSnapshot pendingState = scheduler.captureState();
	pendingState.logicalTickRunPending = true;
	pendingState.logicalTickRunTargetSequence = 1;
	scheduler.restoreState(pendingState);

	require(
		scheduler.runToNextLogicalTick(runtime),
		"bounded execution extends an exhausted explicit grant"
	);
	require(scheduler.lastTickSequence == 1, "the retained target completes on the next edge");
	require(
		scheduler.lastTickBudgetGranted == runtime.timing.cycleBudgetPerFrame,
		"the resumed operation grants one current PCRTC period"
	);
	require(
		!scheduler.captureState().logicalTickRunPending,
		"the completed retained target clears its pending state"
	);
}

void testBoundedLogicalTickDoesNotReportResetAsTargetEdge() {
	TickRuntimeFixture fixture;
	bmsx::Runtime& runtime = fixture.runtime;
	runtime.machine.memory.writeMappedU32LE(bmsx::IO_SYS_CONTROL, bmsx::SYS_CONTROL_RESET);

	require(
		!runtime.frameScheduler.runToNextLogicalTick(runtime),
		"system reset does not report completion of the abandoned target"
	);
	require(runtime.frameScheduler.lastTickSequence == 0, "system reset clears the logical tick sequence");
	require(
		!runtime.frameScheduler.captureState().logicalTickRunPending,
		"system reset abandons the bounded operation"
	);
}

void testLogicalTickPublishesInputAndEntersWaitingCpuInterrupt() {
	TickRuntimeFixture fixture;
	bmsx::Runtime& runtime = fixture.runtime;
	bmsx::Memory& memory = runtime.machine.memory;
	fixture.input.keyDown = true;
	const int frameDepth = runtime.machine.cpu.getFrameDepth();
	memory.writeMappedU32LE(bmsx::IO_INP_CTRL, bmsx::INP_CTRL_ARM);
	memory.writeMappedU32LE(bmsx::IO_IRQ_MASK, bmsx::IRQ_VBLANK);

	require(
		runtime.frameScheduler.runToNextLogicalTick(runtime),
		"bounded execution reaches the armed input edge"
	);

	require(fixture.input.sampleCount == 1, "the logical tick samples ICU input once");
	require(memory.readMappedU32LE(bmsx::IO_INP_STATUS) == 1u, "the logical tick publishes the ICU sequence");
	const bmsx::u32 keyWordAddress = bmsx::IO_INP_KEYS
		+ (TEST_KEY_USAGE >> 5u) * bmsx::IO_WORD_SIZE;
	require(
		(memory.readMappedU32LE(keyWordAddress) & (1u << (TEST_KEY_USAGE & 31u))) != 0u,
		"the logical tick publishes the raw ICU key word"
	);
	require(
		(memory.readMappedU32LE(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_VBLANK) != 0u,
		"the logical tick raises the VBlank IRQ"
	);
	require(
		runtime.machine.cpu.peekPendingInterrupt() == bmsx::AcceptedInterruptKind::None,
		"the waiting CPU accepts the VBlank IRQ on the scheduler fence"
	);
	require(
		runtime.machine.cpu.getFrameDepth() == frameDepth + 1,
		"bounded execution returns after IRQ entry and before its first instruction"
	);
}

void testLogicalTickIsBoundedWithoutVblankDeadline() {
	TickRuntimeFixture fixture;
	bmsx::Runtime& runtime = fixture.runtime;
	const bmsx::u32 smode1Address = bmsx::gxGpuPcrtcRegisterAddress(
		bmsx::GX_GPU_PCRTC_SMODE1_LOW
	);
	const bmsx::u32 smode1 = runtime.machine.memory.readMappedU32LE(smode1Address);
	runtime.machine.memory.writeMappedU32LE(
		smode1Address,
		smode1 | bmsx::GX_GPU_PCRTC_SMODE1_SINT
	);
	bmsx::runDueRuntimeTimers(runtime);
	const bmsx::i64 cycle = runtime.machine.scheduler.nowCycles();

	require(runtime.timing.cycleBudgetPerFrame == 0, "stopped PCRTC publishes no tick budget");
	require(
		!runtime.frameScheduler.runToNextLogicalTick(runtime),
		"bounded execution reports no logical tick while PCRTC is stopped"
	);
	require(runtime.frameScheduler.lastTickSequence == 0, "stopped PCRTC does not fabricate a tick");
	require(runtime.machine.scheduler.nowCycles() == cycle, "stopped PCRTC does not consume machine cycles");
}

void testNormalHostExecutionKeepsExistingSchedulerContract() {
	TickRuntimeFixture fixture;
	bmsx::Runtime& runtime = fixture.runtime;
	const bmsx::f64 exactHostGrant = runtime.timing.frameDurationMs
		* runtime.timing.cpuCyclesPerMillisecond;
	const bmsx::i64 wholeHostGrant = static_cast<bmsx::i64>(exactHostGrant);

	runtime.frameScheduler.run(runtime, runtime.timing.frameDurationMs);

	require(runtime.frameScheduler.lastTickSequence == 1, "normal host execution reaches one VBlank");
	require(
		runtime.machine.scheduler.nowCycles() == wholeHostGrant,
		"normal host execution consumes its existing host-derived cycle grant"
	);
	require(
		runtime.frameScheduler.captureState().cycleGrantRemainder
			== exactHostGrant - static_cast<bmsx::f64>(wholeHostGrant),
		"normal host execution retains its existing fractional cycle grant"
	);
}

} // namespace

int main() {
	testBoundedLogicalTickRetainsCycleCarry();
	testBoundedLogicalTickResumesBackendFenceWithoutAnotherGrant();
	testScheduledBoundedTickRetainsPartialMachineProgress();
	testScheduledBoundedTickExposesEveryCatchUpBoundary();
	testScheduledBoundedTickResumesBackendFenceWithAcceptedHostGrant();
	testScheduledBoundedTickMatchesCommonHostRates();
	testBoundedLogicalTickExtendsExhaustedRetainedGrant();
	testBoundedLogicalTickDoesNotReportResetAsTargetEdge();
	testLogicalTickPublishesInputAndEntersWaitingCpuInterrupt();
	testLogicalTickIsBoundedWithoutVblankDeadline();
	testNormalHostExecutionKeepsExistingSchedulerContract();
	return 0;
}
