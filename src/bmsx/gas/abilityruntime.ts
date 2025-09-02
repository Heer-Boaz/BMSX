import type { BaseModel } from '../core/basemodel';
import { $ } from '../core/game';
import { System, TickGroup } from '../ecs/system';
import { AbilitySystemComponent } from './abilitysystem';

export class AbilityRuntimeSystem extends System {
	constructor(priority: number = 32) { super(TickGroup.Simulation, priority); }
	update(model: BaseModel): void {
		const dtMs = $.deltaTime as number;
		for (const asc of AbilitySystemComponent.registry) asc.step(dtMs);
	}
}
