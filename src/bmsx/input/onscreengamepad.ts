import { getPressedState, Input, makeButtonState, options, resetObject } from './input';
import type { ButtonState, GamepadButton, InputHandler, KeyOrButtonId2ButtonState } from './inputtypes';

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
    /**
     * Gets the current gamepad instance.
     * @returns The current Gamepad object.
     */
    public get gamepad(): Gamepad { return this._gamepad; }

    /**
     * The state of each gamepad button for each player.
     */
    private gamepadButtonStates: KeyOrButtonId2ButtonState = {};

    /**
     * Creates an instance of the class and initializes the gamepad.
     *
     * @param gamepad - The Gamepad object to be associated with this instance.
     *
     * This constructor also resets the gamepad button states upon initialization.
     */
    constructor(gamepad: Gamepad) {
        this._gamepad = gamepad;

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
        this._gamepad = gamepads[this.gamepadIndex]; // Update gamepad reference


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
}
/**
 * Represents an on-screen gamepad for handling input in a game.
 * Implements the IInputHandler interface to manage gamepad button states,
 * including touch events for both directional and action buttons.
 * It is used to simulate gamepad input on touch devices, and is intended to be used in conjunction with the {@link Input} class.
 *
 * @class OnscreenGamepad
 * @implements {InputHandler}
 */
export class OnscreenGamepad implements InputHandler {
    /**
     * The index of the gamepad used for input.
     * @remarks
     * This value is set to 7 by default.
     */
    public readonly gamepadIndex = 7;

    /**
     * The state of each gamepad button for each player.
     */
    private gamepadButtonStates: KeyOrButtonId2ButtonState = {};

    /**
     * Hides the specified buttons.
     * @param gamepad_button_ids An array of button names to hide.
     * @throws Error if no HTML element is found matching a button name.
     */
    public static hideButtons(gamepad_button_ids: string[]): void {
        gamepad_button_ids.forEach(b => {
            const elementId = OnscreenGamepad.ACTION_BUTTON_TO_ELEMENTID_MAP[b];
            if (!elementId) throw new Error(`Error while attempting to hide your buttons - no HTML elementID found matching button '${b}'.`);
            const element = document.getElementById(elementId);
            const textElement = document.getElementById(`${elementId}_text`);
            if (!element) throw new Error(`Error while attempting to hide your buttons - no HTML element found matching button '${b}' and elementID '${elementId}'.`);
            if (!textElement) throw new Error(`Error while attempting to hide your buttons - no HTML *text* element found matching button '${b}' and elementID '${elementId}'.`);
            element.classList.add('hidden');
            textElement.classList.add('hidden');
        });
    }

    /**
     * Returns the pressed state of a gamepad button, and optionally checks if it was clicked.
     * @param btn - The index of the button to check the state of.
     * @returns The pressed state of the button.
     */
    public getButtonState(btn: string): ButtonState {
        const stateMap = this.gamepadButtonStates || {};
        return getPressedState(stateMap, btn);
    }

    /**
     * Polls the input to update the button states and press times.
     * This method should be called once per frame to ensure that gamepad input is up-to-date.
     * It uses the `touched` attribute (in the dataset) of the on-screen buttons to determine if they are currently being pressed.
     */
    public pollInput(): void {
        // Initialize new states with current values instead of resetting
        const defaultState = makeButtonState();

        const newGamepadButtonStates: KeyOrButtonId2ButtonState = {};

        Input.BUTTON_IDS.forEach(button => {
            newGamepadButtonStates[button] = this.gamepadButtonStates[button] ?? { ...defaultState };
        });

        for (let i = 0; i < OnscreenGamepad.ONSCREEN_BUTTON_ELEMENT_NAMES.length; i++) {
            const d = document.getElementById(OnscreenGamepad.ONSCREEN_BUTTON_ELEMENT_NAMES[i]);
            const buttonData = OnscreenGamepad.ALL_BUTTON_MAP[d.id];
            if (buttonData) {
                buttonData.buttons.forEach(button => {
                    if (d.dataset.touched === 'true') {
                        const oldPressTime = this.gamepadButtonStates[button].presstime ?? 0;
                        // Update the state only if the button is currently pressed
                        newGamepadButtonStates[button].pressed = true;
                        newGamepadButtonStates[button].presstime = oldPressTime + 1;
                        newGamepadButtonStates[button].consumed ??= false;
                        newGamepadButtonStates[button].timestamp ??= performance.now();
                        newGamepadButtonStates[button].justpressed = oldPressTime === 0;
                        newGamepadButtonStates[button].justreleased = false;
                    } else {
                        // Set to false only if no other element is pressing this button
                        if (!this.isOtherElementPressingButton(button)) {
                            newGamepadButtonStates[button].justreleased = this.gamepadButtonStates[button].pressed ? true : false; // Set justreleased to true if the button was pressed before
                            newGamepadButtonStates[button].timestamp = performance.now(); // Update the timestamp to the current time
                        }
                    }
                });
            }
        }

        // Update the button states with the new states
        this.gamepadButtonStates = newGamepadButtonStates;
    }

    /**
     * Checks if any other on-screen gamepad element is currently pressing the specified button.
     *
     * @param button - The identifier of the button to check for.
     * @returns True if any element is pressing the button; otherwise, false.
     */
    private isOtherElementPressingButton(button: string): boolean {
        return OnscreenGamepad.ONSCREEN_BUTTON_ELEMENT_NAMES.some(dpadId => {
            const element = document.getElementById(dpadId);
            return element && element.dataset.touched === 'true' && OnscreenGamepad.ALL_BUTTON_MAP[element.id].buttons.includes(button);
        });
    }

    /**
     * Consumes the given button press for the specified player index.
     * @param button The button to consume.
     */
    public consumeButton(button: string) {
        if (this.gamepadButtonStates[button]) this.gamepadButtonStates[button].consumed = true;
    }

    /**
     * A mapping of directional pad (D-Pad) button combinations to their corresponding button arrays.
     *
     * Each key represents a specific D-Pad direction or combination, and the value is an object containing
     * an array of buttons that are associated with that direction. The buttons are validated to be of type
     * `GamepadButton`.
     */
    private static readonly DPAD_BUTTON_MAP: Record<string, { buttons: string[]; }> = {
        'd-pad-u': {
            buttons: ['up' satisfies GamepadButton],
        },
        'd-pad-ru': {
            buttons: ['up' satisfies GamepadButton, 'right' satisfies GamepadButton],
        },
        'd-pad-r': {
            buttons: ['right' satisfies GamepadButton],
        },
        'd-pad-rd': {
            buttons: ['right' satisfies GamepadButton, 'down' satisfies GamepadButton],
        },
        'd-pad-d': {
            buttons: ['down' satisfies GamepadButton],
        },
        'd-pad-ld': {
            buttons: ['down' satisfies GamepadButton, 'left' satisfies GamepadButton],
        },
        'd-pad-l': {
            buttons: ['left' satisfies GamepadButton],
        },
        'd-pad-lu': {
            buttons: ['left' satisfies GamepadButton, 'up' satisfies GamepadButton],
        },
    };

    /**
     * A mapping of action buttons to their corresponding GamepadButton representations.
     *
     * Each key in the ACTION_BUTTON_MAP represents a specific action button, and the value
     * is an object containing an array of button identifiers that satisfy the GamepadButton type.
     *
     * Note: Some buttons like 'lt_knop', 'rt_knop', and 'home_knop' are commented out and not currently in use.
     */
    private static readonly ACTION_BUTTON_MAP: Record<string, { buttons: string[]; }> = {
        'a_knop': {
            buttons: ['a' satisfies GamepadButton],
        },
        'b_knop': {
            buttons: ['b' satisfies GamepadButton],
        },
        'x_knop': {
            buttons: ['x' satisfies GamepadButton],
        },
        'y_knop': {
            buttons: ['y' satisfies GamepadButton],
        },
        'ls_knop': {
            buttons: ['ls' satisfies GamepadButton],
        },
        'rs_knop': {
            buttons: ['rs' satisfies GamepadButton],
        },
        // 'lt_knop': {
        // 	buttons: ['lt' satisfies GamepadButton],
        // },
        // 'rt_knop': {
        // 	buttons: ['rt' satisfies GamepadButton],
        // },
        'select_knop': {
            buttons: ['select' satisfies GamepadButton],
        },
        'start_knop': {
            buttons: ['start' satisfies GamepadButton],
        },
        // 'home_knop': {
        //     buttons: ['home' satisfies GamepadButton],
        // },
    };

    /**
     * Maps action button names to corresponding element names.
     * Used for hiding buttons at game start.
     */
    private static readonly ACTION_BUTTON_TO_ELEMENTID_MAP: Record<string, string> = {
        'a': 'a_knop',
        'b': 'b_knop',
        'x': 'x_knop',
        'y': 'y_knop',
        'ls': 'ls_knop',
        'rs': 'rs_knop',
        'lt': 'lt_knop',
        'rt': 'rt_knop',
        'select': 'select_knop',
        'start': 'start_knop',
        // 'home': 'home_knop',
    };

    /**
    * Mapping of button names to their corresponding key inputs.
    */
    private static readonly ALL_BUTTON_MAP: Record<string, { buttons: string[]; }> = {
        ...OnscreenGamepad.DPAD_BUTTON_MAP,
        ...OnscreenGamepad.ACTION_BUTTON_MAP,
    };

    /**
     * A list of element IDs representing the directional pad (D-Pad) buttons.
     */
    private static readonly DPAD_BUTTON_ELEMENT_IDS = ['d-pad-u', 'd-pad-ru', 'd-pad-r', 'd-pad-rd', 'd-pad-d', 'd-pad-ld', 'd-pad-l', 'd-pad-lu'];
    private static readonly ACTION_BUTTON_ELEMENT_IDS = ['btn1_knop', 'btn2_knop', 'btn3_knop', 'btn4_knop', 'ls_knop', 'rs_knop', 'lt_knop', 'rt_knop', 'select_knop', 'start_knop', 'home_knop'];

    private static readonly ONSCREEN_BUTTON_ELEMENT_NAMES = Object.keys(OnscreenGamepad.ALL_BUTTON_MAP);

    /**
     * Initializes the input system.
     * Sets up event listeners for touch and mouse input,
     * and resets the gamepad button states.
     */
    public init(): void {
        // Reset gamepad button states
        this.reset();
        const addTouchListeners = (controlsElement: HTMLElement, action_type: 'dpad' | 'action') => {
            controlsElement.addEventListener('touchmove', e => { this.handleTouchMove(e, action_type); return true; }, options);
            controlsElement.addEventListener('touchstart', e => { this.handleTouchStart(e, action_type); return true; }, options);
            controlsElement.addEventListener('touchend', e => { this.handleTouchEnd(e, action_type); return true; }, options);
            controlsElement.addEventListener('touchcancel', e => { this.handleTouchEnd(e, action_type); return true; }, options);
        };

        addTouchListeners(document.getElementById('d-pad-controls')!, 'dpad');
        addTouchListeners(document.getElementById('button-controls')!, 'action');
        // Prevent default touch events for all other elements in the DOM
        document.addEventListener('touchstart', e => { e.preventDefault(); return true; }, options);

        window.addEventListener('blur', e => this.blur(e), false); // Blur event will pause the game and prevent any input from being registered and reset the key states
        window.addEventListener('focus', e => this.focus(e), false); // Focus event will allow input to be registered again
        window.addEventListener('mouseout', () => this.reset(), options); // Reset input states when mouse leaves the window
    }

    /**
     * Resets the state of all gamepad buttons.
     * @param except An optional array of buttons to exclude from the reset.
     */
    public reset(except?: string[]): void {
        if (!except) {
            // Initialize the states of all gamepad buttons and axes
            Input.BUTTON_IDS.forEach(buttonId => this.gamepadButtonStates[buttonId] = makeButtonState());
        }
        else {
            resetObject(this.gamepadButtonStates, except);
        }
    }

    /**
     * Resets the state of all UI elements related to the gamepad this.
     * This function is used to clear the state of all UI elements that represent the gamepad input buttons.
     * It is called once per frame to ensure that the UI is up-to-date with the current gamepad input state.
     */
    public resetUI(elementsToFilterById?: string[]): void {
        const resetElementAndButtonPress = (element_id: string): void => {
            const element = document.getElementById(element_id);
            if (element.classList.contains('druk')) {
                element.classList.remove('druk');
                element.classList.add('los');
                element.dataset.touched = 'false';

                const textElement = document.getElementById(`${element_id}_text`);
                if (textElement && textElement.classList.contains('druk')) {
                    textElement.classList.remove('druk');
                    textElement.classList.add('los');
                }
            }

            // Also reset the state of the button
            const buttonData = OnscreenGamepad.ALL_BUTTON_MAP[element_id];
            if (buttonData) {
                buttonData.buttons.forEach(button => {
                    this.gamepadButtonStates[button].pressed = false;
                });
            }
        };

        if (elementsToFilterById) {
            OnscreenGamepad.ONSCREEN_BUTTON_ELEMENT_NAMES.forEach(element => !elementsToFilterById.includes(element) && resetElementAndButtonPress(element));
        }
        else {
            OnscreenGamepad.ONSCREEN_BUTTON_ELEMENT_NAMES.forEach(resetElementAndButtonPress);
        }
    }

    /**
     * Handles the touch move event for a specific control type on the on-screen gamepad.
     * This function is used to handle touch move events for the on-screen gamepad controls.
     * It is called when the user moves their finger across the screen while touching the on-screen gamepad.
     * The function checks which elements are being touched and updates the UI accordingly.
     * If an element is touched, it adds the 'druk' class to it and removes the 'los' class.
     * If an element is not touched, it adds the 'los' class to it and removes the 'druk' class.
     * It considers the control-type to determine which elements to filter from the reset.
     * @param e - The touch event.
     * @param control_type - The type of control ('dpad' or 'action').
     */
    handleTouchMove(e: TouchEvent, control_type: 'dpad' | 'action'): void {
        if (e.touches.length === 0) {
            return;
        }

        switch (control_type) {
            case 'action':
                const target = e.target as HTMLElement;
                let foundTarget = false;
                for (let i = 0; i < e.touches.length; i++) {
                    let pos = e.touches[i];
                    const elementsUnderTouch = document.elementsFromPoint(pos.clientX, pos.clientY) as HTMLElement[];
                    if (elementsUnderTouch && elementsUnderTouch.length > 0) {
                        if (elementsUnderTouch.includes(target)) {
                            foundTarget = true;
                        }
                    }
                }

                if (!foundTarget) {
                    this.handleTouchEnd(e, control_type);
                }
                break;
            case 'dpad':
                this.handleTouchStart(e, control_type);
                break;
        }
    }

    /**
     * Handles touch events by resetting the UI and checking which elements were touched.
     * If an element is touched, it adds the 'druk' class to it and removes the 'los' class.
     * It also filters the touched buttons from the reset.
     * @param e The touch event to handle.
     */
    handleTouchStart(e: TouchEvent, control_type: 'dpad' | 'action'): void {
        const dpad_omheining = document.getElementById('d-pad-omheining') as HTMLElement;
        switch (control_type) {
            case 'action':
                this.resetUI(OnscreenGamepad.DPAD_BUTTON_ELEMENT_IDS);
                break;
            case 'dpad':
                this.resetUI(OnscreenGamepad.ACTION_BUTTON_ELEMENT_IDS);
                // Remove all classes from dpad_omheining
                dpad_omheining.classList.remove(...OnscreenGamepad.DPAD_BUTTON_ELEMENT_IDS);
                break;
        }

        if (e.touches.length === 0) {
            return;
        }

        const filterFromReset: string[] = [];
        const elementsToFilter: string[] = [];
        const dpadMappings = {
            'd-pad-lu': ['d-pad-u', 'd-pad-l'],
            'd-pad-u': ['d-pad-lu', 'd-pad-ru'],
            'd-pad-ru': ['d-pad-u', 'd-pad-r'],
            'd-pad-r': ['d-pad-ru', 'd-pad-rd'],
            'd-pad-ld': ['d-pad-d', 'd-pad-l'],
            'd-pad-d': ['d-pad-ld', 'd-pad-rd'],
            'd-pad-rd': ['d-pad-d', 'd-pad-r'],
            'd-pad-l': ['d-pad-lu', 'd-pad-ld'],
        };
        for (let i = 0; i < e.touches.length; i++) {
            let pos = e.touches[i];
            const elementsUnderTouch = document.elementsFromPoint(pos.clientX, pos.clientY) as HTMLElement[];
            if (elementsUnderTouch) {
                for (let j = 0; j < elementsUnderTouch.length; j++) {
                    const elementUnderTouch = elementsUnderTouch[j];
                    let buttonsTouched: string[];
                    switch (control_type) {
                        case 'action':
                            buttonsTouched = OnscreenGamepad.ACTION_BUTTON_MAP[elementUnderTouch.id]?.buttons;
                            break;
                        case 'dpad':
                            buttonsTouched = OnscreenGamepad.DPAD_BUTTON_MAP[elementUnderTouch.id]?.buttons;
                            break;
                    }
                    if (buttonsTouched?.length > 0) {
                        elementUnderTouch.dataset.touched = 'true';
                        elementsToFilter.push(elementUnderTouch.id);

                        buttonsTouched.forEach(b => filterFromReset.push(b));
                        if (dpadMappings[elementUnderTouch.id]) {
                            elementsToFilter.push(...dpadMappings[elementUnderTouch.id]);
                            dpad_omheining.classList.add(elementUnderTouch.id);
                        }
                    }
                }
            }
        }

        for (let i = 0; i < elementsToFilter.length; i++) {
            const elementToFilter = elementsToFilter[i];
            const element = document.getElementById(elementToFilter) as HTMLElement;
            element.classList.add('druk');
            element.classList.remove('los');
            if (control_type === 'action') {
                const textElement = document.getElementById(`${elementToFilter}_text`);
                textElement.classList.add('druk');
                textElement.classList.remove('los');
            }
        }

        switch (control_type) {
            case 'action':
                elementsToFilter.push(...OnscreenGamepad.DPAD_BUTTON_ELEMENT_IDS);
                break;
            case 'dpad':
                elementsToFilter.push(...OnscreenGamepad.ACTION_BUTTON_ELEMENT_IDS);
                break;
        }

        this.resetUI(elementsToFilter);
    }

    /**
     * Handles the touch end event for the specified control type.
     * This function is used to handle touch end events for the on-screen gamepad controls.
     * It is called when the user lifts their finger off the screen after touching the on-screen gamepad.
     * The function checks which controls where touched before the user lifted their finger
     * and resets the UI for those controls and leaves the rest as they are.
     *
     * @param _e - The touch event object.
     * @param control_type - The type of control ('dpad' or 'action').
     */
    handleTouchEnd(_e: TouchEvent, control_type: 'dpad' | 'action'): void {
        switch (control_type) {
            case 'action':
                this.resetUI(OnscreenGamepad.DPAD_BUTTON_ELEMENT_IDS);
                break;
            case 'dpad':
                const dpad_omheining = document.getElementById('d-pad-omheining') as HTMLElement;
                // Remove all classes from dpad_omheining
                dpad_omheining.classList.remove(...OnscreenGamepad.DPAD_BUTTON_ELEMENT_IDS);
                this.resetUI(OnscreenGamepad.ACTION_BUTTON_ELEMENT_IDS);
                break;
        }
    }

    /**
     * Handles the blur event for the input element.
     * Resets the input state.
     * @param _e - The blur event object.
     */
    blur(_e: FocusEvent): void {
        this.reset();
    }

    /**
     * Sets the focus on the element and resets its state.
     * @param _e - The focus event.
     */
    focus(_e: FocusEvent): void {
        this.reset();
    }
}
