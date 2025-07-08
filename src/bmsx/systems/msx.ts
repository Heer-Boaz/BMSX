import { Color } from "../render/view";
import { vec2 } from "../rompack/rompack";

export const TileSize: number = 16;
export class Tile {
    public x: number;
    public y: number;

    public static create(x: number, y: number): Tile {
        return new Tile(x, y);
    }

    public constructor(x: number, y: number) {
        this.x = x * TileSize;
        this.y = y * TileSize;
    }

    public [Symbol.toPrimitive](hint: any): any {
        if (hint == 'number') {
            return Tile.toStageCoord(this.x);
        }
        else if (hint.x && hint.y)
            return Tile.toStagePoint(this.x, this.y);

        return true;
    }
    // https://1drv.ms/w/s!AhGwIeMtrb9HjOMW8H6tazCAqkySlg
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

    public static toStagePoint(x: number, y: number): vec2 {
        // if ((<Point>x).y) {
        // return { x: (<Point>x).x * TileSize, y: (<Point>x).y * TileSize };
        // }
        return { x: x * TileSize, y: y * TileSize };
    }
}

export const MSX1ScreenWidth: number = 256;
export const MSX1ScreenHeight: number = 192;
export const MSX2ScreenWidth: number = 256;
export const MSX2ScreenHeight: number = 212;
export const Msx1Colors: Color[] = [
    { r: 0 / 255, g: 0 / 255, b: 0 / 255, a: 1 },
    { r: 0 / 255, g: 0 / 255, b: 0 / 255, a: 1 },
    { r: 0 / 255, g: 241 / 255, b: 20 / 255, a: 1 },
    { r: 68 / 255, g: 249 / 255, b: 86 / 255, a: 1 },
    { r: 85 / 255, g: 79 / 255, b: 255 / 255, a: 1 },
    { r: 128 / 255, g: 111 / 255, b: 255 / 255, a: 1 },
    { r: 250 / 255, g: 80 / 255, b: 51 / 255, a: 1 },
    { r: 12 / 255, g: 255 / 255, b: 255 / 255, a: 1 },
    { r: 255 / 255, g: 81 / 255, b: 52 / 255, a: 1 },
    { r: 255 / 255, g: 115 / 255, b: 86 / 255, a: 1 },
    { r: 226 / 255, g: 210 / 255, b: 4 / 255, a: 1 },
    { r: 242 / 255, g: 217 / 255, b: 71 / 255, a: 1 },
    { r: 4 / 255, g: 212 / 255, b: 19 / 255, a: 1 },
    { r: 231 / 255, g: 80 / 255, b: 229 / 255, a: 1 },
    { r: 208 / 255, g: 208 / 255, b: 208 / 255, a: 1 },
    { r: 255 / 255, g: 255 / 255, b: 255 / 255, a: 1 },
];
export const Msx1ExtColors: Color[] = [{ r: 104, g: 104, b: 104, a: 1 }];