import { Key } from 'ts-key-enum';
import { handleDebugClick, handleDebugMouseDown, handleDebugMouseDragEnd, handleDebugMouseMove, handleDebugMouseOut, handleContextMenu as handleDebugContextMenu, handleOpenObjectMenu, handleOpenDebugMenu as handleOpenDebugMenu } from './bmsxdebugger';
import { EventDispatcher } from './eventdispatcher';

type ButtonId = 'BTN1' | 'BTN2' | 'BTN3' | 'BTN4' | Key;
let preventActionAndPropagation = (e: Event): boolean => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    // return false;
    return e.returnValue = false; // https://javascriptio.com/view/5386822/prevent-text-selection-on-tap-and-hold-on-ios-13-mobile-safari
};

//   public static reset(except?: ButtonId[]): void {
//     const resetMap = (map: InputStateMap, except?: ButtonId[]) => {
//       Object.keys(map).forEach((key) => {
//         if (!except || !except.includes(key as ButtonId)) {
//           delete map[key as ButtonId];
//         }
//       });
//     };

//     resetMap(Input.KeyState, except);
//     resetMap(Input.KeyClickRequestedState, except);
//     resetMap(Input.GamepadButtonState, except);
//     resetMap(Input.GamepadClickRequestedState, except);
//   }

type Index2State = { [index: string | number]: boolean; };
interface InputMap {
    keyboard: { [action: string]: string; };
    gamepad: { [action: string]: string; };
}

/**
 * Represents the input state of the game.
 */
export class Input {
    public static GamepadPlayerMap = {};

    /**
     * The state of each keyboard key.
     */
    public static KeyState: Index2State = {};

    /**
     * The state of each keyboard key click request.
     */
    public static KeyClickRequestedState: Index2State = {};

    /**
     * The state of each gamepad button for each player.
     */
    private static GamepadButtonStates: Index2State[] = [];

    /**
     * The state of each gamepad button click request for each player.
     */
    private static GamepadClickRequestedStates: Index2State[] = [];

    /**
     * The input maps for each player.
     */
    private static inputMaps: InputMap[] = [];

    /**
     * The mapping of gamepad button names to their corresponding indices.
     */
    public static readonly GAMEPAD_BUTTONS: { [button: string]: number } = {
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
    }

    public static playerJoinEvent = new EventDispatcher<number>();

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
     * @param checkClick - Whether to check if the action was clicked.
     * @returns Whether the action is currently pressed for the given player index.
     */
    public static isActionPressed(playerIndex: number, action: string, checkClick: boolean = false): boolean {
        const inputMap = Input.inputMaps[playerIndex];
        if (!inputMap) return false;
        const keyboardKey = inputMap.keyboard[action];
        const gamepadButton = Input.GAMEPAD_BUTTONS[inputMap.gamepad[action]];

        return (
            (keyboardKey && Input.getKeyState(keyboardKey, checkClick)) ||
            (gamepadButton !== undefined && Input.getGamepadButtonState(playerIndex, gamepadButton, checkClick))
        );
    }

    public static bla() {
        // Example usage
        Input.setInputMap(0, {
            keyboard: {
                'jump': 'Space',
                'left': 'ArrowLeft',
                'right': 'ArrowRight',
                'up': 'ArrowUp',
                'down': 'ArrowDown',
            },
            gamepad: {
                'jump': 'a',
                'left': 'left',
                'right': 'right',
                'up': 'up',
                'down': 'down',
            },
        });

        // To check if an action is pressed for player 0
        Input.isActionPressed(0, 'jump', true);
    }

    /**
     * Returns the pressed state of a key or button, and optionally checks if it was clicked.
     * @param stateMap - The state map to check for the key or button.
     * @param clickStateMap - The click state map to check for the key or button.
     * @param key - The key or button to check the state of.
     * @param checkClick - Whether to check if the key or button was clicked.
     * @returns The pressed state of the key or button.
     */
    private static getPressedState(
        stateMap: Index2State,
        clickStateMap: Index2State,
        key: string | number,
        checkClick: boolean = false
    ): boolean {
        const state = stateMap[key] === true;
        if (checkClick && state) {
            if (clickStateMap[key]) return false;
            clickStateMap[key] = true;
        }
        return state;
    }

    private static getKeyState(key: string, checkClick: boolean = false): boolean {
        return Input.getPressedState(Input.KeyState, Input.KeyClickRequestedState, key, checkClick);
    }

    private static getGamepadButtonState(playerIndex: number, btn: number, checkClick: boolean = false): boolean {
        const stateMap = Input.GamepadButtonStates[playerIndex] || {};
        const clickStateMap = Input.GamepadClickRequestedStates[playerIndex] || {};
        return Input.getPressedState(stateMap, clickStateMap, btn, checkClick);
    }

    public static isKeyDown(key: string): boolean {
        return Input.getKeyState(key, false);
    }

    public static isGamepadButtonDown(playerIndex: number, btn: number): boolean {
        return Input.getGamepadButtonState(playerIndex, btn, false);
    }

    public static get KC_F1(): boolean {
        return Input.getKeyState(Key.F1, true);
    }
    public static get KC_F12(): boolean {
        return Input.getKeyState('F12', true);
    }
    public static get KC_F2(): boolean {
        return Input.getKeyState('F2', true);
    }
    public static get KC_F3(): boolean {
        return Input.getKeyState('F3', true);
    }
    public static get KC_F4(): boolean {
        return Input.getKeyState('F4', true);
    }
    public static get KC_F5(): boolean {
        return Input.getKeyState('F5', true);
    }
    public static get KC_M(): boolean {
        return Input.getKeyState('KeyM', true);
    }
    public static get KC_SPACE(): boolean {
        return Input.getKeyState('Space', true);
    }
    public static get KC_UP(): boolean {
        return Input.getKeyState('ArrowUp', true) || Input.getGamepadButtonState(0, Input.GAMEPAD_BUTTONS.up, true);
    }
    public static get KC_RIGHT(): boolean {
        return Input.getKeyState('ArrowRight', true) || Input.getGamepadButtonState(0, Input.GAMEPAD_BUTTONS.right, true);
    }
    public static get KC_DOWN(): boolean {
        return Input.getKeyState('ArrowDown', true) || Input.getGamepadButtonState(0, Input.GAMEPAD_BUTTONS.down, true);
    }
    public static get KC_LEFT(): boolean {
        return Input.getKeyState('ArrowLeft', true) || Input.getGamepadButtonState(0, Input.GAMEPAD_BUTTONS.left, true);
    }
    public static get KC_BTN1(): boolean {
        return Input.getKeyState('ShiftLeft', true) || Input.getGamepadButtonState(0, Input.GAMEPAD_BUTTONS.a, true);
    }
    public static get KC_BTN2(): boolean {
        return Input.getKeyState('KeyZ', true) || Input.getGamepadButtonState(0, Input.GAMEPAD_BUTTONS.b, true);
    }
    public static get KC_BTN3(): boolean {
        return Input.getKeyState('F1', true) || Input.getGamepadButtonState(0, Input.GAMEPAD_BUTTONS.x, true);
    }
    public static get KC_BTN4(): boolean {
        return Input.getKeyState('F5', true) || Input.getGamepadButtonState(0, Input.GAMEPAD_BUTTONS.y, true);
    }

    public static get KD_F1(): boolean {
        return Input.getKeyState('F1');
    }
    public static get KD_F12(): boolean {
        return Input.getKeyState('F12');
    }
    public static get KD_F2(): boolean {
        return Input.getKeyState('F2');
    }
    public static get KD_F3(): boolean {
        return Input.getKeyState('F3');
    }
    public static get KD_F4(): boolean {
        return Input.getKeyState('F4');
    }
    public static get KD_F5(): boolean {
        return Input.getKeyState('F5');
    }
    public static get KD_M(): boolean {
        return Input.getKeyState('KeyM');
    }
    public static get KD_SPACE(): boolean {
        return Input.getKeyState('Space');
    }
    public static get KD_UP(): boolean {
        return Input.getKeyState('ArrowUp') || Input.getGamepadButtonState(0, Input.GAMEPAD_BUTTONS.up, false);
    }
    public static get KD_RIGHT(): boolean {
        return Input.getKeyState('ArrowRight') || Input.getGamepadButtonState(0, Input.GAMEPAD_BUTTONS.right, false);
    }
    public static get KD_DOWN(): boolean {
        return Input.getKeyState('ArrowDown') || Input.getGamepadButtonState(0, Input.GAMEPAD_BUTTONS.down, false);
    }
    public static get KD_LEFT(): boolean {
        return Input.getKeyState('ArrowLeft') || Input.getGamepadButtonState(0, Input.GAMEPAD_BUTTONS.left, false);
    }
    public static get KD_BTN1(): boolean {
        return Input.getKeyState('ShiftLeft') || Input.getGamepadButtonState(0, Input.GAMEPAD_BUTTONS.a, false);
    }
    public static get KD_BTN2(): boolean {
        return Input.getKeyState('KeyZ') || Input.getGamepadButtonState(0, Input.GAMEPAD_BUTTONS.b, false);
    }
    public static get KD_BTN3(): boolean {
        return Input.getKeyState('F1') || Input.getGamepadButtonState(0, Input.GAMEPAD_BUTTONS.x, true);
    }
    public static get KD_BTN4(): boolean {
        return Input.getKeyState('F5') || Input.getGamepadButtonState(0, Input.GAMEPAD_BUTTONS.y, true);
    }

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

    public static init(debug = true): void {
        Input.KeyState = {};
        Input.KeyClickRequestedState = {};
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
            Input.GamepadClickRequestedStates[playerIndex] = {};

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

            if (playerIndex != null) Input.playerJoinEvent.dispatch(playerIndex);
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
            if (Input.GamepadClickRequestedStates[playerIndex]) {
                delete Input.GamepadClickRequestedStates[playerIndex];
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
            // if (gamepad.id.includes('Sound Blaster')) continue;
            if (!gamepad.id.toLowerCase().includes('gamepad')) continue;

            // Reset gamepad button states
            const playerIndex = Input.GamepadPlayerMap[gamepad.index];
            Input.GamepadButtonStates[playerIndex] = {};
            if (!Input.GamepadClickRequestedStates[playerIndex]) {
                Input.GamepadClickRequestedStates[playerIndex] = {};
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
                Input.GamepadClickRequestedStates[playerIndex][btnIndex] = false;
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
            if (Input.GamepadPlayerMap[i] === undefined) {
                return i;
            }
        }
        return undefined;
    }

    /**
     * Resets the state of all input keys and gamepad buttons.
     * @param except An optional array of keys or buttons to exclude from the reset.
     */
    public static reset(except?: string[]): void {
        let props = Object.keys(Input.KeyState);
        for (let i = 0; i < props.length; i++) {
            if (!except || except.indexOf(props[i]) === -1) { delete Input.KeyState[props[i]]; }
        }

        props = Object.keys(Input.KeyClickRequestedState);
        for (let i = 0; i < props.length; i++) {
            if (!except || except.indexOf(props[i]) === -1) { delete Input.KeyClickRequestedState[props[i]]; }
        }

        for (let gamepad_index = 0; gamepad_index < Input.GamepadButtonStates.length; gamepad_index++) {
            props = Object.keys(Input.GamepadButtonStates[gamepad_index]);
            for (let prop_index = 0; prop_index < props.length; prop_index++) {
                if (!except || except.indexOf(props[prop_index]) === -1) { delete Input.GamepadButtonStates[gamepad_index][props[prop_index]]; }
            }
        }

        for (let gamepad_index = 0; gamepad_index < Input.GamepadClickRequestedStates.length; gamepad_index++) {
            props = Object.keys(Input.GamepadClickRequestedStates[gamepad_index]);
            for (let prop_index = 0; prop_index < props.length; prop_index++) {
                if (!except || except.indexOf(props[prop_index]) === -1) { delete Input.GamepadClickRequestedStates[gamepad_index][props[prop_index]]; }
            }
        }
    }

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

function keydown(key: ButtonId | string): void {
    Input.KeyState[key] = true;
}

function keyup(key: ButtonId | string): void {
    Input.KeyState[key] = Input.KeyClickRequestedState[key] = false;
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
