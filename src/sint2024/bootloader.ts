import { $, BFont, BGamepadButton, World, BootArgs, Game, GameView, GamepadInputMapping, KeyboardButton, KeyboardInputMapping, MSX1ScreenHeight, MSX1ScreenWidth, StateMachineBlueprint, build_fsm, new_vec2, type State } from '../bmsx/index';
import { quiz } from './quiz';
import { BitmapId } from './resourceids';
import { sint } from './sint';

var _game: Game;
let _model: World;
var _view: GameView;

const _global = (window || globalThis) as unknown as { h406A: (args: BootArgs) => Promise<void> };

_global['h406A'] = (args: BootArgs): Promise<void> => {
    _model = new World({ size: { width: MSX1ScreenWidth, height: MSX1ScreenHeight }, fsmId: 'world' });
    _view = new GameView(new_vec2(MSX1ScreenWidth, MSX1ScreenHeight));
    _view.default_font = new BFont(BitmapId);
    _game = new Game();
    return _game.init({ ...args, world: _model, view: _view }).then(() => {
        // set input map previously done in do_one_time_game_init
        _game.setInputMap(1, { keyboard: keyboardInputMapping, gamepad: gamepadInputMapping } as any);
        _game.start();
    });
};

const actions = ['up', 'right', 'down', 'left', 'a', 'b'] as const;
type Action = typeof actions[number];

type MyKeyboardInputMapping = {
    [key in keyof KeyboardInputMapping & Action]: KeyboardButton[];
};

type MyGamepadInputMapping = {
    [key in keyof GamepadInputMapping & Action]: BGamepadButton[];
};

const keyboardInputMapping: MyKeyboardInputMapping = {
    'up': ['ArrowUp'],
    'right': ['ArrowRight'],
    'down': ['ArrowDown'],
    'left': ['ArrowLeft'],
    'a': ['KeyA'],
    'b': ['KeyB'],
};

const gamepadInputMapping: MyGamepadInputMapping = {
    'up': ['up'],
    'right': ['right'],
    'down': ['down'],
    'left': ['left'],
    'a': ['a'],
    'b': ['b'],
};

const savestring = Symbol('savestring');
// @ts-ignore
class SintModelFSM {
    /**
     * A string property that is saved in the game.
     */
    public [savestring]: string;

    @build_fsm('model')
    /**
     * Constructs and returns a StateMachineBlueprint object.
     *
     * The blueprint defines the states and their behaviors for the state machine.
     *
     * @returns {StateMachineBlueprint} The blueprint for the state machine.
     *
     * The blueprint contains the following states:
     * - `#game_start`: The initial state of the game.
     *   - `enter`: A function that is called when entering the `#game_start` state.
     *   - `run`: A function that is called to run the `#game_start` state. Returns the next state as 'default'.
     *
     * - `default`: The default state of the game.
     *   - `enter`: A function that is called when entering the `default` state. It spawns a new quiz and a new sint.
     *   - `run`: A function that is called to run the `default` state. Uses `World.defaultrun`.
     */
    public static bouw(): StateMachineBlueprint {
        return {
            substates: {
                '#game_start': {
                    entering_state(this: World) {
                    },
                    tick(this: World, _s: State) { // Don't use 'onenter', as the game has not been fully initialized yet before 'onenter' triggers!
                        return 'default';
                    }
                },
                default: {
                    entering_state(this: World) {
                        let q = new quiz();
                        $.spawn(q);
                        let s = new sint();
                        $.spawn(s);
                    },
                },
            }
        };
    }

}
