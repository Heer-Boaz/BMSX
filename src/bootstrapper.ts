/// <reference path="../BoazEngineJS/model.ts" />
/// <reference path="./sintervaniamodel.ts" />

import { Chapter, GameModel as M } from "./sintervaniamodel";

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
        M._.Belmont.pos.Set(Tile.ToCoord(15), Tile.ToCoord(10));
    }
    private static bootstrapGameForDebug(): void {
        M._.LoadRoom(100);
        M._.Belmont.pos.Set(Tile.ToCoord(15), Tile.ToCoord(10));
    }
}