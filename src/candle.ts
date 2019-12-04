import { Foe } from "./foe";
import { BStopwatch } from "../BoazEngineJS/btimer";
import { ItemType } from "./item";
import { Animation, AniStepReturnValue } from "../BoazEngineJS/animation"
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

	public get respawnOnRoomEntry(): boolean {
		return true;
	}

	protected static CandleHitArea: Area = newArea(0, 0, 10, 16);
	protected static candleSprites: Map<Direction, BitmapId[]> = new Map([[Direction.None, [BitmapId.Candle_1]]]);
	protected static AnimationFrames: BitmapId[] = [BitmapId.Candle_1, BitmapId.Candle_2];
	protected static framesPerDrawing: number[] = [25, 25];
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
		this.imgid = this.animation.stepValue;
		this.hitarea = Candle.CandleHitArea;
		this.itemSpawnedAfterKill = itemSpawned;
		this.maxHealth = 1;
		this.health = 1;
	}

	public takeTurn(): void {
		let bla = this.animation.doAnimation(1, this.imgid);
		this.imgid = bla.stepValue;
	}

	public dispose(): void {
	}

	public handleHit(source: PlayerProjectile): void {
		super.handleHit(source);
		this.loseHealth(source);
	}

	public paint(offset: Point = null): void {
		super.paint(offset);
	}
}
