import { $ } from '../core/game';
import type { World, WorldModule } from '../core/world';
import { BmsxConsoleRuntime } from './runtime';
import type { BmsxConsoleCartridge, ConsoleModuleOptions } from './types';
import { BmsxConsoleModeSystem, BmsxConsoleEditorSystem, BmsxConsoleUpdateSystem, BmsxConsoleDrawSystem } from './console_systems';
import { TickGroup } from '../ecs/ecsystem';

export function createBmsxConsoleModule(cart: BmsxConsoleCartridge, options: ConsoleModuleOptions): WorldModule {
	const modeSystemId = 'bmsxConsole.mode';
	const editorSystemId = 'bmsxConsole.editor';
	const updateSystemId = 'bmsxConsole.update';
	const drawSystemId = 'bmsxConsole.draw';
	return {
		id: options.moduleId,
		ecs: {
			systems: [
				{
					id: modeSystemId,
					group: TickGroup.Input,
					defaultPriority: 5,
					create: (priority: number) => new BmsxConsoleModeSystem(priority),
				},
				{
					id: editorSystemId,
					group: TickGroup.Input,
					defaultPriority: 7,
					create: (priority: number) => new BmsxConsoleEditorSystem(priority),
				},
				{
					id: updateSystemId,
					group: TickGroup.Input,
					defaultPriority: 10,
					create: (priority: number) => new BmsxConsoleUpdateSystem(priority),
				},
				{
					id: drawSystemId,
					group: TickGroup.Presentation,
					defaultPriority: 100,
					create: (priority: number) => new BmsxConsoleDrawSystem(priority),
				},
			],
			nodes: [
				{ ref: modeSystemId },
				{ ref: editorSystemId },
				{ ref: updateSystemId },
				{ ref: drawSystemId },
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
