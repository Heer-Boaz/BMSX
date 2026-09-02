#include "machine/cpu/cpu.h"
#include "machine/devices/input/contracts.h"
#include "machine/runtime/cpu_executor.h"
#include "machine/runtime/runtime.h"
#include "machine/scheduler/frame.h"
#include "spec/bmsx/io.h"
#include "spec/bmsx/memory_map.h"
#include "spec/bmsx/model.h"
#include "spec/gx/pcrtc.h"
#include "support/boot_rom_fixture.h"
#include "support/cartridge_fixture.h"

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
	testLogicalTickPublishesInputAndEntersWaitingCpuInterrupt();
	testLogicalTickIsBoundedWithoutVblankDeadline();
	testNormalHostExecutionKeepsExistingSchedulerContract();
	return 0;
}
