import { KeyboardInputMapping, KeyboardButton, GamepadInputMapping, GamepadButton } from '../bmsx/input';

export const actions = ['jump', 'right', 'duck', 'left', 'punch', 'highkick', 'lowkick', 'block'] as const;
export type Action = typeof actions[number];

export type MyKeyboardInputMapping = {
    [key in keyof KeyboardInputMapping & Action]: KeyboardButton;
};

export type MyGamepadInputMapping = {
    [key in keyof GamepadInputMapping & Action]: GamepadButton;
};

export const keyboardInputMapping: MyKeyboardInputMapping = {
    'jump': 'ArrowUp',
    'right': 'ArrowRight',
    'duck': 'ArrowDown',
    'left': 'ArrowLeft',
    'punch': 'KeyX',
    'highkick': 'KeyA',
    'lowkick': 'KeyZ',
    'block': 'ShiftLeft',
};

export const gamepadInputMapping: MyGamepadInputMapping = {
    'jump': 'up',
    'right': 'right',
    'duck': 'down',
    'left': 'left',
    'punch': 'a',
    'highkick': 'b',
    'lowkick': 'x',
    'block': 'y',
};