import { new_vec2, vec3, vec2_translate, vec2, new_vec3, vec3_translate } from "./bmsx";
import { GameObject } from "./gameobject";
import { insavegame } from "./gamereviver";
import { DEFAULT_VERTEX_COLOR } from "./glview";
import { Color, paintImage } from "./view";

@insavegame
export abstract class SpriteObject extends GameObject {
    public get flip_h() {
        return this.sprite.flip_h;
    }
    public set flip_h(fh: boolean) {
        this.sprite.flip_h = fh;
    }

    public get flip_v() {
        return this.sprite.flip_v;
    }
    public set flip_v(fv: boolean) {
        this.sprite.flip_v = fv;
    }

    public get imgid() {
        return this.sprite.imgid;
    }
    public set imgid(id: string) {
        this.sprite.imgid = id;
        let imgmeta = global.game.rom['imgresources'][id]?.['imgmeta'];
        if (imgmeta) {
            this.sx = imgmeta['width'];
            this.sy = imgmeta['height'];
        }
    }

    sprite: Sprite;

    constructor(id?: string) {
        super(id);
        this.sprite ??= new Sprite();
    }

    override paint() {
        this.sprite.paint.call(this.sprite, this.x, this.y, this.z);
    }
}

@insavegame
export class Sprite {
    public x: number;
    public y: number;
    public z: number;
    public sx: number;
    public sy: number;
    public flip_h: boolean;
    public flip_v: any;
    public colorize: Color;
    public imgid: string;

    constructor() {
        this.imgid ??= 'None';
        this.flip_h ??= false;
        this.flip_v ??= false;
        this.colorize ??= DEFAULT_VERTEX_COLOR;
        this.x ??= 0;
        this.y ??= 0;
        this.z ??= 0;
        this.sx ??= 1;
        this.sy ??= 1;
    }

    public paint(dx: number = 0, dy: number = 0, dz: number = 0) {
        this.x += dx; // ! LELIJK!
        this.y += dy;
        this.z += dz;
        paintImage(this);
        this.x -= dx; // ! LELIJKER!
        this.y -= dy;
        this.z -= dz;
    }
}
