import { bst } from "../BoazEngineJS/statemachine";

declare interface Point {
    x: number;
    y: number;
}

declare type Size = Point;

declare interface Area {
    start: Point;
    end: Point;
}

declare interface Color {
    r: number;
    g: number;
    b: number;
    a?: number;
}

declare class PixelData {
    public B: number;
    public G: number;
    public R: number;
}

declare interface IGameObject {
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

declare interface IRenderObject extends IGameObject {
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

declare interface IGameView {
    drawGame(elapsedMs: number): void;
}

declare interface ImageId2Url {
    id: number;
    url: string;
}
