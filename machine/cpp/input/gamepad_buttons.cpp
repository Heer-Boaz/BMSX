#include "input/gamepad_buttons.h"

#include "machine/devices/input/contracts.h"

namespace bmsx {

i32 inputControllerGamepadButtonBit(const std::string& code) {
	for (int bit = 0; bit < INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_COUNT; bit += 1) {
		if (code == INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_IDS[bit]) {
			return bit;
		}
	}
	return -1;
}

} // namespace bmsx
