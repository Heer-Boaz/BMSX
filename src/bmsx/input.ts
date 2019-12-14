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

        window.addEventListener('keydown', e => { preventDefaultEventAction(e); keydown(e.key); }, false);
        window.addEventListener('keyup', e => { preventDefaultEventAction(e); keyup(e.key); }, false);
        window.addEventListener('blur', blur, false);

        document.getElementById('d-pad-u').addEventListener('touchstart', e => keydown('ArrowUp'), false);
        document.getElementById('d-pad-u').addEventListener('touchend', e => keyup('ArrowUp'), false);
        document.getElementById('d-pad-ru').addEventListener('touchstart', e => { keydown('ArrowUp'); keydown('ArrowRight'); }, false);
        document.getElementById('d-pad-ru').addEventListener('touchend', e => { keyup('ArrowUp'); keyup('ArrowRight'); }, false);
        document.getElementById('d-pad-r').addEventListener('touchstart', e => keydown('ArrowRight'), false);
        document.getElementById('d-pad-r').addEventListener('touchend', e => keyup('ArrowRight'), false);
        document.getElementById('d-pad-d').addEventListener('touchstart', e => keydown('ArrowDown'), false);
        document.getElementById('d-pad-d').addEventListener('touchend', e => keyup('ArrowDown'), false);
        document.getElementById('d-pad-ld').addEventListener('touchstart', e => { keydown('ArrowLeft'); keydown('ArrowDown'); }, false);
        document.getElementById('d-pad-ld').addEventListener('touchend', e => { keyup('ArrowLeft'); keyup('ArrowDown'); }, false);
        document.getElementById('d-pad-l').addEventListener('touchstart', e => keydown('ArrowLeft'), false);
        document.getElementById('d-pad-l').addEventListener('touchend', e => keyup('ArrowLeft'), false);
        document.getElementById('d-pad-lu').addEventListener('touchstart', e => { keydown('ArrowLeft'); keydown('ArrowUp'); }, false);
        document.getElementById('d-pad-lu').addEventListener('touchend', e => { keyup('ArrowLeft'); keyup('ArrowUp'); }, false);
        document.getElementById('btn1_knop').addEventListener('touchstart', e => keydown(' '), false);
        document.getElementById('btn1_knop').addEventListener('touchend', e => keyup(' '), false);
        document.getElementById('btn2_knop').addEventListener('touchstart', e => keydown('m'), false);
        document.getElementById('btn2_knop').addEventListener('touchend', e => keyup('m'), false);
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

function preventDefaultEventAction(e: KeyboardEvent) {
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
}

function keydown(key: string): void {
    // if (!document.hasFocus()) return;
    Input.KeyState[key] = true;
}

function keyup(key: string): void {
    // if (!document.hasFocus()) return;
    delete Input.KeyState[key];
    delete Input.KeyClickRequestedState[key];
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
