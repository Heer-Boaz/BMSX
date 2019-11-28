import { Point } from "./interfaces"
import { game } from "./engine";
import { Controller } from './controller';

export class Input {
    public static KC_BTN1: boolean;
    public static KC_BTN2: boolean;
    public static KC_BTN3: boolean;
    public static KC_BTN4: boolean;
    public static KC_BTN5: boolean;
    public static KC_BTN6: boolean;
    public static KC_DOWN: boolean;
    public static KC_F1: boolean;
    public static KC_F12: boolean;
    public static KC_F2: boolean;
    public static KC_F3: boolean;
    public static KC_F4: boolean;
    public static KC_F5: boolean;
    public static KC_LEFT: boolean;
    public static KC_M: boolean;
    public static KC_RIGHT: boolean;
    public static KC_SPACE: boolean;
    public static KC_UP: boolean;
    public static KD_BTN1: boolean;
    public static KD_BTN2: boolean;
    public static KD_BTN3: boolean;
    public static KD_BTN4: boolean;
    public static KD_BTN5: boolean;
    public static KD_BTN6: boolean;
    public static KD_DOWN: boolean;
    public static KD_F1: boolean;
    public static KD_F12: boolean;
    public static KD_F2: boolean;
    public static KD_F3: boolean;
    public static KD_F4: boolean;
    public static KD_F5: boolean;
    public static KD_LEFT: boolean;
    public static KD_M: boolean;
    public static KD_RIGHT: boolean;
    public static KD_SPACE: boolean;
    public static KD_UP: boolean;

    public static init(): void {
        Input.reset();

        window.addEventListener('keydown', keydown, false);
        window.addEventListener('keyup', keyup, false);
        window.addEventListener('blur', blur, false);
    }

    public static reset(): void {
        Input.KC_F1 = false;
        Input.KC_F2 = false;
        Input.KC_F3 = false;
        Input.KC_F4 = false;
        Input.KC_F5 = false;
        Input.KC_F12 = false;
        Input.KC_BTN1 = false;
        Input.KC_BTN2 = false;
        Input.KC_BTN3 = false;
        Input.KC_BTN4 = false;
        Input.KC_BTN5 = false;
        Input.KC_BTN6 = false;
        Input.KC_UP = false;
        Input.KC_RIGHT = false;
        Input.KC_DOWN = false;
        Input.KC_LEFT = false;
        Input.KC_SPACE = false;
        Input.KC_M = false;

        Input.KD_F1 = false;
        Input.KD_F2 = false;
        Input.KD_F3 = false;
        Input.KD_F4 = false;
        Input.KD_F5 = false;
        Input.KD_F12 = false;
        Input.KD_BTN1 = false;
        Input.KD_BTN2 = false;
        Input.KD_BTN3 = false;
        Input.KD_BTN4 = false;
        Input.KD_BTN5 = false;
        Input.KD_BTN6 = false;
        Input.KD_UP = false;
        Input.KD_RIGHT = false;
        Input.KD_DOWN = false;
        Input.KD_LEFT = false;
        Input.KD_SPACE = false;
        Input.KD_M = false;
    }
}

function keydown(e: KeyboardEvent): void {
    if (game.running) e.preventDefault();
    if (!document.hasFocus()) return;

    switch (e.key) {
        case "ArrowLeft":
            if (Input.KC_LEFT === true)
                Input.KC_LEFT = false;
            else Input.KC_LEFT = true;
            Input.KD_LEFT = true;
            break;
        case "ArrowRight":
            if (Input.KC_RIGHT === true)
                Input.KC_RIGHT = false;
            else Input.KC_RIGHT = true;
            Input.KD_RIGHT = true;
            break;
        case "ArrowDown":
            if (Input.KD_DOWN === true)
                Input.KC_DOWN = false;
            else Input.KC_DOWN = true;
            Input.KD_DOWN = true;
            break;
        case "ArrowUp":
            if (Input.KC_UP === true)
                Input.KC_UP = false;
            else Input.KC_UP = true;
            Input.KD_UP = true;
            break;
        case " ":
            if (Input.KC_SPACE === true)
                Input.KC_SPACE = false;
            else Input.KC_SPACE = true;
            Input.KD_SPACE = true;
            break;
        case "M":
            if (!Input.KD_M)
                Input.KC_M = true;
            else Input.KC_M = false;
            Input.KD_M = true;
            break;
        case "F1":
            if (!Input.KD_F1)
                Input.KC_F1 = true;
            else Input.KC_F1 = false;
            Input.KD_F1 = true;
            break;
        case "F2":
            if (!Input.KD_F2)
                Input.KC_F2 = true;
            else Input.KC_F2 = false;
            Input.KD_F2 = true;
            break;
        case "F3":
            if (!Input.KD_F3)
                Input.KC_F3 = true;
            else Input.KC_F3 = false;
            Input.KD_F3 = true;
            break;
        case "F4":
            if (!Input.KD_F4)
                Input.KC_F4 = true;
            else Input.KC_F4 = false;
            Input.KD_F4 = true;
            break;
        case "F5":
            if (!Input.KD_F5)
                Input.KC_F5 = true;
            else Input.KC_F5 = false;
            Input.KD_F5 = true;
            break;
        case "F12":
            if (!Input.KD_F12)
                Input.KC_F12 = true;
            else Input.KC_F12 = false;
            Input.KD_F12 = true;
            break;
    }
}

function keyup(e: KeyboardEvent): void {
    if (game.running) e.preventDefault();
    if (!document.hasFocus()) return;

    switch (e.key) {
        case "ArrowLeft":
            Input.KD_LEFT = false;
            Input.KC_LEFT = false;
            break;
        case "ArrowRight":
            Input.KD_RIGHT = false;
            Input.KC_RIGHT = false;
            break;
        case "ArrowDown":
            Input.KD_DOWN = false;
            Input.KC_DOWN = false;
            break;
        case "ArrowUp":
            Input.KD_UP = false;
            Input.KC_UP = false;
            break;
        case " ":
            Input.KD_SPACE = false;
            Input.KC_SPACE = false;
            break;
        case "M":
            Input.KD_M = false;
            Input.KC_M = false;
            break;
        case "F1":
            Input.KD_F1 = false;
            Input.KC_F1 = false;
            break;
        case "F2":
            Input.KD_F2 = false;
            Input.KC_F2 = false;
            break;
        case "F3":
            Input.KD_F3 = false;
            Input.KC_F3 = false;
            break;
        case "F4":
            Input.KD_F4 = false;
            Input.KC_F4 = false;
            break;
        case "F5":
            Input.KD_F5 = false;
            Input.KC_F5 = false;
            break;
        case "F12":
            Input.KD_F12 = false;
            Input.KC_F12 = false;
            break;
    }
}

function blur(e: FocusEvent): void {
    Input.reset();
}

export function getMousePos(evt: MouseEvent): Point {
    // let rect = view.outcanvas.getBoundingClientRect();
    // return <Point>{
    //     x: evt.clientX - rect.left,
    //     y: evt.clientY - rect.top
    // };
    return <Point>{ x: 0, y: 0 };
}
