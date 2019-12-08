import { Foe } from "./foe";
import { ItemType } from "./item";
import { Direction } from "../BoazEngineJS/direction";
import { PlayerProjectile } from "./pprojectile";
import { newArea, newSize } from "../BoazEngineJS/common";
import { BitmapId } from "./resourceids";
import { Model as M } from "./gamemodel";
import { GameConstants as CS } from "./gameconstants";
import { bst } from "../BoazEngineJS/statemachine";
import { Area, Point } from "../lib/interfaces";

type AniType = { i: BitmapId, dy: number };

export class ZakFoe extends Foe {
	public get damageToPlayer(): number {
		return 1;
	}

	public get respawnOnRoomEntry(): boolean {
		return true;
	}

	protected static ZakFoeHitArea: Area = newArea(2, 2, 14, 14);
	protected fst: bst<ZakFoe>;

	constructor(pos: Point, dir: Direction, itemSpawned: ItemType = ItemType.HeartSmall) {
		super(pos);
		this.canHurtPlayer = true;
		this.imgid = BitmapId.ZakFoe1;
		this.hitarea = ZakFoe.ZakFoeHitArea;
		this.size = newSize(16, 16);
		this.itemSpawnedAfterKill = itemSpawned;
		this.direction = dir;
		this.health = 1;

		this.fst = new bst<ZakFoe>(this, 0, true);
		let state0 = this.fst.addNewState(0);
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
		state0.delta2tapehead = 2;
		state0.onrun = (s) => {
			++s.tapeheadnudges;

			switch (s.target.direction) {
				case Direction.Left:
					s.target.pos.x -= 1;
					// Handle game screen collision
					if (s.target.pos.x <= 0)
						s.target.direction = Direction.Right;
					// Handle wall / missing floor collision
					if (M._.currentRoom.AnyCollisionsTiles({ x: s.target.hitbox_sx, y: s.target.hitbox_sy }, { x: s.target.hitbox_sx, y: s.target.hitbox_ey }))
						s.target.direction = Direction.Right;
					// if (!M._.currentRoom.AnyCollisionsTiles(true, { x: s.target.hitbox_sx, y: s.target.hitbox_ey + TileSize + 4 }))
					// 	s.target.direction = Direction.Right;
					break;
				case Direction.Right: s.target.pos.x += 1;
					// Handle game screen collision
					if (s.target.pos.x >= CS.GameScreenWidth)
						s.target.direction = Direction.Left;
					// Handle wall / missing floor collision
					if (M._.currentRoom.AnyCollisionsTiles({ x: s.target.hitbox_ex, y: s.target.hitbox_sy }, { x: s.target.hitbox_ex, y: s.target.hitbox_ey }))
						s.target.direction = Direction.Left;
					// if (!M._.currentRoom.AnyCollisionsTiles(true, { x: s.target.hitbox_ex, y: s.target.hitbox_ey + TileSize + 4 }))
					// 	s.target.direction = Direction.Left;
					break;
			}
			if (!M._.currentRoom.IsCollisionTile(s.target.hitbox_sx + 4, s.target.hitbox_ey + 12)) {
				s.target.pos.y += 4;
			}
		};
		state0.ontapeend = (s) => {
			s.bsm.transition(1);
		};
		state0.oninitstate = (s) => {
			s.setTapeheadNoEvent(0);
		};
		state0.ontapeheadmove = (s) => {
			s.target.imgid = (<AniType>s.currentdata).i;
			s.target.pos.y += (<AniType>s.currentdata).dy;
		};

		let state1 = this.fst.addNewState(1);
		state1.delta2tapehead = 8;
		state1.onrun = (s) => {
			++s.tapeheadnudges;
		};
		state1.ontapeheadmove = (s) => {
			s.bsm.transition(0);
		};
		state1.oninitstate = (s) => {
			s.setTapeheadNoEvent(0);
		};

		this.fst.setStartState(0, false);
	}

	public takeTurn(): void {
		if (this.disposeFlag) return;
		this.fst.run();
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