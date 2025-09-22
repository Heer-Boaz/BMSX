import { $ } from '../core/game';
import { ECSystem, TickGroup } from '../ecs/ecsystem';
import { AbilitySystemComponent } from '../component/abilitysystemcomponent';
import { GameplayCommandBuffer } from '../gameplay/gameplay_command_buffer';

export class AbilityRuntimeSystem extends ECSystem {
	constructor(priority: number = 32) { super(TickGroup.AbilityUpdate, priority); }
	update(): void {
		const commands = GameplayCommandBuffer.instance.drain('ActivateAbility');
		for (let i = 0; i < commands.length; i++) {
			const command = commands[i]!;
			const asc = AbilitySystemComponent.registryByOwner.get(command.ownerId);
			if (asc) asc.tryActivate(command.abilityId, command.payload);
		}
		const dtMs = $.deltaTime as number;
		for (const asc of AbilitySystemComponent.registry) asc.step(dtMs);
	}
}
