import {
	createInputControllerSnapshot,
	INPUT_CONTROLLER_KEY_WORD_COUNT,
	INPUT_CONTROLLER_PAD_AXIS_COUNT,
	INPUT_CONTROLLER_PAD_COUNT,
	type InputControllerSnapshot,
} from '../../../machine/ts/machine/devices/input/contracts';
import { inputControllerGamepadButtonBit } from './gamepad_buttons';
import { hidKeyUsageForCode } from './hid_keys';

/**
 * Retained, raw ICU input state for deterministic host-driven playback.
 *
 * Playback replaces the physical ICU view while active. Host shortcuts keep
 * using the physical PlayerInput graph, so test input cannot open host chrome
 * and physical input cannot leak into a recorded guest sequence.
 */
export class InputControllerPlayback {
	private readonly snapshot = createInputControllerSnapshot();

	public reset(): void {
		this.snapshot.keyWords.fill(0);
		this.snapshot.pointerButtons = 0;
		this.snapshot.pointerXQ16 = 0;
		this.snapshot.pointerYQ16 = 0;
		this.snapshot.pointerWheelQ16 = 0;
		this.snapshot.rumbleSupportMask = 0;
		for (let padIndex = 0; padIndex < INPUT_CONTROLLER_PAD_COUNT; padIndex += 1) {
			const pad = this.snapshot.pads[padIndex];
			pad.buttons = 0;
			pad.axesQ16.fill(0);
		}
	}

	public setKeyboardKey(code: string, down: boolean): void {
		const usage = hidKeyUsageForCode(code);
		if (usage < 0) {
			throw new Error(`Unknown keyboard input code '${code}'.`);
		}
		const wordIndex = usage >>> 5;
		const mask = 1 << (usage & 31);
		const words = this.snapshot.keyWords;
		words[wordIndex] = down
			? (words[wordIndex] | mask) >>> 0
			: (words[wordIndex] & ~mask) >>> 0;
	}

	public setGamepadButton(padIndex: number, code: string, down: boolean): void {
		if (padIndex < 0 || padIndex >= INPUT_CONTROLLER_PAD_COUNT) {
			throw new Error(`Input controller pad index ${padIndex} is out of range.`);
		}
		const bit = inputControllerGamepadButtonBit(code);
		if (bit < 0) {
			throw new Error(`Unknown gamepad input code '${code}'.`);
		}
		const mask = 1 << bit;
		const pad = this.snapshot.pads[padIndex];
		pad.buttons = down
			? (pad.buttons | mask) >>> 0
			: (pad.buttons & ~mask) >>> 0;
	}

	public writeInputControllerSnapshot(target: InputControllerSnapshot): void {
		for (let wordIndex = 0; wordIndex < INPUT_CONTROLLER_KEY_WORD_COUNT; wordIndex += 1) {
			target.keyWords[wordIndex] = this.snapshot.keyWords[wordIndex];
		}
		target.pointerButtons = this.snapshot.pointerButtons;
		target.pointerXQ16 = this.snapshot.pointerXQ16;
		target.pointerYQ16 = this.snapshot.pointerYQ16;
		target.pointerWheelQ16 = this.snapshot.pointerWheelQ16;
		target.rumbleSupportMask = this.snapshot.rumbleSupportMask;
		for (let padIndex = 0; padIndex < INPUT_CONTROLLER_PAD_COUNT; padIndex += 1) {
			const sourcePad = this.snapshot.pads[padIndex];
			const targetPad = target.pads[padIndex];
			targetPad.buttons = sourcePad.buttons;
			for (let axisIndex = 0; axisIndex < INPUT_CONTROLLER_PAD_AXIS_COUNT; axisIndex += 1) {
				targetPad.axesQ16[axisIndex] = sourcePad.axesQ16[axisIndex];
			}
		}
	}
}
