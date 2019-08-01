import { Chapter, GameModel as M } from "./sintervaniamodel";
import { setPoint } from "../BoazEngineJS/common";
import { Tile } from "../BoazEngineJS/msx";

export class Bootstrapper {
    public static BootstrapGame(chapter: Chapter): void {
        switch (chapter) {
            case Chapter.Debug:
                Bootstrapper.bootstrapGameForDebug();
                break;
            case Chapter.GameStart:
                Bootstrapper.bootstrapGameForGameStart();
                break;
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