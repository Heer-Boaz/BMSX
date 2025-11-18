import type { NodeSpec } from "../../ecs/pipeline";

/** Gameplay pipeline spec (id-based). */
export function gameplaySpec(): NodeSpec[] {
	return [
		// Phase 1: Input (gameplay reads only)
		{ ref: 'behaviorTrees' },
		{ ref: 'inputAbility', after: ['behaviorTrees'] },
		// Phase 2: Ability runtime coroutines (drains gameplay command buffer)
		{ ref: 'abilityRuntime' },
		// Phase 3: Mode graph / gameplay FSMs mutate state and tags
		{ ref: 'objectFSM' },
		// Phase 4: Physics and collision resolution
		{ ref: 'prePosition' },
		{ ref: 'physicsSyncBefore' },
		{ ref: 'physicsStep', after: ['physicsSyncBefore'] },
		{ ref: 'physicsPost', after: ['physicsStep'] },
		{ ref: 'tileCollision', after: ['physicsPost'] },
		{ ref: 'boundary', after: ['tileCollision'] },
		{ ref: 'physicsCollisionEvents', after: ['physicsPost'] },
		{ ref: 'physicsSyncAfterWorld', after: ['boundary'] },
		{ ref: 'overlapEvents', after: ['physicsSyncAfterWorld'] },
		{ ref: 'transform', after: ['overlapEvents'] },
		// Phase 5: Animation systems
		{ ref: 'timeline', after: ['transform'] },
		{ ref: 'meshAnim', after: ['timeline'] },
		// Phase 6: Presentation (render submission)
		{ ref: 'textRender', after: ['timeline'] },
		{ ref: 'spriteRender', after: ['textRender'] },
		{ ref: 'meshRender', after: ['spriteRender'] },
		{ ref: 'renderSubmit', after: ['meshRender'] },
	];
}
