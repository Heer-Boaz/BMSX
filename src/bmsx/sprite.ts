import { newPoint, Point, translatePoint } from "./bmsx";
import { GameObject } from "./gameobject";
import { insavegame } from "./gamereviver";
import { DrawImgFlags, paintImage } from "./view";

@insavegame
export abstract class SpriteObject extends GameObject {
    public get flippedH() {
        return this.sprite.flippedH;
    }
    public set flippedH(fh: boolean) {
        this.sprite.flippedH = fh;
    }

    public get flippedV() {
        return this.sprite.flippedV;
    }
    public set flippedV(fv: boolean) {
        this.sprite.flippedV = fv;
    }

    public get imgid() {
        return this.sprite.imgid;
    }
    public set imgid(id: string) {
        this.sprite.imgid = id;
        let imgmeta = global.game.rom['imgresources'][id]?.['imgmeta'];
        if (imgmeta) {
            this.size.x = imgmeta['width'];
            this.size.y = imgmeta['height'];
        }
    }

    public get offset() {
        return this.sprite.pos;
    }
    public set offset(o: Point) {
        this.sprite.pos = o;
    }

    // public override set z(__z: number) {
    // 	super.z = __z;
    // 	if (this.sprite) this.sprite.z = this.z;
    // }

    sprite: Sprite;

    constructor(id?: string) {
        super(id);
        this.sprite ??= new Sprite();
    }

    override paint(offset?: Point) {
        offset ??= newPoint(0, 0);
        let total_offset = translatePoint(offset, this.pos);
        this.sprite.paint.call(this.sprite, total_offset, this.z);
    }
}

@insavegame
export class Sprite {
    public get flippedH(): boolean {
        return (this.#options & DrawImgFlags.HFLIP) === DrawImgFlags.HFLIP;
    }
    public set flippedH(f: boolean) {
        this.#options |= DrawImgFlags.HFLIP;
    }

    public get flippedV(): boolean {
        return (this.#options & DrawImgFlags.VFLIP) === DrawImgFlags.VFLIP;
    }
    public set flippedV(f: boolean) {
        this.#options |= DrawImgFlags.VFLIP;
    }

    public imgid: string;
    public pos: Point;
    public z: number;
    #options: DrawImgFlags;

    constructor() {
        this.imgid ??= 'None';
        this.#options ??= 0;
        this.pos ??= newPoint(0, 0);
        this.z ??= 0;
    }

    public paint(offset?: Point, z?: number) {
        paintImage(this.imgid, translatePoint(this.pos, offset || { x: 0, y: 0 }), z ?? this.z, this.#options);
    }
}
