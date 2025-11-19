import type { World } from '../core/world';
import { ECSystem, TickGroup } from '../ecs/ecsystem';
import { BmsxConsoleRuntime } from './runtime';

abstract class BaseConsoleSystem extends ECSystem {
	protected get runtime(): BmsxConsoleRuntime | null {
		return BmsxConsoleRuntime.instance;
	}
}

export class BmsxConsoleModeSystem extends BaseConsoleSystem {
	constructor(priority = 5) {
		super(TickGroup.Input, priority);
		this.__ecsId = 'bmsxConsole.mode';
		this.runsWhileGamePaused = true;
	}

	public update(_world: World): void {
		if (!this.runtime) return;
		this.runtime.runConsoleModePhase();
	}
}

export class BmsxConsoleFrameSystem extends BaseConsoleSystem {
	constructor(priority = 5) {
		super(TickGroup.Input, priority);
		this.__ecsId = 'bmsxConsole.frame';
		this.runsWhileGamePaused = true;
	}

	public update(_world: World): void {
		if (!this.runtime) return;
		this.runtime.runConsoleModePhase();
		this.runtime.runEditorModePhase();
		this.runtime.runUpdatePhase();
	}
}

export class BmsxConsoleDrawSystem extends BaseConsoleSystem {
	constructor(priority = 100) {
		super(TickGroup.Presentation, priority);
		this.__ecsId = 'bmsxConsole.draw';
		this.runsWhileGamePaused = true;
	}

	public update(_world: World): void {
		if (!this.runtime) return;
		this.runtime.runDrawPhase();
	}
}
