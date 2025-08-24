import {
    BFont,
    BGamepadButton, BootArgs,
    GLView, Game, GamepadInputMapping, KeyboardButton, KeyboardInputMapping,

    new_vec2
} from '../bmsx/index';
import { BitmapId } from './resourceids';
import { gamemodel } from './test_gamemodel';

var _game: Game;
export let _model: gamemodel;
var _view: gameview;

const _global = window || globalThis;

_global['h406A'] = (args: BootArgs): Promise<any> => {
    _model = new gamemodel();
    _view = new gameview(new_vec2(_model.gamewidth, _model.gameheight));

    _game = new Game();
    return _game.init({ ...args, model: _model, view: _view }).then(() => {
        _view.default_font = new BFont(BitmapId);
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

class gameview extends GLView {
}
