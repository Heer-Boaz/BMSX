import { $ } from '../core/game';
import type { World, WorldModule } from '../core/world';
import { TickGroup } from '../ecs/ecsystem';
import { BmsxConsoleRuntime } from './runtime';
import { Physics2DManager, Physics2DSystem } from '../physics/physics2d';
import type { BmsxConsoleCartridge, ConsoleModuleOptions } from './types';

export function createBmsxConsoleModule(cart: BmsxConsoleCartridge, options: ConsoleModuleOptions): WorldModule {
	let runtime: BmsxConsoleRuntime | null = null;
	const physics = new Physics2DManager();
	return {
		id: options.moduleId,
		ecs: {
				systems: [{
					id: 'bmsx.console.physics2d',
					group: TickGroup.Physics,
					defaultPriority: 18,
					create: (priority: number) => new Physics2DSystem(physics, priority),
				}],
			nodes: [],
		},
		onBoot(_world: World) {
			runtime = new BmsxConsoleRuntime({
				cart,
				storage: $.platform.storage,
				playerIndex: options.playerIndex,
				physics,
			});
			runtime.boot();
		},
		onTick(_world: World, deltaMilliseconds: number) {
			if (!runtime) {
				throw new Error('[createBmsxConsoleModule] Runtime not initialised before tick.');
			}
			runtime.frame(deltaMilliseconds);
		},
		onLoad(_world: World) {
			if (!runtime) {
				throw new Error('[createBmsxConsoleModule] Runtime not initialised before load.');
			}
			runtime.boot();
		},
		dispose() {
			runtime = null;
		},
	};
}
