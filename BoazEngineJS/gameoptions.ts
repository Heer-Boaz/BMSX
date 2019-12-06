import { MSX2ScreenWidth, MSX2ScreenHeight } from "./msx";

export class GameOptions {
	public static readonly INITIAL_SCALE: number = 1;
	public static readonly INITIAL_FULLSCREEN: boolean = false;

	public static Scale: number = GameOptions.INITIAL_SCALE;
	public static Fullscreen: boolean = GameOptions.INITIAL_FULLSCREEN;
	public static EffectsVolumePercentage: number = 100;
	public static MusicVolumePercentage: number = 100;

	public static get WindowWidth(): number {
		return (MSX2ScreenWidth * GameOptions.Scale);
	}

	public static get WindowHeight(): number {
		return (MSX2ScreenHeight * GameOptions.Scale);
	}

	public static get BufferWidth(): number {
		return (MSX2ScreenWidth * GameOptions.Scale);
	}

	public static get BufferHeight(): number {
		return (MSX2ScreenHeight * GameOptions.Scale);
	}
}