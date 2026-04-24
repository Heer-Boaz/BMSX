#include "machine/runtime/frame/loop.h"
#include "machine/runtime/cart_boot.h"
#include "machine/runtime/cpu_executor.h"
#include "machine/runtime/render/state.h"
#include "machine/runtime/runtime.h"

namespace bmsx {
void FrameLoopState::reset() {
	frameDeltaMs = 0.0;
	currentTimeSeconds = 0.0;
}

void FrameLoopState::resetFrameState(Runtime& runtime) {
	frameActive = false;
	runtime.vblank.abandonTick();
	runtime.machine().inputController().restoreSampleArmed(false);
	frameState = FrameState{};
	runtime.vblank.clearHaltUntilIrq(runtime);
	runtime.frameScheduler.reset();
	reset();
	runtime.screen.reset();
	runtime.frameScheduler.resetTickTelemetry();
	runtime.vblank.reset(runtime);
}

void FrameLoopState::beginFrameState(Runtime& runtime) {
	frameActive = true;
	runtime.vblank.beginTick();
	frameState = FrameState{};
	frameState.cycleBudgetRemaining = runtime.timing.cycleBudgetPerFrame;
	frameState.cycleBudgetGranted = runtime.timing.cycleBudgetPerFrame;
	frameState.cycleCarryGranted = 0;
	frameDeltaMs = runtime.timing.frameDurationMs;
	beginRuntimeRenderFrame();
	runtime.machine().vdp().beginFrame();
}

bool FrameLoopState::hasActiveTick(const Runtime& runtime) const {
	return frameActive && runtime.m_luaInitialized && runtime.m_tickEnabled && !runtime.m_runtimeFailed;
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

void FrameLoopState::executeUpdateCallback(Runtime& runtime) {
	try {
		while (true) {
			if (runtime.machine().cpu().isHaltedUntilIrq() && runtime.vblank.runHaltedUntilIrq(runtime, frameState)) {
				return;
			}
			if (runtime.vblank.consumeBackQueueClearAfterIrqWake()) {
				clearRuntimeRenderBackQueues();
			}
			if (runtime.m_pendingCall != Runtime::PendingCall::Entry) {
				return;
			}
			const RunResult result = runtime.cpuExecution.runWithBudget(runtime, frameState);
			if (runtime.machine().cpu().isHaltedUntilIrq()) {
				if (runtime.vblank.runHaltedUntilIrq(runtime, frameState)) {
					return;
				}
				continue;
			}
			if (result == RunResult::Halted) {
				runtime.m_pendingCall = Runtime::PendingCall::None;
			}
			return;
		}
	} catch (const std::exception& e) {
		runtime.handleLuaError(e.what());
	}
}

bool FrameLoopState::tickUpdate(Runtime& runtime) {
	using PendingCall = Runtime::PendingCall;
	if (runtime.cartBoot.processProgramReloadRequest(runtime)) {
		return true;
	}
	if (!runtime.m_luaInitialized || !runtime.m_tickEnabled || runtime.m_runtimeFailed) {
		return false;
	}

	if (runtime.cartBoot.processPending(runtime)) {
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

	if (runtime.m_pendingCall == PendingCall::Entry) {
		executeUpdateCallback(runtime);
	}

	if (startedFrame) {
		runtime.m_debugUpdateCountTotal += 1;
	}

	frameState.updateExecuted = runtime.m_pendingCall != PendingCall::Entry;
	finalizeUpdateSlice(runtime);
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
