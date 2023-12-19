import { PlayerProjectile } from './pprojectile';
import { Area, Direction, newArea } from '../bmsx/common';
import { BitmapId } from './resourceids';

export class Cross extends PlayerProjectile {
	public get hitarea(): Area { return newArea(0, 0, 26, 18); }

	constructor(dir: Direction) {
		super();
		this.direction = dir;
		this.size = this.hitarea.end;
		this.imgid = BitmapId.deviation;
		this.onLeaveScreen = this.removeFromTheGame;
		this.onWallcollide = this.removeFromTheGame;
	}

	public run(): void {
		switch (this.direction) {
			case 'left': this.setx(this.pos.x - 2); break;
			case 'right': this.setx(this.pos.x + 2); break;
		}
		if (this.checkAndInvokeHit()) {
			this.disposeFlag = true;
		}
	}

	public removeFromTheGame(dir: Direction): void {
		this.disposeFlag = true;
	}
}