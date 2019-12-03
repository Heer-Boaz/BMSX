import { IGameObject } from './interfaces';
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

export interface IGameObject {
    // Properties
    id: string | null;
    hitarea: Area | null;
    disposeFlag: boolean;
    visible: boolean;
    extendedProperties: Map<string, any>;
    pos: Point;
    size: Size;
    hitbox_sx?: number;
    hitbox_sy?: number;
    hitbox_sz?: number;
    hitbox_ex?: number;
    hitbox_ey?: number;
    hitbox_ez?: number;
    x_plus_width?: number;
    y_plus_height?: number;
    z_plus_depth?: number;
    priority?: number;

    // Methods
    takeTurn(): void;
    paint?(offset?: Point): void;
    postpaint?(offset?: Point): void; // Post-processing such as lighting effects or the characters of an ASCII-buffer in case of an ASCII-sprite
    objectCollide(o: IGameObject): boolean;
    areaCollide(a: Area): boolean;
    collides(o: IGameObject | Area): boolean;
    collide(src: IGameObject): void;
    oncollide: (src: IGameObject) => void;
    spawn(spawningPos?: Point | null): void;
    dispose(): void;
}

export interface IGameView {
    drawGame(elapsedMs: number): void;
}

export interface ImageId2Url {
    id: number;
    url: string;
}
