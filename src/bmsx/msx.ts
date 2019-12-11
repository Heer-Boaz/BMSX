import { Point } from "./common";
import { Color } from "./view";

export const TileSize: number = 16;
export class Tile {
	public x: number;
	public y: number;

	public static create(x: number, y: number): Tile {
		let result = new Tile();
		result.x = x * TileSize;
		result.y = y * TileSize;
		return result;
	}

	public [Symbol.toPrimitive](hint: any): any {
		if (hint == 'number') {
			return Tile.toStageCoord(this.x);
		}
		else if (hint.x && hint.y)
			return Tile.toStagePoint(this.x, this.y);

		return true;
	}

	public static [Symbol.toPrimitive](hint: any): any {
		if (hint == 'number') {
			return Tile.toStageCoord(hint);
		}
		else if (hint.x && hint.x == 'number' && hint.y && hint.y == 'number')
			return Tile.toStagePoint(hint.x, hint.y);

		return true;
	}

	public get stagePoint() {
		return { x: this.x * TileSize, y: this.y * TileSize };
	}

	public static toStageCoord(v: number): number {
		return v * TileSize;
	}

	public static toStagePoint(x: number | Point, y: number): Point {
		if ((<Point>x).y)
			return { x: (<Point>x).x * TileSize, y: (<Point>x).y * TileSize };
		return { x: <number>x * TileSize, y: y * TileSize };
	}
}

export const MSX1ScreenWidth: number = 256;
export const MSX1ScreenHeight: number = 192;
export const MSX2ScreenWidth: number = 256;
export const MSX2ScreenHeight: number = 212;
export const Msx1Colors: Color[] = [
	<Color>{ r: 0, g: 0, b: 0 },
	<Color>{ r: 0, g: 0, b: 0 },
	<Color>{ r: 0, g: 241, b: 20 },
	<Color>{ r: 68, g: 249, b: 86 },
	<Color>{ r: 85, g: 79, b: 255 },
	<Color>{ r: 128, g: 111, b: 255 },
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