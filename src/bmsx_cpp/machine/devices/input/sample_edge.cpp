#include "machine/devices/input/sample_edge.h"

#include "input/manager.h"
#include "machine/devices/input/action_table.h"
#include "machine/devices/input/event_fifo.h"
#include "machine/devices/input/sample_latch.h"

namespace bmsx {

InputControllerSampleEdge::InputControllerSampleEdge(Input& input, InputControllerSampleLatch& sampleLatch, InputControllerActionTable& actionTable, InputControllerEventFifo& eventFifo)
	: m_input(input)
	, m_sampleLatch(sampleLatch)
	, m_actionTable(actionTable)
	, m_eventFifo(eventFifo) {}

void InputControllerSampleEdge::onVblankEdge(f64 currentTimeMs, u32 nowCycles) {
	if (!m_sampleLatch.consumeVblankEdge(nowCycles)) {
		return;
	}
	m_input.samplePlayers(currentTimeMs);
	m_actionTable.sampleCommittedActions(m_eventFifo);
}

} // namespace bmsx
