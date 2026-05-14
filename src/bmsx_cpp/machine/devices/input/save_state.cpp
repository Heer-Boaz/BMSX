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
	for (size_t index = 0; index < m_playerStates.size(); index += 1) {
		state.players[index].actions = m_playerStates[index].actions;
	}
	state.eventFifoEvents = m_eventFifo.captureEvents();
	state.eventFifoOverflow = m_eventFifo.overflow();
	return state;
}

void InputController::restoreState(const InputControllerState& state) {
	for (i32 playerIndex = 1; playerIndex <= INPUT_CONTROLLER_PLAYER_COUNT; playerIndex += 1) {
		clearPlayerActions(playerIndex, m_playerStates[static_cast<size_t>(playerIndex - 1)]);
	}
	m_sampleArmed = state.sampleArmed;
	m_sampleSequence = state.sampleSequence;
	m_lastSampleCycle = state.lastSampleCycle;
	m_registers = state.registers;
	for (i32 playerIndex = 1; playerIndex <= INPUT_CONTROLLER_PLAYER_COUNT; playerIndex += 1) {
		restorePlayerActions(
			playerIndex,
			m_playerStates[static_cast<size_t>(playerIndex - 1)],
			state.players[static_cast<size_t>(playerIndex - 1)].actions
		);
	}
	m_eventFifo.restore(state.eventFifoEvents, state.eventFifoOverflow);
	m_memory.writeIoValue(IO_INP_EVENT_CTRL, valueNumber(0.0));
	m_memory.writeIoValue(IO_INP_OUTPUT_CTRL, valueNumber(0.0));
	mirrorRegisters();
}

} // namespace bmsx
