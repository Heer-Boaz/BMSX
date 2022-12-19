import { Point } from "./bmsx";
import { GameObject } from "./gameobject";
import { insavegame } from "./gamereviver";
import { paintSprite } from "./view";

@insavegame
export abstract class Sprite extends GameObject {
	public flippedH: boolean;
	public flippedV: boolean;
	public imgid: string;

	constructor(id?: string) {
		super(id);
		this.pos = { x: 0, y: 0 };
		this.visible = true;
		this.hittable = true;
		this.flippedH = false;
		this.flippedV = false;
		this.z = 0;
		this.disposeFlag = false;
		this.disposeOnSwitchRoom = true;
	}

	override onspawn(spawningPos?: Point): void {
		if (spawningPos) {
			[this.pos.x, this.pos.y] = [spawningPos.x, spawningPos.y];
		}
	}

	override spawn(spawningPos: Point = null): this {
		global.model.spawn(this, spawningPos);
		return this; // Voor chaining
	}

	override paint = paintSprite;
}
