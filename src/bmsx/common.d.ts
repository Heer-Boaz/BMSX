import { BStopwatch } from "./engine";
export declare const enum Direction {
    None = 0,
    Up = 1,
    Right = 2,
    Down = 3,
    Left = 4
}
export interface Point {
    x: number;
    y: number;
}
export declare type Size = Point;
export interface Area {
    start: Point;
    end: Point;
}
export declare function moveArea(a: Area, p: Point): Area;
export declare function addPoints(a: Point, b: Point): Point;
export declare function randomInt(min: number, max: number): number;
export declare function newPoint(x: number, y: number): Point;
export declare function copyPoint(toCopy: Point): Point;
export declare function newArea(sx: number, sy: number, ex: number, ey: number): Area;
export declare function newSize(x: number, y: number): Size;
export declare function setPoint(p: Point, new_x: number, new_y: number): void;
export declare function setSize(s: Size, new_x: number, new_y: number): void;
export declare function area2size(a: Area): Point;
export declare function waitDuration(timer: BStopwatch, duration: number): boolean;
export declare function addToScreen(element: HTMLElement): void;
export declare function removeFromScreen(element: HTMLElement): void;
export declare function createDivSprite(img?: HTMLImageElement, imgsrc?: string | null, classnames?: string[] | null): HTMLDivElement;
export declare function GetDeltaFromSourceToTarget(source: Point, target: Point): Point;
export declare function LineLength(p1: Point, p2: Point): number;
export declare function storageAvailable(type: string): boolean;
export declare function localStorageAvailable(): boolean;
export declare function sessionStorageAvailable(): boolean;
export declare function LookAt(subjectpos: Point, targetpos: Point): Direction;
export declare function Opposite(dir: Direction): Direction;
//# sourceMappingURL=common.d.ts.map