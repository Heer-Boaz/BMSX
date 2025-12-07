import type { World } from '../core/world';
import { ECSystem, TickGroup } from '../ecs/ecsystem';
import { BmsxVMRuntime } from './vm_runtime';

export const BMSX_CART_UPDATE_SYSTEM_ID = 'bmsx:cart_update_system';
export const BMSX_CART_DRAW_SYSTEM_ID = 'bmsx:cart_draw_system';
export const BMSX_IDE_UPDATE_SYSTEM_ID = 'bmsx:ide_update_system';
export const BMSX_IDE_DRAW_SYSTEM_ID = 'bmsx:ide_draw_system';
export const BMSX_TERMINAL_UPDATE_SYSTEM_ID = 'bmsx:terminal_update_system';
export const BMSX_TERMINAL_DRAW_SYSTEM_ID = 'bmsx:terminal_draw_system';

export class BmsxCartUpdateSystem extends ECSystem {
	constructor(priority = 90) {
		super(TickGroup.ModeResolution, priority);
		this.__ecsId = BMSX_CART_UPDATE_SYSTEM_ID;
		this.runsWhileGamePaused = true;
	}

	public update(_world: World): void {
		BmsxVMRuntime.instance.tickUpdate();
	}
}

export class BmsxCartDrawSystem extends ECSystem {
	constructor(priority = 90) {
		super(TickGroup.Presentation, priority);
		this.__ecsId = BMSX_CART_DRAW_SYSTEM_ID;
		this.runsWhileGamePaused = true;
	}

	public update(_world: World): void {
		BmsxVMRuntime.instance.tickDraw();
	}
}

export class BmsxIDEUpdateSystem extends ECSystem {
	constructor(priority = 100) {
		super(TickGroup.ModeResolution, priority);
		this.__ecsId = BMSX_IDE_UPDATE_SYSTEM_ID;
		this.runsWhileGamePaused = true;
	}

	public update(_world: World): void {
		BmsxVMRuntime.instance.tickIDE();
	}
}

export class BmsxIDEDrawSystem extends ECSystem {
	constructor(priority = 100) {
		super(TickGroup.Presentation, priority);
		this.__ecsId = BMSX_IDE_DRAW_SYSTEM_ID;
		this.runsWhileGamePaused = true;
	}

	public update(_world: World): void {
		BmsxVMRuntime.instance.tickIDEDraw();
	}
}

export class BmsxTerminalUpdateSystem extends ECSystem {
	constructor(priority = 110) {
		super(TickGroup.ModeResolution, priority);
		this.__ecsId = BMSX_TERMINAL_UPDATE_SYSTEM_ID;
		this.runsWhileGamePaused = true;
	}

	public update(_world: World): void {
		BmsxVMRuntime.instance.tickTerminalMode();
	}
}

export class BmsxTerminalDrawSystem extends ECSystem {
	constructor(priority = 110) {
		super(TickGroup.Presentation, priority);
		this.__ecsId = BMSX_TERMINAL_DRAW_SYSTEM_ID;
		this.runsWhileGamePaused = true;
	}

	public update(_world: World): void {
		BmsxVMRuntime.instance.tickTerminalModeDraw();
	}
}
