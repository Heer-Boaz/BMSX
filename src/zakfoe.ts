import { Foe } from "./foe";
import { ItemType } from "./item";
import { PlayerProjectile } from "./pprojectile";
import { Area, Point, Direction, newArea, newSize } from "./bmsx/common";
import { BitmapId } from "./bmsx/resourceids";
import { Model } from "./gamemodel";
import { GameConstants as CS } from "./gameconstants";
import { bst, BSTEventType, bss } from "./bmsx/engine";

type AniType = { i: BitmapId, dy: number; };

export class ZakFoe extends Foe {
	public get damageToPlayer(): number {
		return 1;
	}

	public get respawnOnRoomEntry(): boolean {
		return true;
	}

	protected static ZakFoeHitArea: Area = newArea(2, 2, 14, 14);

	constructor(pos: Point, dir: Direction, itemSpawned: ItemType = ItemType.HeartSmall) {
		super(pos);
		this.canHurtPlayer = true;
		this.imgid = BitmapId.ZakFoe1;
		this.hitarea = ZakFoe.ZakFoeHitArea;
		this.size = newSize(16, 16);
		this.itemSpawnedAfterKill = itemSpawned;
		this.direction = dir;
		this.priority = 10;
		this.health = 1;

		let state0 = this.add(0);
		state0.tapedata = <Array<AniType>>[
			null,
			{ i: BitmapId.ZakFoe3, dy: 0 },
			{ i: BitmapId.ZakFoe1, dy: -4 },
			{ i: BitmapId.ZakFoe1, dy: -2 },
			{ i: BitmapId.ZakFoe2, dy: -1 },
			{ i: BitmapId.ZakFoe2, dy: -1 },
			{ i: BitmapId.ZakFoe2, dy: 0 },
			{ i: BitmapId.ZakFoe2, dy: 1 },
			{ i: BitmapId.ZakFoe2, dy: 1 },
			{ i: BitmapId.ZakFoe2, dy: 2 },
			{ i: BitmapId.ZakFoe2, dy: 5 },
			{ i: BitmapId.ZakFoe3, dy: 0 },
			{ i: BitmapId.ZakFoe3, dy: 0 },
			{ i: BitmapId.ZakFoe1, dy: -1 },
		];
		state0.nudges2move = 2;
		let state0handler = (s: bss, type: BSTEventType) => {
			switch (type) {
				case BSTEventType.Run:
					++s.nudges;

					switch (this.direction) {
						case Direction.Left:
							this.pos.x -= 1;
							// Handle game screen collision
							if (this.pos.x <= 0)
								this.direction = Direction.Right;
							// Handle wall / missing floor collision
							if (Model._.currentRoom.AnyCollisionsTiles({ x: this.hitbox_sx, y: this.hitbox_sy }, { x: this.hitbox_sx, y: this.hitbox_ey }))
								this.direction = Direction.Right;
							break;
						case Direction.Right: this.pos.x += 1;
							// Handle game screen collision
							if (this.pos.x >= CS.GameScreenWidth)
								this.direction = Direction.Left;
							// Handle wall / missing floor collision
							if (Model._.currentRoom.AnyCollisionsTiles({ x: this.hitbox_ex, y: this.hitbox_sy }, { x: this.hitbox_ex, y: this.hitbox_ey }))
								this.direction = Direction.Left;
							break;
					}
					if (!Model._.currentRoom.IsCollisionTile(this.hitbox_sx + 4, this.hitbox_ey + 12)) {
						this.pos.y += 4;
					}
					break;
				case BSTEventType.TapeEnd:
					this.to(1);
					break;
				case BSTEventType.TapeMove:
					this.imgid = (<AniType>s.currentdata).i;
					this.pos.y += (<AniType>s.currentdata).dy;
					break;
			}
		};
		state0.onrun = state0handler;
		state0.ontapeend = state0handler;
		state0.ontapemove = state0handler;

		let state1 = this.add(1);
		state1.nudges2move = 8;
		let state1handler = (s: bss, type: BSTEventType) => {
			switch (type) {
				case BSTEventType.Run:
					++s.nudges;
					break;
				case BSTEventType.TapeMove:
					this.to(0);
					break;

			}
		};
		state1.onrun = state1handler;
		state1.ontapemove = state1handler;

		this.setStart(0, false);
	}

	public takeTurn(): void {
		if (this.disposeFlag) return;
		this.run();
		super.takeTurn();
	}

	public dispose(): void {
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