import { RomLoadResult } from '../bmsx/rompack';
import { Game, BaseModel, IGameObject, Sprite, insavegame, Reviver, onsave, cbst, bss } from '../bmsx/engine';
import { setPoint, newPoint, Direction, newSize } from '../bmsx/common';
import { Tile, MSX1ScreenWidth, MSX1ScreenHeight } from '../bmsx/msx';
import { GLView } from '../bmsx/glview';
import { BitmapId } from './resourceids';
import { Input } from '../bmsx/input';

@insavegame
class bclass extends Sprite {
    constructor() {
        super();
        this.id = 'The B';
        this.imgid = BitmapId.b;
        this.sm = new cbst();
        this.init(false);
        this.disposeOnSwitchRoom
    }

    onloaded() {
        this.init(true);
        super.onloaded();
    }

    init(wasloaded: boolean) {
        let ik = this;
        let blarun = () => {
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
                _model.savestring = _model.save();
                console.info(`${new Date().toTimeString()} Game saved!`);
                console.info(`${_model.savestring}`);
            }
            if (Input.KC_BTN2) {
                if (_model.savestring) {
                    _model.load(_model.savestring);
                    _model.savestring = undefined;
                    delete _model.savestring;
                    console.info(`${new Date().toTimeString()} Game loaded!`);
                }
            }
            Input.KC_M && this.sm.to('blap');
            Input.KC_SPACE && this.sm.to('bla');
        };

        this.sm.add(
            new bss('bla', {
                onrun: blarun,
                onenter: () => { ik.imgid = BitmapId.b; },
                start: true,
                init: !wasloaded,
            }),
            new bss('blap', {
                onrun: blarun,
                onenter: () => { ik.imgid = BitmapId.b2; },
            }),
        );
    }

    run(): void {
        super.run();
    }
};

@insavegame
class _modelclass extends BaseModel {
    public savestring: string = undefined;

    public get gamewidth(): number {
        return MSX1ScreenWidth;
    }

    public get gameheight(): number {
        return MSX1ScreenHeight;
    }

    public collidesWithTile(o: IGameObject, dir: Direction): boolean {
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
