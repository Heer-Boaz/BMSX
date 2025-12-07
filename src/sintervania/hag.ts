import { BStopwatch, CollisionSystem } from 'bmsx';
import { subscribesToSelfScopedEvent } from 'bmsx/core/eventemitter';
import type { GameEvent } from 'bmsx/core/game_event';
import { Animation, AniData } from "bmsx/animation";
import { BitmapId } from "./resourceids";
import { ItemType } from "./item";
import { Foe } from "./foe";
import { GameConstants } from "./gameconstants";
import { Direction, Size, Area, Point } from "bmsx/common";
import { Model, belmont } from "./gamemodel";

export class Hag extends Foe {
	public get respawnOnRoomEntry(): boolean { return true; }

	public static HagSize: Size = { x: 16, y: 32 };
	protected static HagHitArea: Area = { start: <Point>{ x: 2, y: 2 }, end: <Point>{ x: 14, y: 32 } };
	protected animation: Animation<number>;
	protected timer: BStopwatch;

	protected static hagSprites: Map<Direction, BitmapId[]> = new Map([
		['none', [BitmapId.Hag1, BitmapId.Hag2]]
	]);

	protected static movementSprites: Map<Direction, BitmapId[]> = Hag.hagSprites;
	protected static AnimationFrames: AniData<BitmapId>[] = new Array(
		{ time: 12, data: BitmapId.Hag1 },
		{ time: 12, data: BitmapId.Hag2 },
	);

	constructor(dir: Direction, itemSpawned = ItemType.HeartSmall) {
		super();
		this.animation = new Animation<BitmapId>(Hag.AnimationFrames, null, true);
		this.timer = BStopwatch.createWatch();
		this.imgid = this.animation.stepValue;
		this.timer.restart();
		this.size = Hag.HagSize;
		this.getOrCreateCollider().setLocalArea(Hag.HagHitArea);
		this.itemSpawnedAfterKill = itemSpawned;
		// Request overlap events for this object
		this.getOrCreateCollider().generateoverlapevents = true;
		this.health = 1;
		this.direction = dir;
		this.flippedH = this.direction == 'left';
		this.z = 10;
	}

	public run(): void {
		// Overlap-based damage handled via event (see handler below)

		let stepValue = this.animation.doAnimation(this.timer, this.imgid).stepValue;
		this.imgid = stepValue;
		this.x += this.direction == 'left' ? -2 : 2;
		if (this.x >= GameConstants.GameScreenWidth || (0 > this.x + this.size.x)) {
			this.disposeFlag = true;
		}
	}

	public dispose(): void {
		BStopwatch.removeWatch(this.timer);
	}

	@subscribesToSelfScopedEvent('overlap.begin')
	public onOverlapBegin(event: GameEvent) {
		const otherId = (event as { other_id?: string }).other_id;
		if (otherId === belmont.id) belmont.takeDamage(this.damageToPlayer);
	}
}
