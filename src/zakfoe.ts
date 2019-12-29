import { Foe } from "./foe";
import { ItemType } from "./item";
import { Area, Direction, newArea, newSize } from "./bmsx/common";
import { BitmapId } from "./bmsx/resourceids";
import { Model } from "./gamemodel";
import { BSTEventType, bss, model } from "./bmsx/engine";

type AniType = { i: BitmapId, dy: number; };

export class ZakFoe extends Foe {
	public get respawnOnRoomEntry(): boolean { return true; }

	protected static ZakFoeHitArea: Area = newArea(2, 2, 14, 14);

	constructor(dir: Direction, itemSpawned: ItemType = ItemType.HeartSmall) {
		super();
		this.canHurtPlayer = true;
		this.imgid = BitmapId.ZakFoe1;
		this.hitarea = ZakFoe.ZakFoeHitArea;
		this.size = newSize(16, 16);
		this.itemSpawnedAfterKill = itemSpawned;
		this.direction = dir;
		this.priority = 10;
		this.health = 1;

		let collissionHandler = (d: Direction) => {
			switch (this.direction) {
				case Direction.Left:
					this.direction = Direction.Right;
					break;
				case Direction.Right:
					this.direction = Direction.Left;
					break;
				case Direction.Down:
					this.markForDisposure();
					break;
			}
		};
		this.onWallcollide = collissionHandler;
		this.onLeaveScreen = collissionHandler;

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
							this.setx(this.pos.x - 1);
							break;
						case Direction.Right:
							this.setx(this.pos.x + 1);
							break;
					}
					this.flippedH = this.direction == Direction.Left ? true : false;

					if (!(model as Model).currentRoom.isCollisionTile(this.hitbox_sx + 4, this.hitbox_ey + 12)) {
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
		this.run();
		super.takeTurn();
	}
}