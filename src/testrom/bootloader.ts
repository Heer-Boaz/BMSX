import { GamepadButton } from './../bmsx/input';
import { RomPack } from '../bmsx/rompack';
import { MSX1ScreenWidth, MSX1ScreenHeight } from '../bmsx/msx';
import { GLView } from '../bmsx/glview';
import { BitmapId } from './resourceids';
import { Input, InputMap, KeyboardButton, GamepadInputMapping, KeyboardInputMapping } from '../bmsx/input';
import { sstate, statedef_builder, machine_states } from '../bmsx/bfsm';
import { show_download_savestate_dialog, insavegame, show_openfile_dialog, show_load_savestate_dialog } from '../bmsx/gameserializer';
import { new_area, Direction, Game, new_vec2, get_gamemodel } from '../bmsx/bmsx';
import { GameObject } from '../bmsx/gameobject';
import { BaseModel } from '../bmsx/model';
import { SpriteObject } from '../bmsx/sprite';

const get_model = get_gamemodel<gamemodel>;

const actions = ['up', 'right', 'down', 'left', 'jump'] as const;
type Action = typeof actions[number];

type MyKeyboardInputMapping = {
    [key in keyof KeyboardInputMapping & Action]: KeyboardButton;
};

type MyGamepadInputMapping = {
    [key in keyof GamepadInputMapping & Action]: GamepadButton;
};

const keyboardInputMapping: MyKeyboardInputMapping = {
    'up': 'ArrowUp',
    'right': 'ArrowRight',
    'down': 'ArrowDown',
    'left': 'ArrowLeft',
    'jump': 'Space',
};

const gamepadInputMapping: MyGamepadInputMapping = {
    'up': 'up',
    'right': 'right',
    'down': 'down',
    'left': 'left',
    'jump': 'x',
};

@insavegame
class bclass extends SpriteObject {
    @statedef_builder
    public static bouw(): machine_states {
        Input.setInputMap(0, {
            keyboard: keyboardInputMapping,
            gamepad: gamepadInputMapping,
        } as InputMap);

        // To check if an action is pressed for player 0

        function blarun(this: bclass, s: sstate) {
            const speed = 2;

            const pressedActions = Input.getPressedActions(0);

            for (const { action, click } of pressedActions) {
                switch (action) {
                    case 'up':
                        this.pos.y -= speed;
                        break;
                    case 'right':
                        this.pos.x += speed;
                        break;
                    case 'down':
                        this.pos.y += speed;
                        break;
                    case 'left':
                        this.pos.x -= speed;
                        break;
                }
            }

            if (Input.KC_BTN1) {
                get_model()[savestring] = get_model().save();
                // console.info(`${new Date().toTimeString()} Game saved!`);
                // console.info(`${_model[savestring]}`);
                show_download_savestate_dialog();
            }
            if (Input.KC_BTN2) {
                // if (_model[savestring]) {
                //     _model.load(_model[savestring]);
                //     _model[savestring] = undefined;
                //     delete _model[savestring];
                //     console.info(`${new Date().toTimeString()} Game loaded!`);
                // }
                show_load_savestate_dialog();
            }
            if (Input.KC_BTN3) {
            }
            if (Input.KC_BTN4) {
            }
            // Input.KC_BTN3 && me.state.to('blap');
            // Input.KC_BTN3 && debugtest1();
            // Input.KC_BTN4 && me.state.to('bla');
            // Input.KC_BTN4 && debugtest2();
        };

        return {
            states: {
                bla: {
                    run: blarun,
                    enter(this: bclass) { this.imgid = BitmapId.b; },
                },
                '#blap': {
                    run: blarun,
                    enter(this: bclass) { this.imgid = BitmapId.b2; },
                },
            }
        };
    }

    constructor() {
        super('The B');
        // this.imgid = BitmapId.b;
        this.hitarea = new_area(0, 0, 14, 18);
    }
};

const savestring = Symbol('savestring');
@insavegame
class gamemodel extends BaseModel {
    public [savestring]: string;

    @statedef_builder
    public static bouw(): machine_states {
        return {
            states: {
                '#game_start': {
                    run(this: gamemodel, s: sstate) { // Don't use 'onenter', as the game has not been fully initialized yet before 'onenter' triggers!
                        this.state.to('default');
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
        _model.spawn(new bclass(), new_vec2(100, 100));
        return this;
    }

    public get gamewidth(): number {
        return MSX1ScreenWidth;
    }

    public get gameheight(): number {
        return MSX1ScreenHeight;
    }

    public collidesWithTile(o: GameObject, dir: Direction): boolean {
        return false;
    }

    public isCollisionTile(x: number, y: number): boolean {
        return false;
    }
};

class gameview extends GLView {
    override drawgame() {
        super.drawgame();
        super.drawSprites();
    }
};

var _game: Game;
let _model: gamemodel;
var _view: gameview;

var _global = window || global;

_global['h406A'] = (rom: RomPack, sndcontext: AudioContext, gainnode: GainNode): void => {
    _model = new gamemodel();
    _view = new gameview(new_vec2(MSX1ScreenWidth, MSX1ScreenHeight));
    _game = new Game(rom, _model, _view, sndcontext, gainnode);
    _game.start();
};
