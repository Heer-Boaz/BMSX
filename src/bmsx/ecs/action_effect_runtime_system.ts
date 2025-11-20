import { $ } from '../core/game';
import { ECSystem, TickGroup } from './ecsystem';
import { ActionEffectComponent } from '../component/actioneffectcomponent';
import { BmsxConsoleRuntime } from '../console/runtime';

export class ActionEffectRuntimeSystem extends ECSystem {
	constructor(priority: number = 32) {
		super(TickGroup.ActionEffect, priority);
	}

	update(): void {
		const dtMs = $.deltatime;
		for (const [, component] of $.world.objects_with_components(ActionEffectComponent, { scope: 'active' })) {
			try {
				component.advance_time(dtMs);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const ownerId = component.parent.id ? component.parent.id : '<unknown>';
				const runtime = BmsxConsoleRuntime.instance;
				if (runtime) {
					runtime.reportEngineError(error);
				}
				throw new Error(`[ActionEffectRuntimeSystem] Tick failed for ActionEffectComponent '${ownerId}': ${message}`);
			}
		}
	}
}
