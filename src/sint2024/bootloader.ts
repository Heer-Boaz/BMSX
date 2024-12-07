import { BaseModel, Direction, GLView, Game, GameObject, GamepadInputMapping, GamepadButton, KeyboardButton, KeyboardInputMapping, MSX1ScreenHeight, MSX1ScreenWidth, RomPack, StateMachineBlueprint, build_fsm, insavegame, new_vec2, type State } from '../bmsx/bmsx';

var _game: Game;
let _model: gamemodel;
var _view: gameview;

const _global = window || global;

_global['h406A'] = (rom: RomPack, sndcontext: AudioContext, gainnode: GainNode, debug: boolean = false): void => {
    _model = new gamemodel();
    _view = new gameview(new_vec2(MSX1ScreenWidth, MSX1ScreenHeight));
    _game = new Game(rom, _model, _view, sndcontext, gainnode, debug);
    _game.start();
};

const actions = ['up', 'right', 'down', 'left', 'a', 'b'] as const;
type Action = typeof actions[number];

type MyKeyboardInputMapping = {
    [key in keyof KeyboardInputMapping & Action]: KeyboardButton[];
};

type MyGamepadInputMapping = {
    [key in keyof GamepadInputMapping & Action]: GamepadButton[];
};

// @ts-ignore
const keyboardInputMapping: MyKeyboardInputMapping = {
    'up': ['ArrowUp'],
    'right': ['ArrowRight'],
    'down': ['ArrowDown'],
    'left': ['ArrowLeft'],
    'a': ['KeyA'],
    'b': ['KeyB'],
};

// @ts-ignore
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
class gamemodel extends BaseModel {
    public [savestring]: string;

    @build_fsm()
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
                    run: BaseModel.defaultrun,
                },
            }
        };
    }

    // DO NOT CHANGE THIS CODE! PLEASE USE STATE DEFS TO HANDLE GAME STARTUP LOGIC!
    // Trying to add logic here will most often result in runtime errors.
    // These runtime errors usually occur because the model was not created and initialized (with states),
    // while creating new game objects that reference the model or the model states
    constructor() {
        super();
    }

    public get constructor_name(): string {
        return this.constructor.name;
    }

    public override do_one_time_game_init(): this {

        return this;
    }

    public get gamewidth(): number {
        return MSX1ScreenWidth;
    }

    public get gameheight(): number {
        return MSX1ScreenHeight;
    }

    public collidesWithTile(_o: GameObject, _dir: Direction): boolean {
        return false;
    }

    public isCollisionTile(_x: number, _y: number): boolean {
        return false;
    }
};

class gameview extends GLView {
    override drawgame() {
        super.drawgame();
        super.drawSprites();
    }
}
