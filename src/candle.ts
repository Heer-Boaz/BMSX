import { Foe } from "./foe";
import { BStopwatch } from "../BoazEngineJS/btimer";
import { Item } from "./item";
import { Animation, AniStepCompoundValue } from "../BoazEngineJS/animation"
import { Direction } from "../BoazEngineJS/direction";
import { PlayerProjectile } from "./pprojectile";
import { BitmapId } from "./resourceids";
import { newArea } from "../BoazEngineJS/common";

/*[Serializable]*/
export class Candle extends Foe {
	public get DamageToPlayer(): number {
		return 0;
	}

	protected get moveBeforeFrameChange(): number {
		return 0;
	}

	public get RespawnAtRoomEntry(): boolean {
		return true;
	}

	protected static CandleHitArea: Area = newArea(0, 0, 10, 16);
	static candleSprites: Map<Direction, any[]>;
	// protected static candleSprites: Map<Direction, BitmapId[]> = __init(new Map<Direction, BitmapId[]>(), { { Direction.None, BitmapId.Candle_1 } });
	protected static AnimationFrames: number[] = [<number>BitmapId.Candle_1, <number>BitmapId.Candle_2];
	protected static ElapsedMsPerFrame: number[] = [200, 200];
	protected animation: Animation<number>;
	protected timer: BStopwatch;
	protected get movementSprites(): Map<Direction, BitmapId[]> {
		return Candle.candleSprites;
	}

	protected itemSpawnedAfterKill: Item.Type;
	constructor(pos: Point, itemSpawned: Item.Type = Item.Type.HeartSmall) {
		super(pos);
		this.CanHurtPlayer = false;
		this.animation = new Animation<number>(Candle.AnimationFrames, Candle.ElapsedMsPerFrame);
		this.animation.repeat = true;
		this.timer = BStopwatch.createWatch();
		this.imgid = <number>this.animation.stepValue();
		this.timer.restart();
		this.hitarea = Candle.CandleHitArea;
		this.itemSpawnedAfterKill = itemSpawned;
	}

	public TakeTurn(): void {
		let imageId: AniStepCompoundValue<number> = { nextStepValue: <number>this.imgid };
		this.animation.doAnimation(this.timer, imageId);
		this.imgid = imageId.nextStepValue;
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
