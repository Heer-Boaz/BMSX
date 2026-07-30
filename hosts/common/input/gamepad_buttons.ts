import { InputControllerGamepadButtonBit } from '../../../machine/ts/machine/devices/input/contracts';

export const GAMEPAD_BUTTON_IDS = [
	'a',
	'b',
	'x',
	'y',
	'lb',
	'rb',
	'lt',
	'rt',
	'select',
	'start',
	'ls',
	'rs',
	'up',
	'down',
	'left',
	'right',
	'home',
	'touch',
] as const;

export function inputControllerGamepadButtonBit(code: string): InputControllerGamepadButtonBit | -1 {
	switch (code) {
		case 'a': return InputControllerGamepadButtonBit.A;
		case 'b': return InputControllerGamepadButtonBit.B;
		case 'x': return InputControllerGamepadButtonBit.X;
		case 'y': return InputControllerGamepadButtonBit.Y;
		case 'lb': return InputControllerGamepadButtonBit.LeftBumper;
		case 'rb': return InputControllerGamepadButtonBit.RightBumper;
		case 'lt': return InputControllerGamepadButtonBit.LeftTrigger;
		case 'rt': return InputControllerGamepadButtonBit.RightTrigger;
		case 'select': return InputControllerGamepadButtonBit.Select;
		case 'start': return InputControllerGamepadButtonBit.Start;
		case 'ls': return InputControllerGamepadButtonBit.LeftStick;
		case 'rs': return InputControllerGamepadButtonBit.RightStick;
		case 'up': return InputControllerGamepadButtonBit.Up;
		case 'down': return InputControllerGamepadButtonBit.Down;
		case 'left': return InputControllerGamepadButtonBit.Left;
		case 'right': return InputControllerGamepadButtonBit.Right;
		case 'home': return InputControllerGamepadButtonBit.Home;
		case 'touch': return InputControllerGamepadButtonBit.Touchpad;
	}
	return -1;
}
