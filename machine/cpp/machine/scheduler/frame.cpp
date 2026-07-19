#include "machine/scheduler/frame.h"
#include "machine/runtime/runtime.h"

namespace bmsx {
namespace {
constexpr f64 MAX_CATCH_UP_MS = 1000.0 / 12.0;
}

void FrameSchedulerState::accumulateHostTime(f64 deltaMs) {
	m_accumulatedHostTimeMs += deltaMs;
	if (m_accumulatedHostTimeMs > MAX_CATCH_UP_MS) {
		m_accumulatedHostTimeMs = MAX_CATCH_UP_MS;
	}
}

bool FrameSchedulerState::canRunScheduledUpdate(const Runtime& runtime) const {
	if (!runtime.m_luaInitialized
		|| runtime.m_runtimeFailed
		|| runtime.machine.gxGpu.backendReadbackBlocksMachine()) {
		return false;
	}
	return (runtime.frameLoop.frameActive && runtime.frameLoop.frameState.cycleBudgetRemaining > 0)
		|| m_carriedCycleBudget > 0
		|| m_accumulatedHostTimeMs > 0.0;
}

i64 FrameSchedulerState::takeScheduledCycleBudget(const Runtime& runtime) {
	if (m_accumulatedHostTimeMs <= 0.0) return -1;
	const f64 exactBudget = m_accumulatedHostTimeMs * runtime.timing.cpuCyclesPerMillisecond
		+ m_cycleGrantRemainder;
	const i64 budget = static_cast<i64>(exactBudget);
	m_cycleGrantRemainder = exactBudget - static_cast<f64>(budget);
	m_accumulatedHostTimeMs = 0.0;
	return budget;
}

void FrameSchedulerState::clearQueuedTime() {
	m_accumulatedHostTimeMs = 0.0;
	m_carriedCycleBudget = 0;
}

void FrameSchedulerState::clearPendingTickCompletion() {
	m_tickCompletionPending = false;
	m_tickCompletionVisualCommitted = false;
	lastTickConsumedSequence = lastTickSequence;
}

void FrameSchedulerState::reset() {
	clearQueuedTime();
	m_cycleGrantRemainder = 0.0;
	clearPendingTickCompletion();
	m_backendServiceSuspended = false;
}

void FrameSchedulerState::resetTickTelemetry() {
	lastTickCompleted = false;
	lastTickBudgetGranted = 0;
	lastTickCpuBudgetGranted = 0;
	lastTickCpuUsedCycles = 0;
	lastTickBudgetRemaining = 0;
	lastTickVisualFrameCommitted = true;
	lastTickSequence = 0;
	lastTickConsumedSequence = 0;
}

FrameSchedulerStateSnapshot FrameSchedulerState::captureState() const {
	FrameSchedulerStateSnapshot state;
	state.accumulatedHostTimeMs = m_accumulatedHostTimeMs;
	state.cycleGrantRemainder = m_cycleGrantRemainder;
	state.carriedCycleBudget = m_carriedCycleBudget;
	state.tickCompletionPending = m_tickCompletionPending;
	state.tickCompletionVisualCommitted = m_tickCompletionVisualCommitted;
	state.lastTickSequence = lastTickSequence;
	state.lastTickBudgetGranted = lastTickBudgetGranted;
	state.lastTickCpuBudgetGranted = lastTickCpuBudgetGranted;
	state.lastTickCpuUsedCycles = lastTickCpuUsedCycles;
	state.lastTickBudgetRemaining = lastTickBudgetRemaining;
	state.lastTickVisualFrameCommitted = lastTickVisualFrameCommitted;
	state.lastTickCompleted = lastTickCompleted;
	state.lastTickConsumedSequence = lastTickConsumedSequence;
	return state;
}

void FrameSchedulerState::restoreState(const FrameSchedulerStateSnapshot& state) {
	m_accumulatedHostTimeMs = state.accumulatedHostTimeMs;
	m_cycleGrantRemainder = state.cycleGrantRemainder;
	m_carriedCycleBudget = state.carriedCycleBudget;
	m_tickCompletionPending = state.tickCompletionPending;
	m_tickCompletionVisualCommitted = state.tickCompletionVisualCommitted;
	lastTickSequence = state.lastTickSequence;
	lastTickBudgetGranted = state.lastTickBudgetGranted;
	lastTickCpuBudgetGranted = state.lastTickCpuBudgetGranted;
	lastTickCpuUsedCycles = state.lastTickCpuUsedCycles;
	lastTickBudgetRemaining = state.lastTickBudgetRemaining;
	lastTickVisualFrameCommitted = state.lastTickVisualFrameCommitted;
	lastTickCompleted = state.lastTickCompleted;
	lastTickConsumedSequence = state.lastTickConsumedSequence;
	m_backendServiceSuspended = false;
}

void FrameSchedulerState::enqueueTickCompletion(Runtime& runtime, FrameState& frameState) {
	const i64 sequence = lastTickSequence + 1;
	const i64 remaining = frameState.cycleBudgetRemaining;
	const i64 granted = frameState.cycleBudgetGranted;
	const bool visualCommitted = runtime.machine.gxGpu.lastFrameCommitted();
	m_tickCompletionVisualCommitted = m_tickCompletionPending
		? m_tickCompletionVisualCommitted || visualCommitted
		: visualCommitted;
	m_tickCompletionPending = true;
	lastTickBudgetGranted = granted;
	lastTickCpuBudgetGranted = granted;
	lastTickCpuUsedCycles = frameState.activeCpuUsedCycles;
	lastTickBudgetRemaining = remaining;
	lastTickVisualFrameCommitted = visualCommitted;
	lastTickCompleted = true;
	lastTickSequence = sequence;
	m_carriedCycleBudget = remaining;
}

bool FrameSchedulerState::consumeTickCompletion(TickCompletion& outCompletion) {
	if (!m_tickCompletionPending) return false;
	outCompletion.sequence = lastTickSequence;
	outCompletion.remaining = lastTickBudgetRemaining;
	outCompletion.visualCommitted = m_tickCompletionVisualCommitted;
	m_tickCompletionPending = false;
	m_tickCompletionVisualCommitted = false;
	lastTickConsumedSequence = outCompletion.sequence;
	return true;
}

bool FrameSchedulerState::refillFrameBudget(Runtime& runtime, FrameState& frameState) {
	const i64 budget = takeScheduledCycleBudget(runtime);
	if (budget <= 0) return false;
	frameState.cycleBudgetRemaining += budget;
	frameState.cycleBudgetGranted += budget;
	return true;
}

bool FrameSchedulerState::startScheduledFrame(Runtime& runtime) {
	const i64 carry = m_carriedCycleBudget;
	i64 budget = carry;
	if (budget == 0) {
		budget = takeScheduledCycleBudget(runtime);
		if (budget <= 0) return false;
	}
	m_carriedCycleBudget = 0;
	lastTickCompleted = false;
	runtime.frameLoop.beginFrameState(runtime, budget, carry);
	return true;
}

void FrameSchedulerState::run(Runtime& runtime, f64 hostDeltaMs) {
	if (runtime.machine.gxGpu.backendReadbackBlocksMachine()) {
		m_backendServiceSuspended = true;
		return;
	}
	if (m_backendServiceSuspended) {
		// Backend submission/mapping latency is host time, not machine time. Resume
		// the in-flight machine frame without turning that latency into catch-up.
		m_backendServiceSuspended = false;
		hostDeltaMs = 0.0;
	}
	accumulateHostTime(hostDeltaMs);
	while (canRunScheduledUpdate(runtime)) {
		const bool progressed = runtime.frameLoop.tickUpdate(runtime);
		if (runtime.frameLoop.frameActive && !progressed) {
			break;
		}
	}
	if (runtime.machine.gxGpu.backendReadbackBlocksMachine()) {
		m_backendServiceSuspended = true;
	}
}

} // namespace bmsx
