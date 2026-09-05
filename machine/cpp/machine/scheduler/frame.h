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
	f64 cycleGrantRemainder = 0.0;
	i64 carriedCycleBudget = 0;
	bool tickCompletionPending = false;
	bool tickCompletionVisualCommitted = false;
	bool logicalTickRunPending = false;
	i64 logicalTickRunTargetSequence = 0;
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
	bool runToNextLogicalTick(Runtime& runtime);
	bool runToNextLogicalTick(Runtime& runtime, i64 cycleGrant);
	bool runScheduledToNextLogicalTick(Runtime& runtime, f64 hostDeltaMs);
	InstructionStepResult stepInstruction(Runtime& runtime, f64 hostDeltaMs);

	i64 lastTickSequence = 0;
	i64 lastTickBudgetGranted = 0;
	i64 lastTickCpuBudgetGranted = 0;
	i64 lastTickCpuUsedCycles = 0;
	i64 lastTickBudgetRemaining = 0;
	bool lastTickVisualFrameCommitted = true;
	bool lastTickCompleted = false;
	i64 lastTickConsumedSequence = 0;

private:
	bool beginScheduledExecution(Runtime& runtime, f64 hostDeltaMs);
	void endScheduledExecution(Runtime& runtime);
	void beginScheduledFrame(Runtime& runtime, i64 budget, i64 carry);
	void accumulateHostTime(f64 deltaMs);
	bool canRunScheduledUpdate(const Runtime& runtime) const;
	i64 takeScheduledCycleBudget(const Runtime& runtime);

	f64 m_accumulatedHostTimeMs = 0.0;
	f64 m_cycleGrantRemainder = 0.0;
	i64 m_carriedCycleBudget = 0;
	bool m_tickCompletionPending = false;
	bool m_tickCompletionVisualCommitted = false;
	bool m_backendServiceSuspended = false;
	bool m_logicalTickRunPending = false;
	i64 m_logicalTickRunTargetSequence = 0;
};

} // namespace bmsx
