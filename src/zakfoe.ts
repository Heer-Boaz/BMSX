import { Foe } from "./foe";
import { BStopwatch } from "../BoazEngineJS/btimer";
import { Item, ItemType } from "./item";
import { Direction } from "../BoazEngineJS/direction";
import { PlayerProjectile } from "./pprojectile";
import { newArea, newSize } from "../BoazEngineJS/common";
import { AudioId, BitmapId } from "resourceids";
import { Area, Point } from "../BoazEngineJS/interfaces";
import { Animation, AniStepCompoundValue } from "../BoazEngineJS/animation";
import { GameModel as M } from "./sintervaniamodel";
import { GameConstants as CS } from "./gameconstants";
import { TileSize } from "../BoazEngineJS/msx";

/*[Serializable]*/
type AniType = { img: BitmapId, dy: number };

export class ZakFoe extends Foe {
	public get DamageToPlayer(): number {
		return 1;
	}

	protected get moveBeforeFrameChange(): number {
		return 0;
	}

	public get RespawnAtRoomEntry(): boolean {
		return true;
	}

	protected static ZakFoeHitArea: Area = newArea(2, 2, 14, 14);
	protected static zakFoeSprites: Map<Direction, BitmapId[]> = new Map<Direction, BitmapId[]>([
		[Direction.Right, [BitmapId.ZakFoe_1, BitmapId.ZakFoe_2, BitmapId.ZakFoe_3]],
		[Direction.Left, [BitmapId.ZakFoe_1, BitmapId.ZakFoe_2, BitmapId.ZakFoe_3]],
	]);
	protected timer: BStopwatch;

	protected get movementSprites(): Map<Direction, BitmapId[]> {
		return ZakFoe.zakFoeSprites;
	}

	protected animation: Animation<AniType>;

	constructor(pos: Point, itemSpawned: ItemType = Item.Type.HeartSmall) {
		super(pos);
		this.CanHurtPlayer = true;
		// this.animation = new Animation<AniType>(AnimationFrames, null, true);
		throw new Error("ZakFoe compileert nog niet omdat er gewoon nog wat zaken missen.");
		this.timer = BStopwatch.createWatch();
		this.imgid = <number>this.animation.stepValue().img;
		this.timer.restart();
		this.hitarea = ZakFoe.ZakFoeHitArea;
		this.size = newSize(16, 16);
		this.itemSpawnedAfterKill = itemSpawned;
		this.Direction = Direction.Left;
		this.Health = 1;
	}

	public TakeTurn(): void {
		let stepValue: AniStepCompoundValue<AniType> = { nextStepValue: { img: this.imgid, dy: 0 } };
		this.animation.doAnimation(this.timer, stepValue);
		this.imgid = stepValue.nextStepValue.img;
		this.pos.y += stepValue.nextStepValue.dy;
		if (this.imgid == BitmapId.ZakFoe_2) {
			switch (this.Direction) {
				case Direction.Left:
					this.pos.x -= 1;
					// Handle game screen collision
					if (this.pos.x <= 0)
						this.Direction = Direction.Right;
					// Handle wall / missing floor collision
					if (M._.CurrentRoom.AnyCollisionsTiles(true, { x: this.hitbox_sx, y: this.hitbox_sy }, { x: this.hitbox_sx, y: this.hitbox_ey }))
						this.Direction = Direction.Right;
					if (!M._.CurrentRoom.AnyCollisionsTiles(true, { x: this.hitbox_sx, y: this.hitbox_ey + TileSize + 4 }))
						this.Direction = Direction.Right;
					break;
				case Direction.Right:
					this.pos.x += 1;
					// Handle game screen collision
					if (this.pos.x >= CS.GameScreenWidth)
						this.Direction = Direction.Left;
					// Handle wall / missing floor collision
					if (M._.CurrentRoom.AnyCollisionsTiles(true, { x: this.hitbox_ex, y: this.hitbox_sy }, { x: this.hitbox_ex, y: this.hitbox_ey }))
						this.Direction = Direction.Left;
					if (!M._.CurrentRoom.AnyCollisionsTiles(true, { x: this.hitbox_ex, y: this.hitbox_ey + TileSize + 4 }))
						this.Direction = Direction.Left;
					break;
			}
		}
		super.TakeTurn();

	}
	public Dispose(): void {
		BStopwatch.removeWatch(this.timer);
	}

	public HandleHit(source: PlayerProjectile): void {
		super.HandleHit(source);
		this.loseHealth(source);
	}

	public Paint(offset: Point = null): void {
		this.flippedH = this.Direction == Direction.Left ? true : false;
		super.Paint(offset);
	}
}