import {
    BFont,
    BGamepadButton, BootArgs,
    Game, GamepadInputMapping, GameView, KeyboardButton, KeyboardInputMapping,
    new_vec2, BaseModel
} from '../bmsx/index';
import { BitmapId } from './resourceids';
import { createTestromPlugin } from './modelplugin';
// Ensure FSM blueprint is registered
import './test_gamemodel';

// Find all (xyz as any) and replace them. Codex is stupid and always inserts buggy `as any`.
// (\s*\(([^)]+?)\s+as\s+any\s*\))
// $2

var _game: Game;
export let _model: BaseModel;
var _view: GameView;

const _global = window || globalThis;

_global['h406A'] = (args: BootArgs): Promise<any> => {
    _model = new BaseModel({ size: { width: 320, height: 240 }, fsmId: 'model', plugins: [createTestromPlugin()] });
    _view = new GameView(new_vec2(320, 240));

    _game = new Game();
    return _game.init({ ...args, model: _model, view: _view }).then(() => {
        _view.default_font = new BFont(BitmapId);
        // Set input maps now that input is initialized
        _game.setInputMap(1, { keyboard: keyboardInputMapping, gamepad: gamepadInputMapping } as any);
        _game.start();
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
