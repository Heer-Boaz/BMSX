import { Foe } from "./foe";
import { BStopwatch } from "../BoazEngineJS/btimer";
import { Item, ItemType } from "./item";
import { Direction } from "../BoazEngineJS/direction";
import { PlayerProjectile } from "./pprojectile";
import { newArea, newSize } from "../BoazEngineJS/common";
import { AudioId, BitmapId } from "./resourceids";
import { Area, Point } from "../BoazEngineJS/interfaces";
import { Animation, AniStepReturnValue } from "../BoazEngineJS/animation";
import { GameModel as M } from "./sintervaniamodel";
import { GameConstants as CS } from "./gameconstants";
import { TileSize } from "../BoazEngineJS/msx";

/*[Serializable]*/
type AniType = { img: BitmapId, dy: number };

export class ZakFoe extends Foe {
	public get damageToPlayer(): number {
		return 1;
	}

	protected get moveBeforeFrameChange(): number {
		return 0;
	}

	public get respawnOnRoomEntry(): boolean {
		return true;
	}

	protected static ZakFoeHitArea: Area = newArea(2, 2, 14, 14);
	protected static zakFoeSprites: Map<Direction, BitmapId[]> = new Map<Direction, BitmapId[]>([
		// [Direction.Right, [BitmapId.ZakFoe_1, BitmapId.ZakFoe_2, BitmapId.ZakFoe_3]],
		// [Direction.Left, [BitmapId.ZakFoe_1, BitmapId.ZakFoe_2, BitmapId.ZakFoe_3]],
	]);
	protected timer: BStopwatch;

	protected get movementSprites(): Map<Direction, BitmapId[]> {
		return ZakFoe.zakFoeSprites;
	}

	protected animation: Animation<AniType>;

	constructor(pos: Point, itemSpawned: ItemType = Item.Type.HeartSmall) {
		super(pos);
		this.canHurtPlayer = true;
		// this.animation = new Animation<AniType>(AnimationFrames, null, true);
		this.timer = BStopwatch.createWatch();
		this.imgid = <number>this.animation.stepValue.img;
		this.timer.restart();
		this.hitarea = ZakFoe.ZakFoeHitArea;
		this.size = newSize(16, 16);
		this.itemSpawnedAfterKill = itemSpawned;
		this.direction = Direction.Left;
		this.health = 1;
	}

	public takeTurn(): void {
		let stepValue = this.animation.doAnimation(this.timer, { img: this.imgid, dy: 0 });
		this.imgid = stepValue.stepValue.img;
		this.pos.y += stepValue.stepValue.dy;
		// if (this.imgid == BitmapId.ZakFoe_2) {
		if (this.imgid == 0) {
			switch (this.direction) {
				case Direction.Left:
					this.pos.x -= 1;
					// Handle game screen collision
					if (this.pos.x <= 0)
						this.direction = Direction.Right;
					// Handle wall / missing floor collision
					if (M._.currentRoom.AnyCollisionsTiles(true, { x: this.hitbox_sx, y: this.hitbox_sy }, { x: this.hitbox_sx, y: this.hitbox_ey }))
						this.direction = Direction.Right;
					if (!M._.currentRoom.AnyCollisionsTiles(true, { x: this.hitbox_sx, y: this.hitbox_ey + TileSize + 4 }))
						this.direction = Direction.Right;
					break;
				case Direction.Right:
					this.pos.x += 1;
					// Handle game screen collision
					if (this.pos.x >= CS.GameScreenWidth)
						this.direction = Direction.Left;
					// Handle wall / missing floor collision
					if (M._.currentRoom.AnyCollisionsTiles(true, { x: this.hitbox_ex, y: this.hitbox_sy }, { x: this.hitbox_ex, y: this.hitbox_ey }))
						this.direction = Direction.Left;
					if (!M._.currentRoom.AnyCollisionsTiles(true, { x: this.hitbox_ex, y: this.hitbox_ey + TileSize + 4 }))
						this.direction = Direction.Left;
					break;
			}
		}
		super.takeTurn();

	}
	public Dispose(): void {
		BStopwatch.removeWatch(this.timer);
	}

	public handleHit(source: PlayerProjectile): void {
		super.handleHit(source);
		this.loseHealth(source);
	}

	public paint(offset: Point = null): void {
		this.flippedH = this.direction == Direction.Left ? true : false;
		super.paint(offset);
	}
}