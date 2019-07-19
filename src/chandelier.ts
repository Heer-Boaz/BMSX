import { BStopwatch } from "../BoazEngineJS/btimer";
import { Direction } from "./sintervaniamodel";
import { Foe } from "./foe";
import { PlayerProjectile } from "./pprojectile";
import { Item } from "./item";

/*[Serializable]*/
export class Chandelier extends Foe {
	public get DamageToPlayer(): number {
		return 3;
	}
	protected get moveBeforeFrameChange(): number {
		return 0;
	}
	public get RespawnAtRoomEntry(): boolean {
		return true;
	}
	protected static ChandelierHitArea: Area = new Area(14, 0, 35, 64);
	// protected static chandelierSprites: Map<Direction, BitmapId[]> = __init(new Map<Direction, BitmapId[]>(), { { Direction.None, BitmapId.Chandelier_1 } });
	//protected static (ulong, uint img)[] AnimationFrames = {
	//	(125, (uint)BitmapId.Chandelier_2),
	//	(125, (uint)BitmapId.Chandelier_3),
	//	(125, (uint)BitmapId.Chandelier_4),
	//	(125, (uint)BitmapId.Chandelier_5),
	//}
	protected animation: BAnimation<number>;
	protected timer: BStopwatch;
	protected get movementSprites(): Map<Direction, BitmapId[]> {
		return Chandelier.chandelierSprites;
	}
	protected state: ChandelierState;
	public get CanHurtPlayer(): boolean {
		return this.state == ChandelierState.Crashing ? true : false;
	}
	public set CanHurtPlayer(value: boolean) {

	}
	constructor(pos: Point, itemSpawned: Item.Type = Item.Type.HeartSmall) {
		super(pos);
		this.animation = __init(new Animation<number>(AnimationFrames), { Repeat: true });
		this.timer = BStopwatch.createWatch();
		this.imgid = <number>BitmapId.Chandelier_1;
		this.hitarea = Chandelier.ChandelierHitArea;
		this.size = new Size(50, 64);
		this.itemSpawnedAfterKill = Item.Type.None;
		this.Health = 0;
		this.state = ChandelierState.None;
	}
	public TakeTurn(): void {
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
	public HandleHit(source: PlayerProjectile): void {
		super.HandleHit(source);
		this.loseHealth(source);
	}
	public Paint(offset: Point = null): void {
		super.Paint(offset);
	}
}

export enum ChandelierState {
	None,
	Falling,
	Crashing,
	Crashed
}