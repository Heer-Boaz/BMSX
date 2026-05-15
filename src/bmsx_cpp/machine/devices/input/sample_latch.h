#pragma once

#include "common/types.h"

namespace bmsx {

class Input;
class InputControllerActionTable;
class InputControllerEventFifo;

struct InputControllerSampleLatchState {
	bool sampleArmed = false;
	u32 sampleSequence = 0;
	u32 lastSampleCycle = 0;
};

class InputControllerSampleLatch {
public:
	InputControllerSampleLatch(Input& input, InputControllerActionTable& actionTable, InputControllerEventFifo& eventFifo);

	void reset();
	void arm();
	void cancel();
	void onVblankEdge(f64 currentTimeMs, u32 nowCycles);
	InputControllerSampleLatchState captureState() const;
	void restoreState(const InputControllerSampleLatchState& state);

private:
	Input& m_input;
	InputControllerActionTable& m_actionTable;
	InputControllerEventFifo& m_eventFifo;
	bool m_sampleArmed = false;
	u32 m_sampleSequence = 0;
	u32 m_lastSampleCycle = 0;
};

} // namespace bmsx
