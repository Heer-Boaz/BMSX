import { Constants } from "./constants";

export const TileSize: number = 8;
export class Tile {
	public t: number;
	public get toCoord(): number {
		return this.t * TileSize;
	}

	public static conversionMethod(v: number): Tile {
		return <Tile>{ t: v };
	}

	public static ToCoord(x: number, y?: number): number | Point {
		if (!y) return x * TileSize;
		return <Point>{ x: x * TileSize, y: y * TileSize };
	}
}

export namespace MSXConstants {
	export const MSX1ScreenWidth: number = 256;
	export const MSX1ScreenHeight: number = 192;
	export const MSX2ScreenWidth: number = 256;
	export const MSX2ScreenHeight: number = 212;
	export const Msx1Colors: Color[] = [
		<Color>{ r: 0, g: 0, b: 0 },
		<Color>{ r: 0, g: 241, b: 20 },
		<Color>{ r: 68, g: 249, b: 86 },
		<Color>{ r: 85, g: 79, b: 255 },
		<Color>{ r: 128, g: 111, b: 2550 },
		<Color>{ r: 250, g: 80, b: 51 },
		<Color>{ r: 12, g: 255, b: 255 },
		<Color>{ r: 255, g: 81, b: 52 },
		<Color>{ r: 255, g: 115, b: 86 },
		<Color>{ r: 226, g: 210, b: 4 },
		<Color>{ r: 242, g: 217, b: 71 },
		<Color>{ r: 4, g: 212, b: 19 },
		<Color>{ r: 231, g: 80, b: 229 },
		<Color>{ r: 208, g: 208, b: 208 },
		<Color>{ r: 255, g: 255, b: 255 },
	];
	export const Msx1ExtColors: Color[] = [<Color>{ r: 104, g: 104, b: 104 }];
	// public static Msx1Colors: Color[] = [Color.FromArgb(0, 0, 0, 0),
	// Color.FromArgb(0  , 0,   0),
	// Color.FromArgb(0  , 241, 20),
	// Color.FromArgb(68 , 249, 86),
	// Color.FromArgb(85 , 79,  255),
	// Color.FromArgb(128, 111, 255),
	// Color.FromArgb(250, 80,  51),
	// Color.FromArgb(12 , 255, 255),
	// Color.FromArgb(255, 81,  52),
	// Color.FromArgb(255, 115, 86),
	// Color.FromArgb(226, 210, 4),
	// Color.FromArgb(242, 217, 71),
	// Color.FromArgb(  4, 212, 19),
	// Color.FromArgb(231, 80,  229),
	// Color.FromArgb(208, 208, 208),
	// Color.FromArgb(255, 255, 255)];
	// public static Msx1ExtColors: Color[] = [Color.FromArgb(104, 104, 104)];
}