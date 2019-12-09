import { Sprite } from "../BoazEngineJS/sprite";
import { Animation } from "../BoazEngineJS/animation"
import { AudioId, BitmapId } from "./resourceids";
import { GameConstants } from "./gameconstants";
import { newArea } from "../BoazEngineJS/common";
import { Model } from "./gamemodel";
import { SM } from "../BoazEngineJS/soundmaster";
import { Area, Point } from "../lib/interfaces";

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

	public set hitarea(value: Area) {
	}

	protected animation: Animation<number>;
	protected animationData: number[] = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

	constructor(pos: Point) {
		super(pos, BitmapId.Heart_fly);
		this.State = HeartSmallState.Flying;
		this.animation = new Animation(this.animationData,/*constantStepTime:*/1,/*repeat:*/true);
		this.uglyBitThing = false;
		this.priority = 30;
	}

	protected get floorCollision(): boolean {
		return Model._.currentRoom.IsCollisionTile(this.pos.x + 5, this.pos.y + 8);
	}

	protected uglyBitThing: boolean;

	public takeTurn(): void {
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
		if (this.objectCollide(Model._.Belmont)) {
			++Model._.Hearts;
			this.disposeFlag = true;
			SM.play(AudioId.Heart);
		}
	}

	public paint(offset: Point = null): void {
		super.paint(offset);
	}

	public dispose(): void {
		// Do nothing
	}
}