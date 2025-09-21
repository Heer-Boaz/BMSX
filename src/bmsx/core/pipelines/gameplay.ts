import type { NodeSpec } from "../../ecs/pipeline";

/** Gameplay pipeline spec (id-based). */
export function gameplaySpec(): NodeSpec[] {
	return [
		// Phase 1: Input (gameplay reads only)
		{ ref: 'behaviorTrees' },
		// Phase 2: Intent resolution (convert queued requests into ability activations)
		{ ref: 'abilityIntent' },
		// Phase 3: Ability runtime coroutines
		{ ref: 'abilityRuntime' },
		// Phase 4: Mode graph / gameplay FSMs mutate state and tags
		{ ref: 'objectFSM' },
		// Phase 5: Physics and collision resolution
		{ ref: 'prePosition' },
		{ ref: 'physicsSyncBefore' },
		{ ref: 'physicsStep' },
		{ ref: 'physicsPost' },
		{ ref: 'tileCollision' },
		{ ref: 'spriteColliderSync', after: ['tileCollision'] },
		{ ref: 'boundary', after: ['tileCollision'] },
		{ ref: 'physicsCollisionEvents' },
		{ ref: 'physicsSyncAfterWorld', after: ['boundary', 'tileCollision'] },
		{ ref: 'collisionBroadphase', after: ['physicsSyncAfterWorld'] },
		{ ref: 'overlapEvents', after: ['collisionBroadphase'] },
		{ ref: 'transform' },
		// Phase 6: Animation systems
		{ ref: 'meshAnim' },
		// Phase 7: Presentation (render submission)
		{ ref: 'textRender' },
		{ ref: 'spriteRender', after: ['textRender'] },
		{ ref: 'meshRender', after: ['spriteRender'] },
		{ ref: 'renderSubmit', after: ['meshRender'] },
	];
}
