import { Key } from 'ts-key-enum';
import { handleDebugClick, handleDebugMouseDown, handleDebugMouseUp, handleDebugMouseMove, handleDebugMouseOut, handleContextMenu as handleDebugContextMenu, handleOpenObjectMenu, handleOpenDebugMenu as handleOpenDebugMenu } from './bmsxdebugger';
import { EventEmitter } from './eventemitter';
import { ZCOORD_MAX } from './glview';
import { BitmapId } from '../ella2023/resourceids';
import { SpriteObject } from './sprite';
import { get_gamemodel } from './bmsx';
import { machine_states } from './bfsm';
import type { IIdentifiable, Identifier } from "./bmsx";

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

function resetObject(obj: Index2State | Index2PressTime, except?: string[]) {
    Object.keys(obj).forEach(key => {
        if (!except || !except.includes(key)) {
            delete obj[key];
        }
    });
};

/**
 * Returns the pressed state of a key or button, and optionally checks if it was clicked.
 * @param stateMap - The state map to check for the key or button.
 * @param consumedStateMap - The click state map to check for the key or button.
 * @param key - The key or button to check the state of.
 * @returns The pressed state of the key or button.
 */
function getPressedState(
    stateMap: Index2State,
    consumedStateMap: Index2State,
    pressTimeMap: Index2PressTime,
    key: string | number
): ButtonState {
    return { pressed: stateMap[key] ?? false, consumed: consumedStateMap[key] ?? false, presstime: pressTimeMap[key] ?? null };
}

/**
 * Represents the state of an index in the Index2State type.
 */
type Index2State = { [index: string | number]: boolean; }

type Index2PressTime = { [index: string | number]: number | null; }
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
 * @typedef {keyof typeof Input.BUTTON2INDEX } GamepadButton
 */
export type GamepadButton = keyof typeof Input.BUTTON2INDEX;

/**
 * Represents the state of a button.
 */
export type ButtonState = { pressed: boolean; consumed: boolean; presstime: number | null; };
/**
 * Represents the state of an action, including the action name and button state.
 */
export type ActionState = { action: string } & ButtonState;

const options = {
    passive: false,
    once: false,
};

class PendingAssignmentProcessor {
    private static readonly joystick_icon_start = { x: 0, y: 0 };
    private static readonly joystick_icon_increment_x = 32;
    private get pendingIndex() { return this.gamepadInput.gamepadIndex; }

    private icon: SelectedPlayerIndexIcon = null;

    private checkNonConsumedPressed(button: GamepadButton, gamepadInput: GamepadInput) {
        return gamepadInput.getButtonState(Input.BUTTON2INDEX[button]).pressed && !gamepadInput.getButtonState(Input.BUTTON2INDEX[button]).consumed;
    }

    private calcIconPositionX(positionIndex: number) { return PendingAssignmentProcessor.joystick_icon_start.x + (PendingAssignmentProcessor.joystick_icon_increment_x * (positionIndex ?? 0)) };
    private handleSelectPlayerIndexButtonPress(button: GamepadButton, increment: number, gamepadInput: GamepadInput) {
        if (this.checkNonConsumedPressed(button, gamepadInput)) {
            gamepadInput.consumeButton(Input.BUTTON2INDEX[button]);

            let newProposedPlayerIndex: number = this.proposedPlayerIndex;
            let triedPlayerIndicesCount = 0;
            do {
                ++triedPlayerIndicesCount;
                newProposedPlayerIndex += increment;
                if (newProposedPlayerIndex < 1) {
                    newProposedPlayerIndex = 1; // No wrap-around to avoid accidentally assigning a gamepad to the wrong player
                    break;
                }
                if (newProposedPlayerIndex > Input.PLAYERS_MAX) {
                    newProposedPlayerIndex = Input.PLAYERS_MAX; // No wrap-around to avoid accidentally assigning a gamepad to the wrong player
                    break;
                }
            } while (!Input.getInstance().isPlayerIndexAvailableForGamepadAssignment(newProposedPlayerIndex) && triedPlayerIndicesCount <= Input.PLAYERS_MAX);
            if (triedPlayerIndicesCount > Input.PLAYERS_MAX) {
                // No player index available for gamepad assignment found => abort assignment process for this gamepad
                newProposedPlayerIndex = null;
            }

            this.proposedPlayerIndex = newProposedPlayerIndex;
            this.icon.playerIndex = newProposedPlayerIndex;
            console.info(`Gamepad ${gamepadInput.gamepadIndex} proposed to be assigned to player ${newProposedPlayerIndex ?? 'none (no free slots left)'}.`);
        }
    }

    private createSelectPlayerIconIfNeeded(gamepadInput: GamepadInput, positionIndex: number) {
        if (!this.icon) { // If the joystick icon doesn't exist yet, create it
            const joystick_icon = new SelectedPlayerIndexIcon(gamepadInput.gamepadIndex);
            this.icon = joystick_icon;
            const existingIcon = get_gamemodel().get(this.icon.id); // Check whether the icon already exists. This can happen when the icon was still animating while somehow the assignment needs to happen again.
            existingIcon ?? get_gamemodel().exile(existingIcon); // Remove the existing icon so that we can replace it with a new, younger and prettier version.
            get_gamemodel().spawn(joystick_icon);
            joystick_icon.x = this.calcIconPositionX(positionIndex);
            joystick_icon.y = PendingAssignmentProcessor.joystick_icon_start.y;
        }
        else if (!get_gamemodel().getFromCurrentSpace(this.icon.id)) { // Check whether the joystick icon is already part of the current space (scene)
            // If the joystick icon already exists, move it to the current space (scene) (e.g. if the player changed scenes)
            get_gamemodel().move_obj_to_space(this.icon.id, get_gamemodel().current_space_id);
        }
    }

    constructor(public gamepadInput: GamepadInput, public proposedPlayerIndex: number | null) {
        const self = this;
        window.addEventListener("gamepaddisconnected", function (e: GamepadEvent) {
            const gamepad = e.gamepad;
            if (!gamepad.id.toLowerCase().includes('gamepad')) return;

            if (!self.gamepadInput) return; // No gamepad was not assigned to this object, so ignore the event (should not happen).

            if (e.gamepad.index === self.gamepadInput.gamepadIndex) {
                // No player was assigned to this gamepad yet, but this input object was used for polling input from the gamepad
                console.info(`Gamepad ${gamepad.index} disconnected while pending assignment.`);
                Input.getInstance().removePendingGamepadAssignment(gamepad); // Remove pending gamepad assignment
            }
        });
    }

    run(): void {
        const inputMaestro = Input.getInstance();
        const gamepadInput = this.gamepadInput
        gamepadInput.pollInput();

        // Check whether the start button was pressed and not consumed yet to assign the gamepad to a player
        if (this.proposedPlayerIndex === null) {
            if (this.checkNonConsumedPressed('start', gamepadInput)) {
                gamepadInput.consumeButton(Input.BUTTON2INDEX['start']);
                const proposedPlayerIndex = inputMaestro.getNextAvailablePlayerIndexForGamepadAssignment();

                if (proposedPlayerIndex !== null) {
                    this.proposedPlayerIndex = proposedPlayerIndex;
                    this.createSelectPlayerIconIfNeeded(this.gamepadInput, this.pendingIndex);
                    this.icon.playerIndex = proposedPlayerIndex;
                    console.info(`Gamepad ${gamepadInput.gamepadIndex} proposed to be assigned to player ${proposedPlayerIndex}.`);
                }
            }
        }
        else {
            if (!get_gamemodel().getFromCurrentSpace(this.icon.id)) {
                get_gamemodel().move_obj_to_space(this.icon.id, get_gamemodel().current_space_id);
            }
            this.icon.x = this.calcIconPositionX(this.pendingIndex);
            if (this.checkNonConsumedPressed('a', gamepadInput)) {
                // Assign gamepad to player and remove the joystick icon
                gamepadInput.consumeButton(Input.BUTTON2INDEX['a']);
                inputMaestro.assignGamepadToPlayer(gamepadInput, this.proposedPlayerIndex);
                inputMaestro.removePendingGamepadAssignment(this.gamepadInput.gamepad);
            }
            else if (this.checkNonConsumedPressed('b', gamepadInput)) {
                // Cancel assignment process for this gamepad and remove the joystick icon
                gamepadInput.consumeButton(Input.BUTTON2INDEX['b']);
                this.proposedPlayerIndex = null; // Set proposed player index to null to indicate that the gamepad is no longer proposed to be assigned to a player. Note that we keep the pending gamepad assignment object around, so that the gamepad can be assigned to a player again later.
                this.removeIcon();
            }
            else {
                // Handle joystick icon movement to change the proposed player index
                this.handleSelectPlayerIndexButtonPress('up', 1, gamepadInput);
                this.handleSelectPlayerIndexButtonPress('right', 1, gamepadInput);
                this.handleSelectPlayerIndexButtonPress('down', -1, gamepadInput);
                this.handleSelectPlayerIndexButtonPress('left', -1, gamepadInput);
            }
        }
    }

    removeIcon(): void {
        if (this.icon) {
            get_gamemodel().exile(this.icon);
            this.icon = undefined;
        }
    }
}

export class Input implements IIdentifiable {
    private static instance: Input;
    private static playerInputs: PlayerInput[] = [];
    private pendingGamepadAssignments: PendingAssignmentProcessor[] = [];

    public static PLAYERS_MAX = 4;
    public static PLAYER_MAX_INDEX = Input.PLAYERS_MAX - 1;

    public static getInstance(debug = false): Input {
        if (!Input.instance) {
            Input.instance = new Input(debug);
        }
        return Input.instance;
    }

    public static getPlayerInput(playerIndex: number): PlayerInput {
        const index = playerIndex - 1;
        if (index < 0 || index > Input.PLAYER_MAX_INDEX) throw new Error(`Player index ${playerIndex} is out of range, should be between 1 and ${Input.PLAYERS_MAX}.`);
        if (!Input.playerInputs[index]) {
            Input.playerInputs[index] = new PlayerInput(playerIndex);
        }
        return Input.playerInputs[index];
    }

    /**
    * The mapping of gamepad button names to their corresponding indices.
    */
    public static readonly BUTTON2INDEX = {
        'a': 0, // Bottom face button
        'b': 1, // Right face button
        'x': 2, // Left face button
        'y': 3, // Top face button
        'lb': 4, // Left shoulder button
        'rb': 5, // Right shoulder button
        'lt': 6, // Left trigger button
        'rt': 7, // Right trigger button
        'back': 8, // Back button
        'start': 9, // Start button
        'ls': 10, // Left stick button
        'rs': 11, // Right stick button
        'up': 12, // D-pad up
        'down': 13, // D-pad down
        'left': 14, // D-pad left
        'right': 15, // D-pad right
        'home': 16, // Xbox button
    } as const;

    /**
    * The mapping of indices to their corresponding gamepad button names.
    */
    public static readonly INDEX2BUTTON = {
        0: 'a', // Bottom face button
        1: 'b', // Right face button
        2: 'x', // Left face button
        3: 'y', // Top face button
        4: 'lb', // Left shoulder button
        5: 'rb', // Right shoulder button
        6: 'lt', // Left trigger button
        7: 'rt', // Right trigger button
        8: 'back', // Back button
        9: 'start', // Start button
        10: 'ls', // Left stick button
        11: 'rs', // Right stick button
        12: 'up', // D-pad up
        13: 'down', // D-pad down
        14: 'left', // D-pad left
        15: 'right', // D-pad right
        16: 'home', // Xbox button
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

    public get id(): string { return 'input'; }

    /**
     * Initializes the input system.
     * @param debug Whether to enable debug mode. Default is true.
     */
    constructor(debug = true) {
        const self = this;


        // Initialize gamepad states for already connected gamepads
        const gamepads = navigator.getGamepads();
        for (let i = 0; i < gamepads.length; i++) {
            const gamepad = gamepads[i];
            if (!gamepad || !gamepad.id.toLowerCase().includes('gamepad')) continue;

            this.addPendingGamepadAssignment(gamepad);
        }

        /**
         * Event listener for when a gamepad is connected. Assigns the gamepad to a player and dispatches a player join event.
         * @param e The gamepad event.
         */
        window.addEventListener("gamepadconnected", function (e: GamepadEvent) {
            const gamepad = e.gamepad;
            if (!gamepad || !gamepad.id.toLowerCase().includes('gamepad')) return;
            console.info(`Gamepad ${gamepad.index} connected.`);
            self.addPendingGamepadAssignment(gamepad)
            // let playerIndex = assignGamepadToPlayer(gamepad);
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
        Input.playerInputs.forEach(player => {
            player.pollInput();
            const gamepadInput = player.gamepadInput;
            if (gamepadInput) {
                const buttonState = gamepadInput.getButtonState(Input.BUTTON2INDEX['start']);
                if (buttonState.pressed && buttonState.presstime >= 50) {
                    gamepadInput.reset();
                    player.gamepadInput = null;
                    this.pendingGamepadAssignments.push(new PendingAssignmentProcessor(gamepadInput, null));
                }
            }
        });
        this.pendingGamepadAssignments.forEach(pending => pending.run());
    }

    /**
     * Returns the index of the next available player for gamepad input, or undefined if no player is available.
     * A player is considered available if there is a connected gamepad that is not already assigned to a player.
     * @returns The index of the next available player, or undefined if no player is available.
     */
    public getNextAvailablePlayerIndexForGamepadAssignment(): number | null {
        for (let i = 1; i < Input.PLAYERS_MAX; i++) {
            if (this.isPlayerIndexAvailableForGamepadAssignment(i)) return i;
        }
        return null;
    }

    public isPlayerIndexAvailableForGamepadAssignment(playerIndex: number): boolean {
        const playerInput = Input.getPlayerInput(playerIndex);
        return (!playerInput.gamepadInput && !this.pendingGamepadAssignments.some(pending => pending.proposedPlayerIndex === playerInput.playerIndex));
    }

    /**
     * Adds a pending gamepad assignment.
     *
     * @param gamepad - The gamepad waiting to be assigned.
     */
    private addPendingGamepadAssignment(gamepad: Gamepad): void {
        const gamepadInput = new GamepadInput(gamepad);
        this.pendingGamepadAssignments.push(new PendingAssignmentProcessor(gamepadInput, null));
    }

    /**
     * Remove a pending gamepad assignment.
     *
     * @param gamepad - The gamepad waiting to be assigned.
     */
    public removePendingGamepadAssignment(gamepad: Gamepad): void {
        const index = this.pendingGamepadAssignments.findIndex(pending => pending.gamepadInput.gamepadIndex === gamepad.index);
        if (index !== -1) {
            const pendingAssignmentProcessor = this.pendingGamepadAssignments[index];
            this.pendingGamepadAssignments.splice(index, 1);
            pendingAssignmentProcessor.removeIcon(); // Dispose the joystick icon
        }
    }

    /**
     * Assigns a gamepad to a player.
     *
     * @param gamepad The gamepad to assign.
     * @param playerIndex The index of the player.
     */
    public assignGamepadToPlayer(gamepad: GamepadInput, playerIndex: number): void {
        Input.getPlayerInput(playerIndex).assignGamepadToPlayer(gamepad);
        EventEmitter.getInstance().emit('playerjoin', this, playerIndex);
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
        return Input.getPlayerInput(1).checkAndConsume('ArrowUp', Input.BUTTON2INDEX.up);
    }

    public static get KC_RIGHT(): boolean {
        return Input.getPlayerInput(1).checkAndConsume('ArrowRight', Input.BUTTON2INDEX.right);
    }

    public static get KC_DOWN(): boolean {
        return Input.getPlayerInput(1).checkAndConsume('ArrowDown', Input.BUTTON2INDEX.down);
    }

    public static get KC_LEFT(): boolean {
        return Input.getPlayerInput(1).checkAndConsume('ArrowLeft', Input.BUTTON2INDEX.left);
    }

    public static get KC_BTN1(): boolean {
        return Input.getPlayerInput(1).checkAndConsume('ShiftLeft', Input.BUTTON2INDEX.a);
    }

    public static get KC_BTN2(): boolean {
        return Input.getPlayerInput(1).checkAndConsume('KeyZ', Input.BUTTON2INDEX.b);
    }

    public static get KC_BTN3(): boolean {
        return Input.getPlayerInput(1).checkAndConsume('F1', Input.BUTTON2INDEX.x);
    }

    public static get KC_BTN4(): boolean {
        return Input.getPlayerInput(1).checkAndConsume('F5', Input.BUTTON2INDEX.y);
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
        return Input.getPlayerInput(1).getKeyState('ArrowUp').pressed || Input.getPlayerInput(1).getGamepadButtonState(Input.BUTTON2INDEX.up).pressed;
    }
    public static get KD_RIGHT(): boolean {
        return Input.getPlayerInput(1).getKeyState('ArrowRight').pressed || Input.getPlayerInput(1).getGamepadButtonState(Input.BUTTON2INDEX.right).pressed;
    }
    public static get KD_DOWN(): boolean {
        return Input.getPlayerInput(1).getKeyState('ArrowDown').pressed || Input.getPlayerInput(1).getGamepadButtonState(Input.BUTTON2INDEX.down).pressed;
    }
    public static get KD_LEFT(): boolean {
        return Input.getPlayerInput(1).getKeyState('ArrowLeft').pressed || Input.getPlayerInput(1).getGamepadButtonState(Input.BUTTON2INDEX.left).pressed;
    }
    public static get KD_BTN1(): boolean {
        return Input.getPlayerInput(1).getKeyState('ShiftLeft').pressed || Input.getPlayerInput(1).getGamepadButtonState(Input.BUTTON2INDEX.a).pressed;
    }
    public static get KD_BTN2(): boolean {
        return Input.getPlayerInput(1).getKeyState('KeyZ').pressed || Input.getPlayerInput(1).getGamepadButtonState(Input.BUTTON2INDEX.b).pressed;
    }
    public static get KD_BTN3(): boolean {
        return Input.getPlayerInput(1).getKeyState('F1').pressed || Input.getPlayerInput(1).getGamepadButtonState(Input.BUTTON2INDEX.x).pressed;
    }
    public static get KD_BTN4(): boolean {
        return Input.getPlayerInput(1).getKeyState('F5').pressed || Input.getPlayerInput(1).getGamepadButtonState(Input.BUTTON2INDEX.y).pressed;
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
    public gamepadInput: GamepadInput;
    /**
     * The state of each keyboard key.
     */
    public KeyState: Index2State = {};

    /**
     * The state of each keyboard key click request.
     */
    public KeyPressedConsumedState: Index2State = {};

    public KeyPressedTimes: Index2PressTime = {};

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
        if (!inputMap) return { action, pressed: false, consumed: false, presstime: null };

        const keyboardKey = inputMap.keyboard ? inputMap.keyboard[action] : null;
        const gamepadButton = inputMap.gamepad ? Input.BUTTON2INDEX[inputMap.gamepad[action]] : null;

        const keyboardButtonState = this.getKeyState(keyboardKey);
        const gamepadButtonState = this.getGamepadButtonState(gamepadButton);
        return {
            action: action,
            pressed: keyboardButtonState.pressed || (gamepadButtonState?.pressed ?? false),
            consumed: keyboardButtonState.consumed || (gamepadButtonState?.consumed ?? false),
            presstime: keyboardButtonState.presstime ?? (gamepadButtonState?.presstime ?? null),
        };
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
     * Consumes the input action for the specified player index.
     * @param action The name of the input action to consume.
     */
    public consumeAction(action: string) {
        const inputMap = this.inputMap;
        if (!inputMap) return;

        const keyboardKey = inputMap.keyboard?.[action];
        // Check whether the keyboard key was actually pressed before consuming it
        if (keyboardKey && this.KeyState[keyboardKey]) this.consumeKey(keyboardKey);

        if (this.gamepadInput) {
            const gamepadButton = inputMap.gamepad[action] ? Input.BUTTON2INDEX[inputMap.gamepad[action]] : null;
            (gamepadButton !== null) && this.gamepadInput.consumeButton(gamepadButton);
        }
    }

    /**
     * Returns the pressed state of a key, and optionally checks if it was clicked.
     * @param key - The key to check the state of.
     * @returns The pressed state of the key.
     */
    public getKeyState(key: string): ButtonState {
        if (key === null) return { pressed: false, consumed: false, presstime: null };
        return getPressedState(this.KeyState, this.KeyPressedConsumedState, this.KeyPressedTimes, key);
    }

    /**
     * Retrieves the state of a gamepad button.
     * @param button - The button index.
     * @returns The state of the button.
     */
    public getGamepadButtonState(button: number): ButtonState {
        if (!this.isGamepadConnected()) return null;
        return this.gamepadInput.getButtonState(button);
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
                this.gamepadInput.consumeButton(button);
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
    assignGamepadToPlayer(gamepadInput: GamepadInput): void {
        this.gamepadInput = gamepadInput;

        console.info(`Gamepad ${gamepadInput.gamepadIndex} assigned to player ${this.playerIndex}.`);
    }

    /**
     * Polls the input from the gamepad.
     */
    pollInput(): void {
        this.gamepadInput?.pollInput();
    }

    /**
     * Initializes the input system.
     * @param debug Whether to enable debug mode. Default is true.
     */
    public constructor(playerIndex: number) {
        const self = this;
        this.playerIndex = playerIndex;
        this.gamepadInput = null; // Gamepad should be null by default, and set to a value when a gamepad is connected and assigned to this player
        this.KeyState = {};
        this.KeyPressedConsumedState = {};
        this.reset();

        window.addEventListener("gamepaddisconnected", function (e: GamepadEvent) {
            const gamepad = e.gamepad;
            if (!gamepad.id.toLowerCase().includes('gamepad')) return;

            if (!self.gamepadInput) return; // No gamepad was not assigned to this input-object, so ignore the event (this can happen if multiple gamepads are connected and one is disconnected)

            if (e.gamepad.index === self.gamepadInput.gamepadIndex) {
                if (self.playerIndex) {
                    console.info(`Gamepad ${gamepad.index}, that was assigned to player ${playerIndex}, disconnected.`);
                    self.gamepadInput = null; // Remove gamepad for this input-object
                }
            }
        });

        window.addEventListener('keydown', e => { e.preventDefault(); !this.preventInput && this.keydown(e.code); }, options);
        window.addEventListener('keyup', e => { e.preventDefault(); !this.preventInput && this.keyup(e.code); }, options);
    }

    /**
     * Checks if a gamepad is connected for the specified player index.
     * @returns True if a gamepad is connected for the specified player index, false otherwise.
     */
    private isGamepadConnected(): boolean {
        return !(!this.gamepadInput);
    }

    /**
     * Resets the state of all input keys and gamepad buttons.
     * @param except An optional array of keys or buttons to exclude from the reset.
     */
    public reset(except?: string[]): void {
        this.gamepadInput?.reset(except);
        if (!except) {
            this.KeyState = {};
            this.KeyPressedConsumedState = {};
            this.KeyPressedTimes = {};
            return;
        }

        resetObject(this.KeyState, except);
        resetObject(this.KeyPressedConsumedState, except);
        resetObject(this.KeyPressedTimes, except);
    }

    /**
     * Sets the key state to true when a key is pressed.
     * @param key_code - The button ID or string representing the key.
     */
    keydown(key_code: ButtonId | string): void {
        this.KeyState[key_code] = true;
        this.KeyPressedTimes[key_code] = 0;
    }

    /**
     * Handles the keyup event for a given key.
     * @param key_code - The key identifier or name.
     */
    keyup(key_code: ButtonId | string): void {
        this.KeyState[key_code] = this.KeyPressedConsumedState[key_code] = false;
        this.KeyPressedTimes[key_code] = null;
    }

    blur(_e: FocusEvent): void {
        this.preventInput = true; // Prevent input when the window loses focus
        this.reset();
    }

    focus(_e: FocusEvent): void {
        this.reset();
        this.preventInput = false; // Allow input when the window regains focus
    }
}

class GamepadInput {
    public get gamepadIndex(): number | null {
        return this.gamepad?.index ?? null;
    }

    private _gamepad: Gamepad;
    public get gamepad(): Gamepad { return this._gamepad; }

    /**
     * The state of each gamepad button for each player.
     */
    private gamepadButtonStates: Index2State = {};

    /**
     * The state of each gamepad button click request for each player.
     */
    private gamepadButtonPressedConsumedStates: Index2State = {};

    /**
     * The state of each gamepad button click request for each player.
     */
    private gamepadButtonPressTimes: Index2PressTime = {};

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

        // Reset gamepad button states
        this.gamepadButtonStates = {};

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
        this.gamepadButtonStates[Input.BUTTON2INDEX.left] = xAxis < -0.5;
        this.gamepadButtonStates[Input.BUTTON2INDEX.right] = xAxis > 0.5;
        this.gamepadButtonStates[Input.BUTTON2INDEX.up] = yAxis < -0.5;
        this.gamepadButtonStates[Input.BUTTON2INDEX.down] = yAxis > 0.5;
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
            const btn = buttons[btnIndex];
            const pressed = typeof btn === "object" ? btn.pressed : btn === 1.0;
            // Consider that the button can already be regarded as pressed if it was pressed as part of another action, like an axis
            this.gamepadButtonStates[btnIndex] = this.gamepadButtonStates[btnIndex] || pressed;
            if (!pressed) {
                this.gamepadButtonPressedConsumedStates[btnIndex] = false;
                this.gamepadButtonPressTimes[btnIndex] = null;
            }
            else {
                // If the button is pressed, increment the press time counter for detecting hold actions
                this.gamepadButtonPressTimes[btnIndex] = (this.gamepadButtonPressTimes[btnIndex] ?? 0) + 1;
            }
        }
    }

    /**
     * Returns the pressed state of a gamepad button, and optionally checks if it was clicked.
     * @param btn - The index of the button to check the state of.
     * @returns The pressed state of the button.
     */
    public getButtonState(btn: number | null): ButtonState {
        if (btn === null) return { pressed: false, consumed: false, presstime: null };

        const stateMap = this.gamepadButtonStates || {};
        const consumedStateMap = this.gamepadButtonPressedConsumedStates;
        const pressTimes = this.gamepadButtonPressTimes;
        if (!consumedStateMap) return null;
        return getPressedState(stateMap, consumedStateMap, pressTimes, btn);
    }

    /**
     * Consumes the given button press for the specified player index.
     * @param button The button to consume.
     */
    public consumeButton(button: number) {
        if (this.gamepadButtonPressedConsumedStates) {
            this.gamepadButtonPressedConsumedStates[button] = true;
        }
    }

    /**
     * Resets the state of all gamepad buttons.
     * @param except An optional array of buttons to exclude from the reset.
     */
    public reset(except?: string[]): void {
        if (!except) {
            this.gamepadButtonStates = {};
            this.gamepadButtonPressedConsumedStates = {};
            this.gamepadButtonPressTimes = {};
        }
        else {
            resetObject(this.gamepadButtonStates, except);
            resetObject(this.gamepadButtonPressedConsumedStates, except);
            resetObject(this.gamepadButtonPressTimes, except);
        }
    }
}

// @ts-ignore
class OnScreenGamepad { //
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


    blur(_e: FocusEvent): void {
        this.reset();
    }

    focus(_e: FocusEvent): void {
        this.reset();
    }
}

class SelectedPlayerIndexIcon extends SpriteObject {
    static bouw(): machine_states {
        return {
            parallel: true,
            on: {
                EVENT_1: '_default',
            },
            states: {

                _default: {
                },
                assigned: {
                    on: {
                        PLAYER_JOIN: 'assigned',
                        PLAYER_LEAVE: 'unassigned',
                    },
                },
                unassigned: {
                    on: {
                        PLAYER_JOIN: 'assigned',
                        PLAYER_LEAVE: 'unassigned',
                    },
                },
            },
        };
    }

    public static getIconId(gamepadIndex: number): Identifier {
        return `joystick_icon_${gamepadIndex ?? 0}`;
    }

    constructor(public gamepadIndex: number) {
        super(SelectedPlayerIndexIcon.getIconId(gamepadIndex));
        this.z = ZCOORD_MAX;
    }

    public set playerIndex(playerIndex: number) {
        if (playerIndex === null) {
            this.imgid = BitmapId['joystick_none'];
            return;
        }
        else {
            this.imgid = BitmapId[`joystick${playerIndex}`];
        }
    }
}
