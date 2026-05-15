#pragma once

#include "common/types.h"

namespace bmsx {

class Input;
class InputControllerActionTable;
class InputControllerEventFifo;
class InputControllerSampleLatch;

class InputControllerSampleEdge final {
public:
	InputControllerSampleEdge(Input& input, InputControllerSampleLatch& sampleLatch, InputControllerActionTable& actionTable, InputControllerEventFifo& eventFifo);

	void onVblankEdge(f64 currentTimeMs, u32 nowCycles);

private:
	Input& m_input;
	InputControllerSampleLatch& m_sampleLatch;
	InputControllerActionTable& m_actionTable;
	InputControllerEventFifo& m_eventFifo;
};

} // namespace bmsx
