import type { BaseModel } from '../core/basemodel';
import { $ } from '../core/game';
import type { GameObject } from '../core/gameobject';
import { System, TickGroup } from '../ecs/system';
import { AbilitySystemComponent } from './abilitysystem';

function hasASC(o: GameObject): o is GameObject & { asc: AbilitySystemComponent } {
	const r = o as unknown as Record<string, unknown>;
	return r['asc'] instanceof AbilitySystemComponent;
}

export class AbilityRuntimeSystem extends System {
	constructor(priority: number = 32) { super(TickGroup.Simulation, priority); }
	update(model: BaseModel): void {
		const dtMs = $.deltaTime as number;
		const objs = model.objects;
		for (let i = 0; i < objs.length; ++i) {
			const o = objs[i] as GameObject;
			if (!hasASC(o)) continue;
			o.asc.step(dtMs);
		}
	}
}
