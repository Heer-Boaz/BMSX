import { Key } from 'ts-key-enum';
import { handleDebugClick, handleDebugMouseDown, handleDebugMouseDragEnd, handleDebugMouseMove, handleDebugMouseOut, handleContextMenu as handleDebugContextMenu, handleOpenObjectMenu, handleOpenDebugMenu as handleOpenDebugMenu } from './bmsxdebugger';

const GAMEPAD_LEFT: number = 1000;
const GAMEPAD_RIGHT: number = 1001;
const GAMEPAD_UP: number = 1002;
const GAMEPAD_DOWN: number = 1003;

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
    public static readonly GAMEPAD_UP = 12;
    public static readonly GAMEPAD_DOWN = 13;
    public static readonly GAMEPAD_LEFT = 14;
    public static readonly GAMEPAD_RIGHT = 15;

    private static KeyState: Index2State = {};
    private static KeyClickRequestedState: Index2State = {};
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

    public static isKeyPressed(key: string, checkClick: boolean = false): boolean {
        return Input.getKeyState(key, checkClick);
    }

    public static isGamepadButtonPressed(playerIndex: number, btn: number, checkClick: boolean = false): boolean {
        return Input.getGamepadButtonState(playerIndex, btn, checkClick);
    }

    // Update gamepad states for each player
    public static updateGamepadStates(): void {
        const gamepads = navigator.getGamepads();
        for (let i = 0; i < gamepads.length; i++) {
            const gamepad = gamepads[i];
            if (!gamepad) continue;

            if (!Input.GamepadButtonStates[i]) {
                Input.GamepadButtonStates[i] = {};
                Input.GamepadClickRequestedStates[i] = {};
            }

            for (let btnIndex = 0; btnIndex < gamepad.buttons.length; btnIndex++) {
                const btn = gamepad.buttons[btnIndex];
                Input.GamepadButtonStates[i][btnIndex] = btn.pressed;
            }
        }
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
        return Input.getKeyState('ArrowUp', true) || Input.getGamepadButtonState(GAMEPAD_UP, true);
    }
    public static get KC_RIGHT(): boolean {
        return Input.getKeyState('ArrowRight', true) || Input.getGamepadButtonState(GAMEPAD_RIGHT, true);
    }
    public static get KC_DOWN(): boolean {
        return Input.getKeyState('ArrowDown', true) || Input.getGamepadButtonState(GAMEPAD_DOWN, true);
    }
    public static get KC_LEFT(): boolean {
        return Input.getKeyState('ArrowLeft', true) || Input.getGamepadButtonState(GAMEPAD_LEFT, true);
    }
    public static get KC_BTN1(): boolean {
        return Input.getKeyState('ShiftLeft', true) || Input.getGamepadButtonState(0, true);
    }
    public static get KC_BTN2(): boolean {
        return Input.getKeyState('KeyZ', true) || Input.getGamepadButtonState(1, true);
    }
    public static get KC_BTN3(): boolean {
        return Input.getKeyState('F1', true) || Input.getGamepadButtonState(2, true);
    }
    public static get KC_BTN4(): boolean {
        return Input.getKeyState('F5', true) || Input.getGamepadButtonState(3, true);
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
        return Input.getKeyState('ArrowUp') || Input.getGamepadButtonState(GAMEPAD_UP, false);
    }
    public static get KD_RIGHT(): boolean {
        return Input.getKeyState('ArrowRight') || Input.getGamepadButtonState(GAMEPAD_RIGHT, false);
    }
    public static get KD_DOWN(): boolean {
        return Input.getKeyState('ArrowDown') || Input.getGamepadButtonState(GAMEPAD_DOWN, false);
    }
    public static get KD_LEFT(): boolean {
        return Input.getKeyState('ArrowLeft') || Input.getGamepadButtonState(GAMEPAD_LEFT, false);
    }
    public static get KD_BTN1(): boolean {
        return Input.getKeyState('ShiftLeft') || Input.getGamepadButtonState(0, false);
    }
    public static get KD_BTN2(): boolean {
        return Input.getKeyState('KeyZ') || Input.getGamepadButtonState(1, false);
    }
    public static get KD_BTN3(): boolean {
        return Input.getKeyState('F1') || Input.getGamepadButtonState(2, true);
    }
    public static get KD_BTN4(): boolean {
        return Input.getKeyState('F5') || Input.getGamepadButtonState(3, true);
    }

    public static init(): void {
        Input.KeyState = {};
        Input.KeyClickRequestedState = {};
        Input.GamepadButtonState = {};
        Input.GamepadClickRequestedState = {};
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

        let gamescreen = document.getElementById('gamescreen');
        gamescreen.addEventListener('click', e => handleDebugClick(e), options);
        gamescreen.addEventListener('mousedown', e => handleDebugMouseDown(e), options);
        gamescreen.addEventListener('mousemove', e => handleDebugMouseMove(e), options);
        gamescreen.addEventListener('mouseup', e => handleDebugMouseDragEnd(e), options);
        gamescreen.addEventListener('mouseout', e => handleDebugMouseOut(e), options);
        gamescreen.addEventListener('contextmenu', e => handleDebugContextMenu(e), options);
    }

    public static pollGamepadInput(): void { // ! FIXME: ONDERSTEUND ALLEEN 1 SPELER!!
        let buttonPressed = (button: GamepadButton) => {
            if (typeof (button) == "object") {
                return button.pressed;
            }
            return button == 1.0;
        };
        Input.GamepadButtonState[GAMEPAD_LEFT] = false;
        Input.GamepadButtonState[GAMEPAD_RIGHT] = false;
        Input.GamepadButtonState[GAMEPAD_UP] = false;
        Input.GamepadButtonState[GAMEPAD_DOWN] = false;

        let gamepads: Gamepad[] = navigator.getGamepads ? navigator.getGamepads() : ((navigator as any).webkitGetGamepads ? (navigator as any).webkitGetGamepads : undefined);
        // ! FIXME: Moet niet hardcoded zijn!
        let gp: Gamepad = gamepads?.find((gp: Gamepad) => {
            if (gp) return !gp.id.includes('Sound Blaster');
            return false;
        }); // Note that gp can be `null` if gamepads have not been connected yet
        if (!gp) { return; }
        for (let i = 0; i < gp.buttons.length; i++) {
            if (buttonPressed(gp.buttons[i])) {
                Input.GamepadButtonState[i] = true;
            }
            else {
                Input.GamepadButtonState[i] = false;
                Input.GamepadClickRequestedState[i] = false;
            }
        }

        // Check whether any axes have been triggered
        for (let i = 0; i < gp.axes.length && i < 2; i++) {
            let axis = gp.axes[i];
            switch (i) {
                case 0:
                    if (axis < -.5) { Input.GamepadButtonState[GAMEPAD_LEFT] = true; }
                    else if (axis > .5) { Input.GamepadButtonState[GAMEPAD_RIGHT] = true; }
                    break;
                case 1:
                    if (axis < -.5) { Input.GamepadButtonState[GAMEPAD_UP] = true; }
                    else if (axis > .5) { Input.GamepadButtonState[GAMEPAD_DOWN] = true; }
                    break;
            }
        }
    }

    public static reset(except?: string[]): void {
        let props = Object.keys(Input.KeyState);
        for (let i = 0; i < props.length; i++) {
            if (!except || except.indexOf(props[i]) === -1) { delete Input.KeyState[props[i]]; }
        }

        props = Object.keys(Input.KeyClickRequestedState);
        for (let i = 0; i < props.length; i++) {
            if (!except || except.indexOf(props[i]) === -1) { delete Input.KeyClickRequestedState[props[i]]; }
        }

        props = Object.keys(Input.GamepadButtonState);
        for (let i = 0; i < props.length; i++) {
            if (!except || except.indexOf(props[i]) === -1) { delete Input.GamepadButtonState[props[i]]; }
        }

        props = Object.keys(Input.GamepadClickRequestedState);
        for (let i = 0; i < props.length; i++) {
            if (!except || except.indexOf(props[i]) === -1) { delete Input.GamepadClickRequestedState[props[i]]; }
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
    // delete Input.KeyState[key];
    // delete Input.KeyClickRequestedState[key];
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

function handleElementUnderTouch(e: Element): (ButtonId | string)[] {
    switch (e.id) {
        case 'd-pad-u':
            keydown('ArrowUp');
            return [Key.ArrowUp];
        case 'd-pad-ru':
            keydown('ArrowUp');
            keydown('ArrowRight');
            document.getElementById('d-pad-ru').classList.add('druk');
            return [Key.ArrowUp, Key.ArrowRight];
        case 'd-pad-r':
            keydown('ArrowRight');
            document.getElementById('d-pad-r').classList.add('druk');
            return [Key.ArrowRight];
        case 'd-pad-rd':
            keydown('ArrowRight');
            keydown('ArrowDown');
            document.getElementById('d-pad-rd').classList.add('druk');
            return [Key.ArrowDown, Key.ArrowRight];
        case 'd-pad-d':
            keydown('ArrowDown');
            document.getElementById('d-pad-d').classList.add('druk');
            return [Key.ArrowDown];
        case 'd-pad-ld':
            keydown('ArrowLeft');
            keydown('ArrowDown');
            document.getElementById('d-pad-ld').classList.add('druk');
            return [Key.ArrowLeft, Key.ArrowDown];
        case 'd-pad-l':
            keydown('ArrowLeft');
            document.getElementById('d-pad-l').classList.add('druk');
            return [Key.ArrowLeft];
        case 'd-pad-lu':
            keydown('ArrowLeft');
            keydown('ArrowUp');
            document.getElementById('d-pad-lu').classList.add('druk');
            return [Key.ArrowUp, Key.ArrowLeft];
        case 'btn1_knop':
            keydown('ShiftLeft');
            keydown('BTN1');
            document.getElementById('btn1_knop').classList.add('druk');
            return ['BTN1', 'ShiftLeft'];
        case 'btn2_knop':
            keydown('KeyZ');
            keydown('BTN2');
            document.getElementById('btn2_knop').classList.add('druk');
            return ['BTN2', 'KeyZ'];
        case 'btn3_knop':
            keydown('F1');
            keydown('BTN3');
            document.getElementById('btn3_knop').classList.add('druk');
            return ['BTN3', 'F1'];
        case 'btn4_knop':
            keydown('F5');
            keydown('BTN4');
            document.getElementById('btn4_knop').classList.add('druk');
            return ['BTN4', 'F5'];
    }
    return [];
}
