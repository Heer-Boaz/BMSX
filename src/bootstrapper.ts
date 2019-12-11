import { RomLoadResult } from './bmsx/rompack';
import { Game, game } from './bmsx/engine';
import { GameConstants } from './gameconstants';
import { Model, Chapter } from './gamemodel';
import { Controller } from './gamecontroller';
import { GameView } from './gameview';
import { View } from './bmsx/view';
import { SM } from './bmsx/soundmaster';
import { setPoint } from './bmsx/common';
import { Tile } from './bmsx/msx';

var _global = window || global;
_global['h406A'] = (rom: RomLoadResult): void => {
    new Game(rom, { x: GameConstants.ViewportWidth, y: GameConstants.ViewportHeight });
    game.setModel(new Model());
    game.setController(new Controller());
    let gameview = new GameView();
    game.setGameView(gameview);

    View.images = rom.images;

    SM.init(rom.resources);
    game.start();
    Model._.SelectedChapterToPlay = Chapter.GameStart;
    Controller._.switchState(GameConstants.INITIAL_GAMESTATE);
    Controller._.switchSubstate(GameConstants.INITIAL_GAMESUBSTATE);
};

export class Bootstrapper {
    public static h406A(rom: RomLoadResult): void {
        // new Game(rom, { x: GameConstants.ViewportWidth, y: GameConstants.ViewportHeight });
        // game.setModel(new Model());
        // game.setController(new Controller());
        // let gameview = new GameView();
        // game.setGameView(gameview);

        // View.images = rom.images;

        // SM.init(rom.resources);
        // game.start();
        // Model._.SelectedChapterToPlay = Chapter.GameStart;
        // Controller._.switchState(GameConstants.INITIAL_GAMESTATE);
        // Controller._.switchSubstate(GameConstants.INITIAL_GAMESUBSTATE);
    }

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