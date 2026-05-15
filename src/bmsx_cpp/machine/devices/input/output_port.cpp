#include "machine/devices/input/output_port.h"

#include "input/manager.h"
#include "input/player.h"
#include "machine/bus/io.h"
#include "machine/devices/input/contracts.h"
#include "machine/devices/input/registers.h"
#include "machine/memory/memory.h"

#include <stdexcept>

namespace bmsx {

InputControllerOutputPort::InputControllerOutputPort(Input& input, const InputControllerRegisterFile& registers, Memory& memory)
	: m_input(input)
	, m_registers(registers)
	, m_memory(memory) {
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk into the input output-port instance.
Value InputControllerOutputPort::readRegisterThunk(void* context, u32 addr) {
	return static_cast<InputControllerOutputPort*>(context)->readRegister(addr);
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk into the input output-port instance.
void InputControllerOutputPort::writeOutputControlRegisterThunk(void* context, u32, Value value) {
	static_cast<InputControllerOutputPort*>(context)->writeOutputControlRegister(value);
}

u32 InputControllerOutputPort::readStatus(u32 player) const {
	return m_input.getPlayerInput(static_cast<i32>(player))->supportsVibrationEffect() ? INP_OUTPUT_STATUS_SUPPORTED : 0u;
}

Value InputControllerOutputPort::readRegister(u32 addr) const {
	switch (addr) {
		case IO_INP_OUTPUT_STATUS:
			return valueNumber(static_cast<double>(readStatus(m_registers.state.player)));
		case IO_INP_OUTPUT_CTRL:
			return valueNumber(0.0);
	}
	throw std::runtime_error("ICU output register read is not mapped.");
}

void InputControllerOutputPort::writeControl(u32 command) {
	switch (command) {
		case INP_OUTPUT_CTRL_APPLY:
			apply(m_registers.state.player, m_registers.state.outputIntensityQ16, m_registers.state.outputDurationMs);
			return;
	}
}

void InputControllerOutputPort::writeOutputControlRegister(Value value) {
	writeControl(toU32(value));
	m_memory.writeIoValue(IO_INP_OUTPUT_CTRL, valueNumber(0.0));
}

void InputControllerOutputPort::apply(u32 player, u32 intensityQ16, u32 durationMs) {
	VibrationParams params;
	params.duration = static_cast<f64>(durationMs);
	params.intensity = decodeInputOutputIntensityQ16(intensityQ16);
	m_input.getPlayerInput(static_cast<i32>(player))->applyVibrationEffect(params);
}

} // namespace bmsx
