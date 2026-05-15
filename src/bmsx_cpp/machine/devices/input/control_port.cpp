#include "machine/devices/input/control_port.h"

#include "machine/bus/io.h"
#include "machine/devices/input/action_table.h"
#include "machine/devices/input/contracts.h"
#include "machine/devices/input/registers.h"
#include "machine/devices/input/sample_latch.h"

namespace bmsx {

InputControllerControlPort::InputControllerControlPort(
	Memory& memory,
	InputControllerRegisterFile& registers,
	InputControllerActionTable& actionTable,
	InputControllerSampleLatch& sampleLatch
)
	: m_memory(memory)
	, m_registers(registers)
	, m_actionTable(actionTable)
	, m_sampleLatch(sampleLatch) {
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk into the input control-port instance.
void InputControllerControlPort::writeControlThunk(void* context, u32, Value value) {
	static_cast<InputControllerControlPort*>(context)->writeControl(value);
}

void InputControllerControlPort::writeControl(Value value) {
	m_registers.write(IO_INP_CTRL, value);
	switch (m_registers.state.ctrl) {
		case INP_CTRL_COMMIT:
			m_actionTable.commitAction(m_registers.selectedPlayerIndex(), m_registers.state.actionStringId, m_registers.state.bindStringId);
			return;
		case INP_CTRL_ARM:
			m_sampleLatch.arm();
			return;
		case INP_CTRL_RESET:
			m_actionTable.resetActions(m_registers.selectedPlayerIndex());
			m_registers.writeResult(m_memory, 0u, 0u);
			return;
	}
}

} // namespace bmsx
