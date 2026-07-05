#include "machine/devices/input/controller.h"

#include "machine/bus/io.h"

namespace bmsx {

InputController::InputController(Memory& memory, InputControllerInputSource& input)
	: m_memory(memory)
	, m_input(input)
	, m_outputPort(input, m_registers, memory) {
	m_memory.mapIoWrite<&InputController::writeControl>(IO_INP_CTRL, *this);
	m_memory.mapIoWrite<&InputControllerRegisterFile::write>(IO_INP_OUTPUT_PORT, m_registers);
	m_memory.mapIoWrite<&InputControllerRegisterFile::write>(IO_INP_OUTPUT_INTENSITY_Q16, m_registers);
	m_memory.mapIoWrite<&InputControllerRegisterFile::write>(IO_INP_OUTPUT_DURATION_MS, m_registers);
	m_memory.mapIoWrite<&InputControllerOutputPort::writeOutputControlRegisterThunk>(IO_INP_OUTPUT_CTRL, m_outputPort);
}

void InputController::reset() {
	m_sampleArmed = false;
	m_sampleSequence = 0u;
	m_lastSampleCycle = 0u;
	m_registers.reset();
	m_memory.writeIoValue(IO_INP_OUTPUT_CTRL, valueNumber(0.0));
	m_registers.mirror(m_memory);
	m_memory.writeIoValue(IO_INP_STATUS, valueNumber(static_cast<double>(m_sampleSequence)));
}

void InputController::writeControl([[maybe_unused]] u32 addr, Value value) {
	m_registers.write(IO_INP_CTRL, value);
	switch (m_registers.state.ctrl) {
		case INP_CTRL_ARM:
			m_sampleArmed = true;
			return;
		case INP_CTRL_RESET:
			m_sampleArmed = false;
			m_sampleSequence = 0u;
			m_lastSampleCycle = 0u;
			m_registers.reset();
			m_registers.mirror(m_memory);
			m_memory.writeIoValue(IO_INP_STATUS, valueNumber(static_cast<double>(m_sampleSequence)));
			return;
	}
}

void InputController::onVblankEdge(f64 currentTimeMs, u32 nowCycles) {
	if (!m_sampleArmed) {
		return;
	}
	m_sampleSequence += 1u;
	m_lastSampleCycle = nowCycles;
	m_sampleArmed = false;
	m_input.sampleInputControllerSnapshot(currentTimeMs, m_snapshot);
	m_registers.latchSnapshot(m_snapshot);
	m_registers.mirror(m_memory);
	m_memory.writeIoValue(IO_INP_STATUS, valueNumber(static_cast<double>(m_sampleSequence)));
}

void InputController::cancelSampleArm() {
	m_sampleArmed = false;
}

} // namespace bmsx
