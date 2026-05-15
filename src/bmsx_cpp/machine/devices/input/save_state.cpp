#include "machine/devices/input/controller.h"

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"

namespace bmsx {

InputControllerState InputController::captureState() const {
	InputControllerState state;
	state.sampleArmed = m_sampleArmed;
	state.sampleSequence = m_sampleSequence;
	state.lastSampleCycle = m_lastSampleCycle;
	state.registers = m_registers;
	state.players = m_actionTable.capturePlayers();
	state.eventFifoEvents = m_eventFifo.captureEvents();
	state.eventFifoOverflow = m_eventFifo.overflow();
	return state;
}

void InputController::restoreState(const InputControllerState& state) {
	m_sampleArmed = state.sampleArmed;
	m_sampleSequence = state.sampleSequence;
	m_lastSampleCycle = state.lastSampleCycle;
	m_registers = state.registers;
	m_actionTable.restorePlayers(state.players);
	m_eventFifo.restore(state.eventFifoEvents, state.eventFifoOverflow);
	m_memory.writeIoValue(IO_INP_EVENT_CTRL, valueNumber(0.0));
	m_memory.writeIoValue(IO_INP_OUTPUT_CTRL, valueNumber(0.0));
	mirrorRegisters();
}

} // namespace bmsx
