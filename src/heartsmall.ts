import { Sprite } from "../BoazEngineJS/sprite";
import { Animation } from "../BoazEngineJS/animation"
import { AudioId, BitmapId } from "./resourceids";
import { GameConstants } from "./gameconstants";
import { ResourceMaster } from "./resourcemaster";
import { sound } from "../BoazEngineJS/engine";
import { newArea } from "../BoazEngineJS/common";
import { GameModel } from "./sintervaniamodel";
import { SoundMaster } from "../BoazEngineJS/soundmaster";
import { Area, Point } from "../BoazEngineJS/interfaces";

export enum HeartSmallState {
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
		this.animation = new Animation<number>(this.animationData,/*constantStepTime:*/1,/*repeat:*/true);
		this.uglyBitThing = false;
	}

	protected get floorCollision(): boolean {
		return GameModel._.CurrentRoom.IsCollisionTile(this.pos.x + 5, this.pos.y + 8, false);
	}

	protected uglyBitThing: boolean;

	public takeTurn(): void {
		if (this.State == HeartSmallState.Flying) {
			let delta: number = 0;
			delta = this.animation.doAnimation(1).value;

			this.pos.x += delta;
			if (this.uglyBitThing)
				++this.pos.y;

			this.uglyBitThing = !this.uglyBitThing;

			if (this.pos.y > GameConstants.GameScreenHeight) {
				this.disposeFlag = true;
				return
			}

			if (this.floorCollision) {
				this.State = HeartSmallState.Standing;
				this.pos.y -= 3;
				this.imgid = BitmapId.Heart_small;
			}
		}
		if (this.objectCollide(GameModel._.Belmont)) {
			++GameModel._.Hearts;
			this.disposeFlag = true;
			// SoundMaster.PlayEffect(ResourceMaster.Sound[AudioId.Heart]);
		}
	}

	public paint(offset: Point = null): void {
		super.paint(offset);
	}
}