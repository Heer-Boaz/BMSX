import { Key } from 'ts-key-enum';

const GAMEPAD_LEFT: number = 1000;
const GAMEPAD_RIGHT: number = 1001;
const GAMEPAD_UP: number = 1002;
const GAMEPAD_DOWN: number = 1003;

type ButtonId = 'BTN1' | 'BTN2' | 'BTN3' | 'BTN4' | Key;

export class Input {
    public static KeyState: {};
    public static KeyClickRequestedState: {};
    public static GamepadButtonState: {};
    public static GamepadClickRequestedState: {};

    private static getKeyState(key: string, checkClick: boolean = false): boolean {
        if (checkClick) {
            if (Input.KeyState[key] === true && !Input.KeyClickRequestedState[key]) {
                Input.KeyClickRequestedState[key] = true;
                return true;
            }
            else return false;
        }
        else return Input.KeyState[key] === true;
    }

    private static getGamepadButtonState(btn: number, checkClick: boolean = false): boolean {
        if (checkClick) {
            if (Input.GamepadButtonState[btn] === true && !Input.GamepadClickRequestedState[btn]) {
                Input.GamepadClickRequestedState[btn] = true;
                return true;
            }
            else return false;
        }
        else return Input.GamepadButtonState[btn] === true;
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

        window.addEventListener("gamepadconnected", function (e: Event) {
            let gp = navigator.getGamepads()[(e as any).gamepad.index];
            console.info("Gamepad connected at index " + gp.index + ": " + gp.id + ". It has " + gp.buttons.length + " buttons and " + gp.axes.length + " axes.");
        });

        window.addEventListener('keydown', e => { preventDefaultEventAction(e, e.code); keydown(e.code); }, false);
        window.addEventListener('keyup', e => { preventDefaultEventAction(e, e.code); keyup(e.code); }, false);
        window.addEventListener('blur', blur, false);

        document.addEventListener('touchmove', e => { e.preventDefault(); e.stopPropagation(); handleTouchStuff(e); });
        document.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); handleTouchStuff(e); });
        document.addEventListener('touchend', e => { e.preventDefault(); e.stopPropagation(); handleTouchStuff(e); });
        // iOS -- https://stackoverflow.com/questions/58159526/draggable-element-in-iframe-on-mobile-is-buggy
        document.addEventListener('touchforcechange', e => {
            e.preventDefault();
        });
        window.addEventListener('touchforcechange', e => {
            e.preventDefault();
        });
    }

    public static pollGamepadInput(): void {
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

        let gamepads = navigator.getGamepads ? navigator.getGamepads() : ((navigator as any).webkitGetGamepads ? (navigator as any).webkitGetGamepads : undefined);
        let gp: Gamepad = gamepads?.[0];
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
}

function preventDefaultEventAction(e: UIEvent, key: string) {
    if (global.game.running) {
        switch (key) {
            case 'Escape':
            case 'Esc':
            case 'F11':
            case 'F12':
                break;
            default:
                e.preventDefault();
                e.stopPropagation();
                break;
        }
    }
}

function keydown(key: ButtonId | string): void {
    Input.KeyState[key] = true;
}

function keyup(key: ButtonId | string): void {
    delete Input.KeyState[key];
    delete Input.KeyClickRequestedState[key];
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
            break;
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
