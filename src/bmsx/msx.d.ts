import { Point } from "./common";
import { Color } from "./view";
export declare const TileSize: number;
export declare class Tile {
    x: number;
    y: number;
    static create(x: number, y: number): Tile;
    [Symbol.toPrimitive](hint: any): any;
    static [Symbol.toPrimitive](hint: any): any;
    get stagePoint(): {
        x: number;
        y: number;
    };
    static toStageCoord(v: number): number;
    static toStagePoint(x: number | Point, y: number): Point;
}
export declare const MSX1ScreenWidth: number;
export declare const MSX1ScreenHeight: number;
export declare const MSX2ScreenWidth: number;
export declare const MSX2ScreenHeight: number;
export declare const Msx1Colors: Color[];
export declare const Msx1ExtColors: Color[];
//# sourceMappingURL=msx.d.ts.map