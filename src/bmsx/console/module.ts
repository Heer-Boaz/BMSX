import type { World, WorldModule } from '../core/world';
import { BmsxCartDrawSystem, BmsxCartUpdateSystem } from './console_systems';
import { TickGroup } from '../ecs/ecsystem';
import { CONSOLE_DRAW_SYSTEM_ID, CONSOLE_UPDATE_SYSTEM_ID } from './system_ids';

export function createBmsxConsoleModule(): WorldModule {
	return {
		id: 'bmsx',
		ecs: {
			systems: [
				{
					id: CONSOLE_UPDATE_SYSTEM_ID,
					group: TickGroup.ModeResolution,
					defaultPriority: 90,
					create: (priority: number) => new BmsxCartUpdateSystem(priority),
				},
				{
					id: CONSOLE_DRAW_SYSTEM_ID,
					group: TickGroup.Presentation,
					defaultPriority: 90,
					create: (priority: number) => new BmsxCartDrawSystem(priority),
				},
			],
			nodes: [
				{ ref: CONSOLE_UPDATE_SYSTEM_ID },
				{ ref: CONSOLE_DRAW_SYSTEM_ID },
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
