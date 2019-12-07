import { bst } from "./statemachine";

export interface Point {
    x: number;
    y: number;
}

export type Size = Point;

export interface Area {
    start: Point;
    end: Point;
}

export interface Color {
    r: number;
    g: number;
    b: number;
    a?: number;
}

export class PixelData {
    public B: number;
    public G: number;
    public R: number;
}

export interface IGameObject {
    // Properties
    id: string | null;
    disposeFlag: boolean;
    priority?: number;
    pos: Point;
    smachines?: bst<any>[];

    isWall?: boolean;
    disposeOnSwitchRoom?: boolean;

    takeTurn(): void;
    spawn: ((spawningPos?: Point | null) => void) | (() => void);
    dispose(): void;

    paint?(offset?: Point): void;
    postpaint?(offset?: Point): void; // Post-processing such as lighting effects or the characters of an ASCII-buffer in case of an ASCII-sprite
    objectCollide?(o: IRenderObject): boolean;
    areaCollide?(a: Area): boolean;
    collides?(o: IRenderObject | Area): boolean;
    collide?(src: IRenderObject): void;
    oncollide?: (src: IRenderObject) => void;
}

export interface IRenderObject extends IGameObject {
    size: Size;
    hitarea?: Area;
    visible: boolean;
    hitbox_sx?: number;
    hitbox_sy?: number;
    hitbox_ex?: number;
    hitbox_ey?: number;
    x_plus_width?: number;
    y_plus_height?: number;
    priority?: number;

    paint(offset?: Point): void;
    postpaint(offset?: Point): void; // Post-processing such as lighting effects or the characters of an ASCII-buffer in case of an ASCII-sprite
    objectCollide(o: IRenderObject): boolean;
    areaCollide(a: Area): boolean;
    collides(o: IRenderObject | Area): boolean;
    collide(src: IRenderObject): void;
    oncollide: (src: IRenderObject) => void;
}

export interface IGameView {
    drawGame(elapsedMs: number): void;
}

export interface ImageId2Url {
    id: number;
    url: string;
}
