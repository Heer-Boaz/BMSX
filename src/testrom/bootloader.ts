import {
    BFont,
    BGamepadButton, BootArgs,
    GamepadInputMapping,KeyboardButton, KeyboardInputMapping,
    $,
    WorldConfiguration,
} from 'bmsx';
import { createTestromPlugin } from './modelplugin';
import { BitmapId } from './resourceids';
// Ensure FSM blueprint is registered
import './test_gamemodel';

// Find all (xyz as any) and replace them. Codex is stupid and always inserts buggy `as any`.
// (\s*\(([^)]+?)\s+as\s+any\s*\))
// $2

const _global = (window || globalThis) as unknown as { h406A: (args: BootArgs) => Promise<void> };

_global['h406A'] = (args: BootArgs): Promise<any> => {
    const worldConfiguration: WorldConfiguration = { viewportSize: { x: 320, y: 240 }, fsmId: 'testrom_world_fsm', modules: [createTestromPlugin()] };

    return $.init({ ...args, worldConfig: worldConfiguration }).then(() => {
        $.view.default_font = new BFont(BitmapId);
        // Set input maps now that input is initialized
        $.setInputMap(1, { keyboard: keyboardInputMapping, gamepad: gamepadInputMapping });
        $.start();
    });
};

const actions = ['up', 'right', 'down', 'left', 'panleft', 'panright', 'switch_camera', 'bla', 'blap', 'moveforward', 'movebackward', 'turnleft', 'turnright', 'rotateleft', 'rotateright', 'panup', 'pandown', 'pitchup', 'pitchdown', 'toggleprojection', 'fire'] as const;
export type Action = typeof actions[number];

type MyKeyboardInputMapping = {
    [key in keyof KeyboardInputMapping & Action]: KeyboardButton[];
};

type MyGamepadInputMapping = {
    [key in keyof GamepadInputMapping & Action]: BGamepadButton[];
};

export const keyboardInputMapping: MyKeyboardInputMapping = {
    'up': ['ArrowUp'],
    'right': ['ArrowRight'],
    'down': ['ArrowDown'],
    'left': ['ArrowLeft'],
    'switch_camera': ['KeyZ'],           // Switch camera
    'bla': ['KeyW'],            // Move forward
    'blap': ['KeyS'],           // Move backward
    'moveforward': ['KeyW'],    // Move forward
    'movebackward': ['KeyS'],   // Move backward
    'turnleft': ['KeyA'],       // Turn left
    'turnright': ['KeyD'],      // Turn right
    'panleft': ['KeyQ'],       // Pan left
    'panright': ['KeyE'],      // Pan right
    'rotateleft': ['Digit1'],    // Rotate left
    'rotateright': ['Digit3'],   // Rotate right
    'panup': ['KeyR'],         // Pan up
    'pandown': ['KeyF'],      // Pan down
    'pitchup': ['KeyT'],      // Pitch up
    'pitchdown': ['KeyG'],    // Pitch down
    'toggleprojection': ['KeyP'], // Toggle projection
    'fire': ['ShiftLeft'],
};

export const gamepadInputMapping: MyGamepadInputMapping = {
    'up': ['up'],
    'right': ['right'],
    'down': ['down'],
    'left': ['left'],
    'switch_camera': ['b'],
    'bla': ['x'],
    'blap': ['y'],
    'turnleft': ['left'],
    'turnright': ['right'],
    'moveforward': ['x'],
    'movebackward': ['y'],
    'panleft': ['lb'],
    'panright': ['rb'],
    'rotateleft': ['lt'],
    'rotateright': ['rt'],
    'panup': ['home'],
    'pandown': ['select'],
    'pitchup': ['up'],
    'pitchdown': ['down'],
    'toggleprojection': ['x', 'y'], // Toggle projection
    'fire': ['a'],
};

// Custom view subclass was removed; using RenderView directly. Extend here only if per-ROM overrides are needed.
