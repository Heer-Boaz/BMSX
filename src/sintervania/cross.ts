import { PlayerProjectile } from './pprojectile';
import { Area, Direction, newArea } from 'bmsx/common';
import { BitmapId } from './resourceids';
import { WorldObjectEvents, type WorldObjectEventPayloads } from 'bmsx/worldobject';
import { subscribesToSelfScopedEvent } from 'bmsx/core/eventemitter';

export class Cross extends PlayerProjectile {
	public get hitarea(): Area { return newArea(0, 0, 26, 18); }

	constructor(dir: Direction) {
		super();
		this.direction = dir;
		this.size = this.hitarea.end;
		this.imgid = BitmapId.deviation;
	}

	public run(): void {
		switch (this.direction) {
			case 'left': this.setx(this.x - 2); break;
			case 'right': this.setx(this.x + 2); break;
		}
		if (this.checkAndInvokeHit()) {
			this.disposeFlag = true;
		}
	}

	public removeFromTheGame(dir: Direction): void {
		this.disposeFlag = true;
	}

	@subscribesToSelfScopedEvent(WorldObjectEvents.LeaveScreen)
	private handleLeaveScreen(_event: string, _emitter: Cross, payload: WorldObjectEventPayloads['screen.leave']): void {
		this.removeFromTheGame(payload.d);
	}

	@subscribesToSelfScopedEvent(WorldObjectEvents.WallCollide)
	private handleWallCollision(_event: string, _emitter: Cross, payload?: { d?: Direction }): void {
		if (!payload?.d) return;
		this.removeFromTheGame(payload.d);
	}
}
