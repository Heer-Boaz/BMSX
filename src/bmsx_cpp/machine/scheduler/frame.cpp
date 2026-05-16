#include "machine/scheduler/frame.h"
#include "machine/runtime/runtime.h"
#include <stdexcept>

namespace bmsx {
namespace {
constexpr int MAX_CATCH_UP_FRAMES = 5;
constexpr double FRAME_SLICE_EPSILON_MS = 0.000001;
}

void FrameSchedulerState::accumulateHostTime(const Runtime& runtime, f64 deltaMs) {
	const f64 maxAccumulatedMs = runtime.timing.frameDurationMs * static_cast<f64>(MAX_CATCH_UP_FRAMES);
	m_accumulatedHostTimeMs += deltaMs;
	if (m_accumulatedHostTimeMs > maxAccumulatedMs) {
		m_accumulatedHostTimeMs = maxAccumulatedMs;
	}
}

bool FrameSchedulerState::hasScheduledFrame(const Runtime& runtime) const {
	return m_accumulatedHostTimeMs + FRAME_SLICE_EPSILON_MS >= runtime.timing.frameDurationMs;
}

bool FrameSchedulerState::canRunScheduledUpdate(const Runtime& runtime) const {
	if (!runtime.m_luaInitialized || !runtime.m_tickEnabled || runtime.m_runtimeFailed) {
		return false;
	}
	return (runtime.frameLoop.frameActive && runtime.frameLoop.frameState.cycleBudgetRemaining > 0 && !runtime.machine.cpu.isHaltedUntilIrq())
		|| hasScheduledFrame(runtime);
}

bool FrameSchedulerState::consumeScheduledFrame(const Runtime& runtime) {
	if (!hasScheduledFrame(runtime)) {
		return false;
	}
	m_accumulatedHostTimeMs -= runtime.timing.frameDurationMs;
	if (m_accumulatedHostTimeMs < 0.0) {
		m_accumulatedHostTimeMs = 0.0;
	}
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

FrameSchedulerStateSnapshot FrameSchedulerState::captureState() const {
	FrameSchedulerStateSnapshot state;
	state.accumulatedHostTimeMs = m_accumulatedHostTimeMs;
	state.lastTickSequence = lastTickSequence;
	state.lastTickBudgetGranted = lastTickBudgetGranted;
	state.lastTickCpuBudgetGranted = lastTickCpuBudgetGranted;
	state.lastTickCpuUsedCycles = lastTickCpuUsedCycles;
	state.lastTickBudgetRemaining = lastTickBudgetRemaining;
	state.lastTickVisualFrameCommitted = lastTickVisualFrameCommitted;
	state.lastTickVdpFrameCost = lastTickVdpFrameCost;
	state.lastTickVdpFrameHeld = lastTickVdpFrameHeld;
	state.lastTickCompleted = lastTickCompleted;
	state.lastTickConsumedSequence = lastTickConsumedSequence;
	state.queuedTickCompletions.reserve(m_tickCompletionCount);
	for (size_t index = 0; index < m_tickCompletionCount; ++index) {
		state.queuedTickCompletions.push_back(m_tickCompletionQueue[(m_tickCompletionReadIndex + index) % TICK_COMPLETION_QUEUE_CAPACITY]);
	}
	return state;
}

void FrameSchedulerState::restoreState(const FrameSchedulerStateSnapshot& state) {
	m_accumulatedHostTimeMs = state.accumulatedHostTimeMs;
	lastTickSequence = state.lastTickSequence;
	lastTickBudgetGranted = state.lastTickBudgetGranted;
	lastTickCpuBudgetGranted = state.lastTickCpuBudgetGranted;
	lastTickCpuUsedCycles = state.lastTickCpuUsedCycles;
	lastTickBudgetRemaining = state.lastTickBudgetRemaining;
	lastTickVisualFrameCommitted = state.lastTickVisualFrameCommitted;
	lastTickVdpFrameCost = state.lastTickVdpFrameCost;
	lastTickVdpFrameHeld = state.lastTickVdpFrameHeld;
	lastTickCompleted = state.lastTickCompleted;
	lastTickConsumedSequence = state.lastTickConsumedSequence;
	m_tickCompletionReadIndex = 0;
	const size_t queuedTickCompletionCount = state.queuedTickCompletions.size();
	m_tickCompletionWriteIndex = queuedTickCompletionCount % TICK_COMPLETION_QUEUE_CAPACITY;
	m_tickCompletionCount = queuedTickCompletionCount;
	for (size_t index = 0; index < TICK_COMPLETION_QUEUE_CAPACITY; ++index) {
		TickCompletion& slot = m_tickCompletionQueue[index];
		if (index < queuedTickCompletionCount) {
			slot = state.queuedTickCompletions[index];
			continue;
		}
		slot = TickCompletion{};
	}
}

void FrameSchedulerState::enqueueTickCompletion(Runtime& runtime, FrameState& frameState) {
	if (m_tickCompletionCount >= TICK_COMPLETION_QUEUE_CAPACITY) {
		throw BMSX_RUNTIME_ERROR("tick completion queue overflow.");
	}
	TickCompletion& slot = m_tickCompletionQueue[m_tickCompletionWriteIndex];
	const i64 sequence = lastTickSequence + 1;
	const int remaining = frameState.cycleBudgetRemaining;
	const int granted = frameState.cycleBudgetGranted;
	const auto& vdp = runtime.machine.vdp;
	slot.sequence = sequence;
	slot.remaining = remaining;
	slot.visualCommitted = vdp.lastFrameCommitted();
	slot.vdpFrameCost = vdp.lastFrameCost();
	slot.vdpFrameHeld = vdp.lastFrameHeld();
	m_tickCompletionWriteIndex = (m_tickCompletionWriteIndex + 1) % TICK_COMPLETION_QUEUE_CAPACITY;
	m_tickCompletionCount += 1;
	lastTickBudgetGranted = granted;
	lastTickCpuBudgetGranted = granted;
	lastTickCpuUsedCycles = frameState.activeCpuUsedCycles;
	lastTickBudgetRemaining = remaining;
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
	const int budget = runtime.timing.cycleBudgetPerFrame;
	frameState.cycleBudgetRemaining += budget;
	frameState.cycleBudgetGranted += budget;
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
		if (runtime.frameLoop.frameActive && !progressed) {
			break;
		}
	}
}

} // namespace bmsx
