import type { World } from '../core/world';
import { ECSystem, TickGroup } from '../ecs/ecsystem';
import { BmsxConsoleRuntime } from './runtime';

abstract class BaseConsoleSystem extends ECSystem {
	protected get runtime(): BmsxConsoleRuntime | null {
		return BmsxConsoleRuntime.instance;
	}
}

export class BmsxConsoleFrameSystem extends BaseConsoleSystem {
	constructor(priority = 90) {
		super(TickGroup.Presentation, priority);
		this.__ecsId = 'bmsxConsole.frame';
		this.runsWhileGamePaused = true;
	}

	public update(_world: World): void {
		if (!this.runtime) return;
		this.runtime.runFrame();
	}
}
