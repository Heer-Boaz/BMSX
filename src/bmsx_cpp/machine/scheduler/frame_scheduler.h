#pragma once

#include "core/types.h"
#include "machine/runtime/frame_state.h"
#include <array>

namespace bmsx {

class Runtime;

struct TickCompletion {
	i64 sequence = 0;
	int remaining = 0;
	bool visualCommitted = true;
	int vdpFrameCost = 0;
	bool vdpFrameHeld = false;
};

constexpr size_t TICK_COMPLETION_QUEUE_CAPACITY = 16;

class FrameSchedulerState {
public:
	void clearQueuedTime();
	void clearTickCompletionQueue();
	void reset();
	void resetTickTelemetry();
	void enqueueTickCompletion(Runtime& runtime, FrameState& frameState);
	bool consumeTickCompletion(TickCompletion& outCompletion);
	bool refillFrameBudget(Runtime& runtime, FrameState& frameState);
	bool startScheduledFrame(Runtime& runtime);
	void run(Runtime& runtime, f64 hostDeltaMs);

	i64 lastTickSequence = 0;
	int lastTickBudgetGranted = 0;
	int lastTickCpuBudgetGranted = 0;
	int lastTickCpuUsedCycles = 0;
	int lastTickBudgetRemaining = 0;
	bool lastTickVisualFrameCommitted = true;
	int lastTickVdpFrameCost = 0;
	bool lastTickVdpFrameHeld = false;
	bool lastTickCompleted = false;
	i64 lastTickConsumedSequence = 0;

private:
	void accumulateHostTime(const Runtime& runtime, f64 deltaMs);
	bool canRunScheduledUpdate(const Runtime& runtime) const;
	bool hasScheduledFrame(const Runtime& runtime) const;
	bool consumeScheduledFrame(const Runtime& runtime);

	f64 m_accumulatedHostTimeMs = 0.0;
	std::array<TickCompletion, TICK_COMPLETION_QUEUE_CAPACITY> m_tickCompletionQueue{};
	size_t m_tickCompletionReadIndex = 0;
	size_t m_tickCompletionWriteIndex = 0;
	size_t m_tickCompletionCount = 0;
};

} // namespace bmsx
