import { Foe } from "./foe";
import { BStopwatch } from "../BoazEngineJS/btimer";
import { ItemType } from "./item";
import { Animation, AniStepCompoundValue } from "../BoazEngineJS/animation"
import { Direction } from "../BoazEngineJS/direction";
import { PlayerProjectile } from "./pprojectile";
import { AudioId, BitmapId } from "./resourceids";
import { newArea } from "../BoazEngineJS/common";
import { Area, Point } from "../BoazEngineJS/interfaces";

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
	protected static candleSprites: Map<Direction, BitmapId[]> = new Map([[Direction.None, [BitmapId.Candle_1]]]);
	protected static AnimationFrames: BitmapId[] = [BitmapId.Candle_1, BitmapId.Candle_2];
	protected static ElapsedMsPerFrame: number[] = [200, 200];
	protected animation: Animation<BitmapId>;
	protected timer: BStopwatch;
	protected get movementSprites(): Map<Direction, BitmapId[]> {
		return Candle.candleSprites;
	}

	protected itemSpawnedAfterKill: ItemType;
	constructor(pos: Point, itemSpawned: ItemType = ItemType.HeartSmall) {
		super(pos);
		this.CanHurtPlayer = false;
		this.animation = new Animation<BitmapId>(Candle.AnimationFrames, Candle.ElapsedMsPerFrame);
		this.animation.repeat = true;
		this.timer = BStopwatch.createWatch();
		this.imgid = this.animation.stepValue();
		this.timer.restart();
		this.hitarea = Candle.CandleHitArea;
		this.itemSpawnedAfterKill = itemSpawned;
		this.MaxHealth = 1;
		this.Health = 1;
	}

	public TakeTurn(): void {
		let imageId: AniStepCompoundValue<BitmapId> = { nextStepValue: this.imgid };
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
