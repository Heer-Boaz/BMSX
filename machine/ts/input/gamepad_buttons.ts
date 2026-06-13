import {
	INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_COUNT,
	INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_IDS,
} from '../machine/devices/input/contracts';

export function inputControllerGamepadButtonBit(code: string): number {
	for (let bit = 0; bit < INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_COUNT; bit += 1) {
		if (INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_IDS[bit] === code) {
			return bit;
		}
	}
	return -1;
}
