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

        document.getElementById('d-pad-u').addEventListener('touchstart', e => keydown('ArrowUp'));
        // document.getElementById('d-pad-u').addEventListener('click', e => keydown('ArrowUp'), false);
        document.getElementById('d-pad-u').addEventListener('touchend', e => keyup('ArrowUp'));
        document.getElementById('d-pad-ru').addEventListener('touchstart', e => { keydown('ArrowUp'); keydown('ArrowRight'); });
        // document.getElementById('d-pad-ru').addEventListener('click', e => { keydown('ArrowUp'); keydown('ArrowRight'); }, false);
        document.getElementById('d-pad-ru').addEventListener('touchend', e => { keyup('ArrowUp'); keyup('ArrowRight'); });
        document.getElementById('d-pad-r').addEventListener('touchstart', e => keydown('ArrowRight'));
        // document.getElementById('d-pad-r').addEventListener('click', e => keydown('ArrowRight'), false);
        document.getElementById('d-pad-r').addEventListener('touchend', e => keyup('ArrowRight'));
        document.getElementById('d-pad-rd').addEventListener('touchstart', e => { keydown('ArrowDown'); keydown('ArrowRight'); });
        // document.getElementById('d-pad-rd').addEventListener('click', e => { keydown('ArrowDown'); keydown('ArrowRight'); }, false);
        document.getElementById('d-pad-rd').addEventListener('touchend', e => { keyup('ArrowDown'); keyup('ArrowRight'); });
        document.getElementById('d-pad-d').addEventListener('touchstart', e => keydown('ArrowDown'));
        // document.getElementById('d-pad-d').addEventListener('click', e => keydown('ArrowDown'), false);
        document.getElementById('d-pad-d').addEventListener('touchend', e => keyup('ArrowDown'));
        document.getElementById('d-pad-ld').addEventListener('touchstart', e => { keydown('ArrowLeft'); keydown('ArrowDown'); });
        // document.getElementById('d-pad-ld').addEventListener('click', e => { keydown('ArrowLeft'); keydown('ArrowDown'); }, false);
        document.getElementById('d-pad-ld').addEventListener('touchend', e => { keyup('ArrowLeft'); keyup('ArrowDown'); });
        document.getElementById('d-pad-l').addEventListener('touchstart', e => keydown('ArrowLeft'));
        // document.getElementById('d-pad-l').addEventListener('click', e => keydown('ArrowLeft'), false);
        document.getElementById('d-pad-l').addEventListener('touchend', e => keyup('ArrowLeft'));
        document.getElementById('d-pad-lu').addEventListener('touchstart', e => { keydown('ArrowLeft'); keydown('ArrowUp'); });
        // document.getElementById('d-pad-lu').addEventListener('click', e => { keydown('ArrowLeft'); keydown('ArrowUp'); }, false);
        document.getElementById('d-pad-lu').addEventListener('touchend', e => { keyup('ArrowLeft'); keyup('ArrowUp'); });
        document.getElementById('btn1_knop').addEventListener('touchstart', e => keydown(' '));
        document.getElementById('btn1_knop').addEventListener('click', e => keydown(' '));
        document.getElementById('btn1_knop').addEventListener('touchend', e => keyup(' '));
        document.getElementById('btn2_knop').addEventListener('touchstart', e => keydown('m'));
        document.getElementById('btn2_knop').addEventListener('click', e => keydown('m'));
        document.getElementById('btn2_knop').addEventListener('touchend', e => keyup('m'));
        document.addEventListener('touchmove', e => detectElementUnderMove(e), false);
        document.addEventListener('touchend', e => Input.reset(), false);
        document.addEventListener('touchcancel', e => Input.reset(), false);
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

        document.getElementById('d-pad-u').classList.remove('druk');
        document.getElementById('d-pad-ru').classList.remove('druk');
        document.getElementById('d-pad-r').classList.remove('druk');
        document.getElementById('d-pad-rd').classList.remove('druk');
        document.getElementById('d-pad-d').classList.remove('druk');
        document.getElementById('d-pad-ld').classList.remove('druk');
        document.getElementById('d-pad-l').classList.remove('druk');
        document.getElementById('d-pad-lu').classList.remove('druk');
        document.getElementById('btn1_knop').classList.remove('druk');
        document.getElementById('btn2_knop').classList.remove('druk');
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

function detectElementUnderMove(e: TouchEvent): void {
    let pos = e.changedTouches[0];
    let elementTouched = document.elementFromPoint(pos.clientX, pos.clientY);
    if (!elementTouched) return;

    switch (elementTouched.id) {
        case 'd-pad-u':
            keydown('ArrowUp');
            Input.reset([ 'ArrowUp' ]);
            document.getElementById('d-pad-u').classList.add('druk');
            break;
        case 'd-pad-ru':
            keydown('ArrowUp');
            keydown('ArrowRight');
            Input.reset(['ArrowUp', 'ArrowRight']);
            document.getElementById('d-pad-ru').classList.add('druk');
        break;
        case 'd-pad-r':
            keydown('ArrowRight');
            Input.reset(['ArrowRight']);
            document.getElementById('d-pad-r').classList.add('druk');
        break;
        case 'd-pad-rd':
            keydown('ArrowRight');
            keydown('ArrowDown');
            Input.reset(['ArrowDown', 'ArrowRight']);
            document.getElementById('d-pad-rd').classList.add('druk');
        break;
        case 'd-pad-d':
            keydown('ArrowDown');
            Input.reset(['ArrowDown']);
            document.getElementById('d-pad-d').classList.add('druk');
        break;
        case 'd-pad-ld':
            keydown('ArrowLeft');
            keydown('ArrowDown');
            Input.reset(['ArrowLeft', 'ArrowDown']);
            document.getElementById('d-pad-ld').classList.add('druk');
        break;
        case 'd-pad-l':
            keydown('ArrowLeft');
            Input.reset(['ArrowLeft']);
            document.getElementById('d-pad-l').classList.add('druk');
        break;
        case 'd-pad-lu':
            keydown('ArrowLeft');
            keydown('ArrowUp');
            Input.reset(['ArrowUp', 'ArrowLeft']);
            document.getElementById('d-pad-lu').classList.add('druk');
        break;
        case 'btn1_knop':
            keydown(' ');
            Input.reset([' ']);
            document.getElementById('btn1_knop').classList.add('druk');
        break;
        case 'btn2_knop':
            keydown('m');
            Input.reset(['m']);
            document.getElementById('btn2_knop').classList.add('druk');
        break;
    }
}

// export function getMousePos(evt: MouseEvent): Point {
    // let rect = view.outcanvas.getBoundingClientRect();
    // return <Point>{
    //     x: evt.clientX - rect.left,
    //     y: evt.clientY - rect.top
    // };
    // return <Point>{ x: 0, y: 0 };
// }
