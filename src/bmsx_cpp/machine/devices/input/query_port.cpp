#include "machine/devices/input/query_port.h"

#include "machine/bus/io.h"
#include "machine/cpu/string_pool.h"
#include "machine/devices/input/registers.h"

namespace bmsx {

InputControllerQueryPort::InputControllerQueryPort(Memory& memory, const StringPool& strings, InputControllerRegisterFile& registers, InputControllerActionTable& actionTable)
	: m_memory(memory)
	, m_strings(strings)
	, m_registers(registers)
	, m_actionTable(actionTable) {
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk into the input query-port instance.
void InputControllerQueryPort::writeQueryThunk(void* context, u32, Value value) {
	static_cast<InputControllerQueryPort*>(context)->writeQuery(value);
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk into the input query-port instance.
void InputControllerQueryPort::writeConsumeThunk(void* context, u32, Value value) {
	static_cast<InputControllerQueryPort*>(context)->writeConsume(value);
}

void InputControllerQueryPort::writeQuery(Value value) {
	m_registers.write(IO_INP_QUERY, value);
	const std::string& queryText = m_strings.toString(m_registers.state.queryStringId);
	m_actionTable.queryAction(static_cast<i32>(m_registers.state.player), queryText, m_queryResult);
	m_registers.writeResult(m_memory, m_queryResult.statusWord, m_queryResult.valueQ16);
}

void InputControllerQueryPort::writeConsume(Value value) {
	m_registers.write(IO_INP_CONSUME, value);
	const std::string& actionNames = m_strings.toString(m_registers.state.consumeStringId);
	m_actionTable.consumeActions(static_cast<i32>(m_registers.state.player), actionNames);
}

} // namespace bmsx
