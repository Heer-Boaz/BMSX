import { RomLoadResult } from '../bmsx/rompack';
import { Game, game, model, BaseModel, IGameObject, Sprite } from '../bmsx/engine';
import { setPoint, newPoint, Direction, newSize } from '../bmsx/common';
import { Tile, MSX1ScreenWidth, MSX1ScreenHeight } from '../bmsx/msx';
import { GLView } from '../bmsx/glview';
import { BitmapId } from './resourceids';
import { Input } from '../bmsx/input';

let speler = class extends Sprite {
    constructor() {
        super();
        this.imgid = BitmapId.p1;
        this.priority = 1000;
    }

    takeTurn(): void {
        // Do cute animation

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
    }

};

let keuken = class extends Sprite {
    constructor() {
        super();
        this.imgid = BitmapId.Keuken;
        this.priority = 0;
    }

    takeTurn(): void {
    }
}

let _modelclass = class extends BaseModel {
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

let _viewclass = class extends GLView {
    public drawgame(): void {
        super.drawgame();
        super.drawSprites();
    }
};

var _global = window || global;
_global['h406A'] = (rom: RomLoadResult, sndcontext: AudioContext, gainnode: GainNode): void => {
    let _model = new _modelclass();
    let _view = new _viewclass(newSize(MSX1ScreenWidth, MSX1ScreenHeight));
    new Game(rom, _model, _view, null, sndcontext, gainnode);

    game.start();
    model.spawn(new keuken(), newPoint(0, 0));
    model.spawn(new speler(), newPoint(100, 100));
};
