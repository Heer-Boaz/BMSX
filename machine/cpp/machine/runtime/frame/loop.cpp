#include "machine/runtime/frame/loop.h"
#include "machine/runtime/cpu_executor.h"
#include "machine/runtime/runtime.h"
#include "machine/scheduler/device.h"

#include <limits>

namespace bmsx {
void FrameLoopState::reset() {
	frameState = FrameState{};
	frameActive = false;
	frameDeltaMs = 0.0;
	currentTimeSeconds = 0.0;
}

FrameLoopStateSnapshot FrameLoopState::captureState() const {
	return FrameLoopStateSnapshot{frameState, frameActive, frameDeltaMs};
}

void FrameLoopState::restoreState(const FrameLoopStateSnapshot& state) {
	reset();
	frameState = state.frameState;
	frameActive = state.frameActive;
	frameDeltaMs = state.frameDeltaMs;
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
	frameDeltaMs = runtime.timing.frameDurationMs;
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

void FrameLoopState::runUpdatePhase(Runtime& runtime) {
	auto& cpu = runtime.machine.cpu;
	try {
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
	} catch (...) {
		frameState.luaFaulted = true;
		cpu.clearHaltUntilIrq();
		runtime.m_pendingCall = Runtime::PendingCall::None;
		throw;
	}
}

bool FrameLoopState::tickUpdate(Runtime& runtime) {
	using PendingCall = Runtime::PendingCall;
	if (consumeSystemReset(runtime)) {
		return true;
	}
	if (!runtime.m_luaInitialized || runtime.m_runtimeFailed) {
		return false;
	}


	const bool previousFrameActive = frameActive;
	const i64 previousRemaining = previousFrameActive ? frameState.cycleBudgetRemaining : -1;
	const bool previousPending = runtime.m_pendingCall == PendingCall::Entry;
	const i64 previousSequence = runtime.frameScheduler.lastTickSequence;
	const bool startedFrame = !frameActive;
	if (frameActive) {
		if (frameState.cycleBudgetRemaining <= 0 && !runtime.frameScheduler.refillFrameBudget(runtime, frameState)) {
			return false;
		}
	} else {
		if (!runtime.frameScheduler.startScheduledFrame(runtime)) {
			return false;
		}
	}

	if (startedFrame) {
		runtime.m_debugUpdateCountTotal += 1;
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
} // namespace bmsx
