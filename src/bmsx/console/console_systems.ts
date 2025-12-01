import type { World } from '../core/world';
import { ECSystem, TickGroup } from '../ecs/ecsystem';
import { BmsxConsoleRuntime } from './runtime';

export class BmsxCartSystem extends ECSystem {
	constructor(priority = 90) {
		super(TickGroup.Presentation, priority);
		this.__ecsId = 'bmsxConsole.frame';
		this.runsWhileGamePaused = true;
	}

	public update(_world: World): void {
		BmsxConsoleRuntime.instance?.runFrame();
	}
}
