import { $ } from '../core/game';
import { ECSystem, TickGroup } from '../ecs/ecsystem';
import { AbilitySystemComponent } from '../component/abilitysystemcomponent';
import { BmsxConsoleRuntime } from '../console/runtime';

export class AbilityRuntimeSystem extends ECSystem {
	constructor(priority: number = 32) { super(TickGroup.AbilityUpdate, priority); }
	update(): void {
		const dtMs = $.deltatime;
		for (const [, asc] of $.world.objects_with_components(AbilitySystemComponent, { scope: 'active' })) {
			try {
				asc.step(dtMs);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const ownerId = asc.parent.id ? asc.parent.id : '<unknown>';
				const runtime = BmsxConsoleRuntime.instance;
				if (runtime) {
					runtime.reportEngineError(error);
				}
				throw new Error(`[AbilityRuntimeSystem] Tick failed for AbilitySystemComponent '${ownerId}': ${message}`);
			}
		}
	}
}
