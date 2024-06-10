import { KeyboardInputMapping, KeyboardButton, GamepadInputMapping, GamepadButton } from '../bmsx/bmsx';

export const actions = ['up', 'down', 'jump', 'right', 'duck', 'left', 'punch', 'highkick', 'lowkick', 'stoer'] as const;
export type Action = typeof actions[number];

export type MyKeyboardInputMapping = {
    [key in keyof KeyboardInputMapping & Action]: KeyboardButton[];
};

export type MyGamepadInputMapping = {
    [key in keyof GamepadInputMapping & Action]: GamepadButton[];
};

export const keyboardInputMapping1: MyKeyboardInputMapping = {
    'jump': ['ArrowUp'],
    'right': ['ArrowRight'],
    'duck': ['ArrowDown'],
    'left': ['ArrowLeft'],
    'punch': ['KeyX'],
    'highkick': ['KeyA'],
    'lowkick': ['KeyZ'],
    'stoer': ['ShiftLeft'],
    'up': ['ArrowUp'],
    'down': ['ArrowDown'],
};

export const gamepadInputMapping: MyGamepadInputMapping = {
    'jump': ['up'],
    'right': ['right'],
    'duck': ['down'],
    'left': ['left'],
    'punch': ['b'],
    'highkick': ['x'],
    'lowkick': ['a'],
    'stoer': ['y'],
    'up': ['up'],
    'down': ['down'],
};