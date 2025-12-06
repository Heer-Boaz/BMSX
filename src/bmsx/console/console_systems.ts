import type { World } from '../core/world';
import { ECSystem, TickGroup } from '../ecs/ecsystem';
import { BmsxConsoleRuntime } from './runtime';
import { CONSOLE_DRAW_SYSTEM_ID, CONSOLE_UPDATE_SYSTEM_ID } from './system_ids';

export class BmsxCartUpdateSystem extends ECSystem {
	constructor(priority = 90) {
		super(TickGroup.ModeResolution, priority);
		this.__ecsId = CONSOLE_UPDATE_SYSTEM_ID;
		this.runsWhileGamePaused = true;
	}

	public update(_world: World): void {
		BmsxConsoleRuntime.instance.tickUpdate();
	}
}

export class BmsxCartDrawSystem extends ECSystem {
	constructor(priority = 90) {
		super(TickGroup.Presentation, priority);
		this.__ecsId = CONSOLE_DRAW_SYSTEM_ID;
		this.runsWhileGamePaused = true;
	}

	public update(_world: World): void {
		BmsxConsoleRuntime.instance.tickDraw();
	}
}
