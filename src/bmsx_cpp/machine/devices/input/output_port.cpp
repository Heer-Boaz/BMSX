#include "machine/devices/input/output_port.h"

#include "input/manager.h"
#include "input/player.h"
#include "machine/devices/input/contracts.h"

namespace bmsx {

InputControllerOutputPort::InputControllerOutputPort(Input& input)
	: m_input(input) {
}

u32 InputControllerOutputPort::readStatus(u32 player) const {
	return m_input.getPlayerInput(static_cast<i32>(player))->supportsVibrationEffect() ? INP_OUTPUT_STATUS_SUPPORTED : 0u;
}

void InputControllerOutputPort::apply(u32 player, u32 intensityQ16, u32 durationMs) {
	VibrationParams params;
	params.duration = static_cast<f64>(durationMs);
	params.intensity = decodeInputOutputIntensityQ16(intensityQ16);
	m_input.getPlayerInput(static_cast<i32>(player))->applyVibrationEffect(params);
}

} // namespace bmsx
