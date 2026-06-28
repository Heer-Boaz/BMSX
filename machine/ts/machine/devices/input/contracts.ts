import { FIX16_ONE } from '../../common/numeric';

// Raw ICU snapshot contract. The ICU latches one full input snapshot per armed
// VBlank edge into plain MMIO words; it carries no key names, mappings, or
// action semantics. Keyboard bits are indexed by USB HID usage IDs
// (usage page 0x07); pad button bits follow INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_IDS.

export const INPUT_CONTROLLER_KEY_WORD_COUNT = 8; // 256 HID usage bits
export const INPUT_CONTROLLER_PAD_COUNT = 4;
export const INPUT_CONTROLLER_PAD_AXIS_COUNT = 6; // lx, ly, rx, ry, lt, rt

// Canonical pad button bit order: bit i in the pad buttons word.
export const INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_IDS = [
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
export const INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_COUNT = INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_IDS.length;

// Pointer button bit order mirrors the W3C MouseEvent.button index order.
export const INP_POINTER_BUTTON_PRIMARY = 0;
export const INP_POINTER_BUTTON_AUX = 1;
export const INP_POINTER_BUTTON_SECONDARY = 2;
export const INP_POINTER_BUTTON_BACK = 3;
export const INP_POINTER_BUTTON_FORWARD = 4;

export type InputControllerPadSnapshot = {
	buttons: number;
	axes: Float32Array; // INPUT_CONTROLLER_PAD_AXIS_COUNT floats: sticks in [-1,1], triggers in [0,1]
};

export type InputControllerPadSnapshots = [
	InputControllerPadSnapshot,
	InputControllerPadSnapshot,
	InputControllerPadSnapshot,
	InputControllerPadSnapshot,
];

export type InputControllerSnapshot = {
	keyWords: Uint32Array; // INPUT_CONTROLLER_KEY_WORD_COUNT words; bit = HID usage pressed
	pointerButtons: number;
	pointerX: number; // host pointer-space coordinates
	pointerY: number;
	pointerWheel: number;
	rumbleSupportMask: number; // bit per pad
	pads: InputControllerPadSnapshots;
};

function createInputControllerPadSnapshot(): InputControllerPadSnapshot {
	return { buttons: 0, axes: new Float32Array(INPUT_CONTROLLER_PAD_AXIS_COUNT) };
}

export function createInputControllerSnapshot(): InputControllerSnapshot {
	return {
		keyWords: new Uint32Array(INPUT_CONTROLLER_KEY_WORD_COUNT),
		pointerButtons: 0,
		pointerX: 0,
		pointerY: 0,
		pointerWheel: 0,
		rumbleSupportMask: 0,
		pads: [
			createInputControllerPadSnapshot(),
			createInputControllerPadSnapshot(),
			createInputControllerPadSnapshot(),
			createInputControllerPadSnapshot(),
		],
	};
}

export interface InputControllerInputSource {
	sampleInputControllerSnapshot(currentTimeMs: number, snapshot: InputControllerSnapshot): void;
	applyInputControllerVibrationEffect(padIndex: number, durationMs: number, intensity: number): void;
}

export const INPUT_CONTROLLER_OUTPUT_INTENSITY_Q16_ONE = FIX16_ONE;
export const INP_OUTPUT_CTRL_APPLY = 1;

export function decodeInputOutputIntensityQ16(value: number): number {
	return (value >>> 0) / INPUT_CONTROLLER_OUTPUT_INTENSITY_Q16_ONE;
}
