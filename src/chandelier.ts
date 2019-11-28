import { BStopwatch } from "../BoazEngineJS/btimer";
import { Direction } from "../BoazEngineJS/direction";
import { Animation, AniData } from "../BoazEngineJS/animation";
import { Foe } from "./foe";
import { PlayerProjectile } from "./pprojectile";
import { ItemType } from "./item";
import { AudioId, BitmapId } from "./resourceids";
import { newArea, newSize } from "../BoazEngineJS/common";
import { GameModel as M } from "./sintervaniamodel";
import { Area, Point } from "../BoazEngineJS/interfaces";

/*[Serializable]*/
export class Chandelier extends Foe {
	public get damageToPlayer(): number {
		return 3;
	}

	protected get moveBeforeFrameChange(): number {
		return 0;
	}

	public get respawnAtRoomEntry(): boolean {
		return true;
	}

	protected static ChandelierHitArea: Area = newArea(14, 0, 35, 64);
	protected static chandelierSprites: Map<Direction, BitmapId[]> = new Map([
		// [Direction.None, [BitmapId.Chandelier_1]]
	]);
	protected static AnimationFrames: AniData<number>[] = [
		// { time: 125, data: BitmapId.Chandelier_2 },
		// { time: 125, data: BitmapId.Chandelier_3 },
		// { time: 125, data: BitmapId.Chandelier_4 },
		// { time: 125, data: BitmapId.Chandelier_5 },
	];

	protected animation: Animation<number>;
	protected timer: BStopwatch;

	protected get movementSprites(): Map<Direction, BitmapId[]> {
		return Chandelier.chandelierSprites;
	}

	protected state: ChandelierState;

	public get canHurtPlayer(): boolean {
		return this.state == ChandelierState.Crashing ? true : false;
	}

	public set canHurtPlayer(value: boolean) {

	}

	constructor(pos: Point, itemSpawned: ItemType = ItemType.HeartSmall) {
		super(pos);
		this.animation = new Animation<number>(Chandelier.AnimationFrames);
		this.animation.repeat = true;
		this.timer = BStopwatch.createWatch();
		// this.imgid = BitmapId.Chandelier_1;
		this.hitarea = Chandelier.ChandelierHitArea;
		this.size = newSize(50, 64);
		this.itemSpawnedAfterKill = ItemType.None;
		this.health = 0;
		this.state = ChandelierState.None;
	}

	public takeTurn(): void {
		switch (this.state) {
			case ChandelierState.None:
				if (M._.Belmont.x_plus_width >= this.pos.x && M._.Belmont.pos.x <= this.x_plus_width) {
					this.state = ChandelierState.Falling;
				}
				break;
			case ChandelierState.Falling:
				this.pos.y += 8;
				//if (M._.CurrentRoom.AnyCollisionsTiles(true, (this.pos.x, this.y_plus_height), (this.x_plus_width, this.y_plus_height))) {
				//	this.state = ChandelierState.Crashing;
				//	this.timer.Start();
				//	this.imgid = this.animation.stepValue();
				//}
				break;
			case ChandelierState.Crashing:
				if (this.animation.doAnimation(this.timer))
					this.imgid = this.animation.stepValue();
				if (this.animation.finished()) {
					this.timer.stop();
					this.state = ChandelierState.Crashed;
				}
				break;
		}
	}

	public Dispose(): void {
		BStopwatch.removeWatch(this.timer);
	}

	public handleHit(source: PlayerProjectile): void {
		super.handleHit(source);
		this.loseHealth(source);
	}

	public paint(offset: Point = null): void {
		super.paint(offset);
	}
}

export enum ChandelierState {
	None,
	Falling,
	Crashing,
	Crashed
}
