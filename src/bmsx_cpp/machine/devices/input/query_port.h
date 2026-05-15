#pragma once

#include "machine/cpu/cpu.h"
#include "machine/devices/input/action_table.h"

namespace bmsx {

class InputControllerRegisterFile;
class Memory;
class StringPool;

class InputControllerQueryPort {
public:
	InputControllerQueryPort(Memory& memory, const StringPool& strings, InputControllerRegisterFile& registers, InputControllerActionTable& actionTable);

	static void writeQueryThunk(void* context, u32 addr, Value value);
	static void writeConsumeThunk(void* context, u32 addr, Value value);

	void writeQuery(Value value);
	void writeConsume(Value value);

private:
	Memory& m_memory;
	const StringPool& m_strings;
	InputControllerRegisterFile& m_registers;
	InputControllerActionTable& m_actionTable;
	InputControllerQueryResult m_queryResult;
};

} // namespace bmsx
