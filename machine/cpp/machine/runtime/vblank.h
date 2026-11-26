#pragma once

#include "common/primitives.h"
#include "machine/runtime/frame/state.h"

namespace bmsx {

class Runtime;

class VblankState {
public:
	bool tickCompleted() const { return m_activeTickCompleted; }
	void reset(Runtime& runtime);
	void prepareRestore();
	void beginTick();
	void abandonTick();
	void handleGpuRuntimeEdge(Runtime& runtime, u32 edge);

private:
	void enterVblank(Runtime& runtime);
	void completeTickIfPending(Runtime& runtime, FrameState& frameState, u64 vblankSequence);

	u64 m_vblankSequence = 0;
	u64 m_lastCompletedVblankSequence = 0;
	bool m_activeTickCompleted = false;
};

} // namespace bmsx
