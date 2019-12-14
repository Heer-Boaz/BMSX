import { RomLoadResult } from './bmsx/rompack';
import { Game, game } from './bmsx/engine';
import { GameConstants } from './gameconstants';
import { Model, Chapter } from './gamemodel';
import { Controller } from './gamecontroller';
import { GameView } from './gameview';
import { setPoint } from './bmsx/common';
import { Tile } from './bmsx/msx';

var _global = window || global;
_global['h406A'] = (rom: RomLoadResult, sndcontext: AudioContext, gainnode: GainNode): void => {
    let _model = new Model();
    let _view = new GameView({ x: GameConstants.ViewportWidth, y: GameConstants.ViewportHeight });
    let _controller = new Controller();
    new Game(rom, _model, _view, _controller, sndcontext, gainnode);

    game.start();
    Model._.SelectedChapterToPlay = Chapter.GameStart;
    Controller._.switchState(GameConstants.INITIAL_GAMESTATE);
    Controller._.switchSubstate(GameConstants.INITIAL_GAMESUBSTATE);
};

export class Bootstrapper {
    // public static h406A(rom: RomLoadResult): void {
    // }

    public static BootstrapGame(chapter: Chapter): void {
        switch (chapter) {
            case Chapter.Debug:
                Bootstrapper.bootstrapGameForDebug();
                break;
            case Chapter.GameStart:
                Bootstrapper.bootstrapGameForGameStart();
                break;
            default:
                throw Error(`Incorrect chapter for bootstrapping game! Chapter = ${chapter}`);
        }
    }

    private static bootstrapGameForGameStart(): void {
        setPoint(Model._.Belmont.pos, Tile.toStageCoord(2), Tile.toStageCoord(5));
        Model._.LoadRoom(1);
    }

    private static bootstrapGameForDebug(): void {
        Model._.LoadRoom(100);
        setPoint(Model._.Belmont.pos, Tile.toStageCoord(2), Tile.toStageCoord(5));
    }
}