import { InputState, Point } from "./interfaces"
import * as Event from "./event"

export let mouseMoved = new Event.MoveEvent();
export let mouseClicked = new Event.ClickEvent();
export let keydowned = new Event.KeydownEvent();
export let keyupped = new Event.KeyupEvent();
export let blurred = new Event.BlurEvent();
export let touchStarted = new Event.TouchStartEvent();
export let touchMoved = new Event.TouchMoveEvent();
export let touchEnded = new Event.TouchEndEvent();
export var KeyState: InputState = {
    KC_F1: false,
    KC_F2: false,
    KC_F3: false,
    KC_F4: false,
    KC_F5: false,
    KC_F12: false,
    KC_BTN2: false,
    KC_BTN3: false,
    KC_BTN4: false,
    KC_BTN5: false,
    KC_BTN6: false,
    KC_UP: false,
    KC_RIGHT: false,
    KC_DOWN: false,
    KC_LEFT: false,
    KC_SPACE: false,
    KC_M: false,

    KD_F1: false,
    KD_F2: false,
    KD_F3: false,
    KD_F4: false,
    KD_F5: false,
    KD_F12: false,
    KD_BTN2: false,
    KD_BTN3: false,
    KD_BTN4: false,
    KD_BTN5: false,
    KD_BTN6: false,
    KD_UP: false,
    KD_RIGHT: false,
    KD_DOWN: false,
    KD_LEFT: false,
    KD_SPACE: false,
    KD_M: false,
};

export function mouseMove(source: HTMLElement, x: number, y: number) {
    mouseMoved.fire(source, x, y);
}

export function mouseClick(source: HTMLElement, x: number, y: number) {
    mouseClicked.fire(source, x, y);
}

export function keydown(source: HTMLElement, keycode: number) {
    keydowned.fire(source, keycode);
}

export function keyup(source: HTMLElement, keycode: number) {
    keyupped.fire(source, keycode);
}

export function blur(source: HTMLElement) {
    blurred.fire(source);
}

export function touchStart(source: HTMLElement, evt: Event) {
    touchStarted.fire(source, evt);
}

export function touchMove(source: HTMLElement, evt: Event) {
    touchMoved.fire(source, evt);
}

export function touchEnd(source: HTMLElement, evt: Event) {
    touchEnded.fire(source, evt);
}

export function getMousePos(evt: MouseEvent): Point {
    // let rect = view.outcanvas.getBoundingClientRect();
    // return <Point>{
    //     x: evt.clientX - rect.left,
    //     y: evt.clientY - rect.top
    // };
    return <Point>{ x: 0, y: 0 };
}

export function init(): void {
    KeyState = <InputState>{
        KC_UP: false,
        KC_RIGHT: false,
        KC_DOWN: false,
        KC_LEFT: false,
        KC_SPACE: false,
        KC_M: false,
        KU_UP: false,
        KU_RIGHT: false,
        KU_DOWN: false,
        KU_LEFT: false,
        KU_SPACE: false,
        KU_M: false,
        KD_UP: false,
        KD_RIGHT: false,
        KD_DOWN: false,
        KD_LEFT: false,
        KD_SPACE: false,
        KD_M: false
    };

    // let touchable = 'createTouch' in document;

    // if (touchable) {
    // window.addEventListener('touchstart', (evt) => {
    //     evt.preventDefault();
    //     evt.stopPropagation();
    //     Input.touchStart(document.getElementById('gamescreen'), evt);
    // }, false);
    // view.outcanvas.addEventListener('touchstart', (evt) => {
    //     Input.touchStart(view.outcanvas, evt);
    // }, false);
    // view.outcanvas.addEventListener('touchmove', (evt) => {
    //     Input.touchMove(view.outcanvas, evt);
    // }, false);
    // view.outcanvas.addEventListener('touchend', (evt) => {
    //     Input.touchEnd(view.outcanvas, evt);
    // }, false);
    // }

    // view.outcanvas.addEventListener('mousemove', (evt) => {
    //     let mousePos = Input.getMousePos(evt);
    //     Input.mouseMove(view.outcanvas, mousePos.x, mousePos.y);
    // }, false);

    // view.outcanvas.addEventListener('click', (evt) => {
    //     let mousePos = Input.getMousePos(evt);
    //     Input.mouseClick(view.outcanvas, mousePos.x, mousePos.y);
    // }, false);

    // window.addEventListener('keydown', (evt) => {
    //     let keycode = evt.which;
    //     Input.keydown(view.outcanvas, keycode);
    // }, false);

    // window.addEventListener('keyup', (evt) => {
    //     let keycode = evt.which;
    //     Input.keyup(view.outcanvas, keycode);
    // }, false);

    // window.addEventListener('blur', (evt) => {
    //     Input.blur(view.outcanvas);
    // }, false);

    // Input.keydowned.subscribe((source: HTMLCanvasElement, keycode: number) => {
    //     switch (keycode) {
    //         case 37: inputState.left = true; break;
    //         case 38: inputState.up = true; break;
    //         case 39: inputState.right = true; break;
    //         case 40: inputState.down = true; break;
    //         case 17: inputState.trigger1 = true; break;
    //         case 16: inputState.trigger2 = true; break;
    //     }
    // });

    // Input.keyupped.subscribe((source: HTMLCanvasElement, keycode: number) => {
    //     switch (keycode) {
    //         case 37: inputState.left = false; break;
    //         case 38: inputState.up = false; break;
    //         case 39: inputState.right = false; break;
    //         case 40: inputState.down = false; break;
    //         case 17: inputState.trigger1 = false; break;
    //         case 16: inputState.trigger2 = false; break;
    //     }
    // });

    // Input.blurred.subscribe((source: HTMLCanvasElement) => {
    //     inputState.up = false;
    //     inputState.right = false;
    //     inputState.down = false;
    //     inputState.left = false;
    //     inputState.trigger1 = false;
    //     inputState.trigger2 = false;
    // });
}
