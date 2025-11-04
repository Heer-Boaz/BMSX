import { $ } from '../core/game';
import type { World, WorldModule } from '../core/world';
import { BmsxConsoleRuntime } from './runtime';
import type { BmsxConsoleCartridge, ConsoleModuleOptions } from './types';
import { InputAbilitySystem } from '../ecs/input_ability_system';
import { TickGroup } from '../ecs/ecsystem';

export function createBmsxConsoleModule(cart: BmsxConsoleCartridge, options: ConsoleModuleOptions): WorldModule {
	const moduleId = options.moduleId;
	const inputSystemId = `${moduleId ?? 'console'}.inputAbility`;
	return {
		id: options.moduleId,
		ecs: {
			systems: [
				{
					id: inputSystemId,
					group: TickGroup.Input,
					defaultPriority: 10,
					create: (priority: number) => new InputAbilitySystem(priority),
				},
			],
			nodes: [
				{ ref: inputSystemId, after: ['behaviorTrees'] },
			],
		},
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
