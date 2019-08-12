import { Foe } from "./foe";
import { BStopwatch } from "../BoazEngineJS/btimer";
import { Item } from "./item";
import { Direction } from "../BoazEngineJS/direction";
import { PlayerProjectile } from "./pprojectile";
import { newArea } from "../BoazEngineJS/common";
import { BitmapId } from "./resourceids";

/*[Serializable]*/
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
	// // protected static zakFoeSprites: Map<Direction, BitmapId[]> = __init(new Map<Direction, BitmapId[]>(), { { Direction.Right, BitmapId.ZakFoe_1, BitmapId.ZakFoe_2, BitmapId.ZakFoe_3 },
	//     { Direction.Left, BitmapId.ZakFoe_1, BitmapId.ZakFoe_2, BitmapId.ZakFoe_3 } });
	protected timer: BStopwatch;

	protected get movementSprites(): Map<Direction, BitmapId[]> {
		return ZakFoe.zakFoeSprites;
	}

	protected Animation<(uint img, int dy)> animation;

constructor(pos: Point, itemSpawned: Item.Type = Item.Type.HeartSmall) {
	super(pos);
	this.CanHurtPlayer = true;
	this.animation = __init(new Animation < (uint img, int dy) > (/*timeAndData:*/AnimationFrames), { Repeat: true });
	this.timer = BStopwatch.CreateWatch();
	this.imgid = <number>this.animation.stepValue().img;
	this.timer.restart();
	this.hitarea = ZakFoe.ZakFoeHitArea;
	this.size = new Size(16, 16);
	this.itemSpawnedAfterKill = itemSpawned;
	this.Direction = Direction.Left;
	this.Health = 1;
}
		public TakeTurn(): void {
			(uint img, int dy) stepValue = (this.imgid, 0);
this.animation.doAnimation(this.timer, stepValue);
this.imgid = stepValue.img;
this.pos.y += stepValue.dy;
if (this.imgid == <number>BitmapId.ZakFoe_2) {
	switch (this.Direction) {
		case Direction.Left:
			this.pos.x -= 1;
			// Handle game screen collision
			if (this.pos.x <= 0)
				this.Direction = Direction.Right;
			// Handle wall / missing floor collision
			if (M._.CurrentRoom.AnyCollisionsTiles(true, (this.hitbox_sx, this.hitbox_sy), (this.hitbox_sx, this.hitbox_ey)))
				this.Direction = Direction.Right;
			if (!M._.CurrentRoom.AnyCollisionsTiles(true, (this.hitbox_sx, this.hitbox_ey + CS.TileSize + 4)))
				this.Direction = Direction.Right;
			break;
		case Direction.Right:
			this.pos.x += 1;
			// Handle game screen collision
			if (this.pos.x >= CS.GameScreenWidth)
				this.Direction = Direction.Left;
			// Handle wall / missing floor collision
			if (M._.CurrentRoom.AnyCollisionsTiles(true, (this.hitbox_ex, this.hitbox_sy), (this.hitbox_ex, this.hitbox_ey)))
				this.Direction = Direction.Left;
			if (!M._.CurrentRoom.AnyCollisionsTiles(true, (this.hitbox_ex, this.hitbox_ey + CS.TileSize + 4)))
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