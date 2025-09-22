import { $ } from '../core/game';
import { ECSystem, TickGroup } from '../ecs/ecsystem';
import { AbilitySystemComponent } from '../component/abilitysystemcomponent';
import { GameplayIntentQueue } from './intent';

export class AbilityIntentResolutionSystem extends ECSystem {
	constructor(priority: number = 18) { super(TickGroup.IntentResolution, priority); }
	update(): void {
		const queue = GameplayIntentQueue.instance;
		const limit = queue.pendingCount();
		for (let i = 0; i < limit; i++) {
			const intent = queue.next();
			if (!intent) break;
			const asc = AbilitySystemComponent.registryByOwner.get(intent.ownerId);
			if (!asc) continue;
			asc.tryActivate(intent.abilityId, intent.payload);
		}
	}
}

export class AbilityRuntimeSystem extends ECSystem {
	constructor(priority: number = 32) { super(TickGroup.AbilityUpdate, priority); }
	update(): void {
		const dtMs = $.deltaTime as number;
		for (const asc of AbilitySystemComponent.registry) asc.step(dtMs);
	}
}
