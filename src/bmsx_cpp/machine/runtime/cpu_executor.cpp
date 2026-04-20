#include "machine/runtime/cpu_executor.h"

#include "machine/runtime/runtime.h"
#include "machine/scheduler/device.h"

#include <limits>
#include <stdexcept>

namespace bmsx {
namespace {

inline std::runtime_error runtimeFault(const std::string& message) {
	return BMSX_RUNTIME_ERROR("Runtime fault: " + message);
}

void dispatchRuntimeTimer(Runtime& runtime, uint8_t kind, uint8_t payload) {
	switch (kind) {
		case TimerKindVblankBegin:
			runtime.vblank.handleBeginTimer(runtime);
			return;
		case TimerKindVblankEnd:
			runtime.vblank.handleEndTimer(runtime);
			return;
		case TimerKindDeviceService:
			runtime.machine().runDeviceService(payload);
			return;
		default:
			throw runtimeFault("unknown timer kind " + std::to_string(kind) + ".");
	}
}

} // namespace

RunResult CpuExecutionState::runWithBudget(Runtime& runtime, FrameState& frameState) {
	auto& scheduler = runtime.machine().scheduler();
	auto& cpu = runtime.machine().cpu();
	int remaining = frameState.cycleBudgetRemaining;
	RunResult result = RunResult::Yielded;
	while (remaining > 0) {
		runDueRuntimeTimers(runtime);
		int sliceBudget = remaining;
		const i64 nextDeadline = scheduler.nextDeadline();
		if (nextDeadline != std::numeric_limits<i64>::max()) {
			const i64 deadlineBudget = nextDeadline - scheduler.nowCycles();
			if (deadlineBudget <= 0) {
				continue;
			}
			if (deadlineBudget < sliceBudget) {
				sliceBudget = static_cast<int>(deadlineBudget);
			}
		}
		scheduler.beginCpuSlice(sliceBudget);
		result = cpu.run(sliceBudget);
		scheduler.endCpuSlice();
		const int consumed = sliceBudget - cpu.instructionBudgetRemaining;
		if (consumed > 0) {
			remaining -= consumed;
			frameState.activeCpuUsedCycles += consumed;
			advanceRuntimeTime(runtime, consumed);
		}
		if (cpu.isHaltedUntilIrq() || result == RunResult::Halted) {
			break;
		}
		if (consumed <= 0) {
			throw runtimeFault("CPU yielded without consuming cycles.");
		}
	}
	frameState.cycleBudgetRemaining = remaining;
	return result;
}

void advanceRuntimeTime(Runtime& runtime, int cycles) {
	runtime.machine().advanceDevices(cycles);
	runDueRuntimeTimers(runtime);
}

void runDueRuntimeTimers(Runtime& runtime) {
	while (runtime.machine().scheduler().hasDueTimer()) {
		const uint16_t event = runtime.machine().scheduler().popDueTimer();
		const auto timerKind = static_cast<uint8_t>(event >> 8u);
		const auto timerPayload = static_cast<uint8_t>(event & 0xffu);
		dispatchRuntimeTimer(runtime, timerKind, timerPayload);
	}
}

} // namespace bmsx
