import { RomLoadResult } from '../bmsx/rompack';
import { Game, game, model, controller, BaseModel, IGameObject, BaseController, Sprite } from '../bmsx/engine';
import { setPoint, newPoint, Direction } from '../bmsx/common';
import { Tile, MSX1ScreenWidth, MSX1ScreenHeight } from '../bmsx/msx';
import { GLView } from '../bmsx/glview';
import { BitmapId } from '../bmsx/resourceids';
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
                this.pos.y -= 1;
            }
            if (Input.KD_RIGHT) {
                this.pos.x += 1;
            }
            if (Input.KD_DOWN) {
                this.pos.y += 1;
            }
            if (Input.KD_LEFT) {
                this.pos.x -= 1;
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
    }(newPoint(MSX1ScreenWidth, MSX1ScreenHeight));

    //  = new GLView({ x: MSX1ScreenWidth, y: MSX1ScreenHeight });
    let _controller = new class extends BaseController {
        protected disposeOldState(newState: number): void {
        }

        protected disposeOldSubstate(newsubstate: number): void {
        }

        protected initNewSubstate(newsubstate: number): void {
        }

        protected initNewState(newstate: number): void {
        }

        public takeTurn(elapsedMs: number): void {
            super.takeTurn(elapsedMs);

            let objects = _model.objects;
            objects.forEach(o => !o.disposeFlag && o.takeTurn());
        }
    }();

    new Game(rom, _model, _view, _controller, sndcontext, gainnode);

    game.start();
    model.initModelForGameStart();
    (controller as BaseController).switchState(0);
    (controller as BaseController).switchSubstate(0);
};
