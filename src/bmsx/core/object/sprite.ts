import { DEFAULT_VERTEX_COLOR } from "../../render/backend/webgl/webgl.constants";
import { color, ImgRenderSubmission, type RenderSubmitQueue } from "../../render/gameview";
import { Area, BoundingBoxPrecalc, vec3, type HitPolygonsPrecalc, type Polygon } from "../../rompack/rompack";
import { insavegame, type RevivableObjectArgs } from "../../serializer/gameserializer";
import { $rompack } from '../game';
import { WorldObject } from "./worldobject";
import { new_vec2, new_vec3, set_inplace_area, set_inplace_vec3, translate_vec3 } from '../../utils/utils';

@insavegame
/**
 * An abstract class representing a world object that can be rendered as a sprite.
 * Extends the WorldObject class.
 */
export abstract class SpriteObject extends WorldObject {
    public get flip_h() {
        return this.sprite.flip_h;
    }
    public set flip_h(fh: boolean) {
        this.sprite.flip_h = fh;
        this.updateHitareas();
    }

    public get flip_v() {
        return this.sprite.flip_v;
    }
    public set flip_v(fv: boolean) {
        this.sprite.flip_v = fv;
        this.updateHitareas();
    }

    public get imgid() {
        return this.sprite.imgid;
    }

    /**
     * Sets the ID of the image used for this sprite and updates the sprite's size based on the image's metadata.
     * @param id The ID of the image to use for this sprite.
     */
    public set imgid(id: string) {
        this.sprite.imgid = id;
        const imgmeta = $rompack['img'][id]?.['imgmeta'];
        if (imgmeta) {
            this.sx = imgmeta['width'];
            this.sy = imgmeta['height'];

            this.updateHitareas();
        }
    }

    public get colorize() {
        return this.sprite.colorize;
    }

    public set colorize(c: color) {
        this.sprite.colorize = c;
    }

    private updateHitareas() {
        if (!this._hitarea) return; // Only update the hitarea if it exists
        const imgmeta = $rompack['img'][this.sprite.imgid]?.['imgmeta'];
        if (!imgmeta) return; // No image metadata available (e.g. for image 'none'), cannot update hitarea
        const boundingbox = imgmeta['boundingbox']; // Get the bounding box of the image
        if (boundingbox) { // Only update the hitarea if the bounding box exists
            set_inplace_area(this._hitarea, SpriteObject.selectBoundingBox(this.flip_h, this.flip_v, boundingbox)); // Update the hitarea to match the bounding box of the image (used for collision detection)
        }

        const polygonsMeta = imgmeta['hitpolygons'];
        if (polygonsMeta) {
            this.hitpolygon = SpriteObject.selectConcavePolygon(this.flip_h, this.flip_v, polygonsMeta);
        }
        else {
            this.hitpolygon = null; // No polygons available, set to null
        }
    }

    private static selectBoundingBox(flip_h: boolean, flip_v: boolean, box: BoundingBoxPrecalc): Area {
        if (flip_h && flip_v) {
            return box.fliphv;
        } else if (flip_h) {
            return box.fliph;
        } else if (flip_v) {
            return box.flipv;
        } else {
            return box.original;
        }
    }

    private static selectConcavePolygon(flip_h: boolean, flip_v: boolean, polys: HitPolygonsPrecalc): Polygon[] {
        if (flip_h && flip_v) {
            return polys.fliphv;
        } else if (flip_h) {
            return polys.fliph;
        } else if (flip_v) {
            return polys.flipv;
        } else {
            return polys.original;
        }
    }

    sprite: Sprite;

    constructor(opts: RevivableObjectArgs & { id?: string, fsm_id?: string }) {
        super(opts);
        this.sprite ??= new Sprite();
    }

    /**
     * Enumerate draw options for this sprite without issuing draw calls.
     * Submits a single DrawImgOptions describing the current sprite.
     */
    override queueRenderSubmissions(queue: RenderSubmitQueue): void {
        queue.submit.sprite(this.sprite.paint_offset(this));
    }
}

@insavegame
/**
 * A class representing a sprite that can be rendered on the screen.
 * Contains information about the sprite's position, size, image, and other options.
 */
export class Sprite {
    public x: number;
    public y: number;
    public z: number;
    public options: { type: 'img' } & ImgRenderSubmission;
    public get sx(): number {
        return this.options.scale.x;
    }
    public set sx(v: number) {
        this.options.scale.x = v;
    }
    public get sy(): number {
        return this.options.scale.y;
    }
    public set sy(v: number) {
        this.options.scale.y = v;
    }
    public get flip_h(): boolean {
        return this.options.flip.flip_h;
    }
    public set flip_h(v: boolean) {
        this.options.flip.flip_h = v;
    }
    public get flip_v(): boolean {
        return this.options.flip.flip_v;
    }
    public set flip_v(v: boolean) {
        this.options.flip.flip_v = v;
    }
    public get colorize(): color {
        return this.options.colorize;
    }
    public set colorize(v: color) {
        this.options.colorize = v;
    }
    public get imgid(): string {
        return this.options.imgid;
    }
    public set imgid(v: string) {
        this.options.imgid = v;
    }

    constructor(opts?: RevivableObjectArgs) {
        if (opts?.constructReason === 'revive') return;

        this.options ??= {
            type: 'img',
            imgid: 'none',
            pos: new_vec3(0, 0, 0),
            flip: { flip_h: false, flip_v: false },
            scale: new_vec2(1, 1),
            colorize: DEFAULT_VERTEX_COLOR,
        };
        this.x ??= 0;
        this.y ??= 0;
        this.z ??= 0;
    }

    public paint_offset(offset: vec3) {
        set_inplace_vec3(this.options.pos as vec3, translate_vec3(this, offset));
        return this.options;
    }
}
