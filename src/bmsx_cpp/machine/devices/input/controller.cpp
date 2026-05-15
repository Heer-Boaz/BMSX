#include "machine/devices/input/controller.h"

#include <stdexcept>

namespace bmsx {

InputController::InputController(Memory& memory, Input& input, const StringPool& strings)
	: m_memory(memory)
	, m_strings(strings)
	, m_actionTable(input, strings)
	, sampleLatch(input, m_actionTable, m_eventFifo)
	, m_outputPort(input) {
	m_memory.mapIoWrite(IO_INP_PLAYER, this, &InputController::onRegisterWriteThunk);
	m_memory.mapIoWrite(IO_INP_ACTION, this, &InputController::onRegisterWriteThunk);
	m_memory.mapIoWrite(IO_INP_BIND, this, &InputController::onRegisterWriteThunk);
	m_memory.mapIoWrite(IO_INP_CTRL, this, &InputController::onRegisterWriteThunk);
	m_memory.mapIoWrite(IO_INP_QUERY, this, &InputController::onRegisterWriteThunk);
	m_memory.mapIoWrite(IO_INP_CONSUME, this, &InputController::onRegisterWriteThunk);
	m_memory.mapIoWrite(IO_INP_OUTPUT_INTENSITY_Q16, this, &InputController::onRegisterWriteThunk);
	m_memory.mapIoWrite(IO_INP_OUTPUT_DURATION_MS, this, &InputController::onRegisterWriteThunk);
	m_memory.mapIoRead(IO_INP_EVENT_STATUS, this, &InputController::onEventRegisterReadThunk);
	m_memory.mapIoRead(IO_INP_EVENT_COUNT, this, &InputController::onEventRegisterReadThunk);
	m_memory.mapIoRead(IO_INP_EVENT_PLAYER, this, &InputController::onEventRegisterReadThunk);
	m_memory.mapIoRead(IO_INP_EVENT_ACTION, this, &InputController::onEventRegisterReadThunk);
	m_memory.mapIoRead(IO_INP_EVENT_FLAGS, this, &InputController::onEventRegisterReadThunk);
	m_memory.mapIoRead(IO_INP_EVENT_VALUE, this, &InputController::onEventRegisterReadThunk);
	m_memory.mapIoRead(IO_INP_EVENT_REPEAT_COUNT, this, &InputController::onEventRegisterReadThunk);
	m_memory.mapIoRead(IO_INP_EVENT_CTRL, this, &InputController::onEventRegisterReadThunk);
	m_memory.mapIoWrite(IO_INP_EVENT_CTRL, this, &InputController::onEventCtrlWriteThunk);
	m_memory.mapIoRead(IO_INP_OUTPUT_STATUS, this, &InputController::onOutputRegisterReadThunk);
	m_memory.mapIoRead(IO_INP_OUTPUT_CTRL, this, &InputController::onOutputRegisterReadThunk);
	m_memory.mapIoWrite(IO_INP_OUTPUT_CTRL, this, &InputController::onOutputCtrlWriteThunk);
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk back into the input device instance.
void InputController::onRegisterWriteThunk(void* context, uint32_t addr, Value value) {
	static_cast<InputController*>(context)->onRegisterWrite(addr, value);
}

Value InputController::onEventRegisterReadThunk(void* context, uint32_t addr) {
	return static_cast<InputController*>(context)->onEventRegisterRead(addr);
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk back into the input device instance.
void InputController::onEventCtrlWriteThunk(void* context, uint32_t, Value value) {
	static_cast<InputController*>(context)->onEventCtrlWrite(toU32(value));
}

Value InputController::onOutputRegisterReadThunk(void* context, uint32_t addr) {
	return static_cast<InputController*>(context)->onOutputRegisterRead(addr);
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk back into the input device instance.
void InputController::onOutputCtrlWriteThunk(void* context, uint32_t, Value value) {
	static_cast<InputController*>(context)->onOutputCtrlWrite(toU32(value));
}

void InputController::reset() {
	sampleLatch.reset();
	m_actionTable.reset();
	m_registers.reset();
	m_eventFifo.clear();
	m_memory.writeIoValue(IO_INP_EVENT_CTRL, valueNumber(0.0));
	m_memory.writeIoValue(IO_INP_OUTPUT_CTRL, valueNumber(0.0));
	m_registers.mirror(m_memory);
}

void InputController::onRegisterWrite(uint32_t addr, Value value) {
	m_registers.write(addr, value);
	switch (addr) {
		case IO_INP_CTRL:
			onCtrlWrite();
			return;
		case IO_INP_QUERY:
			queryAction();
			return;
		case IO_INP_CONSUME:
			consumeActions();
			return;
	}
}

void InputController::onCtrlWrite() {
	switch (m_registers.state.ctrl) {
		case INP_CTRL_COMMIT:
			m_actionTable.commitAction(static_cast<i32>(m_registers.state.player), m_registers.state.actionStringId, m_registers.state.bindStringId);
			return;
		case INP_CTRL_ARM:
			sampleLatch.arm();
			return;
		case INP_CTRL_RESET:
			resetActions();
			return;
	}
}

Value InputController::onEventRegisterRead(uint32_t addr) const {
	switch (addr) {
		case IO_INP_EVENT_STATUS:
			return valueNumber(static_cast<double>(m_eventFifo.statusWord()));
		case IO_INP_EVENT_COUNT:
			return valueNumber(static_cast<double>(m_eventFifo.count()));
		case IO_INP_EVENT_PLAYER:
			return valueNumber(static_cast<double>(m_eventFifo.front().player));
		case IO_INP_EVENT_ACTION:
			return valueString(m_eventFifo.front().actionStringId);
		case IO_INP_EVENT_FLAGS:
			return valueNumber(static_cast<double>(m_eventFifo.front().statusWord));
		case IO_INP_EVENT_VALUE:
			return valueNumber(static_cast<double>(m_eventFifo.front().valueQ16));
		case IO_INP_EVENT_REPEAT_COUNT:
			return valueNumber(static_cast<double>(m_eventFifo.front().repeatCount));
		case IO_INP_EVENT_CTRL:
			return valueNumber(0.0);
	}
	throw std::runtime_error("ICU event register read is not mapped.");
}

void InputController::onEventCtrlWrite(u32 command) {
	switch (command) {
		case INP_EVENT_CTRL_POP:
			m_eventFifo.pop();
			break;
		case INP_EVENT_CTRL_CLEAR:
			m_eventFifo.clear();
			break;
	}
	m_memory.writeIoValue(IO_INP_EVENT_CTRL, valueNumber(0.0));
}

Value InputController::onOutputRegisterRead(uint32_t addr) const {
	switch (addr) {
		case IO_INP_OUTPUT_STATUS:
			return valueNumber(static_cast<double>(m_outputPort.readStatus(m_registers.state.player)));
		case IO_INP_OUTPUT_CTRL:
			return valueNumber(0.0);
	}
	throw std::runtime_error("ICU output register read is not mapped.");
}

void InputController::onOutputCtrlWrite(u32 command) {
	switch (command) {
		case INP_OUTPUT_CTRL_APPLY:
			m_outputPort.apply(m_registers.state.player, m_registers.state.outputIntensityQ16, m_registers.state.outputDurationMs);
			break;
	}
	m_memory.writeIoValue(IO_INP_OUTPUT_CTRL, valueNumber(0.0));
}

void InputController::queryAction() {
	const std::string& queryText = m_strings.toString(m_registers.state.queryStringId);
	m_actionTable.queryAction(static_cast<i32>(m_registers.state.player), queryText, m_queryResult);
	m_registers.writeResult(m_memory, m_queryResult.statusWord, m_queryResult.valueQ16);
}

void InputController::consumeActions() {
	const std::string& actionNames = m_strings.toString(m_registers.state.consumeStringId);
	m_actionTable.consumeActions(static_cast<i32>(m_registers.state.player), actionNames);
}

void InputController::resetActions() {
	m_actionTable.resetActions(static_cast<i32>(m_registers.state.player));
	m_registers.writeResult(m_memory, 0u, 0u);
}

} // namespace bmsx
