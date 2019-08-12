interface Point {
    x: number;
    y: number;
}

type Size = Point;

interface Area {
    start: Point;
    end: Point;
}

interface Color {
    r: number;
    g: number;
    b: number;
}

interface IGameObject {
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
    spawn(spawningPos?: Point | null): void;
    handleResizeEvent(): void;
    exile(): void;
}

interface ImageId2Url {
    id: number;
    url: string;
}

interface InputState {
    up: boolean;
    right: boolean;
    down: boolean;
    left: boolean;
    trigger1: boolean;
    trigger2: boolean;
}