import type { NodeSpec } from "../../ecs/pipeline";

/** Gameplay pipeline spec (id-based). */
export function gameplaySpec(): NodeSpec[] {
	return [
		// Phase 1: Input (gameplay reads only)
		{ ref: 'behaviorTrees' },
		// Phase 2: Ability runtime coroutines (drains gameplay command buffer)
		{ ref: 'abilityRuntime' },
		// Phase 3: Mode graph / gameplay FSMs mutate state and tags
		{ ref: 'fsmEventDispatch', before: ['objectFSM'] },
		{ ref: 'objectFSM' },
		// Phase 4: Physics and collision resolution
		{ ref: 'prePosition' },
		{ ref: 'gameplayMovement', before: ['physicsSyncBefore'], after: ['prePosition'] },
		{ ref: 'physicsSyncBefore', after: ['gameplayMovement'] },
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
		// Phase 5: Animation systems
		{ ref: 'meshAnim' },
		// Phase 6: Presentation (render submission)
		{ ref: 'textRender' },
		{ ref: 'spriteRender', after: ['textRender'] },
		{ ref: 'meshRender', after: ['spriteRender'] },
		{ ref: 'renderSubmit', after: ['meshRender'] },
	];
}
