import { BStopwatch, model } from "../bmsx/bmsx";
import { Direction } from "../bmsx/common";
import { Animation, AniData } from "../bmsx/animation";
import { Foe } from "./foe";
import { ItemType } from "./item";
import { BitmapId } from "./resourceids";
import { newArea, new_vec2 } from "../bmsx/common";
import { Model } from "./gamemodel";
import { Area } from "../bmsx/common";

const enum ChandelierState {
	None,
	Falling,
	Crashing,
	Crashed
}

export class Chandelier extends Foe {
	public get respawnOnRoomEntry(): boolean { return true; }

	protected static ChandelierHitArea: Area = newArea(14, 0, 35, 64);
	protected static chandelierSprites: Map<Direction, BitmapId[]> = new Map([
		// ['none', [BitmapId.Chandelier_1]]
	]);
	protected static AnimationFrames: AniData<number>[] = [
		// { time: 125, data: BitmapId.Chandelier_2 },
		// { time: 125, data: BitmapId.Chandelier_3 },
		// { time: 125, data: BitmapId.Chandelier_4 },
		// { time: 125, data: BitmapId.Chandelier_5 },
	];

	protected animation: Animation<number>;
	protected timer: BStopwatch;
	protected state: ChandelierState;

	public get canHurtPlayer(): boolean {
		return this.state == ChandelierState.Crashing ? true : false;
	}

	constructor(itemSpawned: ItemType = ItemType.None) {
		super();
		this.animation = new Animation<number>(Chandelier.AnimationFrames);
		this.animation.repeat = true;
		this.timer = BStopwatch.createWatch();
		// this.imgid = BitmapId.Chandelier_1;
		this.hitarea = Chandelier.ChandelierHitArea;
		this.size = new_vec2(50, 64);
		this.itemSpawnedAfterKill = itemSpawned;
		this.health = 0;
		this.state = ChandelierState.None;
	}

	public run(): void {
		switch (this.state) {
			case ChandelierState.None:
				if ((model as Model).Belmont.x_plus_width >= this.pos.x && (model as Model).Belmont.pos.x <= this.x_plus_width) {
					this.state = ChandelierState.Falling;
				}
				break;
			case ChandelierState.Falling:
				this.pos.y += 8;
				//if ((model as Model).CurrentRoom.AnyCollisionsTiles(true, (this.pos.x, this.y_plus_height), (this.x_plus_width, this.y_plus_height))) {
				//	this.state = ChandelierState.Crashing;
				//	this.timer.Start();
				//	this.imgid = this.animation.stepValue();
				//}
				break;
			case ChandelierState.Crashing:
				if (this.animation.doAnimation(this.timer).next)
					this.imgid = this.animation.stepValue;
				if (this.animation.finished === true) {
					this.timer.stop();
					this.state = ChandelierState.Crashed;
				}
				break;
		}
	}
}
