import { Foe } from "./foe";
import { BStopwatch } from "./bmsx/engine";
import { ItemType } from "./item";
import { Animation } from "./bmsx/animation"
import { BitmapId } from "./bmsx/resourceids";
import { newArea } from "./bmsx/common";
import { Area } from "./bmsx/common";

export class Candle extends Foe {
	public get respawnOnRoomEntry(): boolean { return true; }

	protected static CandleHitArea: Area = newArea(0, 0, 10, 16);
	protected static AnimationFrames: BitmapId[] = [BitmapId.Candle_1, BitmapId.Candle_2];
	protected static framesPerDrawing: number[] = [10, 10];
	protected animation: Animation<BitmapId>;
	protected timer: BStopwatch;

	protected itemSpawnedAfterKill: ItemType;
	constructor(itemSpawned: ItemType = ItemType.HeartSmall) {
		super();
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
}
