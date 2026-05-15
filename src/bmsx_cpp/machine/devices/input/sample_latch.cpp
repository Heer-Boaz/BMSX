#include "machine/devices/input/sample_latch.h"

#include "input/manager.h"
#include "machine/devices/input/action_table.h"
#include "machine/devices/input/event_fifo.h"

namespace bmsx {

InputControllerSampleLatch::InputControllerSampleLatch(Input& input, InputControllerActionTable& actionTable, InputControllerEventFifo& eventFifo)
	: m_input(input)
	, m_actionTable(actionTable)
	, m_eventFifo(eventFifo) {
}

void InputControllerSampleLatch::reset() {
	m_sampleArmed = false;
	m_sampleSequence = 0u;
	m_lastSampleCycle = 0u;
}

void InputControllerSampleLatch::arm() {
	m_sampleArmed = true;
}

void InputControllerSampleLatch::cancel() {
	m_sampleArmed = false;
}

void InputControllerSampleLatch::onVblankEdge(f64 currentTimeMs, u32 nowCycles) {
	if (!m_sampleArmed) {
		return;
	}
	m_sampleSequence += 1u;
	m_lastSampleCycle = nowCycles;
	m_input.samplePlayers(currentTimeMs);
	m_actionTable.sampleCommittedActions(m_eventFifo);
	m_sampleArmed = false;
}

InputControllerSampleLatchState InputControllerSampleLatch::captureState() const {
	InputControllerSampleLatchState state;
	state.sampleArmed = m_sampleArmed;
	state.sampleSequence = m_sampleSequence;
	state.lastSampleCycle = m_lastSampleCycle;
	return state;
}

void InputControllerSampleLatch::restoreState(const InputControllerSampleLatchState& state) {
	m_sampleArmed = state.sampleArmed;
	m_sampleSequence = state.sampleSequence;
	m_lastSampleCycle = state.lastSampleCycle;
}

} // namespace bmsx
