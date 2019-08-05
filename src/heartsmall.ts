import { Sprite } from "../BoazEngineJS/sprite";
import { Animation } from "../BoazEngineJS/animation"
import { BitmapId, AudioId } from "./resourceids";
import { GameConstants } from "./gameconstants";
import { ResourceMaster } from "./resourcemaster";
import { sound, model } from "../BoazEngineJS/engine";
import { newArea } from "../BoazEngineJS/common";

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
		return M._.CurrentRoom.IsCollisionTile(this.pos.x + 5, this.pos.y + 8, false);
	}
	protected uglyBitThing: boolean;
	public Dispose(): void {

	}
	public TakeTurn(): void {
		if (this.State == HeartSmallState.Flying) {
			let delta: number = 0;
			this.animation.doAnimation({ timer: 1, imageId: delta });
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
				this.imgid = <number>BitmapId.Heart_small;
			}
		}
		if (this.objectCollide(M._.Belmont)) {
			++model.Hearts;
			this.disposeFlag = true;
			sound.PlayEffect(ResourceMaster.Sound[AudioId.Heart]);
		}
	}
	public Paint(offset: Point = null): void {
		super.paint(offset);
	}
}

export enum HeartSmallState {
	Flying,
	Standing
}