import { Chapter, Model as M, Model } from "./gamemodel";
import { setPoint } from "../BoazEngineJS/common";
import { Tile } from "../BoazEngineJS/msx";
import { GameConstants } from "./gameconstants";
import { Controller } from "./gamecontroller";
import { GameView } from "./gameview";
import { View } from "../BoazEngineJS/view";
import { Game, game } from "../BoazEngineJS/engine";
import { SM } from "../BoazEngineJS/soundmaster";
import { RomLoadResult } from "../lib/rompack";

export class Bootstrapper {
    public static init(rom: RomLoadResult): void {
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
        setPoint(M._.Belmont.pos, Tile.toStageCoord(2), Tile.toStageCoord(5));
        M._.LoadRoom(1);
    }

    private static bootstrapGameForDebug(): void {
        M._.LoadRoom(100);
        setPoint(M._.Belmont.pos, Tile.toStageCoord(2), Tile.toStageCoord(5));
    }
}