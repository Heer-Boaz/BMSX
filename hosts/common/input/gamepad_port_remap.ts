import {
	INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_COUNT,
	INPUT_CONTROLLER_PAD_AXIS_COUNT,
	InputControllerGamepadAxis,
	type InputControllerGamepadButtonBit,
	type InputControllerPadSnapshot,
} from '../../../machine/ts/machine/devices/input/contracts';

export const GAMEPAD_REMAP_UNBOUND = -1;

const UNBOUND_BUTTON_SOURCE_BIT = 31;
const UNBOUND_AXIS_SOURCE = INPUT_CONTROLLER_PAD_AXIS_COUNT;

/**
 * Retained mapping from one TypeScript-host player port's normalized controls
 * to the raw pad words published to the machine. Host controls continue to consume
 * the normalized source snapshot before this mapping is applied.
 */
export class GamepadPortRemap {
	private readonly buttonSources = new Uint8Array(
		INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_COUNT,
	);
	private readonly axisSources = new Uint8Array(
		INPUT_CONTROLLER_PAD_AXIS_COUNT,
	);
	private nonIdentityBindingCount = 0;

	public constructor() {
		this.reset();
	}

	public get isIdentity(): boolean {
		return this.nonIdentityBindingCount === 0;
	}

	public buttonSource(
		target: InputControllerGamepadButtonBit,
	): InputControllerGamepadButtonBit | typeof GAMEPAD_REMAP_UNBOUND {
		const source = this.buttonSources[target];
		return source === UNBOUND_BUTTON_SOURCE_BIT
			? GAMEPAD_REMAP_UNBOUND
			: source as InputControllerGamepadButtonBit;
	}

	public setButtonSource(
		target: InputControllerGamepadButtonBit,
		source: InputControllerGamepadButtonBit | typeof GAMEPAD_REMAP_UNBOUND,
	): void {
		const compiledSource = source === GAMEPAD_REMAP_UNBOUND
			? UNBOUND_BUTTON_SOURCE_BIT
			: source;
		const previous = this.buttonSources[target];
		if (previous === compiledSource) {
			return;
		}
		if (previous === target) {
			this.nonIdentityBindingCount += 1;
		} else if (compiledSource === target) {
			this.nonIdentityBindingCount -= 1;
		}
		this.buttonSources[target] = compiledSource;
	}

	public setAxisSource(
		target: InputControllerGamepadAxis,
		source: InputControllerGamepadAxis | typeof GAMEPAD_REMAP_UNBOUND,
	): void {
		const compiledSource = source === GAMEPAD_REMAP_UNBOUND
			? UNBOUND_AXIS_SOURCE
			: source;
		const previous = this.axisSources[target];
		if (previous === compiledSource) {
			return;
		}
		if (previous === target) {
			this.nonIdentityBindingCount += 1;
		} else if (compiledSource === target) {
			this.nonIdentityBindingCount -= 1;
		}
		this.axisSources[target] = compiledSource;
	}

	public reset(): void {
		for (
			let bit = 0;
			bit < INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_COUNT;
			bit += 1
		) {
			this.buttonSources[bit] = bit;
		}
		for (let axis = 0; axis < INPUT_CONTROLLER_PAD_AXIS_COUNT; axis += 1) {
			this.axisSources[axis] = axis;
		}
		this.nonIdentityBindingCount = 0;
	}

	public apply(
		source: InputControllerPadSnapshot,
		target: InputControllerPadSnapshot,
	): void {
		const sourceButtons = source.buttons;
		let targetButtons = 0;
		for (
			let targetBit = 0;
			targetBit < INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_COUNT;
			targetBit += 1
		) {
			targetButtons |= (
				(sourceButtons >>> this.buttonSources[targetBit]) & 1
			) << targetBit;
		}
		target.buttons = targetButtons >>> 0;

		const sourceAxes = source.axesQ16;
		const targetAxes = target.axesQ16;
		for (let targetAxis = 0; targetAxis < INPUT_CONTROLLER_PAD_AXIS_COUNT; targetAxis += 1) {
			const sourceAxis = this.axisSources[targetAxis];
			targetAxes[targetAxis] = sourceAxis === UNBOUND_AXIS_SOURCE
				? 0
				: sourceAxes[sourceAxis];
		}
	}
}
