#pragma once

#include "../core/types.h"
#include <array>

namespace bmsx {

struct FrameState;
class Runtime;

struct TickCompletion {
	i64 sequence = 0;
	int remaining = 0;
	bool visualCommitted = true;
	int vdpFrameCost = 0;
	bool vdpFrameHeld = false;
};

constexpr size_t TICK_COMPLETION_QUEUE_CAPACITY = 16;

class RuntimeMachineSchedulerState {
public:
	void clearQueuedTime();
	void clearTickCompletionQueue(Runtime& runtime);
	void reset(Runtime& runtime);
	void enqueueTickCompletion(Runtime& runtime, FrameState& frameState);
	bool consumeTickCompletion(Runtime& runtime, TickCompletion& outCompletion);
	bool refillFrameBudget(Runtime& runtime, FrameState& frameState);
	bool startScheduledFrame(Runtime& runtime);
	void run(Runtime& runtime, f64 hostDeltaMs);

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
