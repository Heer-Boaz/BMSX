#include "machine/devices/input/sample_edge.h"

#include "machine/devices/input/action_table.h"
#include "machine/devices/input/contracts.h"
#include "machine/devices/input/event_fifo.h"
#include "machine/devices/input/sample_latch.h"

namespace bmsx {

InputControllerSampleEdge::InputControllerSampleEdge(InputControllerInputSource& input, InputControllerSampleLatch& sampleLatch, InputControllerActionTable& actionTable, InputControllerEventFifo& eventFifo)
	: m_input(input)
	, m_sampleLatch(sampleLatch)
	, m_actionTable(actionTable)
	, m_eventFifo(eventFifo) {}

void InputControllerSampleEdge::onVblankEdge(f64 currentTimeMs, u32 nowCycles) {
	if (!m_sampleLatch.consumeVblankEdge(nowCycles)) {
		return;
	}
	m_input.sampleInputControllerPlayers(currentTimeMs);
	m_actionTable.sampleButtons(m_eventFifo);
}

} // namespace bmsx
