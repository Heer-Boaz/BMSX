#include "machine/devices/input/output_port.h"

#include "machine/bus/io.h"
#include "machine/devices/input/contracts.h"
#include "machine/devices/input/registers.h"
#include "machine/memory/memory.h"

namespace bmsx {

InputControllerOutputPort::InputControllerOutputPort(InputControllerInputSource& input, const InputControllerRegisterFile& registers, Memory& memory)
	: m_input(input)
	, m_registers(registers)
	, m_memory(memory) {
}

void InputControllerOutputPort::writeOutputControlRegisterThunk([[maybe_unused]] u32 addr, Value value) {
	const u32 command = toU32(value);
	if (command == INP_OUTPUT_CTRL_APPLY) {
		m_input.applyInputControllerVibrationEffect(
			m_registers.selectedPadIndex(),
			static_cast<f64>(m_registers.state.outputDurationMs),
			decodeInputOutputIntensityQ16(m_registers.state.outputIntensityQ16)
		);
	}
	m_memory.writeIoValue(IO_INP_OUTPUT_CTRL, valueNumber(0.0));
}

} // namespace bmsx
