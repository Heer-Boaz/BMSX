import { RomLoadResult } from '../bmsx/rompack';
import { Game, game, model, BaseModel, IGameObject, Sprite } from '../bmsx/engine';
import { setPoint, newPoint, Direction, newSize } from '../bmsx/common';
import { Tile, MSX1ScreenWidth, MSX1ScreenHeight } from '../bmsx/msx';
import { GLView } from '../bmsx/glview';
import { BitmapId } from './resourceids';
import { Input } from '../bmsx/input';

var _global = window || global;
_global['h406A'] = (rom: RomLoadResult, sndcontext: AudioContext, gainnode: GainNode): void => {
    let b = new class extends Sprite {
        constructor() {
            super();
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
        }

    }();

    let _model = new class extends BaseModel {
        public get gamewidth(): number {
            return MSX1ScreenWidth;
        }

        public get gameheight(): number {
            return MSX1ScreenHeight;
        }

        public initModelForGameStart(): void {
            this.spawn(b, newPoint(100, 100));
        }

        public collidesWithTile(o: IGameObject, dir: Direction): boolean {
            return false;
        }

        public isCollisionTile(x: number, y: number): boolean {
            return false;
        }
    }();

    let _view = new class extends GLView {
        public drawgame() {
            super.drawgame();
            super.drawSprites();
        }
    }(newSize(MSX1ScreenWidth, MSX1ScreenHeight));

    new Game(rom, _model, _view, null, sndcontext, gainnode);

    game.start();
    model.initModelForGameStart();
};
