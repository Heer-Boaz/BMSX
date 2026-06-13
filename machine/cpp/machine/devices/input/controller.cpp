#include "machine/devices/input/controller.h"

namespace bmsx {

InputController::InputController(Memory& memory, InputControllerInputSource& input)
	: m_memory(memory)
	, m_sampleLatch()
	, m_sampleEdge(input, m_sampleLatch, m_registers, memory)
	, m_controlPort(memory, m_registers, m_sampleLatch)
	, m_outputPort(input, m_registers, memory) {
	m_memory.mapIoWrite(IO_INP_CTRL, &m_controlPort, &InputControllerControlPort::writeControlThunk);
	m_memory.mapIoWrite(IO_INP_OUTPUT_PORT, &m_registers, &InputControllerRegisterFile::writeThunk);
	m_memory.mapIoWrite(IO_INP_OUTPUT_INTENSITY_Q16, &m_registers, &InputControllerRegisterFile::writeThunk);
	m_memory.mapIoWrite(IO_INP_OUTPUT_DURATION_MS, &m_registers, &InputControllerRegisterFile::writeThunk);
	m_memory.mapIoWrite(IO_INP_OUTPUT_CTRL, &m_outputPort, &InputControllerOutputPort::writeOutputControlRegisterThunk);
}

void InputController::reset() {
	m_sampleLatch.reset();
	m_registers.reset();
	m_memory.writeIoValue(IO_INP_OUTPUT_CTRL, valueNumber(0.0));
	m_registers.mirror(m_memory);
	m_memory.writeIoValue(IO_INP_STATUS, valueNumber(static_cast<double>(m_sampleLatch.sequence())));
}

void InputController::onVblankEdge(f64 currentTimeMs, u32 nowCycles) {
	m_sampleEdge.onVblankEdge(currentTimeMs, nowCycles);
}

void InputController::cancelSampleArm() {
	if (!m_sampleLatch.cancel()) {
		return;
	}
}

} // namespace bmsx
