import { Point } from "./bmsx";
import { GameObject } from "./gameobject";
import { insavegame } from "./gamereviver";
import { paintSprite } from "./view";

@insavegame
export abstract class Sprite extends GameObject {
	public flippedH: boolean;
	public flippedV: boolean;
	public imgid!: string;
	declare pos: Point; // Redeclare to ensure that it is defined and not null
	declare size: Point; // Redeclare to ensure that it is defined and not null

	constructor(id?: string) {
		super(id);
		this.visible = true;
		this.hittable = true;
		this.flippedH = false;
		this.flippedV = false;
	}

	override onspawn(spawningPos?: Point): void {
		if (spawningPos) {
			[this.pos.x, this.pos.y] = [spawningPos.x, spawningPos.y];
		}
	}

	override spawn(spawningPos?: Point): this {
		global.model.spawn(this, spawningPos);
		return this; // Voor chaining
	}

	override paint = paintSprite;
}
