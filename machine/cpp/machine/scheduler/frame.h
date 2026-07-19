#pragma once

#include "common/primitives.h"
#include "machine/runtime/frame/state.h"

namespace bmsx {

class Runtime;

struct TickCompletion {
	i64 sequence = 0;
	i64 remaining = 0;
	bool visualCommitted = true;
};

struct FrameSchedulerStateSnapshot {
	f64 accumulatedHostTimeMs = 0.0;
	i64 cycleGrantRemainder = 0;
	i64 carriedCycleBudget = 0;
	bool tickCompletionPending = false;
	bool tickCompletionVisualCommitted = false;
	i64 lastTickSequence = 0;
	i64 lastTickBudgetGranted = 0;
	i64 lastTickCpuBudgetGranted = 0;
	i64 lastTickCpuUsedCycles = 0;
	i64 lastTickBudgetRemaining = 0;
	bool lastTickVisualFrameCommitted = true;
	bool lastTickCompleted = false;
	i64 lastTickConsumedSequence = 0;
};

class FrameSchedulerState {
public:
	void clearQueuedTime();
	void clearPendingTickCompletion();
	void reset();
	void resetTickTelemetry();
	FrameSchedulerStateSnapshot captureState() const;
	void restoreState(const FrameSchedulerStateSnapshot& state);
	void enqueueTickCompletion(Runtime& runtime, FrameState& frameState);
	bool consumeTickCompletion(TickCompletion& outCompletion);
	bool refillFrameBudget(Runtime& runtime, FrameState& frameState);
	bool startScheduledFrame(Runtime& runtime);
	void run(Runtime& runtime, f64 hostDeltaMs);

	i64 lastTickSequence = 0;
	i64 lastTickBudgetGranted = 0;
	i64 lastTickCpuBudgetGranted = 0;
	i64 lastTickCpuUsedCycles = 0;
	i64 lastTickBudgetRemaining = 0;
	bool lastTickVisualFrameCommitted = true;
	bool lastTickCompleted = false;
	i64 lastTickConsumedSequence = 0;

private:
	void accumulateHostTime(f64 deltaMs);
	bool canRunScheduledUpdate(const Runtime& runtime) const;
	bool hasScheduledSlice() const;
	i64 takeScheduledCycleBudget(const Runtime& runtime);

	f64 m_accumulatedHostTimeMs = 0.0;
	i64 m_cycleGrantRemainder = 0;
	i64 m_carriedCycleBudget = 0;
	bool m_tickCompletionPending = false;
	bool m_tickCompletionVisualCommitted = false;
	bool m_backendServiceSuspended = false;
};

} // namespace bmsx
