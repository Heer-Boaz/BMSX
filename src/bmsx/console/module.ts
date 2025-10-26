import { $ } from '../core/game';
import type { World, WorldModule } from '../core/world';
import { BmsxConsoleRuntime } from './runtime';
import type { BmsxConsoleCartridge, ConsoleModuleOptions } from './types';

export function createBmsxConsoleModule(cart: BmsxConsoleCartridge, options: ConsoleModuleOptions): WorldModule {
	return {
		id: options.moduleId,
		ecs: { systems: [], nodes: [] },
		onBoot(_world: World) {
			const rompack = $.rompack;
			const caseInsensitiveLua = options.caseInsensitiveLua ?? (rompack?.caseInsensitiveLua ?? true);
			BmsxConsoleRuntime.ensure({
				cart,
				playerIndex: options.playerIndex,
				storage: $.platform.storage,
				caseInsensitiveLua,
			});
		},
		onTick(_world: World, _deltaMilliseconds: number) {
			// Runtime advances itself via frame events.
		},
		onLoad(_world: World) {
			// Runtime is independent from world save/load cycles.
		},
		dispose() {
			BmsxConsoleRuntime.destroy();
		},
	};
}
