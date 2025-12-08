import type { World, WorldModule } from '../core/world';
import { BMSX_CART_DRAW_SYSTEM_ID, BMSX_CART_UPDATE_SYSTEM_ID, BMSX_IDE_DRAW_SYSTEM_ID, BMSX_IDE_UPDATE_SYSTEM_ID, BMSX_TERMINAL_DRAW_SYSTEM_ID, BMSX_TERMINAL_UPDATE_SYSTEM_ID, BmsxCartDrawSystem, BmsxIDEInputSystem, BmsxCartUpdateSystem, BmsxIDEDrawSystem, BmsxIDEUpdateSystem, BmsxTerminalDrawSystem, BmsxTerminalUpdateSystem, BMSX_IDE_INPUT_SYSTEM_ID, BMSX_TERMINAL_INPUT_SYSTEM_ID, BmsxTerminalInputSystem } from './vm_systems';
import { TickGroup } from '../ecs/ecsystem';

export function createBmsxVMModule(): WorldModule {
	return {
		id: 'bmsx',
		ecs: {
			systems: [
				{
					id: BMSX_CART_UPDATE_SYSTEM_ID,
					group: TickGroup.ModeResolution,
					create: (priority: number) => new BmsxCartUpdateSystem(priority),
				},
				{
					id: BMSX_CART_DRAW_SYSTEM_ID,
					group: TickGroup.Presentation,
					create: (priority: number) => new BmsxCartDrawSystem(priority),
				},
				{
					id: BMSX_IDE_INPUT_SYSTEM_ID,
					group: TickGroup.Input,
					create: (priority: number) => new BmsxIDEInputSystem(priority),
				},
				{
					id: BMSX_IDE_UPDATE_SYSTEM_ID,
					group: TickGroup.ModeResolution,
					create: (priority: number) => new BmsxIDEUpdateSystem(priority),
				},
				{
					id: BMSX_IDE_DRAW_SYSTEM_ID,
					group: TickGroup.Presentation,
					create: (priority: number) => new BmsxIDEDrawSystem(priority),
				},
				{
					id: BMSX_TERMINAL_INPUT_SYSTEM_ID,
					group: TickGroup.Input,
					create: (priority: number) => new BmsxTerminalInputSystem(priority),
				},
				{
					id: BMSX_TERMINAL_UPDATE_SYSTEM_ID,
					group: TickGroup.ModeResolution,
					create: (priority: number) => new BmsxTerminalUpdateSystem(priority),
				},
				{
					id: BMSX_TERMINAL_DRAW_SYSTEM_ID,
					group: TickGroup.Presentation,
					create: (priority: number) => new BmsxTerminalDrawSystem(priority),
				},
			],
			nodes: [
			],
		},
		onBoot(_world: World) {
		},
		onTick(_world: World, _deltaMilliseconds: number) {
			// Nothing to do; runtime is ticked by its systems.
		},
		onLoad(_world: World) {
			// Runtime is independent from world save/load cycles.
		},
		dispose() {
			// Don't dispose the runtime here; it is managed by the Game instance and survives world resets.
		},
	};
}
