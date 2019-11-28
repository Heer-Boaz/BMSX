import { view } from "./engine";
import { moveArea, addPoints } from "./common";
// import { BitmapId } from "../BoazEngineJS/resourceids";
import { IGameObject, Point, Size, Area } from "./interfaces";

export abstract class Sprite implements IGameObject {
	public id: string | null;
	public pos: Point;
	public size: Size;
	public hitarea: Area;
	public visible: boolean;
	public hittable: boolean;
	public flippedH: boolean;
	public flippedV: boolean;
	public priority: number;
	public rawAscii: boolean;
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
	public extendedProperties: Map<string, any>;

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
		this.rawAscii = false;
		this.disposeFlag = false;
		this.imgid = null;
		this.extendedProperties = new Map<string, any>();
		if (imageId) this.imgid = imageId;
	}

	spawn(spawningPos?: Point): void {
		if (spawningPos) this.pos = spawningPos;
	}

	exile(): void {
		throw new Error("Method not implemented.");
	}

	abstract takeTurn(): void;

	paint(offset?: Point): void {
		if (offset)
			view.drawImg(this.imgid, this.pos.x + offset.x, this.pos.y + offset.y);
		else view.drawImg(this.imgid, this.pos.x, this.pos.y);
	}

	postpaint = (offset?: Point): void => {
	}

	static objectCollide = (o1: IGameObject, o2: IGameObject): boolean => {
		return o1.objectCollide(o2);
	}

	public collide(o: IGameObject | Area): boolean {
		if ((o as IGameObject).id) return this.objectCollide(<IGameObject>o);
		else return this.areaCollide(<Area>o);
	}

	objectCollide = (o: IGameObject): boolean => {
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

	handleResizeEvent(): void {
		throw new Error("Method not implemented.");
	}

	setExtendedProperty(key: string, value: any) {
		this.extendedProperties.set(key, value);
	}
}