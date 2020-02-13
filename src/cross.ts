import { PlayerProjectile } from './pprojectile';
import { Area, Direction, newArea } from './bmsx/common';
import { BitmapId } from './bmsx/resourceids';

export class Cross extends PlayerProjectile {
	public hitarea: Area = newArea(0, 0, 26, 18);

	constructor(dir: Direction) {
		super();
		this.direction = dir;
		this.size = this.hitarea.end;
		this.imgid = BitmapId.deviation;
		this.onLeaveScreen = this.removeFromTheGame;
		this.onWallcollide = this.removeFromTheGame;
	}

	public takeTurn(): void {
		switch (this.direction) {
			case Direction.Left: this.setx(this.pos.x - 2); break;
			case Direction.Right: this.setx(this.pos.x + 2); break;
		}
		if (this.checkAndInvokeHit()) {
			this.disposeFlag = true;
		}
	}

	public removeFromTheGame(dir: Direction): void {
		this.disposeFlag = true;
	}
}