import {
	InputControllerGamepadAxis,
	InputControllerGamepadButtonBit,
} from '../../../machine/ts/machine/devices/input/contracts';
import {
	GAMEPAD_REMAP_UNBOUND,
	type GamepadPortRemap,
} from './gamepad_port_remap';

type ButtonChoice = {
	readonly label: string;
	readonly button: InputControllerGamepadButtonBit | typeof GAMEPAD_REMAP_UNBOUND;
};

type TriggerChoice = ButtonChoice & {
	readonly axis: InputControllerGamepadAxis | typeof GAMEPAD_REMAP_UNBOUND;
};

type StickChoice = ButtonChoice & {
	readonly axisX: InputControllerGamepadAxis | typeof GAMEPAD_REMAP_UNBOUND;
	readonly axisY: InputControllerGamepadAxis | typeof GAMEPAD_REMAP_UNBOUND;
};

type ButtonControl = {
	readonly kind: 'button';
	readonly label: string;
	readonly targetButton: InputControllerGamepadButtonBit;
	readonly choices: readonly ButtonChoice[];
};

type TriggerControl = {
	readonly kind: 'trigger';
	readonly label: string;
	readonly targetButton: InputControllerGamepadButtonBit;
	readonly targetAxis: InputControllerGamepadAxis;
	readonly choices: readonly TriggerChoice[];
};

type StickControl = {
	readonly kind: 'stick';
	readonly label: string;
	readonly targetButton: InputControllerGamepadButtonBit;
	readonly targetAxisX: InputControllerGamepadAxis;
	readonly targetAxisY: InputControllerGamepadAxis;
	readonly choices: readonly StickChoice[];
};

export type GamepadRemapControl = ButtonControl | TriggerControl | StickControl;

const BUTTON_LEFT_TRIGGER = InputControllerGamepadButtonBit.LeftTrigger;
const BUTTON_RIGHT_TRIGGER = InputControllerGamepadButtonBit.RightTrigger;
const BUTTON_LEFT_STICK = InputControllerGamepadButtonBit.LeftStick;
const BUTTON_RIGHT_STICK = InputControllerGamepadButtonBit.RightStick;

const BUTTON_CHOICES: readonly ButtonChoice[] = [
	{ label: 'NONE', button: GAMEPAD_REMAP_UNBOUND },
	{ label: 'A', button: InputControllerGamepadButtonBit.A },
	{ label: 'B', button: InputControllerGamepadButtonBit.B },
	{ label: 'X', button: InputControllerGamepadButtonBit.X },
	{ label: 'Y', button: InputControllerGamepadButtonBit.Y },
	{ label: 'LB', button: InputControllerGamepadButtonBit.LeftBumper },
	{ label: 'RB', button: InputControllerGamepadButtonBit.RightBumper },
	{ label: 'LT', button: BUTTON_LEFT_TRIGGER },
	{ label: 'RT', button: BUTTON_RIGHT_TRIGGER },
	{ label: 'SELECT', button: InputControllerGamepadButtonBit.Select },
	{ label: 'START', button: InputControllerGamepadButtonBit.Start },
	{ label: 'L3', button: BUTTON_LEFT_STICK },
	{ label: 'R3', button: BUTTON_RIGHT_STICK },
	{ label: 'UP', button: InputControllerGamepadButtonBit.Up },
	{ label: 'DOWN', button: InputControllerGamepadButtonBit.Down },
	{ label: 'LEFT', button: InputControllerGamepadButtonBit.Left },
	{ label: 'RIGHT', button: InputControllerGamepadButtonBit.Right },
	{ label: 'HOME', button: InputControllerGamepadButtonBit.Home },
	{ label: 'TOUCH', button: InputControllerGamepadButtonBit.Touchpad },
];

const TRIGGER_CHOICES: readonly TriggerChoice[] = [
	{ label: 'NONE', button: GAMEPAD_REMAP_UNBOUND, axis: GAMEPAD_REMAP_UNBOUND },
	{
		label: 'LT',
		button: BUTTON_LEFT_TRIGGER,
		axis: InputControllerGamepadAxis.LeftTrigger,
	},
	{
		label: 'RT',
		button: BUTTON_RIGHT_TRIGGER,
		axis: InputControllerGamepadAxis.RightTrigger,
	},
];

const STICK_CHOICES: readonly StickChoice[] = [
	{
		label: 'NONE',
		button: GAMEPAD_REMAP_UNBOUND,
		axisX: GAMEPAD_REMAP_UNBOUND,
		axisY: GAMEPAD_REMAP_UNBOUND,
	},
	{
		label: 'LEFT STICK',
		button: BUTTON_LEFT_STICK,
		axisX: InputControllerGamepadAxis.LeftX,
		axisY: InputControllerGamepadAxis.LeftY,
	},
	{
		label: 'RIGHT STICK',
		button: BUTTON_RIGHT_STICK,
		axisX: InputControllerGamepadAxis.RightX,
		axisY: InputControllerGamepadAxis.RightY,
	},
];

export const GAMEPAD_REMAP_CONTROLS: readonly GamepadRemapControl[] = [
	{ kind: 'button', label: 'A', targetButton: InputControllerGamepadButtonBit.A, choices: BUTTON_CHOICES },
	{ kind: 'button', label: 'B', targetButton: InputControllerGamepadButtonBit.B, choices: BUTTON_CHOICES },
	{ kind: 'button', label: 'X', targetButton: InputControllerGamepadButtonBit.X, choices: BUTTON_CHOICES },
	{ kind: 'button', label: 'Y', targetButton: InputControllerGamepadButtonBit.Y, choices: BUTTON_CHOICES },
	{ kind: 'button', label: 'LB', targetButton: InputControllerGamepadButtonBit.LeftBumper, choices: BUTTON_CHOICES },
	{ kind: 'button', label: 'RB', targetButton: InputControllerGamepadButtonBit.RightBumper, choices: BUTTON_CHOICES },
	{
		kind: 'trigger',
		label: 'LT',
		targetButton: BUTTON_LEFT_TRIGGER,
		targetAxis: InputControllerGamepadAxis.LeftTrigger,
		choices: TRIGGER_CHOICES,
	},
	{
		kind: 'trigger',
		label: 'RT',
		targetButton: BUTTON_RIGHT_TRIGGER,
		targetAxis: InputControllerGamepadAxis.RightTrigger,
		choices: TRIGGER_CHOICES,
	},
	{ kind: 'button', label: 'SELECT', targetButton: InputControllerGamepadButtonBit.Select, choices: BUTTON_CHOICES },
	{ kind: 'button', label: 'START', targetButton: InputControllerGamepadButtonBit.Start, choices: BUTTON_CHOICES },
	{
		kind: 'stick',
		label: 'LEFT STICK',
		targetButton: BUTTON_LEFT_STICK,
		targetAxisX: InputControllerGamepadAxis.LeftX,
		targetAxisY: InputControllerGamepadAxis.LeftY,
		choices: STICK_CHOICES,
	},
	{
		kind: 'stick',
		label: 'RIGHT STICK',
		targetButton: BUTTON_RIGHT_STICK,
		targetAxisX: InputControllerGamepadAxis.RightX,
		targetAxisY: InputControllerGamepadAxis.RightY,
		choices: STICK_CHOICES,
	},
	{ kind: 'button', label: 'UP', targetButton: InputControllerGamepadButtonBit.Up, choices: BUTTON_CHOICES },
	{ kind: 'button', label: 'DOWN', targetButton: InputControllerGamepadButtonBit.Down, choices: BUTTON_CHOICES },
	{ kind: 'button', label: 'LEFT', targetButton: InputControllerGamepadButtonBit.Left, choices: BUTTON_CHOICES },
	{ kind: 'button', label: 'RIGHT', targetButton: InputControllerGamepadButtonBit.Right, choices: BUTTON_CHOICES },
	{ kind: 'button', label: 'HOME', targetButton: InputControllerGamepadButtonBit.Home, choices: BUTTON_CHOICES },
	{ kind: 'button', label: 'TOUCH', targetButton: InputControllerGamepadButtonBit.Touchpad, choices: BUTTON_CHOICES },
];

export function gamepadRemapChoiceIndex(
	remap: GamepadPortRemap,
	control: GamepadRemapControl,
): number {
	const source = remap.buttonSource(control.targetButton);
	if (source === GAMEPAD_REMAP_UNBOUND) {
		return 0;
	}
	switch (control.kind) {
		case 'button':
			return source + 1;
		case 'trigger':
			return source - BUTTON_LEFT_TRIGGER + 1;
		case 'stick':
			return source - BUTTON_LEFT_STICK + 1;
	}
}

export function setGamepadRemapChoice(
	remap: GamepadPortRemap,
	control: GamepadRemapControl,
	choiceIndex: number,
): void {
	switch (control.kind) {
		case 'button': {
			const choice = control.choices[choiceIndex];
			remap.setButtonSource(control.targetButton, choice.button);
			return;
		}
		case 'trigger': {
			const choice = control.choices[choiceIndex];
			remap.setButtonSource(control.targetButton, choice.button);
			remap.setAxisSource(control.targetAxis, choice.axis);
			return;
		}
		case 'stick': {
			const choice = control.choices[choiceIndex];
			remap.setButtonSource(control.targetButton, choice.button);
			remap.setAxisSource(control.targetAxisX, choice.axisX);
			remap.setAxisSource(control.targetAxisY, choice.axisY);
			return;
		}
	}
}
