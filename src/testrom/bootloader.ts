import {
    BGamepadButton, BootArgs,
    GLView, Game, GamepadInputMapping, KeyboardButton, KeyboardInputMapping,

    new_vec2
} from '../bmsx/index';
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
        _game.start();
    });
};

const actions = ['up', 'right', 'down', 'left', 'panleft', 'panright', 'load', 'save', 'bla', 'blap', 'moveforward', 'movebackward', 'turnleft', 'turnright', 'rotateleft', 'rotateright', 'panup', 'pandown'] as const;
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
    'load': ['ShiftLeft'],      // Toggle extra light
    'save': ['KeyZ'],           // Switch camera
    'bla': ['KeyW'],            // Move forward
    'blap': ['KeyS'],           // Move backward
    'moveforward': ['KeyW'],    // Move forward
    'movebackward': ['KeyS'],   // Move backward
    'turnleft': ['KeyA'],       // Turn left
    'turnright': ['KeyD'],      // Turn right
    'panleft': ['KeyQ'],       // Pan left
    'panright': ['KeyE'],      // Pan right
    'rotateleft': ['Key1'],    // Rotate left
    'rotateright': ['Key3'],   // Rotate right
    'panup': ['KeyR'],         // Pan up
    'pandown': ['KeyF'],      // Pan down
};

export const gamepadInputMapping: MyGamepadInputMapping = {
    'up': ['up'],
    'right': ['right'],
    'down': ['down'],
    'left': ['left'],
    'load': ['a'],
    'save': ['b'],
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
};

class gameview extends GLView {
    override drawgame() {
        super.drawgame();
    }
}
