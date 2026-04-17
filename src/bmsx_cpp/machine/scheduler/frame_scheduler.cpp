#include "machine/scheduler/frame_scheduler.h"
#include "machine/runtime/runtime.h"
#include "common/clamp.h"
#include <algorithm>
#include <stdexcept>

namespace bmsx {
namespace {
constexpr int MAX_CATCH_UP_FRAMES = 5;
constexpr double FRAME_SLICE_EPSILON_MS = 0.000001;

inline std::runtime_error runtimeFault(const std::string& message) {
	return std::runtime_error(std::string("Runtime fault: ") + message);
}
}

void FrameSchedulerState::accumulateHostTime(const Runtime& runtime, f64 deltaMs) {
	const f64 maxAccumulatedMs = runtime.timing.frameDurationMs * static_cast<f64>(MAX_CATCH_UP_FRAMES);
	m_accumulatedHostTimeMs = clamp(m_accumulatedHostTimeMs + deltaMs, 0.0, maxAccumulatedMs);
}

bool FrameSchedulerState::hasScheduledFrame(const Runtime& runtime) const {
	return m_accumulatedHostTimeMs + FRAME_SLICE_EPSILON_MS >= runtime.timing.frameDurationMs;
}

bool FrameSchedulerState::canRunScheduledUpdate(const Runtime& runtime) const {
	if (!runtime.m_luaInitialized || !runtime.m_tickEnabled || runtime.m_runtimeFailed) {
		return false;
	}
	if (runtime.frameLoop.frameActive && runtime.frameLoop.frameState.cycleBudgetRemaining > 0) {
		return true;
	}
	return hasScheduledFrame(runtime);
}

bool FrameSchedulerState::consumeScheduledFrame(const Runtime& runtime) {
	if (!hasScheduledFrame(runtime)) {
		return false;
	}
	m_accumulatedHostTimeMs = std::max(m_accumulatedHostTimeMs - runtime.timing.frameDurationMs, 0.0);
	return true;
}

void FrameSchedulerState::clearQueuedTime() {
	m_accumulatedHostTimeMs = 0.0;
}

void FrameSchedulerState::clearTickCompletionQueue() {
	m_tickCompletionReadIndex = 0;
	m_tickCompletionWriteIndex = 0;
	m_tickCompletionCount = 0;
	lastTickConsumedSequence = lastTickSequence;
}

void FrameSchedulerState::reset() {
	clearQueuedTime();
	clearTickCompletionQueue();
}

void FrameSchedulerState::resetTickTelemetry() {
	lastTickCompleted = false;
	lastTickBudgetGranted = 0;
	lastTickCpuBudgetGranted = 0;
	lastTickCpuUsedCycles = 0;
	lastTickBudgetRemaining = 0;
	lastTickVisualFrameCommitted = true;
	lastTickVdpFrameCost = 0;
	lastTickVdpFrameHeld = false;
	lastTickSequence = 0;
	lastTickConsumedSequence = 0;
}

void FrameSchedulerState::enqueueTickCompletion(Runtime& runtime, FrameState& frameState) {
	if (m_tickCompletionCount >= TICK_COMPLETION_QUEUE_CAPACITY) {
		throw runtimeFault("tick completion queue overflow.");
	}
	TickCompletion& slot = m_tickCompletionQueue[m_tickCompletionWriteIndex];
	const i64 sequence = lastTickSequence + 1;
	slot.sequence = sequence;
	slot.remaining = frameState.cycleBudgetRemaining;
	slot.visualCommitted = runtime.machine().vdp().lastFrameCommitted();
	slot.vdpFrameCost = runtime.machine().vdp().lastFrameCost();
	slot.vdpFrameHeld = runtime.machine().vdp().lastFrameHeld();
	m_tickCompletionWriteIndex = (m_tickCompletionWriteIndex + 1) % TICK_COMPLETION_QUEUE_CAPACITY;
	m_tickCompletionCount += 1;
	lastTickBudgetGranted = frameState.cycleBudgetGranted;
	lastTickCpuBudgetGranted = frameState.cycleBudgetGranted;
	lastTickCpuUsedCycles = frameState.activeCpuUsedCycles;
	lastTickBudgetRemaining = frameState.cycleBudgetRemaining;
	lastTickVisualFrameCommitted = slot.visualCommitted;
	lastTickVdpFrameCost = slot.vdpFrameCost;
	lastTickVdpFrameHeld = slot.vdpFrameHeld;
	lastTickCompleted = true;
	lastTickSequence = sequence;
}

bool FrameSchedulerState::consumeTickCompletion(TickCompletion& outCompletion) {
	if (m_tickCompletionCount == 0u) {
		return false;
	}
	outCompletion = m_tickCompletionQueue[m_tickCompletionReadIndex];
	m_tickCompletionReadIndex = (m_tickCompletionReadIndex + 1) % TICK_COMPLETION_QUEUE_CAPACITY;
	m_tickCompletionCount -= 1u;
	lastTickConsumedSequence = outCompletion.sequence;
	return true;
}

bool FrameSchedulerState::refillFrameBudget(Runtime& runtime, FrameState& frameState) {
	if (!consumeScheduledFrame(runtime)) {
		return false;
	}
	frameState.cycleBudgetRemaining += runtime.timing.cycleBudgetPerFrame;
	frameState.cycleBudgetGranted += runtime.timing.cycleBudgetPerFrame;
	return true;
}

bool FrameSchedulerState::startScheduledFrame(Runtime& runtime) {
	if (!consumeScheduledFrame(runtime)) {
		return false;
	}
	lastTickCompleted = false;
	runtime.frameLoop.beginFrameState(runtime);
	return true;
}

void FrameSchedulerState::run(Runtime& runtime, f64 hostDeltaMs) {
	accumulateHostTime(runtime, hostDeltaMs);
	while (canRunScheduledUpdate(runtime)) {
		const bool progressed = runtime.frameLoop.tickUpdate(runtime);
		if (runtime.frameLoop.hasActiveTick(runtime) && !progressed) {
			break;
		}
	}
}

} // namespace bmsx
