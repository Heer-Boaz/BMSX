#include "machine/runtime/cpu_executor.h"

#include "machine/runtime/runtime.h"
#include "machine/scheduler/device.h"

#include <algorithm>
#include <limits>
#include <stdexcept>

namespace bmsx {
namespace {

void dispatchRuntimeTimer(Runtime& runtime, uint8_t kind, uint8_t payload) {
	switch (kind) {
		case TimerKindVblankBegin:
			runtime.vblank.handleBeginTimer(runtime);
			return;
		case TimerKindVblankEnd:
			runtime.vblank.handleEndTimer(runtime);
			return;
		case TimerKindDeviceService:
			runtime.machine.runDeviceService(payload);
			return;
		default:
			throw BMSX_RUNTIME_ERROR("unknown timer kind " + std::to_string(kind) + ".");
	}
}

} // namespace

bool CpuExecutionState::runHaltedUntilIrq(Runtime& runtime, FrameState& frameState) {
	auto& cpu = runtime.machine.cpu;
	int& cycleBudgetRemaining = frameState.cycleBudgetRemaining;
	bool tickCompleted = runDueRuntimeTimers(runtime);
	if (!cpu.isHaltedUntilIrq()) {
		return tickCompleted;
	}
	auto& scheduler = runtime.machine.scheduler;
	while (true) {
		if (cpu.acceptPendingInterrupt(runtime.machine.irqController) != AcceptedInterruptKind::None) {
			return tickCompleted;
		}
		if (tickCompleted) {
			return true;
		}
		if (cycleBudgetRemaining > 0) {
			const i64 cyclesToTarget = scheduler.nextDeadline() - scheduler.nowCycles();
			if (cyclesToTarget <= 0) {
				tickCompleted = runDueRuntimeTimers(runtime);
				continue;
			}
			const int idleCycles = static_cast<int>(std::min<i64>(cycleBudgetRemaining, cyclesToTarget));
			cycleBudgetRemaining -= idleCycles;
			tickCompleted = advanceRuntimeTime(runtime, idleCycles);
			continue;
		}
		return true;
	}
}

RunResult CpuExecutionState::runWithBudget(Runtime& runtime, FrameState& frameState) {
	auto& machine = runtime.machine;
	auto& scheduler = machine.scheduler;
	auto& cpu = machine.cpu;
	int remaining = frameState.cycleBudgetRemaining;
	RunResult result = RunResult::Yielded;
	bool tickCompleted = runDueRuntimeTimers(runtime);
	if (tickCompleted) {
		frameState.cycleBudgetRemaining = remaining;
		return result;
	}
	while (remaining > 0) {
		int sliceBudget = remaining;
		const i64 nextDeadline = scheduler.nextDeadline();
		if (nextDeadline != std::numeric_limits<i64>::max()) {
			const i64 deadlineBudget = nextDeadline - scheduler.nowCycles();
			if (deadlineBudget <= 0) {
				tickCompleted = runDueRuntimeTimers(runtime);
				if (tickCompleted) {
					break;
				}
				continue;
			}
			if (deadlineBudget < sliceBudget) {
				sliceBudget = static_cast<int>(deadlineBudget);
			}
		}
		scheduler.beginCpuSlice(sliceBudget);
		try {
			result = cpu.run(sliceBudget);
		} catch (...) {
			scheduler.endCpuSlice();
			throw;
		}
		scheduler.endCpuSlice();
		const int consumed = sliceBudget - cpu.instructionBudgetRemaining;
		if (consumed > 0) {
			remaining -= consumed;
			frameState.activeCpuUsedCycles += consumed;
			tickCompleted = advanceRuntimeTime(runtime, consumed);
		}
		if (tickCompleted) {
			break;
		}
		if (cpu.isHaltedUntilIrq() || result == RunResult::Halted) {
			break;
		}
		if (consumed <= 0) {
			throw BMSX_RUNTIME_ERROR("CPU yielded without consuming cycles.");
		}
	}
	frameState.cycleBudgetRemaining = remaining;
	return result;
}

bool advanceRuntimeTime(Runtime& runtime, int cycles) {
	runtime.machine.advanceDevices(cycles);
	return runDueRuntimeTimers(runtime);
}

bool runDueRuntimeTimers(Runtime& runtime) {
	auto& scheduler = runtime.machine.scheduler;
	while (scheduler.hasDueTimer()) {
		const uint16_t event = scheduler.popDueTimer();
		dispatchRuntimeTimer(runtime, static_cast<uint8_t>(event >> 8u), static_cast<uint8_t>(event & 0xffu));
	}
	return runtime.vblank.tickCompleted();
}

} // namespace bmsx
