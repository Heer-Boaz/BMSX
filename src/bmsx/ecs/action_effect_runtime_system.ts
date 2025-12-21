import { $ } from '../core/engine_core';
import { ECSystem, TickGroup } from './ecsystem';
import { ActionEffectComponent } from '../component/actioneffectcomponent';
import { BmsxVMRuntime } from '../vm/vm_tooling_runtime';
import { extractErrorMessage } from '../lua/luavalue';

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
				const message = extractErrorMessage(error);
				const ownerId = component.parent.id ? component.parent.id : '<unknown>';
				const runtime = BmsxVMRuntime.instance;
				if (runtime) {
					runtime.handleLuaError(error);
				}
				throw new Error(`[ActionEffectRuntimeSystem] Tick failed for ActionEffectComponent '${ownerId}': ${message}`);
			}
		}
	}
}
