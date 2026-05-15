#include "machine/devices/input/controller.h"

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"

namespace bmsx {

InputControllerState InputController::captureState() const {
	InputControllerState state;
	const InputControllerSampleLatchState capturedSampleLatch = sampleLatch.captureState();
	state.sampleArmed = capturedSampleLatch.sampleArmed;
	state.sampleSequence = capturedSampleLatch.sampleSequence;
	state.lastSampleCycle = capturedSampleLatch.lastSampleCycle;
	state.registers = m_registers.captureState();
	state.players = m_actionTable.capturePlayers();
	state.eventFifoEvents = m_eventFifo.captureEvents();
	state.eventFifoOverflow = m_eventFifo.overflow();
	return state;
}

void InputController::restoreState(const InputControllerState& state) {
	sampleLatch.restoreState(state);
	m_registers.restoreState(state.registers);
	m_actionTable.restorePlayers(state.players);
	m_eventFifo.restore(state.eventFifoEvents, state.eventFifoOverflow);
	m_memory.writeIoValue(IO_INP_EVENT_CTRL, valueNumber(0.0));
	m_memory.writeIoValue(IO_INP_OUTPUT_CTRL, valueNumber(0.0));
	m_registers.mirror(m_memory);
}

} // namespace bmsx
