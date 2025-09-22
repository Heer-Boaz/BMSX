import { ECSystem, TickGroup } from 'bmsx/ecs/ecsystem';
import { registerEcsPipelineExtension } from 'bmsx/ecs/extensions';
import { DefaultECSPipelineRegistry as ECSReg, type NodeSpec } from 'bmsx/ecs/pipeline';
import type { World } from 'bmsx/core/world';
import { Fighter } from './fighter';

const ELLA_LOCOMOTION_SYSTEM_ID = 'ella.fighterLocomotion';

class FighterLocomotionSystem extends ECSystem {
	constructor(priority: number = 12) {
		super(TickGroup.Physics, priority);
	}

	update(world: World): void {
		for (const obj of world.activeObjects) {
			if (!(obj instanceof Fighter)) continue;
			if (obj.hasGameplayTag('state.airborne')) continue;
			if (obj.hasGameplayTag('state.attacking')) continue;
			const dir = obj.desiredWalkDir;
			if (dir === 0) continue;
			obj.x_nonotify += dir * Fighter.SPEED;
		}
	}
}

let locomotionRegistered = false;

export function ensureFighterLocomotionSystemRegistered(): void {
	if (locomotionRegistered) return;
	if (!ECSReg.get(ELLA_LOCOMOTION_SYSTEM_ID)) {
		ECSReg.register({
			id: ELLA_LOCOMOTION_SYSTEM_ID,
			group: TickGroup.Physics,
			defaultPriority: 12,
			create: (priority: number) => new FighterLocomotionSystem(priority),
		});
	}
	registerEcsPipelineExtension((): NodeSpec[] => [{ ref: ELLA_LOCOMOTION_SYSTEM_ID }]);
	locomotionRegistered = true;
}
