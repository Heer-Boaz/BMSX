import { RomLoadResult } from '../bmsx/rompack';
import { Game, BaseModel, GameObject, Sprite, insavegame, cbstd, bssd, statedef_builder, sstate } from '../bmsx/engine';
import { newPoint, Direction, newSize, Point } from '../bmsx/common';
import { MSX1ScreenWidth, MSX1ScreenHeight } from '../bmsx/msx';
import { GLView } from '../bmsx/glview';
import { BitmapId } from './resourceids';
import { Input } from '../bmsx/input';

@insavegame
class bclass extends Sprite {
    @statedef_builder
    public static states(): cbstd {
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
            Input.KC_BTN3 && me.state.to('blap');
            Input.KC_BTN4 && me.state.to('bla');
        };

        let result = new cbstd(this.name);
        result.addBst(); // Add default BST (defined by default name)

        result.add( // Add states to default BST
            new bssd('bla', {
                onrun: blarun,
                onenter: (_, me: bclass) => { me.imgid = BitmapId.b; },
            }),
            new bssd('blap', {
                onrun: blarun,
                onenter: (_, me: bclass) => { me.imgid = BitmapId.b2; },
            }),
        );

        return result;
    }

    constructor() {
        super('The B');
        this.imgid = BitmapId.b;
        this.init(false);
    }

    public onspawn = (spawningPos?: Point): void => {
        super.onspawn?.(spawningPos);
        this.state.to('blap');
    }

    // onloaded() {
    //     this.init(true);
    //     super.onloaded();
    // }

    init(wasloaded: boolean) {

    }
};

const savestring = Symbol('savestring');
@insavegame
class _modelclass extends BaseModel {
    public [savestring]: string;

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

class _viewclass extends GLView {
    public drawgame() {
        super.drawgame();
        super.drawSprites();
    }
};

let _model: _modelclass;

var _global = window || global;
_global['h406A'] = (rom: RomLoadResult, sndcontext: AudioContext, gainnode: GainNode): void => {
    _model = new _modelclass();
    let _view = new _viewclass(newSize(MSX1ScreenWidth, MSX1ScreenHeight));
    new Game(rom, _model, _view, null, sndcontext, gainnode);

    global.game.start();
    _model.spawn(new bclass(), newPoint(100, 100));
};
