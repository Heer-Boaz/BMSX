import { $ } from '../core/game';
import { ECSystem, TickGroup } from '../ecs/ecsystem';
import { AbilitySystemComponent } from '../component/abilitysystemcomponent';
import { GameplayCommandBuffer } from '../ecs/gameplay_command_buffer';

export class AbilityRuntimeSystem extends ECSystem {
	constructor(priority: number = 32) { super(TickGroup.AbilityUpdate, priority); }
	update(): void {
		const commands = GameplayCommandBuffer.instance.drainByKind('ActivateAbility');
		for (let i = 0; i < commands.length; i++) {
			const command = commands[i]!;
			const owner = $.world.getWorldObject(command.owner);
			if (!owner) {
				throw new Error(`[AbilityRuntimeSystem] Owner '${command.owner}' not found while activating ability '${command.ability_id}'.`);
			}
			const asc = owner.getUniqueComponent(AbilitySystemComponent);
			if (!asc) {
				throw new Error(`[AbilityRuntimeSystem] AbilitySystemComponent missing on owner '${command.owner}' while activating ability '${command.ability_id}'.`);
			}
			asc.tryActivate(command.ability_id, command.payload);
		}
		const dtMs = $.deltaTime;
		for (const [, asc] of $.world.objectsWithComponents(AbilitySystemComponent, { scope: 'active' })) {
			asc.step(dtMs);
		}
	}
}
