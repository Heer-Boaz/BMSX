#include "machine/devices/input/controller.h"

#include "spec/bmsx/io.h"

namespace bmsx {

InputControllerState InputController::captureState() const {
	InputControllerState state;
	state.sampleArmed = m_sampleArmed;
	state.sampleSequence = m_sampleSequence;
	state.lastSampleCycle = m_lastSampleCycle;
	state.supervisorRequestLineHigh = m_supervisorRequestLineWasHigh;
	state.registers = m_registers.captureState();
	return state;
}

void InputController::restoreState(const InputControllerState& state) {
	m_sampleArmed = state.sampleArmed;
	m_sampleSequence = state.sampleSequence;
	m_lastSampleCycle = state.lastSampleCycle;
	m_supervisorRequestLineWasHigh = state.supervisorRequestLineHigh;
	m_registers.restoreState(state.registers);
	m_memory.writeIoU32(IO_INP_OUTPUT_CTRL, 0u);
	m_registers.mirror(m_memory);
	m_memory.writeIoU32(IO_INP_STATUS, m_sampleSequence);
}

} // namespace bmsx
