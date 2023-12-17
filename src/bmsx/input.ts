import { Key } from 'ts-key-enum';
import { handleDebugClick, handleDebugMouseDown, handleDebugMouseUp, handleDebugMouseMove, handleDebugMouseOut, handleContextMenu as handleDebugContextMenu, handleOpenObjectMenu, handleOpenDebugMenu as handleOpenDebugMenu } from './bmsxdebugger';
import { EventEmitter } from './eventemitter';
import { IIdentifiable } from './gameobject';

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
function preventActionAndPropagation(e: Event): boolean {
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

const options = {
    passive: false,
    once: false,
};

export class Input implements IIdentifiable {
    private static instance: Input;
    private static playerInputs: PlayerInput[] = [];

    public static getInstance(debug = false): Input {
        if (!Input.instance) {
            Input.instance = new Input(debug);
        }
        return Input.instance;
    }

    public static getPlayerInput(playerIndex: number): PlayerInput {
        const index = playerIndex - 1;
        if (!Input.playerInputs[index]) {
            Input.playerInputs[index] = new PlayerInput(playerIndex);
        }
        return Input.playerInputs[index];
    }

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
     * Prevents the default action of a UI event based on the key pressed, except for certain keys when the game is running or not paused.
     * @param e The UI event to prevent the default action of.
     * @param key The key pressed that triggered the event.
     */
    static preventDefaultEventAction(e: UIEvent, key: string) {
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
                    // e.preventDefault();
                    break;
            }
        }
    }

    public readonly id: string = 'input';

    /**
     * Initializes the input system.
     * @param debug Whether to enable debug mode. Default is true.
     */
    constructor(debug = true) {
        const self = this;

        /**
         * Returns the index of the next available player for gamepad input, or undefined if no player is available.
         * A player is considered available if there is a connected gamepad that is not already assigned to a player.
         * @returns The index of the next available player, or undefined if no player is available.
         */
        const getNextAvailablePlayerIndex = (): number | null => {
            for (let i = 0; i < Input.playerInputs.length; i++) {
                const playerInput = Input.playerInputs[i];
                if (playerInput.gamepadIndex === null) return playerInput.playerIndex;
            }
            return null;
        }

        // /**
        //  * Assigns a gamepad to a player and returns the player index.
        //  * If no player index is available, returns null.
        //  * @param gamepad The gamepad to assign to a player.
        //  * @returns The player index the gamepad was assigned to, or null if no player index was available.
        //  */
        const assignGamepadToPlayer = (gamepad: Gamepad): number | null => {
            // Find the next available player index
            const playerIndex = getNextAvailablePlayerIndex();
            if (playerIndex === null) return null;

            // Assign gamepad to player
            Input.getPlayerInput(playerIndex).assignGamepadToPlayer(gamepad);

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
            console.info(`Gamepad ${gamepad.index} connected.`);

            let playerIndex = assignGamepadToPlayer(gamepad);

            if (playerIndex != null) EventEmitter.getInstance().emit('playerjoin', self, playerIndex);
        });

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
            gamescreen.addEventListener('click', this.handleDebugEvents, options);
            gamescreen.addEventListener('mousedown', this.handleDebugEvents, options);
            gamescreen.addEventListener('mousemove', this.handleDebugEvents, options);
            gamescreen.addEventListener('mouseup', this.handleDebugEvents, options);
            gamescreen.addEventListener('mouseout', this.handleDebugEvents, options);
            gamescreen.addEventListener('contextmenu', this.handleDebugEvents, options);
            window.addEventListener('keydown', this.handleDebugEvents);
            window.addEventListener('click', function (e) {
                if ((e.target as Element).matches('ul.tree li:before')) {
                    const parentNode = (e.target as HTMLElement).parentNode as HTMLElement;
                    parentNode?.classList.toggle('open');
                }
            });
        }
    }

    public pollInput(): void {
        Input.playerInputs.forEach(player => { player.pollGamepadInput(); });
    }

    public static get KC_F1(): boolean {
        return Input.getPlayerInput(1).checkAndConsume(Key.F1);
    }

    public static get KC_F12(): boolean {
        return Input.getPlayerInput(1).checkAndConsume('F12');
    }

    public static get KC_F2(): boolean {
        return Input.getPlayerInput(1).checkAndConsume('F2');
    }

    public static get KC_F3(): boolean {
        return Input.getPlayerInput(1).checkAndConsume('F3');
    }

    public static get KC_F4(): boolean {
        return Input.getPlayerInput(1).checkAndConsume('F4');
    }

    public static get KC_F5(): boolean {
        return Input.getPlayerInput(1).checkAndConsume('F5');
    }

    public static get KC_M(): boolean {
        return Input.getPlayerInput(1).checkAndConsume('KeyM');
    }

    public static get KC_SPACE(): boolean {
        return Input.getPlayerInput(1).checkAndConsume('Space');
    }

    public static get KC_UP(): boolean {
        return Input.getPlayerInput(1).checkAndConsume('ArrowUp', Input.GAMEPAD_BUTTONS.up);
    }

    public static get KC_RIGHT(): boolean {
        return Input.getPlayerInput(1).checkAndConsume('ArrowRight', Input.GAMEPAD_BUTTONS.right);
    }

    public static get KC_DOWN(): boolean {
        return Input.getPlayerInput(1).checkAndConsume('ArrowDown', Input.GAMEPAD_BUTTONS.down);
    }

    public static get KC_LEFT(): boolean {
        return Input.getPlayerInput(1).checkAndConsume('ArrowLeft', Input.GAMEPAD_BUTTONS.left);
    }

    public static get KC_BTN1(): boolean {
        return Input.getPlayerInput(1).checkAndConsume('ShiftLeft', Input.GAMEPAD_BUTTONS.a);
    }

    public static get KC_BTN2(): boolean {
        return Input.getPlayerInput(1).checkAndConsume('KeyZ', Input.GAMEPAD_BUTTONS.b);
    }

    public static get KC_BTN3(): boolean {
        return Input.getPlayerInput(1).checkAndConsume('F1', Input.GAMEPAD_BUTTONS.x);
    }

    public static get KC_BTN4(): boolean {
        return Input.getPlayerInput(1).checkAndConsume('F5', Input.GAMEPAD_BUTTONS.y);
    }

    public static get KD_F1(): boolean {
        return Input.getPlayerInput(1).getKeyState('F1').pressed;
    }
    public static get KD_F12(): boolean {
        return Input.getPlayerInput(1).getKeyState('F12').pressed;
    }
    public static get KD_F2(): boolean {
        return Input.getPlayerInput(1).getKeyState('F2').pressed;
    }
    public static get KD_F3(): boolean {
        return Input.getPlayerInput(1).getKeyState('F3').pressed;
    }
    public static get KD_F4(): boolean {
        return Input.getPlayerInput(1).getKeyState('F4').pressed;
    }
    public static get KD_F5(): boolean {
        return Input.getPlayerInput(1).getKeyState('F5').pressed;
    }
    public static get KD_M(): boolean {
        return Input.getPlayerInput(1).getKeyState('KeyM').pressed;
    }
    public static get KD_SPACE(): boolean {
        return Input.getPlayerInput(1).getKeyState('Space').pressed;
    }
    public static get KD_UP(): boolean {
        return Input.getPlayerInput(1).getKeyState('ArrowUp').pressed || Input.getPlayerInput(1).getGamepadButtonState(Input.GAMEPAD_BUTTONS.up).pressed;
    }
    public static get KD_RIGHT(): boolean {
        return Input.getPlayerInput(1).getKeyState('ArrowRight').pressed || Input.getPlayerInput(1).getGamepadButtonState(Input.GAMEPAD_BUTTONS.right).pressed;
    }
    public static get KD_DOWN(): boolean {
        return Input.getPlayerInput(1).getKeyState('ArrowDown').pressed || Input.getPlayerInput(1).getGamepadButtonState(Input.GAMEPAD_BUTTONS.down).pressed;
    }
    public static get KD_LEFT(): boolean {
        return Input.getPlayerInput(1).getKeyState('ArrowLeft').pressed || Input.getPlayerInput(1).getGamepadButtonState(Input.GAMEPAD_BUTTONS.left).pressed;
    }
    public static get KD_BTN1(): boolean {
        return Input.getPlayerInput(1).getKeyState('ShiftLeft').pressed || Input.getPlayerInput(1).getGamepadButtonState(Input.GAMEPAD_BUTTONS.a).pressed;
    }
    public static get KD_BTN2(): boolean {
        return Input.getPlayerInput(1).getKeyState('KeyZ').pressed || Input.getPlayerInput(1).getGamepadButtonState(Input.GAMEPAD_BUTTONS.b).pressed;
    }
    public static get KD_BTN3(): boolean {
        return Input.getPlayerInput(1).getKeyState('F1').pressed || Input.getPlayerInput(1).getGamepadButtonState(Input.GAMEPAD_BUTTONS.x).pressed;
    }
    public static get KD_BTN4(): boolean {
        return Input.getPlayerInput(1).getKeyState('F5').pressed || Input.getPlayerInput(1).getGamepadButtonState(Input.GAMEPAD_BUTTONS.y).pressed;
    }

    /**
    * Handles debug events such as mouse events and touch events.
    *
    * @param e The event object representing the debug event.
    */
    private handleDebugEvents(e: MouseEvent | TouchEvent | KeyboardEvent): void {
        if (e instanceof KeyboardEvent) {
            switch (e.code) {
                case 'Space':
                    if (Input.getPlayerInput(2).getKeyState(e.code).consumed) break;
                    else Input.getPlayerInput(2).consumeKey(e.code);
                    if (!global.game.paused) {
                        global.game.paused = true;
                        global.game.debug_runSingleFrameAndPause = false;
                    }
                    else {
                        global.game.paused = false;
                        global.game.debug_runSingleFrameAndPause = Input.getPlayerInput(2).getKeyState('ShiftLeft').pressed;
                    }
                    break;
            }
        }
        else if (e instanceof MouseEvent) {
            switch (e.type) {
                case "mousedown":
                    handleDebugMouseDown(e);
                    break;
                case "mousemove":
                    handleDebugMouseMove(e);
                    break;
                case "mouseup":
                    handleDebugMouseUp(e);
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
}

/**
 * Represents the Input class responsible for handling user this.
 */
export class PlayerInput {
    public playerIndex: number;
    public gamepadIndex: number | null;
    /**
     * The state of each keyboard key.
     */
    public KeyState: Index2State = {};

    /**
     * The state of each keyboard key click request.
     */
    public KeyPressedConsumedState: Index2State = {};

    /**
     * The state of each gamepad button for each player.
     */
    private GamepadButtonStates: Index2State = {};

    /**
     * The state of each gamepad button click request for each player.
     */
    private GamepadButtonPressedConsumedStates: Index2State = {};

    /**
     * The input maps for each player.
     * @private
     * @param {number} playerIndex - The index of the player to set the input map for.
     * @param {InputMap} inputMap - The input map to set for the player.
     * @returns {void}
     * @throws {Error} Throws an error if the player index is out of range.
     * @throws {Error} Throws an error if the input map is invalid.
     * @see {@link this.getActionState} and {@link this.getPressedActions} for checking if an action is pressed for a player.
     * @example
     * this.setInputMap(0, {
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
    private inputMap: InputMap;

    preventInput: boolean; // Prevents input from being registered. For instance, when the game loses focus.

    /**
     * Sets the input map for a specific player.
     * @param inputMap - The input map to set.
     */
    public setInputMap(inputMap: InputMap): void {
        this.inputMap = inputMap;
    }

    /**
     * Returns whether a specific action is currently pressed for a given player index, and optionally checks if it was clicked.
     * @param action - The name of the action to check.
     * @returns Whether the action is currently pressed for the given player index.
     */
    public getActionState(action: string): ActionState {
        const inputMap = this.inputMap;
        if (!inputMap) return { action, pressed: false, consumed: false };

        const keyboardKey = inputMap.keyboard ? inputMap.keyboard[action] : null;
        const gamepadButton = inputMap.gamepad ? Input.GAMEPAD_BUTTONS[inputMap.gamepad[action]] : null;

        const keyboardButtonState = this.getKeyState(keyboardKey);
        const gamepadButtonState = this.getGamepadButtonState(gamepadButton);
        return { action: action, pressed: keyboardButtonState.pressed || (gamepadButtonState?.pressed ?? false), consumed: keyboardButtonState.consumed && (gamepadButtonState?.consumed ?? true) };
    }

    /**
     * Returns all actions that have been pressed for a given player index.
     * @returns An array of objects containing the name of the action and whether it was clicked.
     */
    public getPressedActions(): ActionState[] {
        const inputMap = this.inputMap;
        if (!inputMap) return [];

        const pressedActions: ActionState[] = [];

        for (const action in inputMap.keyboard ?? inputMap.gamepad) {
            const actionState = this.getActionState(action);
            if (actionState.pressed) {
                pressedActions.push(actionState);
            }
        }

        return pressedActions;
    }

    /**
     * Retrieves the priority actions for a given player index based on the action priority list.
     * @param actionPriority - The list of action priorities.
     * @returns An array of ActionObject representing the priority actions.
     */
    getPressedPriorityActions(actionPriority: string[]): ActionState[] {
        const pressedActions = this.getPressedActions();
        const priorityActions: ActionState[] = [];

        for (const priorityAction of actionPriority) {
            const actionObject = pressedActions.find(action => action.action === priorityAction);

            if (actionObject) {
                priorityActions.push(actionObject);
            }
        }

        return priorityActions;
    }

    /**
     * Consumes the given key by setting its key state to "consumed".
     * @param key The key to consume.
     */
    public consumeKey(key: string) {
        this.KeyPressedConsumedState[key] = true;
    }

    /**
     * Consumes the given button press for the specified player index.
     * @param button The button to consume.
     */
    public consumeButton(button: number) {
        if (this.GamepadButtonPressedConsumedStates) {
            this.GamepadButtonPressedConsumedStates[button] = true;
        }
    }

    /**
     * Consumes the input action for the specified player index.
     * @param action The name of the input action to consume.
     */
    public consumeAction(action: string) {
        const inputMap = this.inputMap;
        if (!inputMap) return;

        const keyboardKey = inputMap.keyboard?.[action];
        const gamepadButton = inputMap.gamepad?.[action] ? Input.GAMEPAD_BUTTONS[inputMap.gamepad[action]] : null;

        if (keyboardKey) {
            this.consumeKey(keyboardKey);
        }

        if (gamepadButton) {
            const gamepadButtonStates = this.GamepadButtonStates;
            if (gamepadButtonStates && gamepadButtonStates[gamepadButton]) {
                this.consumeButton(gamepadButton);
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
    private getPressedState(
        stateMap: Index2State,
        checkedStateMap: Index2State,
        key: string | number
    ): ButtonState {
        return { pressed: stateMap[key] ?? false, consumed: checkedStateMap[key] ?? false };
    }

    /**
     * Returns the pressed state of a key, and optionally checks if it was clicked.
     * @param key - The key to check the state of.
     * @returns The pressed state of the key.
     */
    public getKeyState(key: string): ButtonState {
        if (key === null) return { pressed: false, consumed: false };
        return this.getPressedState(this.KeyState, this.KeyPressedConsumedState, key);
    }

    /**
     * Returns the pressed state of a gamepad button, and optionally checks if it was clicked.
     * @param btn - The index of the button to check the state of.
     * @param checkClick - Whether to check if the button was clicked.
     * @returns The pressed state of the button.
     */
    public getGamepadButtonState(btn: number | null): ButtonState {
        if (btn === null) return { pressed: false, consumed: false };

        const stateMap = this.GamepadButtonStates || {};
        const pressRequestedStateMap = this.GamepadButtonPressedConsumedStates;
        if (!pressRequestedStateMap) return null;
        return this.getPressedState(stateMap, pressRequestedStateMap, btn);
    }

    /**
     * Checks if a specific key is currently being pressed down.
     * @param key - The key to check.
     * @returns True if the key is being pressed down, false otherwise.
     */
    public isKeyDown(key: string): boolean {
        const buttonState = this.getKeyState(key);
        return buttonState.pressed;
    }

    /**
     * Checks if a specific button on a gamepad is currently being pressed down.
     * @param btn - The button code of the gamepad button to check.
     * @returns A boolean indicating whether the button is currently pressed down.
     */
    public isGamepadButtonDown(btn: number): boolean {
        const buttonState = this.getGamepadButtonState(btn);
        return buttonState.pressed;
    }

    public checkAndConsume(key: string, button?: number): boolean {
        const keyState = this.getKeyState(key);

        if (keyState.pressed && !keyState.consumed) {
            this.consumeKey(key);
            return true;
        }

        if (button !== undefined && this.isGamepadConnected()) {
            const buttonState = this.getGamepadButtonState(button);
            if (buttonState.pressed && !buttonState.consumed) {
                this.consumeButton(button);
                return true;
            }
        }

        return false;
    }

    /**
    * Assigns a gamepad to a player and returns the player index.
    * If no player index is available, returns null.
    * @param gamepad The gamepad to assign to a player.
    * @returns The player index the gamepad was assigned to, or null if no player index was available.
    */
    assignGamepadToPlayer(gamepad: Gamepad): void {
        this.gamepadIndex = gamepad.index;
        this.GamepadButtonStates = {};
        this.GamepadButtonPressedConsumedStates = {};

        console.info(`Gamepad ${gamepad.index} assigned to player ${this.playerIndex}.`);
    }


    /**
     * Initializes the input system.
     * @param debug Whether to enable debug mode. Default is true.
     */
    public constructor(playerIndex: number) {
        const self = this;
        this.playerIndex = playerIndex;
        this.gamepadIndex = null; // Gamepad should be null by default, and set to a value when a gamepad is connected.
        this.KeyState = {};
        this.KeyPressedConsumedState = {};
        this.reset();

        window.addEventListener("gamepaddisconnected", function (e: GamepadEvent) {
            const gamepad = e.gamepad;
            if (!gamepad.id.toLowerCase().includes('gamepad')) return;

            if (self.gamepadIndex === null) return; // Gamepad was not assigned to this player, so ignore the event (this can happen if multiple gamepads are connected and one is disconnected)

            console.info(`Gamepad ${gamepad.index}, that was assigned to player ${playerIndex}, disconnected`);
            self.gamepadIndex = null; // Remove gamepad assignment for this player

            // Remove button states for corresponding player index
            self.GamepadButtonStates = {};
            self.GamepadButtonPressedConsumedStates = {};
        });

        window.addEventListener('keydown', e => { !this.preventInput && this.keydown(e.code); }, options);
        window.addEventListener('keyup', e => { !this.preventInput && this.keyup(e.code); }, options);
    }

    /**
     * Polls the state of all connected gamepads and updates the corresponding button states.
     * This function should be called once per frame to ensure that gamepad input is up-to-date.
     */
    public pollGamepadInput(): void {
        if (this.gamepadIndex === null) return; // No gamepad was assigned to this player
        const gamepads: Gamepad[] = navigator.getGamepads ? navigator.getGamepads() : ((navigator as any).webkitGetGamepads ? (navigator as any).webkitGetGamepads : undefined); // Get gamepads from browser API
        if (!gamepads) return; // Browser does not support gamepads API
        if (gamepads.length < this.gamepadIndex) return; // Gamepad index is out of range of connected gamepads array (this can happen if multiple gamepads are connected and one is disconnected)

        // Reset gamepad button states
        this.GamepadButtonStates = {};
        this.GamepadButtonPressedConsumedStates = {};

        // Check whether any axes have been triggered
        this.pollGamepadAxes(gamepads[this.gamepadIndex]);

        // Check button states
        this.pollGamepadButtons(gamepads[this.gamepadIndex]);
    }

    /**
     * Polls the state of the axes on the given gamepad and updates the corresponding button states.
     * @param gamepad The gamepad to poll.
     */
    private pollGamepadAxes(gamepad: Gamepad): void {
        const [xAxis, yAxis] = gamepad.axes;
        this.GamepadButtonStates[Input.GAMEPAD_BUTTONS.left] = xAxis < -0.5;
        this.GamepadButtonStates[Input.GAMEPAD_BUTTONS.right] = xAxis > 0.5;
        this.GamepadButtonStates[Input.GAMEPAD_BUTTONS.up] = yAxis < -0.5;
        this.GamepadButtonStates[Input.GAMEPAD_BUTTONS.down] = yAxis > 0.5;
    }

    /**
     * Polls the state of all buttons on the given gamepad and updates the corresponding button states.
     * @param gamepad The gamepad to poll.
     */
    private pollGamepadButtons(gamepad: Gamepad): void {
        const buttons = gamepad.buttons;
        if (!buttons) return;
        for (let btnIndex = 0; btnIndex < buttons.length; btnIndex++) {
            const btn = buttons[btnIndex];
            const pressed = typeof btn === "object" ? btn.pressed : btn === 1.0;
            // Consider that the button can already be regarded as pressed if it was pressed as part of another action, like an axis
            this.GamepadButtonStates[btnIndex] = this.GamepadButtonStates[btnIndex] || pressed;
            if (!pressed) {
                this.GamepadButtonPressedConsumedStates[btnIndex] = false;
            }
        }
    }

    /**
     * Checks if a gamepad is connected for the specified player index.
     * @returns True if a gamepad is connected for the specified player index, false otherwise.
     */
    private isGamepadConnected(): boolean {
        return this.gamepadIndex !== null;
    }

    /**
     * Resets the state of all input keys and gamepad buttons.
     * @param except An optional array of keys or buttons to exclude from the reset.
     */
    public reset(except?: string[]): void {
        const resetObject = (obj: Index2State) => {
            Object.keys(obj).forEach(key => {
                if (!except || !except.includes(key)) {
                    delete obj[key];
                }
            });
        };

        resetObject(this.KeyState);
        resetObject(this.KeyPressedConsumedState);
        resetObject(this.GamepadButtonStates);
        resetObject(this.GamepadButtonPressedConsumedStates);
    }

    /**
     * Sets the key state to true when a key is pressed.
     * @param key_code - The button ID or string representing the key.
     */
    keydown(key_code: ButtonId | string): void {
        this.KeyState[key_code] = true;
    }

    /**
     * Handles the keyup event for a given key.
     * @param key_code - The key identifier or name.
     */
    keyup(key_code: ButtonId | string): void {
        this.KeyState[key_code] = this.KeyPressedConsumedState[key_code] = false;
    }

    blur(e: FocusEvent): void {
        this.preventInput = true; // Prevent input when the window loses focus
        this.reset();
    }

    focus(e: FocusEvent): void {
        this.reset();
        this.preventInput = false; // Allow input when the window regains focus
    }

}

class OnScreenGamepad {
    /**
    * Mapping of button names to their corresponding key inputs.
    */
    private static readonly buttonMap = {
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

    private static readonly dpadlist = ['d-pad-u', 'd-pad-ru', 'd-pad-r', 'd-pad-rd', 'd-pad-d', 'd-pad-ld', 'd-pad-l', 'd-pad-lu', 'btn1_knop', 'btn2_knop', 'btn3_knop', 'btn4_knop'];


    constructor(public playerIndex: number) {
        const controlsElement = document.getElementById('controls');
        window.addEventListener('blur', this.blur, false); // Blur event will pause the game and prevent any input from being registered and reset the key states
        window.addEventListener('focus', this.focus, false); // Focus event will allow input to be registered again
        window.addEventListener('mouseout', () => this.reset(), options); // Reset input states when mouse leaves the window

        controlsElement.addEventListener('touchmove', e => { preventActionAndPropagation(e); this.handleTouchStuff(e); return false; }, options);
        controlsElement.addEventListener('touchstart', e => { preventActionAndPropagation(e); this.handleTouchStuff(e); return false; }, options);
        controlsElement.addEventListener('touchend', e => { preventActionAndPropagation(e); this.handleTouchStuff(e); return false; }, options);
        controlsElement.addEventListener('touchcancel', e => { preventActionAndPropagation(e); this.handleTouchStuff(e); return false; }, options);
    }

    /**
     * Resets the state of all input keys and gamepad buttons.
     * @param except An optional array of keys or buttons to exclude from the reset.
     */
    public reset(except?: string[]): void {
        Input.getPlayerInput(this.playerIndex).reset(except);
    }

    /**
     * Resets the state of all UI elements related to the gamepad this.
     * This function is used to clear the state of all UI elements that represent the gamepad input buttons.
     * It is called once per frame to ensure that the UI is up-to-date with the current gamepad input state.
     */
    public resetUI(): void {
        let d: HTMLElement;
        for (let i = 0; i < OnScreenGamepad.dpadlist.length; i++) {
            d = document.getElementById(OnScreenGamepad.dpadlist[i]);
            if (d.classList.contains('druk')) {
                d.classList.remove('druk');
                d.classList.add('los');
            }
        }
    }

    /**
     * Handles touch events by resetting the UI and checking which elements were touched.
     * If an element is touched, it adds the 'druk' class to it and removes the 'los' class.
     * It also filters the touched buttons from the reset.
     * @param e The touch event to handle.
     */
    handleTouchStuff(e: TouchEvent): void {
        this.resetUI();

        if (e.touches.length == 0) {
            this.reset();
            return;
        }

        let filterFromReset: string[] = [];
        for (let i = 0; i < e.touches.length; i++) {
            let pos = e.touches[i];
            let elementTouched = document.elementFromPoint(pos.clientX, pos.clientY);
            if (elementTouched) {
                let buttonsTouched = this.handleElementUnderTouch(elementTouched);
                if (buttonsTouched.length > 0) {
                    elementTouched.classList.add('druk');
                    elementTouched.classList.remove('los');

                    buttonsTouched.forEach(b => filterFromReset.push(b));
                }
            }
        }
        this.reset(filterFromReset);
    }

    /**
     * Handles the element under touch by triggering the corresponding keydown event and adding the 'druk' class to the element.
     * @param e The element under touch.
     * @returns An array of keys or buttons that were triggered by the touch event.
     */
    handleElementUnderTouch(e: Element): (ButtonId | string)[] {
        const buttonData = OnScreenGamepad.buttonMap[e.id];
        if (buttonData) {
            buttonData.keys.forEach(key => Input.getPlayerInput(this.playerIndex).keydown(key));
            document.getElementById(e.id).classList.add('druk');
            return buttonData.keys;
        }
        return [];
    }


    blur(e: FocusEvent): void {
        this.reset();
    }

    focus(e: FocusEvent): void {
        this.reset();
    }
}