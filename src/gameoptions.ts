import { GameConstants as CS } from "./gameconstants"

/*[Serializable]*/
export class GameOptions {
    private static _instance: GameOptions;
    public static get _(): GameOptions {
        return GameOptions._instance != null ? GameOptions._instance : (GameOptions._instance = new GameOptions());
    }
    public static set _(value: GameOptions) {
        GameOptions._instance = value;
    }
    public Scale: number = CS.InitialScale;
    public Fullscreen: boolean = CS.InitialFullscreen;
    public EffectsVolumePercentage: number = 100;
    public MusicVolumePercentage: number = 100;
    public get WindowWidth(): number {
        return (CS.MSX2ScreenWidth * GameOptions._.Scale);
    }
    public get WindowHeight(): number {
        return (CS.MSX2ScreenHeight * GameOptions._.Scale);
    }
    public get BufferWidth(): number {
        return (CS.MSX2ScreenWidth * GameOptions._.Scale);
    }
    public get BufferHeight(): number {
        return (CS.MSX2ScreenHeight * GameOptions._.Scale);
    }
}