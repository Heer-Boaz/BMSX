import { Chapter, GameModel as M, GameModel } from "./sintervaniamodel";
import { setPoint } from "../BoazEngineJS/common";
import { Tile } from "../BoazEngineJS/msx";
import { GameConstants } from "./gameconstants";
import { GameController } from "./gamecontroller";
import { GameView } from "./gameview";
import { View } from "../BoazEngineJS/view";
import { Game, game, RomLoadResult } from "../BoazEngineJS/engine";
import { SM } from "../BoazEngineJS/soundmaster";
import { ResourceMaster } from "./resourcemaster";

export class Bootstrapper {
    public static init(rom: RomLoadResult): void {
        new Game(rom, { x: GameConstants.ViewportWidth, y: GameConstants.ViewportHeight });
        game.setModel(new GameModel());
        game.setController(new GameController());
        let gameview = new GameView();
        game.setGameView(gameview);
        gameview.init();

        View.images = rom.images;
        ResourceMaster._.PrepareGameResources();

        SM.init(rom.resources, ResourceMaster._.SoundEffectList, ResourceMaster._.MusicList);
        game.start();
        GameModel._.SelectedChapterToPlay = Chapter.GameStart;
        GameController._.switchState(GameConstants.INITIAL_GAMESTATE);
        GameController._.switchSubstate(GameConstants.INITIAL_GAMESUBSTATE);
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
        M._.LoadRoom(1);
        setPoint(M._.Belmont.pos, Tile.toStageCoord(15), Tile.toStageCoord(10));
    }
    private static bootstrapGameForDebug(): void {
        M._.LoadRoom(100);
        setPoint(M._.Belmont.pos, Tile.toStageCoord(15), Tile.toStageCoord(10));
    }
}