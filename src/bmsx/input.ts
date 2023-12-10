import { Key } from 'ts-key-enum';
import { handleDebugClick, handleDebugMouseDown, handleDebugMouseDragEnd, handleDebugMouseMove, handleDebugMouseOut, handleContextMenu as handleDebugContextMenu, handleOpenObjectMenu, handleOpenDebugMenu as handleOpenDebugMenu } from './bmsxdebugger';
import { EventEmitter } from './eventemitter';

/**
 * Represents the ID of a button.
 * It can be one of the predefined values 'BTN1', 'BTN2', 'BTN3', 'BTN4',
 * or a custom Key value.
 */
type ButtonId = 'BTN1' | 'BTN2' | 'BTN3' | 'BTN4' | Key;
/**
 * Prevents the default action, propagation, and immediate propagation of an event.
 *
 * @param e The event object.
 * @returns Returns false.
 */
let preventActionAndPropagation = (e: Event): boolean => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    return false;
}

/**
 * Represents the state of an index in the Index2State type.
 */
type Index2State = { [index: string | number]: boolean; }
/**
 * Represents a mapping of keyboard inputs to actions.
 */
export type KeyboardInputMapping = {
    [action: string]: KeyboardButton;
}

/**
 * Represents a mapping of gamepad inputs to gamepad buttons.
 */
export type GamepadInputMapping = {
    [action: string]: GamepadButton;
}

/**
 * Represents the input mapping for a game.
 */
export interface InputMap {
    keyboard: KeyboardInputMapping;
    gamepad: GamepadInputMapping;
}

/**
 * Represents a keyboard button.
 * It can be one of the predefined keys or a custom string.
 */
export type KeyboardButton = keyof typeof Key | string;
/**
 * Represents a gamepad button.
 * @typedef {keyof typeof Input.GAMEPAD_BUTTONS} GamepadButton
 */
export type GamepadButton = keyof typeof Input.GAMEPAD_BUTTONS;

/**
 * Represents the state of a button.
 */
export type ButtonState = { pressed: boolean; consumed: boolean; };
/**
 * Represents the state of an action, including the action name and button state.
 */
export type ActionState = { action: string } & ButtonState;

/**
 * Represents the Input class responsible for handling user input.
 */
export class Input {
    /**
     * Mapping of gamepad IDs to player IDs.
     */
    public static GamepadPlayerMap = {};

    /**
     * The state of each keyboard key.
     */
    public static KeyState: Index2State = {};

    /**
     * The state of each keyboard key click request.
     */
    public static KeyPressedConsumedState: Index2State = {};

    /**
     * The state of each gamepad button for each player.
     */
    private static GamepadButtonStates: Index2State[] = [];

    /**
     * The state of each gamepad button click request for each player.
     */
    private static GamepadButtonPressedConsumedStates: Index2State[] = [];

    /**
     * The input maps for each player.
     * @private
     * @param {number} playerIndex - The index of the player to set the input map for.
     * @param {InputMap} inputMap - The input map to set for the player.
     * @returns {void}
     * @throws {Error} Throws an error if the player index is out of range.
     * @throws {Error} Throws an error if the input map is invalid.
     * @see {@link Input.getActionState} and {@link Input.getPressedActions} for checking if an action is pressed for a player.
     * @example
     * Input.setInputMap(0, {
     *     keyboard: {
     *         'jump': 'Space',
     *         'left': 'ArrowLeft',
     *         'right': 'ArrowRight',
     *         'up': 'ArrowUp',
     *         'down': 'ArrowDown',
     *     },
     *     gamepad: {
     *         'jump': 'a',
     *         'left': 'left',
     *         'right': 'right',
     *         'up': 'up',
     *         'down': 'down',
     *     },
     * });
     */
    private static inputMaps: InputMap[] = [];

    /**
     * The mapping of gamepad button names to their corresponding indices.
     */
    public static readonly GAMEPAD_BUTTONS = {
        'a': 0,
        'b': 1,
        'x': 2,
        'y': 3,
        'lb': 4,
        'rb': 5,
        'lt': 6,
        'rt': 7,
        'back': 8,
        'start': 9,
        'ls': 10,
        'rs': 11,
        'up': 12,
        'down': 13,
        'left': 14,
        'right': 15,
    } as const;

    /**
     * Resets the input state for all buttons except the specified ones.
     * @param except - The list of buttons to exclude from the reset.
     */
    // public static reset(except?: ButtonId[]): void {
    //     const resetMap = (map: Index2State, except?: ButtonId[]) => {
    //         Object.keys(map).forEach((key) => {
    //             if (!except || !except.includes(key as ButtonId)) {
    //                 delete map[key as ButtonId];
    //             }
    //         });
    //     };

    //     resetMap(Input.KeyState, except);
    //     resetMap(Input.KeyClickRequestedState, except);
    //     resetMap(Input.GamepadButtonStates[0], except);
    //     resetMap(Input.GamepadClickRequestedStates[0], except);
    // }

    /**
     * Sets the input map for a specific player.
     * @param playerIndex - The index of the player to set the input map for.
     * @param inputMap - The input map to set.
     */
    public static setInputMap(playerIndex: number, inputMap: InputMap): void {
        Input.inputMaps[playerIndex] = inputMap;
    }

    /**
     * Returns whether a specific action is currently pressed for a given player index, and optionally checks if it was clicked.
     * @param playerIndex - The index of the player to check the action for.
     * @param action - The name of the action to check.
     * @returns Whether the action is currently pressed for the given player index.
     */
    public static getActionState(playerIndex: number, action: string): ActionState {
        const inputMap = Input.inputMaps[playerIndex];
        if (!inputMap) return { action, pressed: false, consumed: false };

        const keyboardKey = inputMap.keyboard[action];
        const gamepadButton = Input.GAMEPAD_BUTTONS[inputMap.gamepad[action]];

        const keyboardButtonState = Input.getKeyState(keyboardKey);
        const gamepadButtonState = Input.getGamepadButtonState(playerIndex, gamepadButton);
        return { action: action, pressed: keyboardButtonState.pressed || gamepadButtonState.pressed, consumed: keyboardButtonState.consumed || gamepadButtonState.consumed };
    }

    /**
     * Returns all actions that have been pressed for a given player index.
     * @param playerIndex - The index of the player to check the actions for.
     * @returns An array of objects containing the name of the action and whether it was clicked.
     */
    public static getPressedActions(playerIndex: number): ActionState[] {
        const inputMap = Input.inputMaps[playerIndex];
        if (!inputMap) return [];

        const pressedActions: ActionState[] = [];

        for (const action in inputMap.keyboard) {
            const actionState = Input.getActionState(playerIndex, action);
            if (actionState.pressed) {
                pressedActions.push(actionState);
            }
        }

        return pressedActions;
    }

    /**
     * Consumes the given key by setting its key state to "consumed".
     * @param key The key to consume.
     */
    public static consumeKey(key: string) {
        Input.KeyPressedConsumedState[key] = true;
    }

    /**
     * Consumes the given button press for the specified player index.
     * @param playerIndex The index of the player whose button press should be consumed.
     * @param button The button to consume.
     */
    public static consumeButton(playerIndex: number, button: number) {
        if (Input.GamepadButtonPressedConsumedStates[playerIndex]) {
            Input.GamepadButtonPressedConsumedStates[playerIndex][button] = true;
        }
    }

    /**
     * Consumes the input action for the specified player index.
     * @param playerIndex The index of the player whose input should be consumed.
     * @param action The name of the input action to consume.
     */
    public static consumeAction(playerIndex: number, action: string) {
        const inputMap = Input.inputMaps[playerIndex];
        if (!inputMap) return;

        const keyboardKey = inputMap.keyboard?.[action];
        const gamepadButton = inputMap.gamepad?.[action] ? Input.GAMEPAD_BUTTONS[inputMap.gamepad[action]] : null;

        if (keyboardKey) {
            this.consumeKey(keyboardKey);
        }

        if (gamepadButton) {
            const gamepadButtonStates = Input.GamepadButtonStates[playerIndex];
            if (gamepadButtonStates && gamepadButtonStates[gamepadButton]) {
                this.consumeButton(playerIndex, gamepadButton);
            }
        }
    }

    /**
     * Returns the pressed state of a key or button, and optionally checks if it was clicked.
     * @param stateMap - The state map to check for the key or button.
     * @param checkedStateMap - The click state map to check for the key or button.
     * @param key - The key or button to check the state of.
     * @param checkClick - Whether to check if the key or button was clicked.
     * @returns The pressed state of the key or button.
     */
    private static getPressedState(
        stateMap: Index2State,
        checkedStateMap: Index2State,
        key: string | number
    ): ButtonState {
        return { pressed: stateMap[key], consumed: checkedStateMap[key] };
    }

    /**
     * Returns the pressed state of a key, and optionally checks if it was clicked.
     * @param key - The key to check the state of.
     * @returns The pressed state of the key.
     */
    private static getKeyState(key: string): ButtonState {
        return Input.getPressedState(Input.KeyState, Input.KeyPressedConsumedState, key);
    }

    /**
     * Returns the pressed state of a gamepad button, and optionally checks if it was clicked.
     * @param playerIndex - The index of the player to check the button for.
     * @param btn - The index of the button to check the state of.
     * @param checkClick - Whether to check if the button was clicked.
     * @returns The pressed state of the button.
     */
    private static getGamepadButtonState(playerIndex: number, btn: number): ButtonState {
        const stateMap = Input.GamepadButtonStates[playerIndex] || {};
        const pressRequestedStateMap = Input.GamepadButtonPressedConsumedStates[playerIndex] || {};
        return Input.getPressedState(stateMap, pressRequestedStateMap, btn);
    }

    /**
     * Checks if a specific key is currently being pressed down.
     * @param key - The key to check.
     * @returns True if the key is being pressed down, false otherwise.
     */
    public static isKeyDown(key: string): boolean {
        const buttonState = Input.getKeyState(key);
        return buttonState.pressed;
    }

    /**
     * Checks if a specific button on a gamepad is currently being pressed down.
     * @param playerIndex - The index of the player's gamepad.
     * @param btn - The button code of the gamepad button to check.
     * @returns A boolean indicating whether the button is currently pressed down.
     */
    public static isGamepadButtonDown(playerIndex: number, btn: number): boolean {
        const buttonState = Input.getGamepadButtonState(playerIndex, btn);
        return buttonState.pressed;
    }

    private static checkAndConsume(key: string, button?: number): boolean {
        const keyState = Input.getKeyState(key);

        if (keyState.pressed && !keyState.consumed) {
            Input.consumeKey(key);
            return true;
        }

        if (button !== undefined && Input.isGamepadConnected(0)) {
            const buttonState = Input.getGamepadButtonState(0, button);
            if (buttonState.pressed && !buttonState.consumed) {
                Input.consumeButton(0, button);
                return true;
            }
        }

        return false;
    }

    public static get KC_F1(): boolean {
        return Input.checkAndConsume(Key.F1);
    }

    public static get KC_F12(): boolean {
        return Input.checkAndConsume('F12');
    }

    public static get KC_F2(): boolean {
        return Input.checkAndConsume('F2');
    }

    public static get KC_F3(): boolean {
        return Input.checkAndConsume('F3');
    }

    public static get KC_F4(): boolean {
        return Input.checkAndConsume('F4');
    }

    public static get KC_F5(): boolean {
        return Input.checkAndConsume('F5');
    }

    public static get KC_M(): boolean {
        return Input.checkAndConsume('KeyM');
    }

    public static get KC_SPACE(): boolean {
        return Input.checkAndConsume('Space');
    }

    public static get KC_UP(): boolean {
        return Input.checkAndConsume('ArrowUp', Input.GAMEPAD_BUTTONS.up);
    }

    public static get KC_RIGHT(): boolean {
        return Input.checkAndConsume('ArrowRight', Input.GAMEPAD_BUTTONS.right);
    }

    public static get KC_DOWN(): boolean {
        return Input.checkAndConsume('ArrowDown', Input.GAMEPAD_BUTTONS.down);
    }

    public static get KC_LEFT(): boolean {
        return Input.checkAndConsume('ArrowLeft', Input.GAMEPAD_BUTTONS.left);
    }

    public static get KC_BTN1(): boolean {
        return Input.checkAndConsume('ShiftLeft', Input.GAMEPAD_BUTTONS.a);
    }

    public static get KC_BTN2(): boolean {
        return Input.checkAndConsume('KeyZ', Input.GAMEPAD_BUTTONS.b);
    }

    public static get KC_BTN3(): boolean {
        return Input.checkAndConsume('F1', Input.GAMEPAD_BUTTONS.x);
    }

    public static get KC_BTN4(): boolean {
        return Input.checkAndConsume('F5', Input.GAMEPAD_BUTTONS.y);
    }

    public static get KD_F1(): boolean {
        return Input.getKeyState('F1').pressed;
    }
    public static get KD_F12(): boolean {
        return Input.getKeyState('F12').pressed;
    }
    public static get KD_F2(): boolean {
        return Input.getKeyState('F2').pressed;
    }
    public static get KD_F3(): boolean {
        return Input.getKeyState('F3').pressed;
    }
    public static get KD_F4(): boolean {
        return Input.getKeyState('F4').pressed;
    }
    public static get KD_F5(): boolean {
        return Input.getKeyState('F5').pressed;
    }
    public static get KD_M(): boolean {
        return Input.getKeyState('KeyM').pressed;
    }
    public static get KD_SPACE(): boolean {
        return Input.getKeyState('Space').pressed;
    }
    public static get KD_UP(): boolean {
        return Input.getKeyState('ArrowUp').pressed || Input.getGamepadButtonState(0, Input.GAMEPAD_BUTTONS.up).pressed;
    }
    public static get KD_RIGHT(): boolean {
        return Input.getKeyState('ArrowRight').pressed || Input.getGamepadButtonState(0, Input.GAMEPAD_BUTTONS.right).pressed;
    }
    public static get KD_DOWN(): boolean {
        return Input.getKeyState('ArrowDown').pressed || Input.getGamepadButtonState(0, Input.GAMEPAD_BUTTONS.down).pressed;
    }
    public static get KD_LEFT(): boolean {
        return Input.getKeyState('ArrowLeft').pressed || Input.getGamepadButtonState(0, Input.GAMEPAD_BUTTONS.left).pressed;
    }
    public static get KD_BTN1(): boolean {
        return Input.getKeyState('ShiftLeft').pressed || Input.getGamepadButtonState(0, Input.GAMEPAD_BUTTONS.a).pressed;
    }
    public static get KD_BTN2(): boolean {
        return Input.getKeyState('KeyZ').pressed || Input.getGamepadButtonState(0, Input.GAMEPAD_BUTTONS.b).pressed;
    }
    public static get KD_BTN3(): boolean {
        return Input.getKeyState('F1').pressed || Input.getGamepadButtonState(0, Input.GAMEPAD_BUTTONS.x).pressed;
    }
    public static get KD_BTN4(): boolean {
        return Input.getKeyState('F5').pressed || Input.getGamepadButtonState(0, Input.GAMEPAD_BUTTONS.y).pressed;
    }

    /**
     * Handles debug events such as mouse events and touch events.
     *
     * @param e The event object representing the debug event.
     */
    private static handleDebugEvents(e: MouseEvent | TouchEvent): void {
        if (e instanceof MouseEvent) {
            switch (e.type) {
                case "mousedown":
                    handleDebugMouseDown(e);
                    break;
                case "mousemove":
                    handleDebugMouseMove(e);
                    break;
                case "mouseup":
                    handleDebugMouseDragEnd(e);
                    break;
                case "mouseout":
                    handleDebugMouseOut(e);
                    break;
                case "contextmenu":
                    handleDebugContextMenu(e);
                    break;
                case "click":
                    handleDebugClick(e);
                    break;
            }
        } else if (e instanceof TouchEvent) {
            switch (e.type) {
                case "touchstart":
                    // handleDebugTouchStart(e);
                    break;
                case "touchmove":
                    // handleDebugTouchMove(e);
                    break;
                case "touchend":
                    // handleDebugTouchEnd(e);
                    break;
                case "touchcancel":
                    // handleDebugTouchCancel(e);
                    break;
            }
        }
    }

    /**
     * Initializes the input system.
     * @param debug Whether to enable debug mode. Default is true.
     */
    public static init(debug = true): void {
        Input.KeyState = {};
        Input.KeyPressedConsumedState = {};
        Input.reset();
        const options = {
            passive: false,
            once: false,
        };

        window.addEventListener('beforeunload', e => { e.preventDefault(); return e.returnValue = 'Are you sure you want to exit this awesome game?'; }, true);

        /**
         * Assigns a gamepad to a player and returns the player index.
         * If no player index is available, returns null.
         * @param gamepad The gamepad to assign to a player.
         * @returns The player index the gamepad was assigned to, or null if no player index was available.
         */
        const assignGamepadToPlayer = (gamepad: Gamepad): number | null => {
            // Find the next available player index
            const playerIndex = Input.getNextAvailablePlayerIndex();
            if (playerIndex === undefined) return null;
            console.info(`Gamepad ${gamepad.index} assigned to player ${playerIndex}`);

            // Assign gamepad to player
            Input.GamepadPlayerMap[gamepad.index] = playerIndex;
            Input.GamepadButtonStates[playerIndex] = {};
            Input.GamepadButtonPressedConsumedStates[playerIndex] = {};

            return playerIndex;
        };

        // Initialize gamepad states for already connected gamepads
        const gamepads = navigator.getGamepads();
        for (let i = 0; i < gamepads.length; i++) {
            const gamepad = gamepads[i];
            if (!gamepad || !gamepad.id.toLowerCase().includes('gamepad')) continue;

            assignGamepadToPlayer(gamepad);
        }

        /**
         * Event listener for when a gamepad is connected. Assigns the gamepad to a player and dispatches a player join event.
         * @param e The gamepad event.
         */
        window.addEventListener("gamepadconnected", function (e: GamepadEvent) {
            const gamepad = e.gamepad;
            if (!gamepad || !gamepad.id.toLowerCase().includes('gamepad')) return;
            console.info(`Gamepad ${gamepad.index} connected`);

            let playerIndex = assignGamepadToPlayer(gamepad);

            if (playerIndex != null) EventEmitter.getInstance().emit('playerjoin', { id: 'input' }, playerIndex); // Note: The part { id: 'input' } is a temporary and ugly hack to make the event emitter happy. It should be removed once the Input class is refactored as a singleton.
        });

        window.addEventListener("gamepaddisconnected", function (e: GamepadEvent) {
            const gamepad = e.gamepad;
            if (!gamepad.id.toLowerCase().includes('gamepad')) return;

            // Find player index for disconnected gamepad
            const playerIndex = Input.GamepadPlayerMap[gamepad.index];
            if (playerIndex === undefined) return;

            // Remove gamepad from player map
            delete Input.GamepadPlayerMap[gamepad.index];

            console.info(`Gamepad ${gamepad.index}, that was assigned to player ${playerIndex}, disconnected`);

            // Remove button states for corresponding player index
            if (Input.GamepadButtonStates[playerIndex]) {
                delete Input.GamepadButtonStates[playerIndex];
            }
            if (Input.GamepadButtonPressedConsumedStates[playerIndex]) {
                delete Input.GamepadButtonPressedConsumedStates[playerIndex];
            }
        });

        window.addEventListener('keydown', e => { preventDefaultEventAction(e, e.code); keydown(e.code); }, options);
        window.addEventListener('keyup', e => { preventDefaultEventAction(e, e.code); keyup(e.code); }, options);
        window.addEventListener('blur', blur, false);

        document.addEventListener('touchmove', e => { preventActionAndPropagation(e); handleTouchStuff(e); return false; }, options);
        document.addEventListener('touchstart', e => { preventActionAndPropagation(e); handleTouchStuff(e); return false; }, options);
        document.addEventListener('touchend', e => { preventActionAndPropagation(e); handleTouchStuff(e); return false; }, options);
        document.addEventListener('touchcancel', e => { preventActionAndPropagation(e); handleTouchStuff(e); return false; }, options);

        document.addEventListener('webkitmouseforcewillbegin', e => preventActionAndPropagation(e), options);
        window.addEventListener('webkitmouseforcewillbegin', e => preventActionAndPropagation(e), options);
        document.addEventListener('webkitmouseforcedown', e => preventActionAndPropagation(e), options);
        window.addEventListener('webkitmouseforcedown', e => preventActionAndPropagation(e), options);
        document.addEventListener('contextmenu', e => {
            if (e.target === document.getElementById('gamescreen')) {
                return true; // Allow context menu on gamescreen
            } else {
                e.preventDefault(); // Suppress context menu on rest of document
                return false;
            }
        }, false);
        document.addEventListener('touchforcechange', e => preventActionAndPropagation(e), options);// iOS -- https://stackoverflow.com/questions/58159526/draggable-element-in-iframe-on-mobile-is-buggy && iOS -- https://stackoverflow.com/questions/50980876/can-you-prevent-3d-touch-on-an-img-but-not-tap-and-hold-to-save

        if (debug) {
            const gamescreen = document.getElementById('gamescreen');
            gamescreen.addEventListener('click', Input.handleDebugEvents, options);
            gamescreen.addEventListener('mousedown', Input.handleDebugEvents, options);
            gamescreen.addEventListener('mousemove', Input.handleDebugEvents, options);
            gamescreen.addEventListener('mouseup', Input.handleDebugEvents, options);
            gamescreen.addEventListener('mouseout', Input.handleDebugEvents, options);
            gamescreen.addEventListener('contextmenu', Input.handleDebugEvents, options);
        }
    }

    /**
     * Polls the state of all connected gamepads and updates the corresponding button states.
     * This function should be called once per frame to ensure that gamepad input is up-to-date.
     */
    public static pollGamepadInput(): void {
        let gamepads: Gamepad[] = navigator.getGamepads ? navigator.getGamepads() : ((navigator as any).webkitGetGamepads ? (navigator as any).webkitGetGamepads : undefined);
        if (!gamepads) return;

        for (let gamepad of gamepads) {
            if (!gamepad) continue;
            if (!gamepad.id.toLowerCase().includes('gamepad')) continue;

            // Reset gamepad button states
            const playerIndex = Input.GamepadPlayerMap[gamepad.index];
            Input.GamepadButtonStates[playerIndex] = {};
            if (!Input.GamepadButtonPressedConsumedStates[playerIndex]) {
                Input.GamepadButtonPressedConsumedStates[playerIndex] = {};
            }

            // Check whether any axes have been triggered
            Input.pollGamepadAxes(gamepad, playerIndex);

            // Check button states
            Input.pollGamepadButtons(gamepad, playerIndex);
        }
    }

    /**
     * Polls the state of the axes on the given gamepad and updates the corresponding button states.
     * @param gamepad The gamepad to poll.
     */
    private static pollGamepadAxes(gamepad: Gamepad, playerIndex: number): void {
        const [xAxis, yAxis] = gamepad.axes;
        Input.GamepadButtonStates[playerIndex][Input.GAMEPAD_BUTTONS.left] = xAxis < -0.5;
        Input.GamepadButtonStates[playerIndex][Input.GAMEPAD_BUTTONS.right] = xAxis > 0.5;
        Input.GamepadButtonStates[playerIndex][Input.GAMEPAD_BUTTONS.up] = yAxis < -0.5;
        Input.GamepadButtonStates[playerIndex][Input.GAMEPAD_BUTTONS.down] = yAxis > 0.5;
    }

    /**
     * Polls the state of all buttons on the given gamepad and updates the corresponding button states.
     * @param gamepad The gamepad to poll.
     */
    private static pollGamepadButtons(gamepad: Gamepad, playerIndex: number): void {
        const buttons = gamepad.buttons;
        if (!buttons) return;
        for (let btnIndex = 0; btnIndex < buttons.length; btnIndex++) {
            const btn = buttons[btnIndex];
            const pressed = typeof btn === "object" ? btn.pressed : btn === 1.0;
            // Consider that the button can already be regarded as pressed if it was pressed as part of another action, like an axis
            Input.GamepadButtonStates[playerIndex][btnIndex] = Input.GamepadButtonStates[playerIndex][btnIndex] || pressed;
            if (!pressed) {
                Input.GamepadButtonPressedConsumedStates[playerIndex][btnIndex] = false;
            }
        }
    }

    /**
     * Returns the index of the next available player for gamepad input, or undefined if no player is available.
     * A player is considered available if there is a connected gamepad that is not already assigned to a player.
     * @returns The index of the next available player, or undefined if no player is available.
     */
    private static getNextAvailablePlayerIndex(): number | undefined {
        for (let i = 0; i < navigator.getGamepads().length; i++) {
            if (Input.isGamepadConnected(i)) {
                return i;
            }
        }
        return undefined;
    }

    /**
     * Checks if a gamepad is connected for the specified player index.
     * @param playerIndex - The index of the player.
     * @returns True if a gamepad is connected for the specified player index, false otherwise.
     */
    private static isGamepadConnected(playerIndex: number): boolean {
        return Input.GamepadPlayerMap[playerIndex] !== undefined;
    }

    /**
     * Resets the state of all input keys and gamepad buttons.
     * @param except An optional array of keys or buttons to exclude from the reset.
     */
    public static reset(except?: string[]): void {
        const resetObject = (obj: Index2State) => {
            Object.keys(obj).forEach(key => {
                if (!except || !except.includes(key)) {
                    delete obj[key];
                }
            });
        };

        resetObject(Input.KeyState);
        resetObject(Input.KeyPressedConsumedState);
        Input.GamepadButtonStates.forEach(gamepad => resetObject(gamepad));
        Input.GamepadButtonPressedConsumedStates.forEach(gamepad => resetObject(gamepad));
    }

    /**
     * Resets the state of all UI elements related to the gamepad input.
     * This function is used to clear the state of all UI elements that represent the gamepad input buttons.
     * It is called once per frame to ensure that the UI is up-to-date with the current gamepad input state.
     */
    public static resetUI(): void {
        const dpadlist = ['d-pad-u', 'd-pad-ru', 'd-pad-r', 'd-pad-rd', 'd-pad-d', 'd-pad-ld', 'd-pad-l', 'd-pad-lu', 'btn1_knop', 'btn2_knop', 'btn3_knop', 'btn4_knop'];
        let d: HTMLElement;
        for (let i = 0; i < dpadlist.length; i++) {
            d = document.getElementById(dpadlist[i]);
            if (d.classList.contains('druk')) {
                d.classList.remove('druk');
                d.classList.add('los');
            }
        }
    }
}

/**
 * Prevents the default action of a UI event based on the key pressed, except for certain keys when the game is running or not paused.
 * @param e The UI event to prevent the default action of.
 * @param key The key pressed that triggered the event.
 */
function preventDefaultEventAction(e: UIEvent, key: string) {
    if (global.game.running || !global.game.paused) {
        switch (key) {
            case 'Escape':
            case 'Esc':
            case 'F12':
                break;
            case 'F6':
                e.preventDefault();
                handleOpenDebugMenu(e);
                break;
            case 'F7':
                e.preventDefault();
                handleOpenObjectMenu(e);
                break;
            case 'F11':
                e.preventDefault();
                if (global.view.isFullscreen)
                    global.view.ToWindowed();
                else global.view.toFullscreen();
                break;
            default:
                e.preventDefault();
                break;
        }
    }
}

/**
 * Sets the key state to true when a key is pressed.
 * @param key - The button ID or string representing the key.
 */
function keydown(key: ButtonId | string): void {
    Input.KeyState[key] = true;
}

/**
 * Handles the keyup event for a given key.
 * @param key - The key identifier or name.
 */
function keyup(key: ButtonId | string): void {
    Input.KeyState[key] = Input.KeyPressedConsumedState[key] = false;
}

function blur(e: FocusEvent): void {
    Input.reset();
}

/**
 * Handles touch events by resetting the UI and checking which elements were touched.
 * If an element is touched, it adds the 'druk' class to it and removes the 'los' class.
 * It also filters the touched buttons from the reset.
 * @param e The touch event to handle.
 */
function handleTouchStuff(e: TouchEvent): void {
    Input.resetUI();
    if (e.touches.length == 0) {
        Input.reset();
        return;
    }

    let filterFromReset: string[] = [];
    for (let i = 0; i < e.touches.length; i++) {
        let pos = e.touches[i];
        let elementTouched = document.elementFromPoint(pos.clientX, pos.clientY);
        if (elementTouched) {
            let buttonsTouched = handleElementUnderTouch(elementTouched);
            if (buttonsTouched.length > 0) {
                elementTouched.classList.add('druk');
                elementTouched.classList.remove('los');

                buttonsTouched.forEach(b => filterFromReset.push(b));
            }
        }
    }
    Input.reset(filterFromReset);
}

/**
 * Mapping of button names to their corresponding key inputs.
 */
const buttonMap = {
    'd-pad-u': {
        keys: [Key.ArrowUp],
    },
    'd-pad-ru': {
        keys: [Key.ArrowUp, Key.ArrowRight],
    },
    'd-pad-r': {
        keys: [Key.ArrowRight],
    },
    'd-pad-rd': {
        keys: [Key.ArrowDown, Key.ArrowRight],
    },
    'd-pad-d': {
        keys: [Key.ArrowDown],
    },
    'd-pad-ld': {
        keys: [Key.ArrowLeft, Key.ArrowDown],
    },
    'd-pad-l': {
        keys: [Key.ArrowLeft],
    },
    'd-pad-lu': {
        keys: [Key.ArrowUp, Key.ArrowLeft],
    },
    'btn1_knop': {
        keys: ['BTN1', 'ShiftLeft'],
    },
    'btn2_knop': {
        keys: ['BTN2', 'KeyZ'],
    },
    'btn3_knop': {
        keys: ['BTN3', 'F1'],
    },
    'btn4_knop': {
        keys: ['BTN4', 'F5'],
    },
}

/**
 * Handles the element under touch by triggering the corresponding keydown event and adding the 'druk' class to the element.
 * @param e The element under touch.
 * @returns An array of keys or buttons that were triggered by the touch event.
 */
function handleElementUnderTouch(e: Element): (ButtonId | string)[] {
    const buttonData = buttonMap[e.id];
    if (buttonData) {
        buttonData.keys.forEach(key => keydown(key));
        document.getElementById(e.id).classList.add('druk');
        return buttonData.keys;
    }
    return [];
}
