import {
	IO_INP_CTRL,
	IO_INP_KEYS,
	IO_INP_OUTPUT_DURATION_MS,
	IO_INP_OUTPUT_INTENSITY_Q16,
	IO_INP_OUTPUT_PORT,
	IO_INP_OUTPUT_STATUS,
	IO_INP_PADS,
	IO_INP_PAD_WORD_COUNT,
	IO_INP_POINTER_BUTTONS,
	IO_INP_POINTER_WHEEL,
	IO_INP_POINTER_X,
	IO_INP_POINTER_Y,
} from '../../bus/io';
import { IO_WORD_SIZE } from '../../memory/map';
import { encodeSignedFix16 } from '../../common/numeric';
import type { Value } from '../../cpu/cpu';
import { Memory } from '../../memory/memory';
import {
	INPUT_CONTROLLER_KEY_WORD_COUNT,
	INPUT_CONTROLLER_PAD_AXIS_COUNT,
	INPUT_CONTROLLER_PAD_COUNT,
	type InputControllerSnapshot,
} from './contracts';

export type InputControllerRegisterState = {
	ctrl: number;
	keyWords: number[]; // INPUT_CONTROLLER_KEY_WORD_COUNT words
	pointerButtons: number;
	pointerXQ16: number;
	pointerYQ16: number;
	pointerWheelQ16: number;
	padButtons: number[]; // INPUT_CONTROLLER_PAD_COUNT words
	padAxesQ16: number[]; // INPUT_CONTROLLER_PAD_COUNT * INPUT_CONTROLLER_PAD_AXIS_COUNT words
	outputPort: number;
	outputIntensityQ16: number;
	outputDurationMs: number;
	outputStatus: number; // bit per pad: rumble supported
};

export function createInputControllerRegisterState(): InputControllerRegisterState {
	return {
		ctrl: 0,
		keyWords: new Array<number>(INPUT_CONTROLLER_KEY_WORD_COUNT).fill(0),
		pointerButtons: 0,
		pointerXQ16: 0,
		pointerYQ16: 0,
		pointerWheelQ16: 0,
		padButtons: new Array<number>(INPUT_CONTROLLER_PAD_COUNT).fill(0),
		padAxesQ16: new Array<number>(INPUT_CONTROLLER_PAD_COUNT * INPUT_CONTROLLER_PAD_AXIS_COUNT).fill(0),
		outputPort: 0,
		outputIntensityQ16: 0,
		outputDurationMs: 0,
		outputStatus: 0,
	};
}

export class InputControllerRegisterFile {
	public state = createInputControllerRegisterState();

	public reset(): void {
		this.state = createInputControllerRegisterState();
	}

	public captureState(): InputControllerRegisterState {
		return {
			...this.state,
			keyWords: [...this.state.keyWords],
			padButtons: [...this.state.padButtons],
			padAxesQ16: [...this.state.padAxesQ16],
		};
	}

	public restoreState(state: InputControllerRegisterState): void {
		this.state = {
			...state,
			keyWords: [...state.keyWords],
			padButtons: [...state.padButtons],
			padAxesQ16: [...state.padAxesQ16],
		};
	}

	public selectedPadIndex(): number {
		return (this.state.outputPort >>> 0) & (INPUT_CONTROLLER_PAD_COUNT - 1);
	}

	public latchSnapshot(snapshot: InputControllerSnapshot): void {
		const state = this.state;
		for (let i = 0; i < INPUT_CONTROLLER_KEY_WORD_COUNT; i += 1) {
			state.keyWords[i] = snapshot.keyWords[i] >>> 0;
		}
		state.pointerButtons = snapshot.pointerButtons >>> 0;
		state.pointerXQ16 = encodeSignedFix16(snapshot.pointerX);
		state.pointerYQ16 = encodeSignedFix16(snapshot.pointerY);
		state.pointerWheelQ16 = encodeSignedFix16(snapshot.pointerWheel);
		state.outputStatus = snapshot.rumbleSupportMask >>> 0;
		for (let pad = 0; pad < INPUT_CONTROLLER_PAD_COUNT; pad += 1) {
			const padSnapshot = snapshot.pads[pad];
			state.padButtons[pad] = padSnapshot.buttons >>> 0;
			for (let axis = 0; axis < INPUT_CONTROLLER_PAD_AXIS_COUNT; axis += 1) {
				state.padAxesQ16[pad * INPUT_CONTROLLER_PAD_AXIS_COUNT + axis] = encodeSignedFix16(padSnapshot.axes[axis]);
			}
		}
	}

	public write(addr: number, value: Value): void {
		switch (addr) {
			case IO_INP_CTRL:
				this.state.ctrl = (value as number) >>> 0;
				return;
			case IO_INP_OUTPUT_PORT:
				this.state.outputPort = (value as number) >>> 0;
				return;
			case IO_INP_OUTPUT_INTENSITY_Q16:
				this.state.outputIntensityQ16 = (value as number) >>> 0;
				return;
			case IO_INP_OUTPUT_DURATION_MS:
				this.state.outputDurationMs = (value as number) >>> 0;
				return;
		}
	}

	public mirror(memory: Memory): void {
		memory.writeIoValue(IO_INP_CTRL, this.state.ctrl);
		for (let i = 0; i < INPUT_CONTROLLER_KEY_WORD_COUNT; i += 1) {
			memory.writeIoValue(IO_INP_KEYS + i * IO_WORD_SIZE, this.state.keyWords[i]);
		}
		memory.writeIoValue(IO_INP_POINTER_BUTTONS, this.state.pointerButtons);
		memory.writeIoValue(IO_INP_POINTER_X, this.state.pointerXQ16);
		memory.writeIoValue(IO_INP_POINTER_Y, this.state.pointerYQ16);
		memory.writeIoValue(IO_INP_POINTER_WHEEL, this.state.pointerWheelQ16);
		for (let pad = 0; pad < INPUT_CONTROLLER_PAD_COUNT; pad += 1) {
			const padBase = IO_INP_PADS + pad * IO_INP_PAD_WORD_COUNT * IO_WORD_SIZE;
			memory.writeIoValue(padBase, this.state.padButtons[pad]);
			for (let axis = 0; axis < INPUT_CONTROLLER_PAD_AXIS_COUNT; axis += 1) {
				memory.writeIoValue(padBase + (axis + 1) * IO_WORD_SIZE, this.state.padAxesQ16[pad * INPUT_CONTROLLER_PAD_AXIS_COUNT + axis]);
			}
		}
		memory.writeIoValue(IO_INP_OUTPUT_PORT, this.state.outputPort);
		memory.writeIoValue(IO_INP_OUTPUT_INTENSITY_Q16, this.state.outputIntensityQ16);
		memory.writeIoValue(IO_INP_OUTPUT_DURATION_MS, this.state.outputDurationMs);
		memory.writeIoValue(IO_INP_OUTPUT_STATUS, this.state.outputStatus);
	}
}
