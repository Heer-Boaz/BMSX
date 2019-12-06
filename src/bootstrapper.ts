import { Chapter, GameModel as M, GameModel } from "./sintervaniamodel";
import { setPoint } from "../BoazEngineJS/common";
import { Tile } from "../BoazEngineJS/msx";
import { GameConstants } from "./gameconstants";
import { GameController } from "./gamecontroller";
import { GameView } from "./gameview";
import { View } from "../BoazEngineJS/view";
import { Game, game, RomLoadResult } from "../BoazEngineJS/engine";
import { SM } from "../BoazEngineJS/soundmaster";
import { AudioId } from "./resourceids";


export class Bootstrapper {
    public static init(rom: RomLoadResult): void {
        new Game(rom, { x: GameConstants.ViewportWidth, y: GameConstants.ViewportHeight });
        game.setModel(new GameModel());
        game.setController(new GameController());
        let gameview = new GameView();
        game.setGameView(gameview);
        gameview.init();

        View.images = rom.images;
        SM.SoundEffectList.set(AudioId.Init, { AudioId: AudioId.Init, Priority: -1 });
        SM.SoundEffectList.set(AudioId.Fout, { AudioId: AudioId.Fout, Priority: 0 });
        SM.SoundEffectList.set(AudioId.Selectie, { AudioId: AudioId.Selectie, Priority: 0 });
        SM.SoundEffectList.set(AudioId.Heart, { AudioId: AudioId.Heart, Priority: 0 });
        SM.SoundEffectList.set(AudioId.Hit, { AudioId: AudioId.Hit, Priority: 0 });
        SM.SoundEffectList.set(AudioId.Chestopen, { AudioId: AudioId.Chestopen, Priority: 0 });
        SM.SoundEffectList.set(AudioId.Item, { AudioId: AudioId.Item, Priority: 0 });
        SM.SoundEffectList.set(AudioId.Key, { AudioId: AudioId.Key, Priority: 0 });
        SM.SoundEffectList.set(AudioId.Knife, { AudioId: AudioId.Knife, Priority: 0 });
        SM.SoundEffectList.set(AudioId.Land, { AudioId: AudioId.Land, Priority: 0 });
        // this.SoundEffectList.set(AudioId.Lightning, { AudioId: AudioId.Lightning, Priority: 0 });
        // this.SoundEffectList.set(AudioId.Munnies, { AudioId: AudioId.Munnies, Priority: 0 });
        SM.SoundEffectList.set(AudioId.Au, { AudioId: AudioId.Au, Priority: 0 });
        // this.SoundEffectList.set(AudioId.Portal, { AudioId: AudioId.Portal, Priority: 0 });
        SM.SoundEffectList.set(AudioId.WallBreak, { AudioId: AudioId.WallBreak, Priority: 0 });
        SM.SoundEffectList.set(AudioId.Whip, { AudioId: AudioId.Whip, Priority: 0 });
        SM.MusicList.set(AudioId.Pietula, { AudioId: AudioId.Pietula, loop: true, NextSong: null });
        // this.MusicList.set(AudioId.Ending, { Music: AudioId.Ending, loop: true, NextSong: null });
        SM.MusicList.set(AudioId.Humiliation, { AudioId: AudioId.Humiliation, loop: false, NextSong: null });
        // this.MusicList.set(AudioId.Huray, { Music: AudioId.Huray, loop: false, NextSong: null });
        SM.MusicList.set(AudioId.OHNOES, { AudioId: AudioId.OHNOES, loop: false, NextSong: null });
        SM.MusicList.set(AudioId.Prologue, { AudioId: AudioId.Prologue, loop: false, NextSong: null });
        SM.MusicList.set(AudioId.VampireKiller, { AudioId: AudioId.VampireKiller, loop: true, NextSong: null });


        SM.init(rom.resources);
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