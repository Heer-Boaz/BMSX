#include "machine/runtime/frame/loop.h"
#include "machine/runtime/cpu_executor.h"
#include "machine/runtime/runtime.h"
#include "machine/scheduler/device.h"

#include <limits>

namespace bmsx {
void FrameLoopState::reset() {
	frameState = FrameState{};
	frameActive = false;
}

FrameLoopStateSnapshot FrameLoopState::captureState() const {
	return FrameLoopStateSnapshot{frameState, frameActive};
}

void FrameLoopState::restoreState(const FrameLoopStateSnapshot& state) {
	reset();
	frameState = state.frameState;
	frameActive = state.frameActive;
}

void FrameLoopState::resetFrameState(Runtime& runtime) {
	frameActive = false;
	runtime.vblank.abandonTick();
	runtime.machine.cpu.clearHaltUntilIrq();
	runtime.frameScheduler.reset();
	reset();
	runtime.frameScheduler.resetTickTelemetry();
}

void FrameLoopState::beginFrameState(Runtime& runtime, i64 budget, i64 carry) {
	frameActive = true;
	runtime.vblank.beginTick();
	frameState = FrameState{};
	frameState.cycleBudgetRemaining = budget;
	frameState.cycleBudgetGranted = budget;
	frameState.cycleCarryGranted = carry;
}

void FrameLoopState::abandonFrameState(Runtime& runtime) {
	frameActive = false;
	runtime.vblank.abandonTick();
}

bool FrameLoopState::consumeSystemReset(Runtime& runtime) {
	if (!runtime.machine.systemController.takeResetRequest()) {
		return false;
	}
	runtime.rebootSystem();
	return true;
}

bool FrameLoopState::prepareScheduledFrame(Runtime& runtime) {
	if (!frameActive) {
		return runtime.frameScheduler.startScheduledFrame(runtime);
	}
	if (frameState.cycleBudgetRemaining <= 0) {
		return runtime.frameScheduler.refillFrameBudget(runtime, frameState);
	}
	return true;
}

void FrameLoopState::finalizeUpdateSlice(Runtime& runtime) {
	if (runtime.m_pendingCall == Runtime::PendingCall::Entry && !runtime.vblank.tickCompleted()) {
		return;
	}
	abandonFrameState(runtime);
}

void FrameLoopState::runActiveFrameState(Runtime& runtime) {
	if (runtime.m_pendingCall == Runtime::PendingCall::Entry) {
		runUpdatePhase(runtime);
		frameState.updateExecuted = runtime.m_pendingCall != Runtime::PendingCall::Entry;
		finalizeUpdateSlice(runtime);
		return;
	}
	finalizeUpdateSlice(runtime);
}

InstructionStepResult FrameLoopState::runActiveFrameInstruction(Runtime& runtime) {
	if (runtime.m_pendingCall != Runtime::PendingCall::Entry) {
		finalizeUpdateSlice(runtime);
		return InstructionStepResult::Advanced;
	}
	const InstructionStepResult result = runUpdateInstruction(runtime);
	frameState.updateExecuted = runtime.m_pendingCall != Runtime::PendingCall::Entry;
	finalizeUpdateSlice(runtime);
	return result;
}

void FrameLoopState::runUpdatePhase(Runtime& runtime) {
	auto& cpu = runtime.machine.cpu;
	while (true) {
		if (cpu.isHaltedUntilIrq() || runtime.machine.systemController.cpuHeld()) {
			const bool tickCompleted = runtime.cpuExecution.runStoppedCpu(runtime, frameState);
			if (tickCompleted || cpu.isHaltedUntilIrq() || runtime.machine.systemController.cpuHeld()) {
				return;
			}
			continue;
		}
		if (runtime.m_pendingCall != Runtime::PendingCall::Entry) {
			return;
		}
		const RunResult result = runtime.cpuExecution.runWithBudget(runtime, frameState);
		if (consumeSystemReset(runtime)) {
			return;
		}
		if (result == RunResult::Halted && cpu.getFrameDepth() == 0) {
			runtime.m_pendingCall = Runtime::PendingCall::None;
			runtime.frameScheduler.clearQueuedTime();
			abandonFrameState(runtime);
			return;
		}
		if (cpu.isHaltedUntilIrq()) {
			return;
		}
		return;
	}
}

InstructionStepResult FrameLoopState::runUpdateInstruction(Runtime& runtime) {
	auto& cpu = runtime.machine.cpu;
	if (cpu.isHaltedUntilIrq() || runtime.machine.systemController.cpuHeld()) {
		const i64 previousRemaining = frameState.cycleBudgetRemaining;
		const bool tickCompleted = runtime.cpuExecution.runStoppedCpu(runtime, frameState);
		if (tickCompleted || cpu.isHaltedUntilIrq() || runtime.machine.systemController.cpuHeld()) {
			return tickCompleted || frameState.cycleBudgetRemaining != previousRemaining
				? InstructionStepResult::Advanced
				: InstructionStepResult::Blocked;
		}
	}
	if (runtime.m_pendingCall != Runtime::PendingCall::Entry) {
		return InstructionStepResult::Blocked;
	}
	const InstructionStepResult result = runtime.cpuExecution.runInstruction(runtime, frameState);
	if (cpu.getFrameDepth() == 0) {
		runtime.m_pendingCall = Runtime::PendingCall::None;
		runtime.frameScheduler.clearQueuedTime();
		abandonFrameState(runtime);
	}
	return result;
}

bool FrameLoopState::tickUpdate(Runtime& runtime) {
	using PendingCall = Runtime::PendingCall;
	if (consumeSystemReset(runtime)) {
		return true;
	}

	const bool previousFrameActive = frameActive;
	const i64 previousRemaining = previousFrameActive ? frameState.cycleBudgetRemaining : -1;
	const bool previousPending = runtime.m_pendingCall == PendingCall::Entry;
	const i64 previousSequence = runtime.frameScheduler.lastTickSequence;
	if (!prepareScheduledFrame(runtime)) {
		return false;
	}

	runActiveFrameState(runtime);
	if (frameActive
		&& (runtime.machine.cpu.isHaltedUntilIrq() || runtime.machine.systemController.cpuHeld())
		&& runtime.machine.scheduler.nextDeadline() == std::numeric_limits<i64>::max()) {
		// Cart parked waiting for an interrupt that nothing has scheduled: report
		// no progress so the scheduler yields the host slice instead of spinning.
		return false;
	}
	const bool nextFrameActive = frameActive;
	if (nextFrameActive != previousFrameActive) {
		return true;
	}
	if (nextFrameActive && frameState.cycleBudgetRemaining != previousRemaining) {
		return true;
	}
	if ((runtime.m_pendingCall == PendingCall::Entry) != previousPending) {
		return true;
	}
	return runtime.frameScheduler.lastTickSequence != previousSequence;
}

InstructionStepResult FrameLoopState::tickInstruction(Runtime& runtime) {
	using PendingCall = Runtime::PendingCall;
	if (consumeSystemReset(runtime)) {
		return InstructionStepResult::Advanced;
	}
	const bool previousFrameActive = frameActive;
	const i64 previousRemaining = previousFrameActive ? frameState.cycleBudgetRemaining : -1;
	const bool previousPending = runtime.m_pendingCall == PendingCall::Entry;
	const i64 previousSequence = runtime.frameScheduler.lastTickSequence;
	if (!prepareScheduledFrame(runtime)) {
		return InstructionStepResult::Blocked;
	}
	const InstructionStepResult result = runActiveFrameInstruction(runtime);
	if (result == InstructionStepResult::Executed) {
		return result;
	}
	if (frameActive != previousFrameActive
		|| (frameActive && frameState.cycleBudgetRemaining != previousRemaining)
		|| ((runtime.m_pendingCall == PendingCall::Entry) != previousPending)
		|| runtime.frameScheduler.lastTickSequence != previousSequence) {
		return InstructionStepResult::Advanced;
	}
	return result;
}
} // namespace bmsx
