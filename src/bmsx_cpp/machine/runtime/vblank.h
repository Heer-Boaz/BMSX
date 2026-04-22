#pragma once

#include "core/primitives.h"
#include "machine/runtime/frame/state.h"

namespace bmsx {

class Runtime;

struct RuntimeVblankSnapshot {
	int cyclesIntoFrame = 0;
};

class VblankState {
public:
	bool tickCompleted() const { return m_activeTickCompleted; }
	void configureCycleBudget(Runtime& runtime);
	void setVblankCycles(Runtime& runtime, int cycles);
	int getCyclesIntoFrame(const Runtime& runtime) const;
	void resetScheduler(Runtime& runtime);
	void reset(Runtime& runtime);
	RuntimeVblankSnapshot capture(const Runtime& runtime) const;
	void restore(Runtime& runtime, const RuntimeVblankSnapshot& state);
	void beginTick();
	void abandonTick();
	void handleBeginTimer(Runtime& runtime);
	void handleEndTimer(Runtime& runtime);
	void clearHaltUntilIrq(Runtime& runtime);
	bool consumeBackQueueClearAfterIrqWake();
	bool runHaltedUntilIrq(Runtime& runtime, FrameState& frameState);

private:
	void scheduleCurrentFrameTimers(Runtime& runtime);
	void setVblankStatus(Runtime& runtime, bool active);
	void enterVblank(Runtime& runtime);
	void resetHaltIrqWait();
	bool tryCompleteTickOnPendingVblankIrq(Runtime& runtime, FrameState& frameState);
	bool isFrameBoundaryHalt(Runtime& runtime) const;
	void commitFrameOnVblankEdge(Runtime& runtime);
	void completeTickIfPending(Runtime& runtime, FrameState& frameState, uint64_t vblankSequence);

	bool m_clearBackQueuesAfterIrqWake = false;
	uint64_t m_haltIrqSignalSequence = 0;
	bool m_haltIrqWaitArmed = false;
	uint64_t m_vblankSequence = 0;
	uint64_t m_lastCompletedVblankSequence = 0;
	int m_vblankCycles = 0;
	int m_vblankStartCycle = 0;
	bool m_vblankActive = false;
	i64 m_frameStartCycle = 0;
	bool m_activeTickCompleted = false;
};

} // namespace bmsx
