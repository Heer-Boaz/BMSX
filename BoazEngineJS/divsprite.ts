/// <reference path="./common.ts"/>
/// <reference path="./view.ts"/>
/// <reference path="./engine.ts"/>
/// <reference path="./interfaces.ts"/>
import { moveArea, addToScreen, removeFromScreen } from "./common"
import { images } from "./engine";
import { IGameObject, Point, Size, Area } from "./interfaces";

export abstract class DivSprite implements IGameObject {
    visible: boolean;
    hitbox_sx?: number;
    hitbox_sy?: number;
    hitbox_sz?: number;
    hitbox_ex?: number;
    hitbox_ey?: number;
    hitbox_ez?: number;
    x_plus_width?: number;
    y_plus_height?: number;
    z_plus_depth?: number;
    public id: string | null;
    public divElement: HTMLDivElement;
    public divShadowElement: HTMLDivElement | null;
    public pos: Point;
    public size: Size;
    public shadowOffset: Point | null;
    public shadowSize: Size | null;
    public hitarea: Area;
    public hittable: boolean;
    public disposeFlag: boolean;
    public extendedProperties: Map<string, any>;

    // Methods
    getPos(): Point {
        return this.pos;
    }

    getSize(): Size {
        return this.size;
    }

    setPosNoTransform(pos: Point): void {
        this.pos = pos;
        this.divElement.style.left = [this.pos.x, 'px'].join('');
        this.divElement.style.top = [this.pos.y, 'px'].join('');
        if (this.divShadowElement) {
            this.divShadowElement.style.left = [this.pos.x + this.shadowOffset.x, 'px'].join('');
            this.divShadowElement.style.top = [this.pos.y + this.shadowOffset.y, 'px'].join('');
        }
    }

    setPos(pos: Point): void {
        this.pos = pos;
        this.divElement.style.transform = ['translate(', this.pos.x, 'px,', this.pos.y, 'px)'].join('');
        if (this.divShadowElement) this.divShadowElement.style.transform = ['translate(', this.pos.x + this.shadowOffset.x, 'px,', this.pos.y + this.shadowOffset.y, 'px)'].join('');
    }

    setSize(size: Size): void {
        this.size = size;
        this.divElement.style.width = [size.x, 'px'].join('');
        this.divElement.style.height = [size.y, 'px'].join('');
    }

    setShadowSize(size: Size | null): void {
        this.shadowSize = size;
        this.divShadowElement.style.width = [size.x, 'px'].join('');
        this.divShadowElement.style.height = [size.y, 'px'].join('');
    }

    handleResizeEvent(): void {
        this.setSize(this.size);
        if (this.divShadowElement) this.setShadowSize(this.shadowSize);
    }

    setImage(imgid: string): void {
        let img = this.divElement.firstChild as HTMLImageElement;
        img.src = images[imgid].src;
    }

    takeTurn(): void {
        if (this.disposeFlag) this.exile();
    }

    paint(offset?: Point): void {
    }

    postpaint = (offset?: Point): void => {
    }

    static objectCollide = (o1: IGameObject, o2: IGameObject): boolean => {
        return o1.objectCollide(o2);
    }

    objectCollide = (o: IGameObject): boolean => {
        if (!o.hitarea) return false;
        return this.areaCollide(moveArea(o.hitarea, o.pos));
    }

    areaCollide = (a: Area): boolean => {
        let o1 = this;
        let o1p = o1.pos;
        let o1a = o1.hitarea;

        let o2a = a;

        return o1p.x + o1a.end.x >= o2a.start.x && o1p.x + o1a.start.x <= o2a.end.x &&
            o1p.y + o1a.end.y >= o2a.start.y && o1p.y + o1a.start.y <= o2a.end.y;
    }

    inside(p: Point): boolean {
        let o1 = this;
        let o1p = o1.pos;
        let o1a = o1.hitarea;

        return o1p.x + o1a.end.x >= p.x && o1p.x + o1a.start.x <= p.x &&
            o1p.y + o1a.end.y >= p.y && o1p.y + o1a.start.y <= p.y;
    }

    spawn(spawningPos?: Point): void {
        if (spawningPos) this.setPos(spawningPos);
        addToScreen(this.divElement);
        if (this.divShadowElement) addToScreen(this.divShadowElement);
    }

    setVisible(visible: boolean): void {
        if (visible === false) this.divElement.style.visibility = 'collapse';
        else this.divElement.style.visibility = 'visible';
        if (this.divShadowElement) {
            if (visible === false) this.divShadowElement.style.visibility = 'collapse';
            else this.divShadowElement.style.visibility = 'visible';
        }
    }

    exile(): void {
        removeFromScreen(this.divElement);
        if (this.divShadowElement) removeFromScreen(this.divShadowElement);
    }

    constructor(divElement: HTMLDivElement, size: Size, pos?: Point | null, divShadowElement?: HTMLDivElement | null, shadowOffset?: Point | null, shadowSize?: Size | null) {
        this.divElement = divElement;
        if (divShadowElement) {
            this.divShadowElement = divShadowElement;
            this.shadowOffset = shadowOffset;
            this.setShadowSize(shadowSize);
        }

        this.id = null;
        if (!pos)
            pos = <Point>{ x: 0, y: 0 };
        this.setPos(pos);
        this.setSize(size);

        this.hitarea = <Area>{
            start: { x: 0, y: 0 },
            end: { x: size.x, y: size.y }
        };
        this.hittable = true;
        this.disposeFlag = false;
        this.extendedProperties = new Map<string, any>();
    }
}