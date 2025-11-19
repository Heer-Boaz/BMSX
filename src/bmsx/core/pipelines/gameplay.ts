import type { NodeSpec } from "../../ecs/pipeline";

/** Gameplay pipeline spec (id-based). */
export function gameplaySpec(): NodeSpec[] {
	return [
		// Phase 1: Input (gameplay reads only)
		{ ref: 'behaviorTrees' },
		{ ref: 'inputAbility' },
		// Phase 2: Ability runtime coroutines (drains gameplay command buffer)
		{ ref: 'abilityRuntime' },
		// Phase 3: Mode graph / gameplay FSMs mutate state and tags
		{ ref: 'objectFSM' },
		// Phase 4: Physics and collision resolution
		{ ref: 'prePosition' },
		{ ref: 'physicsSyncBefore' },
		{ ref: 'physicsStep' },
		{ ref: 'physicsPost' },
		{ ref: 'tileCollision' },
		{ ref: 'boundary' },
		{ ref: 'physicsCollisionEvents' },
		{ ref: 'physicsSyncAfterWorld' },
		{ ref: 'overlapEvents' },
		{ ref: 'transform' },
		// Phase 5: Animation systems
		{ ref: 'timeline' },
		{ ref: 'meshAnim' },
		// Phase 6: Presentation (render submission)
		{ ref: 'textRender' },
		{ ref: 'spriteRender' },
		{ ref: 'meshRender' },
		{ ref: 'renderSubmit' },
	];
}
