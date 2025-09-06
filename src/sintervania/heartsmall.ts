import { Sprite, model } from 'bmsx';
import { Animation } from "bmsx/animation"
import { AudioId, BitmapId } from "./resourceids";
import { GameConstants } from "./gameconstants";
import { newArea } from "bmsx/common";
import { Model, belmont } from "./gamemodel";
import { SM } from "bmsx/soundmaster";
import { Area } from "bmsx/common";

export const enum HeartSmallState {
	Flying,
	Standing
}

export class HeartSmall extends Sprite {
	public State: HeartSmallState;
	protected static HitAreaFly: Area = newArea(0, 0, 9, 8);
	protected static HitAreaStand: Area = newArea(0, 0, 12, 11);

	public get hitarea(): Area {
		return this.State == HeartSmallState.Flying ? HeartSmall.HitAreaFly : HeartSmall.HitAreaStand;
	}

	protected animation: Animation<number>;
	protected animationData: number[] = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

	constructor() {
		super();
		this.State = HeartSmallState.Flying;
		this.imgid = BitmapId.Heart_fly;
		this.animation = new Animation(this.animationData,/*constantStepTime:*/1,/*repeat:*/true);
		this.uglyBitThing = false;
		this.z = 30;
	}

	protected get floorCollision(): boolean {
		return (model as Model).currentRoom.isCollisionTile(this.pos.x + 5, this.pos.y + 8);
	}

	protected uglyBitThing: boolean;

	public run(): void {
		if (this.State === HeartSmallState.Flying) {
			let delta = this.animation.doAnimation(1, 0).stepValue;

			this.pos.x += delta;
			if (this.uglyBitThing)
				++this.pos.y;

			this.uglyBitThing = !this.uglyBitThing;

			if (this.pos.y > GameConstants.GameScreenHeight) {
				this.disposeFlag = true;
				return;
			}

			if (this.floorCollision) {
				this.State = HeartSmallState.Standing;
				this.pos.y -= 3;
				this.imgid = BitmapId.Heart_small;
			}
		}
		if (this.objectCollide(belmont)) {
			++(model as Model).hearts;
			this.disposeFlag = true;
			SM.play(AudioId.Heart);
		}
	}
}
