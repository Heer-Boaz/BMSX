import { getPressedState, Input, makeButtonState, resetObject } from './input';
import type { ButtonState, InputHandler, KeyOrButtonId2ButtonState, VibrationParams } from './inputtypes';
// In je InputManager.ts (pseudo)
import { DualSenseHID } from "./dualsensehid";

const SONY_VID = 0x054C;
const DUALSHOCK4_PID_2013 = 0x05C4;
const DUALSHOCK4_PID_2016 = 0x09CC;

/**
 * Represents a handler for gamepad input.
 * Implements the IInputHandler interface to manage and poll the state of a gamepad.
 *
 * @class GamepadInput
 * @implements {InputHandler}
 */
export class GamepadInput implements InputHandler {
	/**
	 * Gets the index of the gamepad.
	 * @returns The index of the gamepad, or `null` if no gamepad is connected.
	 */
	public get gamepadIndex(): number | null {
		return this.gamepad?.index ?? null;
	}

	private _gamepad: Gamepad;

	/** HID device used for rumble of this specific gamepad */
	private hidPad: DualSenseHID = new DualSenseHID();

	/** Cached flag that indicates whether this gamepad is a DualShock 4 */
	private isDs4Gamepad: boolean | null = null;
	/**
	 * Gets the current gamepad instance.
	 * @returns The current Gamepad object.
	 */
	public get gamepad(): Gamepad { return this._gamepad; }

	/**
	 * The state of each gamepad button for each player.
	 */
	private gamepadButtonStates: KeyOrButtonId2ButtonState = {};

	/** Monotonic press id generator for this device */
	private nextPressId = 1;

	/** Cached timestamp from last poll to early-out when input hasn’t changed */
	private lastSampleTimestamp: number | null = null;

	/** Digitalized axis state with hysteresis to prevent flapping */
	private axisDigitalState: Record<'left' | 'right' | 'up' | 'down', boolean> = { left: false, right: false, up: false, down: false };

	/** Hysteresis thresholds for axis digitalization */
	private static readonly AXIS_ON = 0.5;
	private static readonly AXIS_OFF = 0.4;

	/** Radial deadzone for sticks */
	private static readonly RADIAL_DEADZONE = 0.2;

	public get supportsVibrationEffect(): boolean {
		return true; // Gamepad supports vibration feedback
	}

	private parseGamepadId(id: string): { vendorId: number; productId: number } | null {
		const vendorReg = /(vendor|vid|idvendor)[^0-9a-f]*([0-9a-f]{4})/i;
		const productReg = /(product|pid|idproduct)[^0-9a-f]*([0-9a-f]{4})/i;

		let vendorStr: string | null = vendorReg.exec(id)?.[2] ?? null;
		let productStr: string | null = productReg.exec(id)?.[2] ?? null;

		if (!vendorStr || !productStr) {
			const alt = /([0-9a-f]{4})\W+([0-9a-f]{4})/i.exec(id);
			if (alt) {
				vendorStr ??= alt[1];
				productStr ??= alt[2];
			}
		}

		if (!vendorStr || !productStr) return null;
		const vendorId = parseInt(vendorStr, 16);
		const productId = parseInt(productStr, 16);
		if (Number.isNaN(vendorId) || Number.isNaN(productId)) return null;
		return { vendorId, productId };
	}

	private updateDs4Flag(gamepad: Gamepad | null): void {
		if (!gamepad) {
			this.isDs4Gamepad = null;
			return;
		}
		const ids = this.parseGamepadId(gamepad.id);
		this.isDs4Gamepad = ids &&
			ids.vendorId === SONY_VID &&
			(ids.productId === DUALSHOCK4_PID_2013 || ids.productId === DUALSHOCK4_PID_2016);
	}

	/** Determine if the connected gamepad represents a DualShock 4 */
	private isDualShock4(): boolean {
		return this.isDs4Gamepad;
	}

	/**
	 * Applies a vibration effect to the gamepad.
	 * @param effect The type of vibration effect to apply.
	 * @param duration The duration of the vibration effect in milliseconds.
	 * @param intensity The intensity of the vibration effect, ranging from 0.0 to 1.0.
	 */
	private lastRumbleAt: number = 0;
	public applyVibrationEffect(params: VibrationParams): void {
		const now = performance.now();
		// Coalesce rumble updates to <= 60Hz
		if (now - this.lastRumbleAt < 16) return;
		this.lastRumbleAt = now;

		if (!this.gamepad && !this.hidPad.isConnected) {
			// Fallback: navigator.vibrate (Android); noop on iOS (ignored)
			try { if ('vibrate' in navigator) { navigator.vibrate(Math.max(0, Math.round(params.duration * params.intensity))); } } catch { /* noop */ }
			return;
		}

		const strongMagnitude = params.intensity > 0.5 ? Math.round(params.intensity * 255) : 0;
		const weakMagnitude = params.intensity <= 0.5 ? Math.round(params.intensity * 255) : 0;

		const isDs4 = this.isDualShock4();

		if (this.gamepad && this.gamepad.vibrationActuator && !isDs4) {
			try {
				this.gamepad.vibrationActuator.playEffect(params.effect, {
					duration: params.duration,
					weakMagnitude,
					strongMagnitude
				});
			} catch (e) {
				// Silent dropout on disconnect
			}
			return;
		}

		try {
			this.hidPad.sendRumble({ strong: strongMagnitude, weak: weakMagnitude, duration: params.duration });
		} catch (e) {
			// Silent dropout on disconnect
		}
	}

	/**
	 * Initializes the HID pad for rumble effects.
	 * If the gamepad has a native vibration actuator, it skips HID initialization.
	 * Otherwise, it attempts to initialize the HID pad with the current gamepad.
	 * *NOTE: REQUIRES USER INPUT TO GRANT PERMISSION TO USE THE HID API!! THEREFORE, THIS FUNCTION SHOULD BE CALLED AS PART OF A USER INTERACTION!*
	 */
	public async init(): Promise<void> {
		if (this._gamepad?.vibrationActuator && !this.isDualShock4()) {
			// Native actuator is available and reliable; skip HID init
			return;
		}
		try {
			await this.hidPad.init(this._gamepad);
			this.updateDs4Flag(this._gamepad);
		} catch (e) {
			console.warn(`Error initializing HID device for rumble: ${e}`);
		}
	}

	/**
	 * Creates an instance of the class and initializes the gamepad.
	 *
	 * @param gamepad - The Gamepad object to be associated with this instance.
	 *
	 * This constructor also resets the gamepad button states upon initialization.
	 */
	constructor(gamepad: Gamepad) {
		this._gamepad = gamepad;
		this.updateDs4Flag(gamepad);

		// Note that init should be called later to ensure user interaction for permission

		// Reset gamepad button states
		this.reset();
	}

	/**
	 * Polls the input from the assigned gamepad for this player.
	 * If no gamepad is assigned, or if the browser does not support the gamepads API,
	 * or if the gamepad index is out of range of the connected gamepads array,
	 * this method does nothing.
	 * This function should be called once per frame to ensure that gamepad input is up-to-date.
	 */
	public pollInput(): void {
		if (this.gamepadIndex === null || !this.gamepad) return; // No gamepad was assigned to this GamepadInput-object
		const nav = navigator as Navigator & { webkitGetGamepads?: () => (Gamepad[] | null) };
		const gamepads: Gamepad[] = (nav.getGamepads && nav.getGamepads()) || (nav.webkitGetGamepads && nav.webkitGetGamepads()) || []; // Fallback to empty array
		if (!gamepads) return; // Browser does not support gamepads API
		if (gamepads.length < this.gamepadIndex) return; // Gamepad index is out of range of connected gamepads array (this can happen if multiple gamepads are connected and one is disconnected)
		const newGamepad = gamepads[this.gamepadIndex];
		if (this._gamepad !== newGamepad) {
			this._gamepad = newGamepad;
			this.updateDs4Flag(newGamepad);
		} else {
			this._gamepad = newGamepad;
		}
		// Early-out if timestamp unchanged, but still tick hold durations to allow long-press thresholds
		const ts = this._gamepad?.timestamp ?? null;
		const unchanged = ts != null && this.lastSampleTimestamp === ts;
		this.lastSampleTimestamp = ts;
		if (unchanged) {
			// Increment presstime for any pressed buttons; clear edge flags
			for (const button of Input.BUTTON_IDS) {
				const st = this.gamepadButtonStates[button];
				if (!st) continue;
				if (st.pressed) {
					st.presstime = (st.presstime ?? 0) + 1;
					st.justpressed = false;
					st.justreleased = false;
				}
			}
			return;
		}

		// Initialize the individual gamepad button states if they are not already initialized
		Input.BUTTON_IDS.forEach(button => this.gamepadButtonStates[button] || (this.gamepadButtonStates[button] = makeButtonState()));

		// Check whether any axes have been triggered
		this.pollGamepadAxes(this.gamepad);

		// Check button states
		this.pollGamepadButtons(this.gamepad);
	}

	/**
	 * Polls the state of the axes on the given gamepad and updates the corresponding button states.
	 * @param gamepad The gamepad to poll.
	 */
	private pollGamepadAxes(gamepad: Gamepad): void {
		if (!gamepad) return; // Will be null if the gamepad was disconnected
		const now = performance.now();
		const x = gamepad.axes?.[0] ?? 0;
		const y = gamepad.axes?.[1] ?? 0;

		// Radial deadzone and normalization
		const mag = Math.hypot(x, y);
		const dz = GamepadInput.RADIAL_DEADZONE;
		let nx = 0, ny = 0, nmag = 0;
		if (mag > dz) {
			const k = (mag - dz) / (1 - dz);
			if (mag > 0) { nx = (x / mag) * k; ny = (y / mag) * k; }
			nmag = Math.min(1, Math.max(0, k));
		}

		// Update analog values on LS
		const lsState = this.gamepadButtonStates['ls'] ?? makeButtonState();
		lsState.value2d = [nx, ny];
		lsState.value = nmag;
		lsState.timestamp = now;
		this.gamepadButtonStates['ls'] = lsState;

		// Digitalize with hysteresis
		const on = GamepadInput.AXIS_ON, off = GamepadInput.AXIS_OFF;
		const leftNow = nx < 0 ? -nx >= (this.axisDigitalState.left ? off : on) : false;
		const rightNow = nx > 0 ? nx >= (this.axisDigitalState.right ? off : on) : false;
		const upNow = ny < 0 ? -ny >= (this.axisDigitalState.up ? off : on) : false;
		const downNow = ny > 0 ? ny >= (this.axisDigitalState.down ? off : on) : false;

		this.axisDigitalState.left = leftNow;
		this.axisDigitalState.right = rightNow;
		this.axisDigitalState.up = upNow;
		this.axisDigitalState.down = downNow;

		// Only set pressed flags here; edges handled in pollGamepadButtons
		this.gamepadButtonStates['left'].pressed = leftNow || this.gamepadButtonStates['left'].pressed;
		this.gamepadButtonStates['right'].pressed = rightNow || this.gamepadButtonStates['right'].pressed;
		this.gamepadButtonStates['up'].pressed = upNow || this.gamepadButtonStates['up'].pressed;
		this.gamepadButtonStates['down'].pressed = downNow || this.gamepadButtonStates['down'].pressed;

		// Right stick analog capture (axes 2,3)
		const rx = gamepad.axes?.[2] ?? 0;
		const ry = gamepad.axes?.[3] ?? 0;
		const rmag = Math.hypot(rx, ry);
		let rnx = 0, rny = 0, rnmag = 0;
		if (rmag > dz) {
			const rk = (rmag - dz) / (1 - dz);
			if (rmag > 0) { rnx = (rx / rmag) * rk; rny = (ry / rmag) * rk; }
			rnmag = Math.min(1, Math.max(0, rk));
		}
		const rsState = this.gamepadButtonStates['rs'] ?? makeButtonState();
		rsState.value2d = [rnx, rny];
		rsState.value = rnmag;
		rsState.timestamp = now;
		this.gamepadButtonStates['rs'] = rsState;
	}

	/**
	 * Polls the state of all buttons on the given gamepad and updates the corresponding button states.
	 * @param gamepad The gamepad to poll.
	 */
	private pollGamepadButtons(gamepad: Gamepad): void {
		if (!gamepad) return; // Will be null if the gamepad was disconnected
		const buttons = gamepad.buttons;
		if (!buttons) return;
		const now = performance.now();
		for (let btnIndex = 0; btnIndex < buttons.length; btnIndex++) {
			const gamepadButton = buttons[btnIndex];
			const pressed = typeof gamepadButton === 'object' ? gamepadButton.pressed : gamepadButton === 1.0;
			// Consider that the button can already be regarded as pressed if it was pressed as part of an axis (which is also regarded as a button press)
			const buttonId = Input.INDEX2BUTTON[btnIndex as keyof typeof Input.INDEX2BUTTON];
			const prev = this.gamepadButtonStates[buttonId] ?? makeButtonState();
			const axisPress = (buttonId === 'left' && this.axisDigitalState.left)
				|| (buttonId === 'right' && this.axisDigitalState.right)
				|| (buttonId === 'up' && this.axisDigitalState.up)
				|| (buttonId === 'down' && this.axisDigitalState.down);
			const isDown = pressed || axisPress;
			const wasDown = !!prev.pressed;
			if (isDown) {
				if (!wasDown) {
					const pid = this.nextPressId++;
					this.gamepadButtonStates[buttonId] = makeButtonState({
						pressed: true,
						justpressed: true,
						waspressed: true,
						presstime: 0,
						timestamp: now,
						pressedAtMs: now,
						pressId: pid,
						value:(typeof (gamepadButton).value === 'number') ? Math.max(0, Math.min(1, (gamepadButton).value)) : 1,
					});
				} else {
					const st = prev;
					st.pressed = true;
					st.justpressed = false;
					st.justreleased = false;
					st.waspressed = true;
					st.presstime = (st.presstime ?? 0) + 1;
					st.value =(typeof (gamepadButton).value === 'number') ? Math.max(0, Math.min(1, (gamepadButton).value)) : 1;
					this.gamepadButtonStates[buttonId] = st;
				}
			} else {
				const jr = wasDown;
				this.gamepadButtonStates[buttonId] = makeButtonState({
					pressed: false,
					justpressed: false,
					justreleased: jr,
					waspressed: prev.waspressed || wasDown,
					wasreleased: prev.wasreleased || jr,
					consumed: prev.consumed || false,
					timestamp: now,
					releasedAtMs: jr ? now : prev.releasedAtMs ?? null,
					pressId: jr ? prev.pressId ?? null : prev.pressId ?? null,
					value: 0,
				});
			}
		}
	}

	/**
	 * Returns the pressed state of a gamepad button, and optionally checks if it was clicked.
	 * @param btn - The index of the button to check the state of.
	 * @returns The pressed state of the button.
	 */
	public getButtonState(btn: string): ButtonState {
		const stateMap = this.gamepadButtonStates;
		return getPressedState(stateMap, btn);
	}

	/**
	 * Consumes the given button press for the specified player index.
	 * @param button The button to consume.
	 */
	public consumeButton(button: string) {
		this.gamepadButtonStates[button].consumed = true;
	}

	/**
	 * Resets the state of all gamepad buttons.
	 * @param except An optional array of buttons to exclude from the reset.
	 */
	public reset(except?: string[]): void {
		if (!except) {
			// Initialize the states of all gamepad buttons and axes
			Object.values(this.gamepadButtonStates).forEach(state => Object.assign(state, makeButtonState()));
		}
		else {
			resetObject(this.gamepadButtonStates, except);
		}
	}

	/** Clean up event listeners and close HID device */
	public dispose(): void {
		this.hidPad?.close();
	}
}
