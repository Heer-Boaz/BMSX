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
    public applyVibrationEffect(params: VibrationParams): void {
        if (!this.gamepad) return; // No gamepad is assigned to this GamepadInput-object
        if (!this.gamepad.vibrationActuator && !this.hidPad.isConnected) return; // No vibration actuator available and no HID device connected
        const strongMagnitude = params.intensity > 0.5 ? Math.round(params.intensity * 255) : 0;
        const weakMagnitude = params.intensity <= 0.5 ? Math.round(params.intensity * 255) : 0;

        const isDs4 = this.isDualShock4();

        if (this.gamepad && this.gamepad.vibrationActuator && !isDs4) {
            this.gamepad.vibrationActuator.playEffect(params.effect, {
                duration: params.duration,
                weakMagnitude,
                strongMagnitude
            });
            return;
        }

        try {
            this.hidPad.sendRumble({
                strong: strongMagnitude,
                weak: weakMagnitude,
                duration: params.duration
            });
        } catch (e) {
            console.warn(`HID‑rumble failed: ${e}`);
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

        this.init();

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
        const gamepads: Gamepad[] = navigator.getGamepads ? navigator.getGamepads() : ((navigator as any).webkitGetGamepads ? (navigator as any).webkitGetGamepads : undefined); // Get gamepads from browser API
        if (!gamepads) return; // Browser does not support gamepads API
        if (gamepads.length < this.gamepadIndex) return; // Gamepad index is out of range of connected gamepads array (this can happen if multiple gamepads are connected and one is disconnected)
        const newGamepad = gamepads[this.gamepadIndex];
        if (this._gamepad !== newGamepad) {
            this._gamepad = newGamepad;
            this.updateDs4Flag(newGamepad);
        } else {
            this._gamepad = newGamepad;
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
        const [xAxis, yAxis] = gamepad.axes;
        this.gamepadButtonStates['left'].pressed = xAxis < -0.5;
        this.gamepadButtonStates['right'].pressed = xAxis > 0.5;
        this.gamepadButtonStates['up'].pressed = yAxis < -0.5;
        this.gamepadButtonStates['down'].pressed = yAxis > 0.5;
    }

    /**
     * Polls the state of all buttons on the given gamepad and updates the corresponding button states.
     * @param gamepad The gamepad to poll.
     */
    private pollGamepadButtons(gamepad: Gamepad): void {
        if (!gamepad) return; // Will be null if the gamepad was disconnected
        const buttons = gamepad.buttons;
        if (!buttons) return;
        for (let btnIndex = 0; btnIndex < buttons.length; btnIndex++) {
            const gamepadButton = buttons[btnIndex];
            const pressed = typeof gamepadButton === 'object' ? gamepadButton.pressed : gamepadButton === 1.0;
            // Consider that the button can already be regarded as pressed if it was pressed as part of an axis (which is also regarded as a button press)
            const buttonId = Input.INDEX2BUTTON[btnIndex];
            const oldPressTime = this.gamepadButtonStates[buttonId].presstime ?? 0;
            this.gamepadButtonStates[buttonId].pressed = buttonId === 'left' || buttonId === 'right' || buttonId === 'up' || buttonId === 'down'
                ? this.gamepadButtonStates[buttonId].pressed || pressed
                : pressed;

            if (this.gamepadButtonStates[buttonId].pressed) {
                // If the button is pressed, increment the press time counter for detecting hold actions
                this.gamepadButtonStates[buttonId].presstime = oldPressTime + 1;
                // Set the timestamp only if it was not set before
                this.gamepadButtonStates[buttonId].timestamp ||= performance.now();
                // Set the justpressed flag if the button was not pressed before this poll
                this.gamepadButtonStates[buttonId].justpressed = oldPressTime === 0;
                // Reset the justreleased flag since the button is currently pressed
                this.gamepadButtonStates[buttonId].justreleased = false;
            } else {
                // Reset the button state if it is not pressed
                this.gamepadButtonStates[buttonId] = makeButtonState({ justreleased: this.gamepadButtonStates[buttonId]?.pressed ? true : false, timestamp: performance.now() });
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
            Object.values(this.gamepadButtonStates).forEach(state => {
                state.pressed = false;
                state.consumed = false;
                state.presstime = null;
                state.timestamp = performance.now();
            });
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
