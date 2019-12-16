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
    public static get KC_BTN2(): boolean {
        return Input.getClickState('m');
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
        return Input.getKeyState('m');
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
    public static get KD_BTN2(): boolean {
        return Input.getKeyState('m');
    }

    public static init(): void {
        Input.KeyState = {};
        Input.KeyClickRequestedState = {};
        Input.reset();

        window.addEventListener('keydown', e => { preventDefaultEventAction(e, e.key); keydown(e.key); }, false);
        window.addEventListener('keyup', e => { preventDefaultEventAction(e, e.key); keyup(e.key); }, false);
        window.addEventListener('blur', blur, false);

        document.addEventListener('touchmove', e => handleTouchStuff(e));
        document.addEventListener('touchstart', e => handleTouchStuff(e));
        document.addEventListener('touchend', e => handleTouchStuff(e));
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

function preventDefaultEventAction(event: UIEvent, key: string) {
    if (game.running) {
        switch (key) {
            case 'Escape':
            case 'Esc':
            case 'F11':
            case 'F12':
                break;
            default:
                event.preventDefault();
                break;
        }
    }
}

function keydown(key: string): void {
    Input.KeyState[key] = true;
}

function keyup(key: string): void {
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
                e.preventDefault();
                elementTouched.classList.add('druk');
                elementTouched.classList.remove('los');

                buttonsTouched.forEach(b => filterFromReset.push(b));
            }
        }
    }
    Input.reset(filterFromReset);
}

function handleElementUnderTouch(e: Element): string[] {
    switch (e.id) {
        case 'd-pad-u':
            keydown('ArrowUp');
            return ['ArrowUp'];
        case 'd-pad-ru':
            keydown('ArrowUp');
            keydown('ArrowRight');
            document.getElementById('d-pad-ru').classList.add('druk');
            return ['ArrowUp', 'ArrowRight'];
        case 'd-pad-r':
            keydown('ArrowRight');
            document.getElementById('d-pad-r').classList.add('druk');
            return ['ArrowRight'];
        case 'd-pad-rd':
            keydown('ArrowRight');
            keydown('ArrowDown');
            document.getElementById('d-pad-rd').classList.add('druk');
            return ['ArrowDown', 'ArrowRight'];
        case 'd-pad-d':
            keydown('ArrowDown');
            document.getElementById('d-pad-d').classList.add('druk');
            return ['ArrowDown'];
            break;
        case 'd-pad-ld':
            keydown('ArrowLeft');
            keydown('ArrowDown');
            document.getElementById('d-pad-ld').classList.add('druk');
            return ['ArrowLeft', 'ArrowDown'];
        case 'd-pad-l':
            keydown('ArrowLeft');
            document.getElementById('d-pad-l').classList.add('druk');
            return ['ArrowLeft'];
        case 'd-pad-lu':
            keydown('ArrowLeft');
            keydown('ArrowUp');
            document.getElementById('d-pad-lu').classList.add('druk');
            return ['ArrowUp', 'ArrowLeft'];
        case 'btn1_knop':
            keydown(' ');
            document.getElementById('btn1_knop').classList.add('druk');
            return [' '];
        case 'btn2_knop':
            keydown('m');
            document.getElementById('btn2_knop').classList.add('druk');
            return ['m'];
        case 'btn3_knop':
            keydown('F1');
            document.getElementById('btn3_knop').classList.add('druk');
            return ['F1'];
        case 'btn4_knop':
            keydown('F5');
            document.getElementById('btn4_knop').classList.add('druk');
            return ['F5'];
    }
    return [];
}

// function handleElementUnderTouchEnd(e: Element): string[] {
//     switch (e.id) {
//         case 'd-pad-u':
//             keyup('ArrowUp');
//             document.getElementById('d-pad-u').classList.remove('druk');
//             return ['ArrowUp'];
//         case 'd-pad-ru':
//             keyup('ArrowUp');
//             keyup('ArrowRight');
//             document.getElementById('d-pad-ru').classList.remove('druk');
//             return ['ArrowUp', 'ArrowRight'];
//         case 'd-pad-r':
//             keyup('ArrowRight');
//             document.getElementById('d-pad-r').classList.remove('druk');
//             return ['ArrowRight'];
//         case 'd-pad-rd':
//             keyup('ArrowRight');
//             keyup('ArrowDown');
//             document.getElementById('d-pad-rd').classList.remove('druk');
//             return ['ArrowDown', 'ArrowRight'];
//         case 'd-pad-d':
//             keyup('ArrowDown');
//             document.getElementById('d-pad-d').classList.remove('druk');
//             return ['ArrowDown'];
//         case 'd-pad-ld':
//             keyup('ArrowLeft');
//             keyup('ArrowDown');
//             document.getElementById('d-pad-ld').classList.remove('druk');
//             return ['ArrowLeft', 'ArrowDown'];
//         case 'd-pad-l':
//             keyup('ArrowLeft');
//             document.getElementById('d-pad-l').classList.remove('druk');
//             return ['ArrowLeft'];
//         case 'd-pad-lu':
//             keyup('ArrowLeft');
//             keyup('ArrowUp');
//             document.getElementById('d-pad-lu').classList.remove('druk');
//             return ['ArrowUp', 'ArrowLeft'];
//         case 'btn1_knop':
//             keyup(' ');
//             document.getElementById('btn1_knop').classList.remove('druk');
//             return [' '];
//         case 'btn2_knop':
//             keyup('m');
//             document.getElementById('btn2_knop').classList.remove('druk');
//             return ['m'];
//         case 'btn3_knop':
//             keyup('F1');
//             document.getElementById('btn3_knop').classList.remove('druk');
//             return ['F1'];
//         case 'btn4_knop':
//             keyup('F5');
//             document.getElementById('btn4_knop').classList.remove('druk');
//             return ['F5'];
//     }
//     return [];
// }

// export function getMousePos(evt: MouseEvent): Point {
    // let rect = view.outcanvas.getBoundingClientRect();
    // return <Point>{
    //     x: evt.clientX - rect.left,
    //     y: evt.clientY - rect.top
    // };
    // return <Point>{ x: 0, y: 0 };
// }
