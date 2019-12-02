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
	public get damageToPlayer(): number {
		return 0;
	}

	protected get moveBeforeFrameChange(): number {
		return 0;
	}

	public get respawnAtRoomEntry(): boolean {
		return true;
	}

	protected static CandleHitArea: Area = newArea(0, 0, 10, 16);
	protected static candleSprites: Map<Direction, BitmapId[]> = new Map([[Direction.None, [BitmapId.Candle_1]]]);
	protected static AnimationFrames: BitmapId[] = [BitmapId.Candle_1, BitmapId.Candle_2];
	protected static framesPerDrawing: number[] = [10, 10];
	protected animation: Animation<BitmapId>;
	protected timer: BStopwatch;
	protected get movementSprites(): Map<Direction, BitmapId[]> {
		return Candle.candleSprites;
	}

	protected itemSpawnedAfterKill: ItemType;
	constructor(pos: Point, itemSpawned: ItemType = ItemType.HeartSmall) {
		super(pos);
		this.canHurtPlayer = false;
		this.animation = new Animation<BitmapId>(Candle.AnimationFrames, Candle.framesPerDrawing);
		this.animation.repeat = true;
		this.timer = BStopwatch.createWatch();
		this.imgid = this.animation.stepValue();
		this.timer.restart();
		this.hitarea = Candle.CandleHitArea;
		this.itemSpawnedAfterKill = itemSpawned;
		this.maxHealth = 1;
		this.health = 1;
	}

	public takeTurn(): void {
		let imageId: AniStepCompoundValue<BitmapId> = { nextStepValue: this.imgid };
		this.animation.doAnimation(this.timer, imageId);
		this.imgid = imageId.nextStepValue;
	}

	public dispose(): void {
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
