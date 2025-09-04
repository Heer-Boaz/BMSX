import { $ } from '../core/game';
import { ECSystem, TickGroup } from '../ecs/ecsystem';
import { AbilitySystemComponent } from './abilitysystem';

export class AbilityRuntimeSystem extends ECSystem {
	constructor(priority: number = 32) { super(TickGroup.Simulation, priority); }
	update(): void {
		const dtMs = $.deltaTime as number;
		for (const asc of AbilitySystemComponent.registry) asc.step(dtMs);
	}
}
