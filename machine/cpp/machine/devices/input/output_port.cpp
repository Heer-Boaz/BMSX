#include "machine/devices/input/output_port.h"

#include "spec/bmsx/io.h"
#include "machine/devices/input/contracts.h"
#include "machine/devices/input/registers.h"
#include "machine/memory/memory.h"

namespace bmsx {

InputControllerOutputPort::InputControllerOutputPort(InputControllerInputSource& input, const InputControllerRegisterFile& registers, Memory& memory)
	: m_input(input)
	, m_registers(registers)
	, m_memory(memory) {
}

void InputControllerOutputPort::writeOutputControlRegisterThunk([[maybe_unused]] u32 addr, u32 value) {
	if (value == INP_OUTPUT_CTRL_APPLY) {
		m_input.applyInputControllerVibrationEffect(
			m_registers.selectedPadIndex(),
			static_cast<f64>(m_registers.state.outputDurationMs),
			decodeInputOutputIntensityQ16(m_registers.state.outputIntensityQ16)
		);
	}
	m_memory.writeIoU32(IO_INP_OUTPUT_CTRL, 0u);
}

} // namespace bmsx
