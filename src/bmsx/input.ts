import { Key } from 'ts-key-enum';
import { handleDebugClick, handleDebugMouseDown, handleDebugMouseDragEnd, handleDebugMouseMove, handleDebugMouseOut, handleContextMenu as handleDebugContextMenu, handleOpenObjectMenu, handleOpenDebugMenu as handleOpenDebugMenu } from './bmsxdebugger';

type ButtonId = 'BTN1' | 'BTN2' | 'BTN3' | 'BTN4' | Key;
let preventActionAndPropagation = (e: Event): boolean => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    // return false;
    return e.returnValue = false; // https://javascriptio.com/view/5386822/prevent-text-selection-on-tap-and-hold-on-ios-13-mobile-safari
};

// type ButtonId = 'BTN1' | 'BTN2' | 'BTN3' | 'BTN4' | Key | typeof GamepadButtons[keyof typeof GamepadButtons];

// type InputStateMap = Record<ButtonId, boolean>;

// class Input {
//   private static KeyState: InputStateMap = {};
//   private static KeyClickRequestedState: InputStateMap = {};
//   private static GamepadButtonState: InputStateMap = {};
//   private static GamepadClickRequestedState: InputStateMap = {};

//   private static getPressedState(key: ButtonId, checkClick = false): boolean {
//     const state = Input.KeyState[key] || Input.GamepadButtonState[key];
//     if (checkClick && state) {
//       const clickState = Input.KeyClickRequestedState[key] || Input.GamepadClickRequestedState[key];
//       if (clickState) return false;
//       Input.KeyClickRequestedState[key] = true;
//       Input.GamepadClickRequestedState[key] = true;
//     }
//     return state;
//   }

//   public static isPressed(key: ButtonId, checkClick = false): boolean {
//     return Input.getPressedState(key, checkClick);
//   }

//   public static init(): void {
//     const options = {
//       passive: false,
//       once: false,
//     };
//     // ... Initialize event listeners here ...
//   }

//   public static pollGamepadInput(): void {
//     // ... Handle gamepad input here ...
//   }

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

//   public static resetUI(): void {
//     // ... Reset UI here ...
//   }
// }

// // ... Add other helper functions and event handlers here ...

type Index2State = { [index: string | number]: boolean; };
interface InputMap {
    keyboard: { [action: string]: string; };
    gamepad: { [action: string]: number; };
}

export class Input {
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
    };

    public static KeyState: Index2State = {};
    public static KeyClickRequestedState: Index2State = {};
    private static GamepadButtonStates: Index2State[] = [];
    private static GamepadClickRequestedStates: Index2State[] = [];
    private static inputMaps: InputMap[] = [];

    public static setInputMap(playerIndex: number, inputMap: InputMap): void {
        Input.inputMaps[playerIndex] = inputMap;
    }

    public static isActionPressed(playerIndex: number, action: string, checkClick: boolean = false): boolean {
        const inputMap = Input.inputMaps[playerIndex];
        if (!inputMap) return false;
        const keyboardKey = inputMap.keyboard[action];
        const gamepadButton = inputMap.gamepad[action];

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
                'jump': 0,
                'left': 14,
                'right': 15,
                'up': 12,
                'down': 13,
            },
        });

        // To check if an action is pressed for player 0
        Input.isActionPressed(0, 'jump', true);
    }

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
        return Input.getKeyState('ShiftLeft', true) || Input.getGamepadButtonState(0,Input.GAMEPAD_BUTTONS.a, true);
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
        // Input.GamepadButtonState = {};
        // Input.GamepadClickRequestedState = {};
        Input.reset();
        const options = {
            passive: false,
            once: false,
        };

        window.addEventListener('beforeunload', e => { e.preventDefault(); return e.returnValue = 'Are you sure you want to exit this awesome game?'; }, true);

        window.addEventListener("gamepadconnected", function (e: GamepadEvent) {
            let gp = navigator.getGamepads()[(e as any).gamepad.index];
            console.info("Gamepad connected at index " + gp.index + ": " + gp.id + ". It has " + gp.buttons.length + " buttons and " + gp.axes.length + " axes.");
            console.info(`Gamepad mapping = ${gp.mapping}`);
        }, options);
        window.addEventListener("gamepaddisconnected", function (e: GamepadEvent) {
            let gp = navigator.getGamepads()[(e as any).gamepad.index];
            console.info("Gamepad disconnected at index " + gp.index + ": " + gp.id + ". It has " + gp.buttons.length + " buttons and " + gp.axes.length + " axes.");
        }, options);

        window.addEventListener('keydown', e => { preventDefaultEventAction(e, e.code); keydown(e.code); }, options);
        window.addEventListener('keyup', e => { preventDefaultEventAction(e, e.code); keyup(e.code); }, options);
        window.addEventListener('blur', blur, false);

        document.addEventListener('touchmove', e => { preventActionAndPropagation(e); handleTouchStuff(e); return false; }, options);
        document.addEventListener('touchstart', e => { preventActionAndPropagation(e); handleTouchStuff(e); return false; }, options);
        document.addEventListener('touchend', e => { preventActionAndPropagation(e); handleTouchStuff(e); return false; }, options);
        document.addEventListener('touchcancel', e => { preventActionAndPropagation(e); handleTouchStuff(e); return false; }, options);
        // document.addEventListener('dragenter', e => { preventActionAndPropagation(e); return false; }, false);
        // document.addEventListener('dragover', e => { preventActionAndPropagation(e); return false; }, false);
        // document.addEventListener('dragstart', e => { preventActionAndPropagation(e); return false; }, false);

        document.addEventListener('webkitmouseforcewillbegin', e => preventActionAndPropagation(e), options);
        window.addEventListener('webkitmouseforcewillbegin', e => preventActionAndPropagation(e), options);
        document.addEventListener('webkitmouseforcedown', e => preventActionAndPropagation(e), options);
        window.addEventListener('webkitmouseforcedown', e => preventActionAndPropagation(e), options);
        // document.addEventListener('contextmenu', e => preventActionAndPropagation(e), false);
        // window.addEventListener('contextmenu', e => preventActionAndPropagation(e), false);
        document.addEventListener('touchforcechange', e => preventActionAndPropagation(e), options);// iOS -- https://stackoverflow.com/questions/58159526/draggable-element-in-iframe-on-mobile-is-buggy && iOS -- https://stackoverflow.com/questions/50980876/can-you-prevent-3d-touch-on-an-img-but-not-tap-and-hold-to-save
        window.addEventListener('touchforcechange', e => preventActionAndPropagation(e), options);
        // document.addEventListener('dragstart', e => preventActionAndPropagation(e), false);
        // window.addEventListener('dragstart', e => preventActionAndPropagation(e), false);
        // document.addEventListener('dragover', e => preventActionAndPropagation(e), false);
        // window.addEventListener('dragover', e => preventActionAndPropagation(e), false);
        // document.addEventListener('pointerdown', e => preventActionAndPropagation(e), false);
        // window.addEventListener('pointerdown', e => preventActionAndPropagation(e), false);
        // document.addEventListener('pointermove', e => preventActionAndPropagation(e), false);
        // window.addEventListener('pointermove', e => preventActionAndPropagation(e), false);

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

    // Update gamepad states for each player
    public static updateGamepadStates(): void {
        const gamepads = navigator.getGamepads();
    }
    public static pollGamepadInput(): void {
        let gamepads: Gamepad[] = navigator.getGamepads ? navigator.getGamepads() : ((navigator as any).webkitGetGamepads ? (navigator as any).webkitGetGamepads : undefined);
        if (!gamepads) return;

        for (let gamepad_index = 0; gamepad_index < gamepads.length; gamepad_index++) {
            const gamepad = gamepads[gamepad_index];
            if (!gamepad) continue;
            // if (gamepad.id.includes('Sound Blaster')) continue;
            if (!gamepad.id.toLowerCase().includes('gamepad')) continue;

            // Reset gamepad button states
            Input.GamepadButtonStates[gamepad_index] = {};
            if (!Input.GamepadClickRequestedStates[gamepad_index]) {
                Input.GamepadClickRequestedStates[gamepad_index] = {};
            }

            // Check whether any axes have been triggered
            Input.pollGamepadAxes(gamepad_index, gamepad.axes);

            // Check button states
            Input.pollGamepadButtons(gamepad_index, gamepad.buttons);
        }
    }

    private static pollGamepadAxes(gamepad_index: number, axes: readonly number[]): void {
        const [xAxis, yAxis] = axes;
        Input.GamepadButtonStates[gamepad_index][Input.GAMEPAD_BUTTONS.left] = xAxis < -0.5;
        Input.GamepadButtonStates[gamepad_index][Input.GAMEPAD_BUTTONS.right] = xAxis > 0.5;
        Input.GamepadButtonStates[gamepad_index][Input.GAMEPAD_BUTTONS.up] = yAxis < -0.5;
        Input.GamepadButtonStates[gamepad_index][Input.GAMEPAD_BUTTONS.down] = yAxis > 0.5;
    }

    private static pollGamepadButtons(gamepad_index: number, buttons: readonly GamepadButton[]): void {
        for (let btnIndex = 0; btnIndex < buttons.length; btnIndex++) {
            const btn = buttons[btnIndex];
            const pressed = typeof btn === "object" ? btn.pressed : btn === 1.0;
            // Consider that the button can already be regarded as pressed if it was pressed as part of another action, like an axis
            Input.GamepadButtonStates[gamepad_index][btnIndex] = Input.GamepadButtonStates[gamepad_index][btnIndex] || pressed;
            if (!pressed) {
                Input.GamepadClickRequestedStates[gamepad_index][btnIndex] = false;
            }
        }
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
};

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

function handleElementUnderTouch(e: Element): (ButtonId | string)[] {
    const buttonData = buttonMap[e.id];
    if (buttonData) {
        buttonData.keys.forEach(key => keydown(key));
        document.getElementById(e.id).classList.add('druk');
        return buttonData.keys;
    }
    return [];
}
