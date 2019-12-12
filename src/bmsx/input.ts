import { game } from "./engine";

export class Input {
    public static KeyState: {};
    public static KeyClickRequestedState: {};

    private static getClickState(key: string): boolean {
        if (Input.getKeyState(key) && !Input.KeyClickRequestedState[key]) {
            Input.KeyClickRequestedState[key] = true;
            return true;
        }
        return false;
    }

    private static getKeyState(key: string): boolean {
        return Input.KeyState[key] === true;
    }

    public static get KC_DOWN(): boolean {
        return Input.getClickState('ArrowDown');
    }
    public static get KC_F1(): boolean {
        return Input.getClickState('F1');
    }
    public static get KC_F12(): boolean {
        return Input.getClickState('F12');
    }
    public static get KC_F2(): boolean {
        return Input.getClickState('F2');
    }
    public static get KC_F3(): boolean {
        return Input.getClickState('F3');
    }
    public static get KC_F4(): boolean {
        return Input.getClickState('F4');
    }
    public static get KC_F5(): boolean {
        return Input.getClickState('F5');
    }
    public static get KC_LEFT(): boolean {
        return Input.getClickState('ArrowLeft');
    }
    public static get KC_M(): boolean {
        return Input.getClickState('m');
    }
    public static get KC_RIGHT(): boolean {
        return Input.getClickState('ArrowRight');
    }
    public static get KC_SPACE(): boolean {
        return Input.getClickState(' ');
    }
    public static get KC_UP(): boolean {
        return Input.getClickState('ArrowUp');
    }

    public static get KD_DOWN(): boolean {
        return Input.getKeyState('ArrowDown');
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
    public static get KD_LEFT(): boolean {
        return Input.getKeyState('ArrowLeft');
    }
    public static get KD_M(): boolean {
        return Input.getKeyState('M');
    }
    public static get KD_RIGHT(): boolean {
        return Input.getKeyState('ArrowRight');
    }
    public static get KD_SPACE(): boolean {
        return Input.getKeyState(' ');
    }
    public static get KD_UP(): boolean {
        return Input.getKeyState('ArrowUp');
    }

    public static init(): void {
        Input.KeyState = {};
        Input.KeyClickRequestedState = {};
        Input.reset();

        window.addEventListener('keydown', keydown, false);
        window.addEventListener('keyup', keyup, false);
        window.addEventListener('blur', blur, false);
    }

    public static reset(): void {
        let props = Object.keys(Input.KeyState);
        for (let i = 0; i < props.length; i++) {
            delete Input.KeyState[props[i]];
        }
        props = Object.keys(Input.KeyClickRequestedState);
        for (let i = 0; i < props.length; i++) {
            delete Input.KeyClickRequestedState[props[i]];
        }
    }
}

function keydown(e: KeyboardEvent): void {
    if (!document.hasFocus()) return;
    if (game.running) {
        switch (e.key) {
            case 'Escape':
            case 'Esc':
            case 'F11':
            case 'F12':
                break;
            default:
                e.preventDefault();
                break;
        }
    }

    Input.KeyState[e.key] = true;
}

function keyup(e: KeyboardEvent): void {
    // if (!document.hasFocus()) return;

    if (game.running) {
        switch (e.key) {
            case 'Escape':
            case 'Esc':
            case 'F11':
            case 'F12':
                break;
            default:
                e.preventDefault();
                break;

        }
    }

    delete Input.KeyState[e.key];
    delete Input.KeyClickRequestedState[e.key];
}

function blur(e: FocusEvent): void {
    Input.reset();
}

// export function getMousePos(evt: MouseEvent): Point {
    // let rect = view.outcanvas.getBoundingClientRect();
    // return <Point>{
    //     x: evt.clientX - rect.left,
    //     y: evt.clientY - rect.top
    // };
    // return <Point>{ x: 0, y: 0 };
// }
