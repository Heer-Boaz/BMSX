#pragma once

#include "machine/memory/memory.h"
#include "machine/devices/input/action_table.h"
#include "machine/devices/input/control_port.h"
#include "machine/devices/input/contracts.h"
#include "machine/devices/input/event_fifo.h"
#include "machine/devices/input/output_port.h"
#include "machine/devices/input/query_port.h"
#include "machine/devices/input/registers.h"
#include "machine/devices/input/sample_latch.h"
#include "machine/devices/input/sample_edge.h"
#include "machine/devices/input/save_state.h"
#include "input/manager.h"
#include <string>

namespace bmsx {

class InputController {
public:
	InputController(Memory& memory, Input& input, const StringPool& strings);

	void reset();
	void onVblankEdge(f64 currentTimeMs, u32 nowCycles);
	void cancelSampleArm();
	InputControllerState captureState() const;
	void restoreState(const InputControllerState& state);

private:
	Memory& m_memory;
	InputControllerActionTable m_actionTable;
	InputControllerRegisterFile m_registers;
	InputControllerEventFifo m_eventFifo;
	InputControllerSampleLatch m_sampleLatch;
	InputControllerSampleEdge m_sampleEdge;
	InputControllerControlPort m_controlPort;
	InputControllerOutputPort m_outputPort;
	InputControllerQueryPort m_queryPort;

};

} // namespace bmsx
