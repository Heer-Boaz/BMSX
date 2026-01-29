import { $ } from '../core/engine_core';
import type { World } from '../core/world';
import { ECSystem, TickGroup } from '../ecs/ecsystem';
import type { NodeSpec } from '../ecs/pipeline';
import { Runtime } from './runtime';

export const BMSX_CART_UPDATE_SYSTEM_ID = 'bmsx:cart_update_system';
export const BMSX_CART_DRAW_SYSTEM_ID = 'bmsx:cart_draw_system';
export const BMSX_IDE_INPUT_SYSTEM_ID = 'bmsx:ide_input_system';
export const BMSX_IDE_UPDATE_SYSTEM_ID = 'bmsx:ide_update_system';
export const BMSX_IDE_DRAW_SYSTEM_ID = 'bmsx:ide_draw_system';
export const BMSX_TERMINAL_INPUT_SYSTEM_ID = 'bmsx:terminal_input_system';
export const BMSX_TERMINAL_UPDATE_SYSTEM_ID = 'bmsx:terminal_update_system';
export const BMSX_TERMINAL_DRAW_SYSTEM_ID = 'bmsx:terminal_draw_system';

export class BmsxCartUpdateSystem extends ECSystem {
	constructor(priority = 90) {
		super(TickGroup.ModeResolution, priority);
		this.__ecsId = BMSX_CART_UPDATE_SYSTEM_ID;
		this.runsWhileGamePaused = true;
	}

	public update(_world: World): void {
		Runtime.instance.tickUpdate();
	}
}

export class BmsxCartDrawSystem extends ECSystem {
	constructor(priority = 90) {
		super(TickGroup.Presentation, priority);
		this.__ecsId = BMSX_CART_DRAW_SYSTEM_ID;
		this.runsWhileGamePaused = true;
	}

	public update(_world: World): void {
		Runtime.instance.tickDraw();
	}
}
export class BmsxIDEInputSystem extends ECSystem {
	constructor(priority = 90) {
		super(TickGroup.Input, priority);
		this.__ecsId = BMSX_IDE_INPUT_SYSTEM_ID;
		this.runsWhileGamePaused = true;
	}

	public update(_world: World): void {
		Runtime.instance.tickIdeInput();
	}
}

export class BmsxIDEUpdateSystem extends ECSystem {
	constructor(priority = 100) {
		super(TickGroup.ModeResolution, priority);
		this.__ecsId = BMSX_IDE_UPDATE_SYSTEM_ID;
		this.runsWhileGamePaused = true;
	}

	public update(_world: World): void {
		Runtime.instance.tickIDE();
	}
}

export class BmsxIDEDrawSystem extends ECSystem {
	constructor(priority = 100) {
		super(TickGroup.Presentation, priority);
		this.__ecsId = BMSX_IDE_DRAW_SYSTEM_ID;
		this.runsWhileGamePaused = true;
	}

	public update(_world: World): void {
		Runtime.instance.tickIDEDraw();
	}
}
export class BmsxTerminalInputSystem extends ECSystem {
	constructor(priority = 90) {
		super(TickGroup.Input, priority);
		this.__ecsId = BMSX_TERMINAL_INPUT_SYSTEM_ID;
		this.runsWhileGamePaused = true;
	}

	public update(_world: World): void {
		Runtime.instance.tickTerminalInput();
	}
}

export class BmsxTerminalUpdateSystem extends ECSystem {
	constructor(priority = 110) {
		super(TickGroup.ModeResolution, priority);
		this.__ecsId = BMSX_TERMINAL_UPDATE_SYSTEM_ID;
		this.runsWhileGamePaused = true;
	}

	public update(_world: World): void {
		Runtime.instance.tickTerminalMode();
	}
}

export class BmsxTerminalDrawSystem extends ECSystem {
	constructor(priority = 110) {
		super(TickGroup.Presentation, priority);
		this.__ecsId = BMSX_TERMINAL_DRAW_SYSTEM_ID;
		this.runsWhileGamePaused = true;
	}

	public update(_world: World): void {
		Runtime.instance.tickTerminalModeDraw();
	}
}

export function getBasePipelineSpecOverrideForIdeOrTerminal(): NodeSpec[] {
	// When paused, we want to override the base pipeline to only include the drawing systems.
	const base = $.pipeline_spec.filter((node: NodeSpec) =>
		node.group === TickGroup.Presentation
	);
	return base;
}

export const runtimeExtSpec: NodeSpec[] = [
	{ ref: BMSX_CART_UPDATE_SYSTEM_ID },
	{ ref: BMSX_CART_DRAW_SYSTEM_ID },
];
/** BMSX runtime overlay pipeline extensions. */

export const ideExtSpec: NodeSpec[] = [
	{ ref: BMSX_IDE_INPUT_SYSTEM_ID },
	{ ref: BMSX_IDE_UPDATE_SYSTEM_ID },
	{ ref: BMSX_IDE_DRAW_SYSTEM_ID },
];

export const terminalExtSpec: NodeSpec[] = [
	{ ref: BMSX_TERMINAL_INPUT_SYSTEM_ID },
	{ ref: BMSX_TERMINAL_UPDATE_SYSTEM_ID },
	{ ref: BMSX_TERMINAL_DRAW_SYSTEM_ID },
];
