#include "machine/runtime/cpu_executor.h"

#include "machine/runtime/runtime.h"
#include "machine/scheduler/device.h"
#include "render/vdp/blitter/execute.h"

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
			if (auto* renderVdp = runtime.machine.runDeviceService(payload); renderVdp != nullptr) {
				drainReadyVdpExecution(*renderVdp);
			}
			return;
		default:
			throw BMSX_RUNTIME_ERROR("unknown timer kind " + std::to_string(kind) + ".");
	}
}

} // namespace

void CpuExecutionState::clearHaltUntilIrq(Runtime& runtime) {
	runtime.machine.cpu.clearHaltUntilIrq();
}

bool CpuExecutionState::runHaltedUntilIrq(Runtime& runtime, FrameState& frameState) {
	auto& cpu = runtime.machine.cpu;
	int& cycleBudgetRemaining = frameState.cycleBudgetRemaining;
	runDueRuntimeTimers(runtime);
	if (!cpu.isHaltedUntilIrq()) {
		return runtime.vblank.tickCompleted();
	}
	auto& irqController = runtime.machine.irqController;
	auto& scheduler = runtime.machine.scheduler;
	while (true) {
		if (cpu.acceptPendingInterrupt(irqController) != AcceptedInterruptKind::None) {
			return runtime.vblank.tickCompleted();
		}
		if (runtime.vblank.tickCompleted()) {
			return true;
		}
		if (cycleBudgetRemaining > 0) {
			const i64 cyclesToTarget = scheduler.nextDeadline() - scheduler.nowCycles();
			if (cyclesToTarget <= 0) {
				runDueRuntimeTimers(runtime);
				continue;
			}
			const int idleCycles = static_cast<int>(std::min<i64>(cycleBudgetRemaining, cyclesToTarget));
			cycleBudgetRemaining -= idleCycles;
			advanceRuntimeTime(runtime, idleCycles);
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
	runDueRuntimeTimers(runtime);
	if (runtime.vblank.tickCompleted()) {
		frameState.cycleBudgetRemaining = remaining;
		return result;
	}
	while (remaining > 0) {
		int sliceBudget = remaining;
		const i64 nextDeadline = scheduler.nextDeadline();
		if (nextDeadline != std::numeric_limits<i64>::max()) {
			const i64 deadlineBudget = nextDeadline - scheduler.nowCycles();
			if (deadlineBudget <= 0) {
				runDueRuntimeTimers(runtime);
				if (runtime.vblank.tickCompleted()) {
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
			advanceRuntimeTime(runtime, consumed);
		}
		if (runtime.vblank.tickCompleted()) {
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

void advanceRuntimeTime(Runtime& runtime, int cycles) {
	runtime.machine.advanceDevices(cycles);
	runDueRuntimeTimers(runtime);
}

void runDueRuntimeTimers(Runtime& runtime) {
	auto& scheduler = runtime.machine.scheduler;
	while (scheduler.hasDueTimer()) {
		const uint16_t event = scheduler.popDueTimer();
		dispatchRuntimeTimer(runtime, static_cast<uint8_t>(event >> 8u), static_cast<uint8_t>(event & 0xffu));
	}
}

} // namespace bmsx
