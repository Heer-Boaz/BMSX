#include "machine/devices/input/controller.h"

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"

namespace bmsx {

InputControllerState InputController::captureState() const {
	InputControllerState state;
	state.sampleArmed = m_sampleArmed;
	state.sampleSequence = m_sampleSequence;
	state.lastSampleCycle = m_lastSampleCycle;
	state.systemNmiLineHigh = m_systemNmiLineHigh;
	state.registers = m_registers.captureState();
	return state;
}

void InputController::restoreState(const InputControllerState& state) {
	m_sampleArmed = state.sampleArmed;
	m_sampleSequence = state.sampleSequence;
	m_lastSampleCycle = state.lastSampleCycle;
	m_systemNmiLineHigh = state.systemNmiLineHigh;
	m_registers.restoreState(state.registers);
	m_memory.writeIoValue(IO_INP_OUTPUT_CTRL, valueNumber(0.0));
	m_registers.mirror(m_memory);
	m_memory.writeIoValue(IO_INP_STATUS, valueNumber(static_cast<double>(m_sampleSequence)));
}

} // namespace bmsx
