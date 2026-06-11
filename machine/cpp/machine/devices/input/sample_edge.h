#pragma once

#include "common/types.h"

namespace bmsx {

class InputControllerInputSource;
class InputControllerActionTable;
class InputControllerEventFifo;
class InputControllerSampleLatch;

class InputControllerSampleEdge final {
public:
	InputControllerSampleEdge(InputControllerInputSource& input, InputControllerSampleLatch& sampleLatch, InputControllerActionTable& actionTable, InputControllerEventFifo& eventFifo);

	void onVblankEdge(f64 currentTimeMs, u32 nowCycles);

private:
	InputControllerInputSource& m_input;
	InputControllerSampleLatch& m_sampleLatch;
	InputControllerActionTable& m_actionTable;
	InputControllerEventFifo& m_eventFifo;
};

} // namespace bmsx
