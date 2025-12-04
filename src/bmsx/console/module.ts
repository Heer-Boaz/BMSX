import type { World, WorldModule } from '../core/world';
import type { ConsoleModuleOptions } from './types';
import { BmsxCartSystem } from './console_systems';
import { TickGroup } from '../ecs/ecsystem';

export function createBmsxConsoleModule(options: ConsoleModuleOptions): WorldModule {
	const frameSystemId = 'bmsxConsole.frame';
	return {
		id: options.moduleId,
		ecs: {
			systems: [
				{
					id: frameSystemId,
					group: TickGroup.Presentation,
					defaultPriority: 90,
					create: (priority: number) => new BmsxCartSystem(priority),
				},
			],
			nodes: [
				{ ref: frameSystemId },
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
