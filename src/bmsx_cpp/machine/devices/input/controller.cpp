#include "machine/devices/input/controller.h"

namespace bmsx {

InputController::InputController(Memory& memory, Input& input, const StringPool& strings)
	: m_memory(memory)
	, m_input(input)
	, m_actionTable(input, strings)
	, m_eventFifo(memory)
	, m_sampleLatch()
	, m_controlPort(memory, m_registers, m_actionTable, m_sampleLatch)
	, m_outputPort(input, m_registers, memory)
	, m_queryPort(memory, strings, m_registers, m_actionTable) {
	m_memory.mapIoWrite(IO_INP_PLAYER, &m_registers, &InputControllerRegisterFile::writeThunk);
	m_memory.mapIoWrite(IO_INP_ACTION, &m_registers, &InputControllerRegisterFile::writeThunk);
	m_memory.mapIoWrite(IO_INP_BIND, &m_registers, &InputControllerRegisterFile::writeThunk);
	m_memory.mapIoWrite(IO_INP_CTRL, &m_controlPort, &InputControllerControlPort::writeControlThunk);
	m_memory.mapIoWrite(IO_INP_QUERY, &m_queryPort, &InputControllerQueryPort::writeQueryThunk);
	m_memory.mapIoWrite(IO_INP_CONSUME, &m_queryPort, &InputControllerQueryPort::writeConsumeThunk);
	m_memory.mapIoWrite(IO_INP_OUTPUT_INTENSITY_Q16, &m_registers, &InputControllerRegisterFile::writeThunk);
	m_memory.mapIoWrite(IO_INP_OUTPUT_DURATION_MS, &m_registers, &InputControllerRegisterFile::writeThunk);
	m_memory.mapIoRead(IO_INP_EVENT_STATUS, &m_eventFifo, &InputControllerEventFifo::readRegisterThunk);
	m_memory.mapIoRead(IO_INP_EVENT_COUNT, &m_eventFifo, &InputControllerEventFifo::readRegisterThunk);
	m_memory.mapIoRead(IO_INP_EVENT_PLAYER, &m_eventFifo, &InputControllerEventFifo::readRegisterThunk);
	m_memory.mapIoRead(IO_INP_EVENT_ACTION, &m_eventFifo, &InputControllerEventFifo::readRegisterThunk);
	m_memory.mapIoRead(IO_INP_EVENT_FLAGS, &m_eventFifo, &InputControllerEventFifo::readRegisterThunk);
	m_memory.mapIoRead(IO_INP_EVENT_VALUE, &m_eventFifo, &InputControllerEventFifo::readRegisterThunk);
	m_memory.mapIoRead(IO_INP_EVENT_REPEAT_COUNT, &m_eventFifo, &InputControllerEventFifo::readRegisterThunk);
	m_memory.mapIoRead(IO_INP_EVENT_CTRL, &m_eventFifo, &InputControllerEventFifo::readRegisterThunk);
	m_memory.mapIoWrite(IO_INP_EVENT_CTRL, &m_eventFifo, &InputControllerEventFifo::writeEventControlRegisterThunk);
	m_memory.mapIoRead(IO_INP_OUTPUT_STATUS, &m_outputPort, &InputControllerOutputPort::readRegisterThunk);
	m_memory.mapIoRead(IO_INP_OUTPUT_CTRL, &m_outputPort, &InputControllerOutputPort::readRegisterThunk);
	m_memory.mapIoWrite(IO_INP_OUTPUT_CTRL, &m_outputPort, &InputControllerOutputPort::writeOutputControlRegisterThunk);
}

void InputController::reset() {
	m_sampleLatch.reset();
	m_actionTable.reset();
	m_registers.reset();
	m_eventFifo.clear();
	m_memory.writeIoValue(IO_INP_EVENT_CTRL, valueNumber(0.0));
	m_memory.writeIoValue(IO_INP_OUTPUT_CTRL, valueNumber(0.0));
	m_registers.mirror(m_memory);
}

void InputController::onVblankEdge(f64 currentTimeMs, u32 nowCycles) {
	if (!m_sampleLatch.consumeVblankEdge(nowCycles)) {
		return;
	}
	m_input.samplePlayers(currentTimeMs);
	m_actionTable.sampleCommittedActions(m_eventFifo);
}

void InputController::cancelSampleArm() {
	if (!m_sampleLatch.cancel()) {
		return;
	}
}

} // namespace bmsx
