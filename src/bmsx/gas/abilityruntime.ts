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
			const asc = AbilitySystemComponent.registryByOwner.get(command.owner);
			if (asc) asc.tryActivate(command.ability_id, command.payload);
		}
		const dtMs = $.deltaTime;
		for (const asc of AbilitySystemComponent.registry) asc.step(dtMs);
	}
}
