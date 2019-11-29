import { Chapter, GameModel as M, GameModel } from "./sintervaniamodel";
import { setPoint } from "../BoazEngineJS/common";
import { Tile } from "../BoazEngineJS/msx";
import { GameConstants } from "./gameconstants";
import { GameController } from "./gamecontroller";
import { GameView } from "./gameview";
import { GameState } from "../BoazEngineJS/model";
import { View } from "../BoazEngineJS/view";
import { Game, game } from "../BoazEngineJS/engine";
import { SoundMaster } from "../BoazEngineJS/soundmaster";

interface RomLoadResult {
    images: Map<number, HTMLImageElement>;
    audio: Map<number, HTMLAudioElement>;
    source: any
}

export class Bootstrapper {
    public static bootTheGame(rom: RomLoadResult): void {
        new Game({ x: GameConstants.ViewportWidth, y: GameConstants.ViewportHeight });
        game.setModel(new GameModel());
        game.setController(new GameController());
        let gameview = new GameView();
        game.setGameView(gameview);
        gameview.init();

        GameController._.switchState(GameState.LoadTheGame);

        View.images = rom.images;
        SoundMaster.audio = rom.audio;
        game.waitForUserToStart();

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
        setPoint(M._.Belmont.pos, <number>Tile.ToCoord(15), <number>Tile.ToCoord(10));
    }
    private static bootstrapGameForDebug(): void {
        M._.LoadRoom(100);
        setPoint(M._.Belmont.pos, <number>Tile.ToCoord(15), <number>Tile.ToCoord(10));
    }
}