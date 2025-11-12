import { PlayerProjectile } from './pprojectile';
import { Area, Direction, newArea } from 'bmsx/common';
import { BitmapId } from './resourceids';
import { WorldObjectEvents, type WorldObjectEventPayloads } from 'bmsx/worldobject';
import { subscribesToSelfScopedEvent } from 'bmsx/core/eventemitter';
import type { GameEvent } from 'bmsx/core/game_event';

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
	private handleLeaveScreen(event: GameEvent): void {
		const detail = event as GameEvent<'screen.leave', WorldObjectEventPayloads['screen.leave']>;
		this.removeFromTheGame(detail.d);
	}

	@subscribesToSelfScopedEvent(WorldObjectEvents.WallCollide)
	private handleWallCollision(event: GameEvent): void {
		const { d } = event as GameEvent<'wallcollide', { d: Direction }>;
		if (d) this.removeFromTheGame(d);
	}
}
