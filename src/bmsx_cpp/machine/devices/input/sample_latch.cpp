#include "machine/devices/input/sample_latch.h"

namespace bmsx {

void InputControllerSampleLatch::reset() {
	m_sampleArmed = false;
	m_sampleSequence = 0u;
	m_lastSampleCycle = 0u;
}

void InputControllerSampleLatch::arm() {
	m_sampleArmed = true;
}

bool InputControllerSampleLatch::cancel() {
	const bool wasArmed = m_sampleArmed;
	m_sampleArmed = false;
	return wasArmed;
}

bool InputControllerSampleLatch::consumeVblankEdge(u32 nowCycles) {
	if (!m_sampleArmed) {
		return false;
	}
	m_sampleSequence += 1u;
	m_lastSampleCycle = nowCycles;
	m_sampleArmed = false;
	return true;
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
