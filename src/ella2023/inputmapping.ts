import { KeyboardInputMapping, KeyboardButton, GamepadInputMapping, GamepadButton } from '../bmsx/bmsx';

export const actions = ['up', 'jump_left', 'jump_right', 'down', 'jump', 'right', 'duck', 'left', 'punch', 'highkick', 'lowkick', 'stoer'] as const;
export type Action = typeof actions[number];

export type MyKeyboardInputMapping = {
    [key in keyof KeyboardInputMapping & Action]: KeyboardButton[];
};

export type MyGamepadInputMapping = {
    [key in keyof GamepadInputMapping & Action]: GamepadButton[];
};

export const keyboardInputMapping1: MyKeyboardInputMapping = {
    'jump': ['ArrowUp'],
    'jump_left': ['ArrowUp', 'ArrowLeft'],
    'jump_right': ['ArrowUp', 'ArrowRight'],
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
    'jump_left': ['up', 'left'],
    'jump_right': ['up', 'right'],
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