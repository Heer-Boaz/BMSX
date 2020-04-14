import { RomLoadResult } from '../bmsx/rompack';
import { Game, game, model, controller, BaseModel, IGameObject, BaseController } from '../bmsx/engine';
import { setPoint, newPoint, Direction } from '../bmsx/common';
import { Tile, MSX1ScreenWidth, MSX1ScreenHeight } from '../bmsx/msx';
import { GLView } from '../bmsx/glview';

var _global = window || global;
_global['h406A'] = (rom: RomLoadResult, sndcontext: AudioContext, gainnode: GainNode): void => {
    let _model = new class extends BaseModel {
        public get gamewidth(): number {
            return MSX1ScreenWidth;
        }

        public get gameheight(): number {
            return MSX1ScreenHeight;
        }

        public initModelForGameStart(): void {

        }

        public collidesWithTile(o: IGameObject, dir: Direction): boolean {
            return false;
        }

        public isCollisionTile(x: number, y: number): boolean {
            return false;

        }
    }();

    let _view = new class extends GLView {
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
    }();

    new Game(rom, _model, _view, _controller, sndcontext, gainnode);

    game.start();
    (controller as BaseController).switchState(0);
    (controller as BaseController).switchSubstate(0);
};
