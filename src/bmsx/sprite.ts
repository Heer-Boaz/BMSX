import { translate_vec3, set_inplace_vec3, set_inplace_area } from "./bmsx";
import { GameObject } from "./gameobject";
import { insavegame } from "./gameserializer";
import { DEFAULT_VERTEX_COLOR } from "./glview";
import { Area, BoundingBoxesPrecalc, vec3 } from "./rompack";
import { Color, DrawImgOptions, paintImage } from "./view";

@insavegame
/**
 * An abstract class representing a game object that can be rendered as a sprite.
 * Extends the GameObject class.
 */
export abstract class SpriteObject extends GameObject {
    public get flip_h() {
        return this.sprite.flip_h;
    }
    public set flip_h(fh: boolean) {
        this.sprite.flip_h = fh;
        this.updateBoundingBoxes();
    }

    public get flip_v() {
        return this.sprite.flip_v;
    }
    public set flip_v(fv: boolean) {
        this.sprite.flip_v = fv;
        this.updateBoundingBoxes();
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
        const imgmeta = global.rom['img_assets'][id]?.['imgmeta'];
        if (imgmeta) {
            this.sx = imgmeta['width'];
            this.sy = imgmeta['height'];
            if (this.hitarea) { // Only update the hitarea if it exists
                const boundingbox = imgmeta['boundingbox']; // Get the bounding box of the image
                if (boundingbox) { // Only update the hitarea if the bounding box exists
                    set_inplace_area(this.hitarea, boundingbox); // Update the hitarea to match the bounding box of the image (used for collision detection)
                }
            }
        }
    }

    private updateBoundingBoxes() {
        const imgmeta = global.rom['img_assets'][this.sprite.imgid]?.['imgmeta'];
        const boundingboxes = imgmeta['boundingboxes']; // Get the bounding boxes of the image
        if (boundingboxes) { // Only update the hitarea if the bounding boxes exist
            this.boundingBoxes = SpriteObject.selectBoundingBoxes(this.flip_h, this.flip_v, boundingboxes); // Update the hitarea to match the bounding boxes of the image (used for collision detection)
        }
    }

    private static selectBoundingBoxes(flip_h: boolean, flip_v: boolean, boxes: BoundingBoxesPrecalc): Area[] {
        if (flip_h && flip_v) {
            return boxes.fliphv;
        } else if (flip_h) {
            return boxes.fliph;
        } else if (flip_v) {
            return boxes.flipv;
        } else {
            return boxes.original;
        }
    }

    sprite: Sprite;

    constructor(id?: string, fsm_id?: string) {
        super(id, fsm_id);
        this.sprite ??= new Sprite();
    }

    override paint() {
        this.sprite.paint_offset.call(this.sprite, this);
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
    public options: DrawImgOptions;
    public get sx(): number {
        return this.options.sx;
    }
    public set sx(v: number) {
        this.options.sx = v;
    }
    public get sy(): number {
        return this.options.sy;
    }
    public set sy(v: number) {
        this.options.sy = v;
    }
    public get flip_h(): boolean {
        return this.options.flip_h;
    }
    public set flip_h(v: boolean) {
        this.options.flip_h = v;
    }
    public get flip_v(): boolean {
        return this.options.flip_v;
    }
    public set flip_v(v: boolean) {
        this.options.flip_v = v;
    }
    public get colorize(): Color {
        return this.options.colorize;
    }
    public set colorize(v: Color) {
        this.options.colorize = v;
    }
    public get imgid(): string {
        return this.options.imgid;
    }
    public set imgid(v: string) {
        this.options.imgid = v;
    }

    constructor() {
        this.options ??= {
            imgid: 'None',
            x: 0,
            y: 0,
            z: 0,
            flip_h: false,
            flip_v: false,
            sx: 1,
            sy: 1,
            colorize: DEFAULT_VERTEX_COLOR,
        };
        this.x ??= 0;
        this.y ??= 0;
        this.z ??= 0;
    }

    public paint_offset(offset: vec3) {
        set_inplace_vec3(this.options, translate_vec3(this, offset));
        paintImage(this.options);
    }

    public paint() {
        set_inplace_vec3(this.options, this);
        paintImage(this.options);
    }
}
