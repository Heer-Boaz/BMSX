import { MSXConstants as MCS } from "./msx"

export class GameOptions {
	public static readonly INITIAL_SCALE: number = 1;
	public static readonly INITIAL_FULLSCREEN: boolean = false;

	public static Scale: number = GameOptions.INITIAL_SCALE;
	public static Fullscreen: boolean = GameOptions.INITIAL_FULLSCREEN;
	public static EffectsVolumePercentage: number = 100;
	public static MusicVolumePercentage: number = 100;

	public static get WindowWidth(): number {
		return (MCS.MSX2ScreenWidth * GameOptions.Scale);
	}

	public static get WindowHeight(): number {
		return (MCS.MSX2ScreenHeight * GameOptions.Scale);
	}

	public static get BufferWidth(): number {
		return (MCS.MSX2ScreenWidth * GameOptions.Scale);
	}

	public static get BufferHeight(): number {
		return (MCS.MSX2ScreenHeight * GameOptions.Scale);
	}
}