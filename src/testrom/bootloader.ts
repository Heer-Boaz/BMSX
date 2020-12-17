import { RomLoadResult } from '../bmsx/rompack';
import { Game, game, model, BaseModel, IGameObject, Sprite, insavegame, Reviver } from '../bmsx/engine';
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
    }

    takeTurn(): void {
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
        if (Input.KC_F1) {
            _model.savestring = game.saveToString();
        }
        if (Input.KC_F2) {
            if (_model.savestring) game.loadFromString(_model.savestring);
        }
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

@insavegame
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

    game.start();
    _model.spawn(new bclass(), newPoint(100, 100));
};
