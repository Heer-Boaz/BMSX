import { Constants } from "./constants";

export namespace MSXConstants {
	export const MSX1ScreenWidth: number = 256;
	export const MSX1ScreenHeight: number = 192;
	export const MSX2ScreenWidth: number = 256;
	export const MSX2ScreenHeight: number = 212;
	// public static Msx1Colors: Color[] = [Color.FromArgb(0, 0, 0, 0),
	// Color.FromArgb(0, 0, 0),
	// Color.FromArgb(0, 241, 20),
	// Color.FromArgb(68, 249, 86),
	// Color.FromArgb(85, 79, 255),
	// Color.FromArgb(128, 111, 255),
	// Color.FromArgb(250, 80, 51),
	// Color.FromArgb(12, 255, 255),
	// Color.FromArgb(255, 81, 52),
	// Color.FromArgb(255, 115, 86),
	// Color.FromArgb(226, 210, 4),
	// Color.FromArgb(242, 217, 71),
	// Color.FromArgb(4, 212, 19),
	// Color.FromArgb(231, 80, 229),
	// Color.FromArgb(208, 208, 208),
	// Color.FromArgb(255, 255, 255)];
	// public static Msx1ExtColors: Color[] = [Color.FromArgb(104, 104, 104)];
	export const TileSize: number = 8;

	export class Tile {
		public t: number;
		public get toCoord(): number {
			return this.t * TileSize;
		}
		public static conversionMethod(v: number): Tile {
			return <Tile>{ t: v };
		}
		public static ToCoord(x: number, y: number): number | Point {
			if (!y) return x * TileSize;
			return <Point>{ x: x * TileSize, y: y * TileSize };
		}
	}
}