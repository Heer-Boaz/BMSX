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
	}

	public update(_world: World): void {
		if (!this.runtime) return;
		this.runtime.runConsoleModePhase();
	}
}

export class BmsxConsoleEditorSystem extends BaseConsoleSystem {
	constructor(priority = 7) {
		super(TickGroup.Input, priority);
		this.__ecsId = 'bmsxConsole.editor';
	}

	public update(_world: World): void {
		if (!this.runtime) return;
		this.runtime.runEditorModePhase();
	}
}

export class BmsxConsoleUpdateSystem extends BaseConsoleSystem {
	constructor(priority = 10) {
		super(TickGroup.Input, priority);
		this.__ecsId = 'bmsxConsole.update';
	}

	public update(_world: World): void {
		if (!this.runtime) return;
		this.runtime.runUpdatePhase();
	}
}

export class BmsxConsoleDrawSystem extends BaseConsoleSystem {
	constructor(priority = 100) {
		super(TickGroup.Presentation, priority);
		this.__ecsId = 'bmsxConsole.draw';
	}

	public update(_world: World): void {
		if (!this.runtime) return;
		this.runtime.runDrawPhase();
	}
}
