import { RomLoadResult } from '../bmsx/rompack';
import { MSX1ScreenWidth, MSX1ScreenHeight } from '../bmsx/msx';
import { GLView } from '../bmsx/glview';
import { BitmapId } from './resourceids';
import { Input } from '../bmsx/input';
import { mdef, sstate, sdef, statedef_builder, machine_states } from '../bmsx/bfsm';
import { insavegame } from '../bmsx/gamereviver';
import { newArea, Point, newPoint, Direction, Game, newSize } from '../bmsx/bmsx';
import { GameObject } from '../bmsx/gameobject';
import { BaseModel } from '../bmsx/model';
import { Sprite } from '../bmsx/sprite';

@insavegame
class bclass extends Sprite {
    @statedef_builder
    public static bouw(): machine_states {
        function blarun(this: bclass, s: sstate) {
            if (Input.KD_UP) {
                this.pos.y -= 2;
            }
            if (Input.KD_RIGHT) {
                this.pos.x += 2;
            }
            if (Input.KD_DOWN) {
                this.pos.y += 2;
            }
            if (Input.KD_LEFT) {
                this.pos.x -= 2;
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

        return {
            states: {
                bla: {
                    onrun: blarun,
                    onenter(this: bclass) { this.imgid = BitmapId.b; },
                },
                blap: {
                    onrun: blarun,
                    onenter(this: bclass) { this.imgid = BitmapId.b2; },
                },
            }
        };
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
@insavegame
class gamemodel extends BaseModel {
    public [savestring]: string;

    @statedef_builder
    public static bouw(): machine_states {
        return {
            states: {
                game_start: {
                    onrun(this: gamemodel, s: sstate) { // Don't use 'onenter', as the game has not been fully initialized yet before 'onenter' triggers!
                        this.state.to('default');
                    }
                },
                default: {
                    onrun: BaseModel.defaultrun,
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
