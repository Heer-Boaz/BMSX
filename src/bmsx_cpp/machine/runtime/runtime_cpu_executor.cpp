#include "machine/runtime/runtime_cpu_executor.h"

#include "machine/runtime/runtime.h"
#include "machine/scheduler/device_scheduler.h"

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

RunResult RuntimeCpuExecutionState::runWithBudget(Runtime& runtime, FrameState& frameState) {
	int remaining = frameState.cycleBudgetRemaining;
	RunResult result = RunResult::Yielded;
	runDueRuntimeTimers(runtime);
	while (remaining > 0) {
		int sliceBudget = remaining;
		const i64 nextDeadline = runtime.machine().scheduler().nextDeadline();
		if (nextDeadline != std::numeric_limits<i64>::max()) {
			const i64 deadlineBudget = nextDeadline - runtime.machine().scheduler().nowCycles();
			if (deadlineBudget <= 0) {
				runDueRuntimeTimers(runtime);
				continue;
			}
			if (deadlineBudget < sliceBudget) {
				sliceBudget = static_cast<int>(deadlineBudget);
			}
		}
		runtime.machine().scheduler().beginCpuSlice(sliceBudget);
		result = runtime.machine().cpu().run(sliceBudget);
		runtime.machine().scheduler().endCpuSlice();
		const int sliceRemaining = runtime.machine().cpu().instructionBudgetRemaining;
		const int consumed = sliceBudget - sliceRemaining;
		if (consumed > 0) {
			remaining -= consumed;
			frameState.activeCpuUsedCycles += consumed;
			advanceRuntimeTime(runtime, consumed);
		}
		if (runtime.machine().cpu().isHaltedUntilIrq() || result == RunResult::Halted) {
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
		dispatchRuntimeTimer(runtime, static_cast<uint8_t>(event >> 8u), static_cast<uint8_t>(event & 0xffu));
	}
}

} // namespace bmsx
