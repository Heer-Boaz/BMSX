import type { World } from '../core/world';
import { ECSystem, TickGroup } from './ecsystem';
import { TimelineComponent } from '../component/timeline_component';

export class TimelineSystem extends ECSystem {
	constructor(priority: number = 0) {
		super(TickGroup.Animation, priority);
	}

	update(world: World): void {
		const entries = world.objects_with_components(TimelineComponent, { scope: 'active' });
		for (const [, component] of entries) {
			if (!component.enabled) continue;
			component.tick_active(1);
		}
	}
}
