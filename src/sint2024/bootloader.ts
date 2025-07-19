import { BFont, BGamepadButton, BaseModel, BootArgs, Direction, GLView, Game, GameObject, GamepadInputMapping, KeyboardButton, KeyboardInputMapping, MSX1ScreenHeight, MSX1ScreenWidth, StateMachineBlueprint, build_fsm, insavegame, new_vec2, type State } from '../bmsx/bmsx';
import { quiz } from './quiz';
import { BitmapId } from './resourceids';
import { sint } from './sint';

var _game: Game;
let _model: gamemodel;
var _view: gameview;

const _global = window || globalThis;

_global['h406A'] = async (args: BootArgs): Promise<void> => {
    _model = new gamemodel();
    _view = new gameview(new_vec2(MSX1ScreenWidth, MSX1ScreenHeight));
    _view.default_font = new BFont(BitmapId);
    _game = new Game();
    await _game.init({ ...args, model: _model, view: _view });
    _game.start();
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
@insavegame
/**
 * Represents the game model which extends the BaseModel.
 * This class is responsible for handling the game state and initialization.
 */
class gamemodel extends BaseModel {
    /**
     * A string property that is saved in the game.
     */
    public [savestring]: string;

    @build_fsm()
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
     *   - `run`: A function that is called to run the `default` state. Uses `BaseModel.defaultrun`.
     */
    public static bouw(): StateMachineBlueprint {
        return {
            states: {
                '#game_start': {
                    enter(this: gamemodel) {
                    },
                    run(this: gamemodel, _s: State) { // Don't use 'onenter', as the game has not been fully initialized yet before 'onenter' triggers!
                        return 'default';
                    }
                },
                default: {
                    enter(this: gamemodel) {
                        let q = new quiz();
                        $.spawn(q);
                        let s = new sint();
                        $.spawn(s);
                    },
                    run: BaseModel.defaultrun,
                },
            }
        };
    }

    /**
     * Constructor for the gamemodel class.
     * Initializes the base model.
     */
    constructor() {
        super();
    }

    /**
     * Gets the name of the constructor.
     *
     * @returns {string} The name of the constructor.
     */
    public get constructor_name(): string {
        return this.constructor.name;
    }

    /**
     * Performs one-time game initialization.
     *
     * @returns {this} The instance of the game model.
     */
    public override do_one_time_game_init(): this {
        $.setInputMap(1, { keyboard: keyboardInputMapping, gamepad: gamepadInputMapping });
        return this;
    }

    /**
     * Gets the width of the game screen.
     *
     * @returns {number} The width of the game screen.
     */
    public get gamewidth(): number {
        return MSX1ScreenWidth;
    }

    /**
     * Gets the height of the game screen.
     *
     * @returns {number} The height of the game screen.
     */
    public get gameheight(): number {
        return MSX1ScreenHeight;
    }

    /**
     * Determines if the given game object collides with a tile in the specified direction.
     *
     * @param {GameObject} _o - The game object.
     * @param {Direction} _dir - The direction of the collision.
     * @returns {boolean} False, indicating no collision.
     */
    public collidesWithTile(_o: GameObject, _dir: Direction): boolean {
        return false;
    }

    /**
     * Determines if the specified coordinates correspond to a collision tile.
     *
     * @param {number} _x - The x-coordinate.
     * @param {number} _y - The y-coordinate.
     * @returns {boolean} False, indicating no collision tile.
     */
    public isCollisionTile(_x: number, _y: number): boolean {
        return false;
    }
}

class gameview extends GLView {
}
