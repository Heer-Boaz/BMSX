import { PlayerProjectile } from './pprojectile';
import { Area, Point, Direction, newArea } from './bmsx/common';
import { BitmapId } from './bmsx/resourceids';

export class Cross extends PlayerProjectile {
	public hitarea: Area = newArea(0, 0, 26, 18);

	constructor(pos: Point, dir: Direction) {
		super({ x: pos.x, y: pos.y });
		this.direction = dir;
		this.size = this.hitarea.end;
		this.imgid = BitmapId.deviation;
		this.onLeaveScreen = this.removeFromTheGame;
		this.onWallcollide = this.removeFromTheGame;
	}

	public takeTurn(): void {
		switch (this.direction) {
			case Direction.Left: this.setx(this.pos.x - 4); break;
			case Direction.Right: this.setx(this.pos.x + 4); break;
		}
		if (this.checkAndInvokeHit()) {
			this.disposeFlag = true;
		}
	}

	public removeFromTheGame(dir: Direction): void {
		this.disposeFlag = true;
	}
}