import { view } from "./engine";
import { moveArea } from "./common";
import { IRenderObject, Point, Size, Area } from './interfaces';

export abstract class Sprite implements IRenderObject {
	public id: string | null;
	public pos: Point;
	public size: Size;
	public hitarea: Area;
	public visible: boolean;
	public hittable: boolean;
	public flippedH: boolean;
	public flippedV: boolean;
	public priority: number;
	public disposeFlag: boolean;
	public imgid: number;
	public hitbox_sx?: number;
	public hitbox_sy?: number;
	public hitbox_sz?: number;
	public hitbox_ex?: number;
	public hitbox_ey?: number;
	public hitbox_ez?: number;
	public x_plus_width?: number;
	public y_plus_height?: number;
	public z_plus_depth?: number;
	public disposeOnSwitchRoom?: boolean;
	public oncollide: (src: IRenderObject) => void;

	// public static [Symbol.hasInstance](o: any): boolean {
	// 	return o && o.imgid;
	// }

	constructor(initialPos?: Point, imageId?: number) {
		this.id = null;
		this.pos = initialPos || <Point>{ x: 0, y: 0 };
		this.size = <Size>{ x: 0, y: 0 };
		this.hitarea = <Area>{
			start: { x: 0, y: 0 },
			end: { x: 0, y: 0 }
		};
		this.visible = true;
		this.hittable = true;
		this.flippedH = false;
		this.flippedV = false;
		this.priority = 0;
		this.disposeFlag = false;
		this.imgid = null;
		this.priority = 100;
		this.imgid = imageId || undefined;

		this.disposeOnSwitchRoom = true;
		this.oncollide = undefined;
	}

	spawn(spawningPos?: Point): void {
		if (spawningPos) this.pos = spawningPos;
	}

	abstract dispose(): void;

	abstract takeTurn(): void;

	paint(offset?: Point): void {
		if (offset)
			view.drawImg(this.imgid, this.pos.x + offset.x, this.pos.y + offset.y);
		else view.drawImg(this.imgid, this.pos.x, this.pos.y);
	}

	postpaint(offset?: Point): void {
	}

	static objectCollide = (o1: IRenderObject, o2: IRenderObject): boolean => {
		return o1.objectCollide(o2);
	}

	public collides(o: IRenderObject | Area): boolean {
		if ((o as IRenderObject).id) return this.objectCollide(<IRenderObject>o);
		else return this.areaCollide(<Area>o);
	}

	public collide(src: IRenderObject): void {
		this.oncollide && this.oncollide(src);
	}

	objectCollide = (o: IRenderObject): boolean => {
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
}