import { getPressedState, makeButtonState } from './manager';
import type { ButtonState, KeyOrButtonId2ButtonState, PointerInputHandler } from './models';
import type { HostClock } from '../clock';
import {
	INP_POINTER_BUTTON_AUX,
	INP_POINTER_BUTTON_BACK,
	INP_POINTER_BUTTON_FORWARD,
	INP_POINTER_BUTTON_PRIMARY,
	INP_POINTER_BUTTON_SECONDARY,
	type InputControllerSnapshot,
} from '../../../machine/ts/machine/devices/input/contracts';
import { encodeSignedFix16 } from '../../../machine/ts/machine/common/numeric';

const POINTER_DEFAULT_CODES = [
	'pointer_primary',
	'pointer_aux',
	'pointer_secondary',
	'pointer_back',
	'pointer_forward',
	'pointer_position',
	'pointer_delta',
	'pointer_wheel',
] as const;
const POINTER_BUTTON_CODE_COUNT = INP_POINTER_BUTTON_FORWARD + 1;

function pointerButtonBit(code: string): number {
	switch (code) {
		case 'pointer_primary': return INP_POINTER_BUTTON_PRIMARY;
		case 'pointer_aux': return INP_POINTER_BUTTON_AUX;
		case 'pointer_secondary': return INP_POINTER_BUTTON_SECONDARY;
		case 'pointer_back': return INP_POINTER_BUTTON_BACK;
		case 'pointer_forward': return INP_POINTER_BUTTON_FORWARD;
		default: return -1;
	}
}

export class PointerInput implements PointerInputHandler {
	private buttonStates: KeyOrButtonId2ButtonState = {};
	private nextPressId = 1;
	private readonly pointerPosition: [number, number] = [0, 0];
	private readonly pointerDelta: [number, number] = [0, 0];
	private lastPositionX = 0;
	private lastPositionY = 0;
	private lastPositionValid = false;
	private pendingButtonPressEdges = 0;
	private pendingButtonReleaseEdges = 0;
	private pendingDeltaX = 0;
	private pendingDeltaY = 0;
	private pendingDeltaTimestamp = 0;
	private pendingWheel = 0;
	private pendingWheelTimestamp = 0;
	private inputControllerButtons = 0;
	private routedInputControllerButtons = 0;
	private inputControllerXQ16 = 0;
	private inputControllerYQ16 = 0;
	private inputControllerWheelQ16 = 0;

	constructor(
		private readonly clock: HostClock,
		public readonly deviceId: string = 'pointer:0',
	) {
		this.reset();
	}

	public pollInput(): void {
		const now = this.clock.now();
		this.routedInputControllerButtons = this.inputControllerButtons;
		const delta = this.buttonStates['pointer_delta'];
		const deltaX = this.pendingDeltaX;
		const deltaY = this.pendingDeltaY;
		const deltaMoved = deltaX !== 0 || deltaY !== 0;
		const deltaWasPressed = delta.pressed;
		this.pointerDelta[0] = deltaX;
		this.pointerDelta[1] = deltaY;
		delta.value = deltaMoved ? Math.hypot(deltaX, deltaY) : 0;
		delta.pressed = deltaMoved;
		delta.justpressed = deltaMoved && !deltaWasPressed;
		delta.justreleased = !deltaMoved && deltaWasPressed;
		delta.waspressed = delta.waspressed || deltaMoved;
		delta.wasreleased = delta.wasreleased || delta.justreleased;
		if (deltaMoved) {
			delta.timestamp = this.pendingDeltaTimestamp;
			delta.consumed = false;
			if (!deltaWasPressed) {
				delta.pressedAtMs = delta.timestamp;
				delta.releasedAtMs = 0;
			}
		} else if (deltaWasPressed) {
			delta.pressedAtMs = 0;
			delta.releasedAtMs = now;
		}
		this.pendingDeltaX = 0;
		this.pendingDeltaY = 0;

		const wheel = this.buttonStates['pointer_wheel'];
		const wheelDelta = this.pendingWheel;
		const wheelMoved = wheelDelta !== 0;
		const wheelWasPressed = wheel.pressed;
		wheel.value = wheelDelta;
		wheel.pressed = wheelMoved;
		wheel.justpressed = wheelMoved;
		wheel.justreleased = !wheelMoved && wheelWasPressed;
		wheel.waspressed = wheel.waspressed || wheelMoved;
		wheel.wasreleased = wheel.wasreleased || wheel.justreleased;
		if (wheelMoved) {
			wheel.timestamp = this.pendingWheelTimestamp;
			wheel.pressedAtMs = wheel.timestamp;
			wheel.releasedAtMs = 0;
			wheel.pressId = this.nextPressId++;
			wheel.consumed = false;
		} else if (wheelWasPressed) {
			wheel.pressedAtMs = 0;
			wheel.releasedAtMs = now;
		}
		this.inputControllerWheelQ16 = encodeSignedFix16(wheelDelta);
		this.pendingWheel = 0;

		for (let index = 0; index < POINTER_DEFAULT_CODES.length; index += 1) {
			const state = this.buttonStates[POINTER_DEFAULT_CODES[index]];
			state.consumed = false;
			if (index < POINTER_BUTTON_CODE_COUNT) {
				const mask = 1 << index;
				state.justpressed = (this.pendingButtonPressEdges & mask) !== 0;
				state.justreleased = (this.pendingButtonReleaseEdges & mask) !== 0;
			}
			if (state.pressed) {
				state.presstime = now - state.pressedAtMs;
			} else {
				state.presstime = null;
			}
			state.waspressed = state.waspressed || state.pressed;
			state.wasreleased = state.wasreleased || state.justreleased;
		}
		this.pendingButtonPressEdges = 0;
		this.pendingButtonReleaseEdges = 0;
	}

	public getButtonState(btn: string): ButtonState {
		return getPressedState(this.buttonStates, btn);
	}

	public get positionValid(): boolean {
		return this.lastPositionValid;
	}

	public writeInputControllerPointerSnapshot(snapshot: InputControllerSnapshot): void {
		snapshot.pointerButtons = (snapshot.pointerButtons | this.routedInputControllerButtons) >>> 0;
		snapshot.pointerXQ16 = this.inputControllerXQ16;
		snapshot.pointerYQ16 = this.inputControllerYQ16;
		snapshot.pointerWheelQ16 = this.inputControllerWheelQ16;
	}

	public ingestButton(code: string, down: boolean, value: number, timestamp: number, pressId: number): void {
		const target = getPressedState(this.buttonStates, code);
		const wasPressed = target.pressed;
		target.pressed = down;
		target.timestamp = timestamp;
		target.pressId = pressId;
		target.value = value;
		target.presstime = null;
		target.consumed = false;
		if (down) {
			if (!wasPressed) {
				target.waspressed = true;
				target.pressedAtMs = timestamp;
				target.releasedAtMs = 0;
			}
		} else if (wasPressed) {
			target.wasreleased = true;
			target.pressedAtMs = 0;
			target.releasedAtMs = timestamp;
		}
		const bit = pointerButtonBit(code);
		if (bit >= 0) {
			const mask = 1 << bit;
			if (down) {
				this.inputControllerButtons = (this.inputControllerButtons | mask) >>> 0;
				if (!wasPressed) {
					this.pendingButtonPressEdges = (this.pendingButtonPressEdges | mask) >>> 0;
				}
			} else {
				this.inputControllerButtons = (this.inputControllerButtons & ~mask) >>> 0;
				if (wasPressed) {
					this.pendingButtonReleaseEdges = (this.pendingButtonReleaseEdges | mask) >>> 0;
				}
			}
		}
	}

	public ingestAxis2(code: string, x: number, y: number, timestamp: number): void {
		const current = getPressedState(this.buttonStates, code);
		const dx = this.lastPositionValid ? (x - this.lastPositionX) : 0;
		const dy = this.lastPositionValid ? (y - this.lastPositionY) : 0;
		this.lastPositionX = x;
		this.lastPositionY = y;
		this.lastPositionValid = true;
		let value2d = current.value2d;
		if (!value2d) {
			value2d = code === 'pointer_position' ? this.pointerPosition : [0, 0];
			current.value2d = value2d;
		}
		value2d[0] = x;
		value2d[1] = y;
		current.timestamp = timestamp;
		if (code === 'pointer_position') {
			this.inputControllerXQ16 = encodeSignedFix16(x);
			this.inputControllerYQ16 = encodeSignedFix16(y);
		}

		this.pendingDeltaX += dx;
		this.pendingDeltaY += dy;
		this.pendingDeltaTimestamp = timestamp;
	}

	public ingestAxis1(code: string, x: number, timestamp: number): void {
		const current = getPressedState(this.buttonStates, code);
		current.timestamp = timestamp;
		if (code === 'pointer_wheel') {
			this.pendingWheel += x;
			this.pendingWheelTimestamp = timestamp;
			return;
		}
		current.value = x;
	}

	public consumeButton(button: string): void {
		const state = this.buttonStates[button];
		if (state) {
			state.consumed = true;
			if (button === 'pointer_wheel') {
				state.pressed = false;
				state.justpressed = false;
				state.justreleased = false;
			}
		}
		const bit = pointerButtonBit(button);
		if (bit >= 0) {
			this.routedInputControllerButtons = (
				this.routedInputControllerButtons & ~(1 << bit)
			) >>> 0;
		}
	}

	public reset(): void {
		this.buttonStates = {};
		for (let i = 0; i < POINTER_DEFAULT_CODES.length; i += 1) {
			const code = POINTER_DEFAULT_CODES[i];
			const state = makeButtonState();
			if (code === 'pointer_position') {
				state.value2d = this.pointerPosition;
			} else if (code === 'pointer_delta') {
				state.value2d = this.pointerDelta;
			}
			this.buttonStates[code] = state;
		}
		this.pointerPosition[0] = 0;
		this.pointerPosition[1] = 0;
		this.pointerDelta[0] = 0;
		this.pointerDelta[1] = 0;
		this.lastPositionX = 0;
		this.lastPositionY = 0;
		this.lastPositionValid = false;
		this.pendingButtonPressEdges = 0;
		this.pendingButtonReleaseEdges = 0;
		this.pendingDeltaX = 0;
		this.pendingDeltaY = 0;
		this.pendingDeltaTimestamp = 0;
		this.pendingWheel = 0;
		this.pendingWheelTimestamp = 0;
		this.inputControllerButtons = 0;
		this.routedInputControllerButtons = 0;
		this.inputControllerXQ16 = 0;
		this.inputControllerYQ16 = 0;
		this.inputControllerWheelQ16 = 0;
	}
}
