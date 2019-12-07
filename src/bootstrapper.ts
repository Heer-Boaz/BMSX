import { Chapter, Model as M, Model } from "./gamemodel";
import { setPoint } from "../BoazEngineJS/common";
import { Tile } from "../BoazEngineJS/msx";
import { GameConstants } from "./gameconstants";
import { Controller } from "./gamecontroller";
import { GameView } from "./gameview";
import { View } from "../BoazEngineJS/view";
import { Game, game, RomLoadResult } from "../BoazEngineJS/engine";
import { SM } from "../BoazEngineJS/soundmaster";
import { AudioId } from "./resourceids";

export class Bootstrapper {
    public static init(rom: RomLoadResult): void {
        new Game(rom, { x: GameConstants.ViewportWidth, y: GameConstants.ViewportHeight });
        game.setModel(new Model());
        game.setController(new Controller());
        let gameview = new GameView();
        game.setGameView(gameview);

        View.images = rom.images;
        SM.SoundEffectList.set(AudioId.Init, { AudioId: AudioId.Init, Priority: -1 });
        SM.SoundEffectList.set(AudioId.Fout, { AudioId: AudioId.Fout, Priority: 0 });
        SM.SoundEffectList.set(AudioId.Selectie, { AudioId: AudioId.Selectie, Priority: 0 });
        SM.SoundEffectList.set(AudioId.Heart, { AudioId: AudioId.Heart, Priority: 1 });
        SM.SoundEffectList.set(AudioId.Hit, { AudioId: AudioId.Hit, Priority: 0 });
        SM.SoundEffectList.set(AudioId.Chestopen, { AudioId: AudioId.Chestopen, Priority: 4 });
        SM.SoundEffectList.set(AudioId.Item, { AudioId: AudioId.Item, Priority: 5 });
        SM.SoundEffectList.set(AudioId.Key, { AudioId: AudioId.Key, Priority: 5 });
        SM.SoundEffectList.set(AudioId.Knife, { AudioId: AudioId.Knife, Priority: 0 });
        SM.SoundEffectList.set(AudioId.Cross, { AudioId: AudioId.Cross, Priority: 0 });
        SM.SoundEffectList.set(AudioId.Land, { AudioId: AudioId.Land, Priority: 0 });
        SM.SoundEffectList.set(AudioId.Bliksem, { AudioId: AudioId.Bliksem, Priority: 10 });
        // this.SoundEffectList.set(AudioId.Munnies, { AudioId: AudioId.Munnies, Priority: 0 });
        SM.SoundEffectList.set(AudioId.Au, { AudioId: AudioId.Au, Priority: 2 });
        // this.SoundEffectList.set(AudioId.Portal, { AudioId: AudioId.Portal, Priority: 0 });
        SM.SoundEffectList.set(AudioId.WallBreak, { AudioId: AudioId.WallBreak, Priority: 4 });
        SM.SoundEffectList.set(AudioId.Whip, { AudioId: AudioId.Whip, Priority: 0 });
        SM.SoundEffectList.set(AudioId.Kaboem, { AudioId: AudioId.Kaboem, Priority: 100 });
        SM.MusicList.set(AudioId.Baas, { AudioId: AudioId.Baas, loop: true, NextSong: undefined });
        SM.MusicList.set(AudioId.FeestVieren, { AudioId: AudioId.FeestVieren, loop: true, NextSong: undefined });
        SM.MusicList.set(AudioId.Humiliation, { AudioId: AudioId.Humiliation, loop: false, NextSong: undefined });
        SM.MusicList.set(AudioId.Hoera, { AudioId: AudioId.Hoera, loop: false, NextSong: undefined });
        SM.MusicList.set(AudioId.OHNOES, { AudioId: AudioId.OHNOES, loop: false, NextSong: undefined });
        SM.MusicList.set(AudioId.Prologue, { AudioId: AudioId.Prologue, loop: false, NextSong: undefined });
        SM.MusicList.set(AudioId.VampireKiller, { AudioId: AudioId.VampireKiller, loop: true, NextSong: undefined });


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