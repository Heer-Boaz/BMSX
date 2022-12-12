import { RomLoadResult } from '../bmsx/rompack';
import { Game, BaseModel, GameObject, Sprite, insavegame, cmdef, sdef, statedef_builder, sstate, mdef, cmstate, newPoint, Direction, newSize, Point, newArea } from '../bmsx/bmsx';
import { MSX1ScreenWidth, MSX1ScreenHeight } from '../bmsx/msx';
import { GLView } from '../bmsx/glview';
import { BitmapId } from './resourceids';
import { Input } from '../bmsx/input';

@insavegame
class bclass extends Sprite {
    @statedef_builder
    public static _states(classname: string): cmdef {
        let blarun = (s: sstate, me: bclass) => {
            if (Input.KD_UP) {
                me.pos.y -= 2;
            }
            if (Input.KD_RIGHT) {
                me.pos.x += 2;
            }
            if (Input.KD_DOWN) {
                me.pos.y += 2;
            }
            if (Input.KD_LEFT) {
                me.pos.x -= 2;
            }
            if (Input.KC_BTN1) {
                _model[savestring] = _model.save();
                console.info(`${new Date().toTimeString()} Game saved!`);
                console.info(`${_model[savestring]}`);
            }
            if (Input.KC_BTN2) {
                if (_model[savestring]) {
                    _model.load(_model[savestring]);
                    _model[savestring] = undefined;
                    delete _model[savestring];
                    console.info(`${new Date().toTimeString()} Game loaded!`);
                }
            }
            // Input.KC_BTN3 && me.state.to('blap');
            // Input.KC_BTN3 && debugtest1();
            // Input.KC_BTN4 && me.state.to('bla');
            // Input.KC_BTN4 && debugtest2();
        };

        return new cmdef(classname, {
            machines: {
                master: new mdef('master', {
                    states: {
                        bla: new sdef('bla', {
                            onrun: blarun,
                            onenter: (_, me: bclass) => { me.imgid = BitmapId.b; },
                        }),
                        blap: new sdef('blap', {
                            onrun: blarun,
                            onenter: (_, me: bclass) => { me.imgid = BitmapId.b2; },
                        }),
                    }
                })
            }
        });
    }

    constructor() {
        super('The B');
        this.imgid = BitmapId.b;
        this.hitarea = newArea(0, 0, 14, 18);
    }

    override onspawn = (spawningPos?: Point): void => {
        super.onspawn?.(spawningPos);
        this.state.to('blap');
    };
};

const savestring = Symbol('savestring');
// @insavegame
class gamemodel extends BaseModel {
    public [savestring]: string;

    @statedef_builder
    public static buildModelStates(classname: string): cmdef {
        return new cmdef(classname, {
            machines: {
                master: new mdef('default', {
                    states: {
                        game_start: new sdef('game_start', {
                            onrun(s: sstate) { // Don't use 'onenter', as the game has not been fully initialized yet before 'onenter' triggers!
                                let ik = global.model as gamemodel;
                                ik.state.to('default');
                            }
                        }),
                        default: new sdef('default', {
                            onrun: BaseModel.defaultrun,
                        }),
                    }
                }),
            }
        });
    }

    // DO NOT CHANGE THIS CODE! PLEASE USE STATE DEFS TO HANDLE GAME STARTUP LOGIC!
    // Trying to add logic here will most often result in runtime errors.
    // These runtime errors usually occur because the model was not created and initialized (with states),
    // while creating new game objects that reference the model or the model states
    constructor() {
        super();
    }

	// Build and populate states. Can only be executed once main game objects and view have been created
	// DO NOT CHANGE THIS CODE! PLEASE USE STATE DEFS TO HANDLE GAME STARTUP LOGIC!
    public init_model_state_machines(): this {
        this.state = new cmstate(this.constructor.name, '_');
        this.state.populateMachines();
        this.state.to('game_start');

        return this;
    }

    public override do_one_time_game_init(): this {
        _model.spawn(new bclass(), newPoint(100, 100));
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

_global['h406A'] = (rom: RomLoadResult, sndcontext: AudioContext, gainnode: GainNode): void => {
    _model = new gamemodel();
    _view = new gameview(newSize(MSX1ScreenWidth, MSX1ScreenHeight));
    _game = new Game(rom, _model, _view, sndcontext, gainnode);
    _game.start();
};
