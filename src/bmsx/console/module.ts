import { $ } from '../core/game';
import type { World, WorldModule } from '../core/world';
import { BmsxConsoleRuntime } from './runtime';
import type { BmsxConsoleCartridge, ConsoleModuleOptions } from './types';
import { BmsxConsoleFrameSystem } from './console_systems';
import { TickGroup } from '../ecs/ecsystem';

export function createBmsxConsoleModule(cart: BmsxConsoleCartridge, options: ConsoleModuleOptions): WorldModule {
	const frameSystemId = 'bmsxConsole.frame';
	return {
		id: options.moduleId,
		ecs: {
			systems: [
				{
					id: frameSystemId,
					group: TickGroup.Presentation,
					defaultPriority: 90,
					create: (priority: number) => new BmsxConsoleFrameSystem(priority),
				},
			],
			nodes: [
				{ ref: frameSystemId },
			],
		},
		onBoot(_world: World) {
			const caseInsensitiveLua = options.caseInsensitiveLua ?? ($.rompack.caseInsensitiveLua ?? true);
			BmsxConsoleRuntime.createInstance({
				cart,
				playerIndex: options.playerIndex,
				storage: $.platform.storage,
				caseInsensitiveLua,
			});
		},
		onTick(_world: World, _deltaMilliseconds: number) {
			// Nothing to do; runtime is ticked by its systems.
		},
		onLoad(_world: World) {
			// Runtime is independent from world save/load cycles.
		},
		dispose() {
			BmsxConsoleRuntime.destroy();
		},
	};
}
