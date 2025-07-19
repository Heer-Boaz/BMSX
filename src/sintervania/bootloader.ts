import { controller, Game, game, model } from '../bmsx/bmsx';
import { setPoint } from '../bmsx/common';
import { Tile } from '../bmsx/msx';
import type { RomPack, BootArgs } from '../bmsx/rompack';
import { GameConstants } from './gameconstants';
import { Controller } from './gamecontroller';
import { Chapter, Model } from './gamemodel';
import { GameView } from './gameview';

var _global = window || globalThis;

_global['h406A'] = (args: BootArgs): void => {
    let _model = new Model();
    let _view = new GameView({ x: GameConstants.ViewportWidth, y: GameConstants.ViewportHeight });
    let _controller = new Controller();
    new Game({ ...args, model: _model, view: _view });

    game.start();
    (model as Model).SelectedChapterToPlay = Chapter.GameStart;
    (controller as Controller).switchState(GameConstants.INITIAL_GAMESTATE);
    (controller as Controller).switchSubstate(GameConstants.INITIAL_GAMESUBSTATE);
};

export class Bootloader {
    public static Boot(chapter: Chapter): void {
        switch (chapter) {
            case Chapter.Debug:
                Bootloader.bootstrapGameForDebug();
                break;
            case Chapter.GameStart:
                Bootloader.bootstrapGameForGameStart();
                break;
            default:
                throw Error(`Incorrect chapter for bootstrapping game! Chapter = ${chapter}`);
        }
    }

    private static bootstrapGameForGameStart(): void {
        setPoint((model as Model).Belmont.pos, Tile.toStageCoord(2), Tile.toStageCoord(5));
        (model as Model).LoadRoom(1);
    }

    private static bootstrapGameForDebug(): void {
        (model as Model).LoadRoom(100);
        setPoint((model as Model).Belmont.pos, Tile.toStageCoord(2), Tile.toStageCoord(5));
    }
}