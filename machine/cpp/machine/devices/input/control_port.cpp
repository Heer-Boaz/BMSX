#include "machine/devices/input/control_port.h"

#include "machine/bus/io.h"
#include "machine/devices/input/registers.h"
#include "machine/devices/input/sample_latch.h"
#include "machine/memory/memory.h"

namespace bmsx {

InputControllerControlPort::InputControllerControlPort(
	Memory& memory,
	InputControllerRegisterFile& registers,
	InputControllerSampleLatch& sampleLatch
)
	: m_memory(memory)
	, m_registers(registers)
	, m_sampleLatch(sampleLatch) {
}

void InputControllerControlPort::writeControlThunk(void* context, u32, Value value) {
	static_cast<InputControllerControlPort*>(context)->writeControl(value);
}

void InputControllerControlPort::writeControl(Value value) {
	m_registers.write(IO_INP_CTRL, value);
	switch (m_registers.state.ctrl) {
		case INP_CTRL_ARM:
			m_sampleLatch.arm();
			return;
		case INP_CTRL_RESET:
			m_sampleLatch.reset();
			m_registers.reset();
			m_registers.mirror(m_memory);
			m_memory.writeIoValue(IO_INP_STATUS, valueNumber(static_cast<double>(m_sampleLatch.sequence())));
			return;
	}
}

} // namespace bmsx
