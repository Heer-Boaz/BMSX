#include "machine/devices/input/controller.h"

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"

namespace bmsx {

InputControllerState InputController::captureState() const {
	InputControllerState state;
	const InputControllerSampleLatchState capturedSampleLatch = m_sampleLatch.captureState();
	state.sampleArmed = capturedSampleLatch.sampleArmed;
	state.sampleSequence = capturedSampleLatch.sampleSequence;
	state.lastSampleCycle = capturedSampleLatch.lastSampleCycle;
	state.registers = m_registers.captureState();
	return state;
}

void InputController::restoreState(const InputControllerState& state) {
	m_sampleLatch.restoreState(state);
	m_registers.restoreState(state.registers);
	m_memory.writeIoValue(IO_INP_OUTPUT_CTRL, valueNumber(0.0));
	m_registers.mirror(m_memory);
	m_memory.writeIoValue(IO_INP_STATUS, valueNumber(static_cast<double>(m_sampleLatch.sequence())));
}

} // namespace bmsx
