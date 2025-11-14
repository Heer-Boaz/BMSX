import { $ } from '../core/game';
import { ECSystem, TickGroup } from '../ecs/ecsystem';
import { AbilitySystemComponent } from '../component/abilitysystemcomponent';
import { GameplayCommandBuffer } from '../ecs/gameplay_command_buffer';
import { BmsxConsoleRuntime } from '../console/runtime';

export class AbilityRuntimeSystem extends ECSystem {
	constructor(priority: number = 32) { super(TickGroup.AbilityUpdate, priority); }
	update(): void {
		const commands = GameplayCommandBuffer.instance.drainByKind('activateability');
		const ascByOwner = new Map<string, AbilitySystemComponent>();
		for (let i = 0; i < commands.length; i++) {
			const command = commands[i]!;
			let asc = ascByOwner.get(command.owner);
			if (!asc) {
				const owner = $.world.getWorldObject(command.owner);
				if (!owner) {
					throw new Error(`[AbilityRuntimeSystem] Owner '${command.owner}' not found while activating ability '${command.ability_id}'.`);
				}
				asc = owner.get_unique_component(AbilitySystemComponent);
				if (!asc) {
					throw new Error(`[AbilityRuntimeSystem] AbilitySystemComponent missing on owner '${command.owner}' while activating ability '${command.ability_id}'.`);
				}
				ascByOwner.set(command.owner, asc);
			}
				try {
					asc.tryActivate(command.ability_id, command.payload);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const runtime = BmsxConsoleRuntime.instance;
				if (runtime) {
					runtime.reportEngineError(error);
				}
				throw new Error(`[AbilityRuntimeSystem] Activation failed for ability '${command.ability_id}' on owner '${command.owner}': ${message}`);
			}
		}
		const dtMs = $.deltaTime;
		for (const [, asc] of $.world.objectsWithComponents(AbilitySystemComponent, { scope: 'active' })) {
			try {
				asc.step(dtMs);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const ownerId = asc.parentid ? asc.parentid : '<unknown>';
				const runtime = BmsxConsoleRuntime.instance;
				if (runtime) {
					runtime.reportEngineError(error);
				}
				throw new Error(`[AbilityRuntimeSystem] Tick failed for AbilitySystemComponent '${ownerId}': ${message}`);
			}
		}
	}
}
