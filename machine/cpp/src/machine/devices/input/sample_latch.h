#pragma once

#include "common/types.h"

namespace bmsx {

struct InputControllerSampleLatchState {
	bool sampleArmed = false;
	u32 sampleSequence = 0;
	u32 lastSampleCycle = 0;
};

class InputControllerSampleLatch {
public:
	void reset();
	void arm();
	bool cancel();
	bool consumeVblankEdge(u32 nowCycles);
	InputControllerSampleLatchState captureState() const;
	void restoreState(const InputControllerSampleLatchState& state);

private:
	bool m_sampleArmed = false;
	u32 m_sampleSequence = 0;
	u32 m_lastSampleCycle = 0;
};

} // namespace bmsx
