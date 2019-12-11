import { PlayerProjectile } from './pprojectile';

import { Area, Point, Direction } from './bmsx/common';

import { BitmapId } from './bmsx/resourceids';

import { GameConstants } from './gameconstants';

export class Cross extends PlayerProjectile {
	public direction: Direction;
	public hitarea: Area = { start: { x: 0, y: 0 }, end: { x: 26, y: 18 } };

	public get damageDealt(): number {
		return 1;
	}

	constructor(pos: Point, dir: Direction) {
		super({ x: pos.x, y: pos.y }, { x: 0, y: 0 });
		this.direction = dir;
		this.imgid = BitmapId.deviation;
	}

	public takeTurn(): void {
		switch (this.direction) {
			case Direction.Left: this.pos.x -= 4; break;
			case Direction.Right: this.pos.x += 4; break;
		}
		if (this.checkAndInvokeHit()) {
			this.disposeFlag = true;
			this.visible = false;
		}
		if (this.pos.x < 0 || this.pos.y < 0 || this.pos.x >= GameConstants.GameScreenWidth || this.pos.y >= GameConstants.GameScreenHeight)
			this.disposeFlag = true;
	}

	public paint(offset: Point = null): void {
		super.paint(offset);
	}

	public dispose(): void {
	}
}