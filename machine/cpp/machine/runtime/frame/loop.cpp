#include "machine/runtime/frame/loop.h"
#include "machine/runtime/cart_boot.h"
#include "machine/runtime/cpu_executor.h"
#include "machine/runtime/runtime.h"
#include "machine/scheduler/device.h"

#include <limits>

namespace bmsx {
void FrameLoopState::reset() {
	frameDeltaMs = 0.0;
	currentTimeSeconds = 0.0;
}

void FrameLoopState::resetFrameState(Runtime& runtime) {
	frameActive = false;
	runtime.vblank.abandonTick();
	frameState = FrameState{};
	runtime.machine.cpu.clearHaltUntilIrq();
	runtime.frameScheduler.reset();
	reset();
	runtime.screen.reset();
	runtime.frameScheduler.resetTickTelemetry();
}

void FrameLoopState::beginFrameState(Runtime& runtime) {
	frameActive = true;
	runtime.vblank.beginTick();
	frameState = FrameState{};
	frameState.cycleBudgetRemaining = runtime.timing.cycleBudgetPerFrame;
	frameState.cycleBudgetGranted = runtime.timing.cycleBudgetPerFrame;
	frameState.cycleCarryGranted = 0;
	frameDeltaMs = runtime.timing.frameDurationMs;
	runtime.machine.vdp.beginFrame();
}

void FrameLoopState::abandonFrameState(Runtime& runtime) {
	frameActive = false;
	runtime.vblank.abandonTick();
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
			if (cpu.isHaltedUntilIrq()) {
				const bool tickCompleted = runtime.cpuExecution.runHaltedUntilIrq(runtime, frameState);
				if (tickCompleted || cpu.isHaltedUntilIrq()) {
					return;
				}
				continue;
			}
			if (runtime.m_pendingCall != Runtime::PendingCall::Entry) {
				return;
			}
			runtime.cpuExecution.runWithBudget(runtime, frameState);
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
	if (!runtime.m_luaInitialized || !runtime.m_tickEnabled || runtime.m_runtimeFailed) {
		return false;
	}

	if (runtime.cartBoot.processPending()) {
		return true;
	}

	const bool previousFrameActive = frameActive;
	const int previousRemaining = previousFrameActive ? frameState.cycleBudgetRemaining : -1;
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
		&& runtime.machine.cpu.isHaltedUntilIrq()
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
