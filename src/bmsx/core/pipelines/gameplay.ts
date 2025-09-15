import type { NodeSpec } from "../../ecs/pipeline";

/** Gameplay pipeline spec (id-based). */
export function gameplaySpec(): NodeSpec[] {
	return [
		{ ref: 'prePosition' },
		{ ref: 'behaviorTrees' },
		{ ref: 'meshAnim', after: ['behaviorTrees'] },
		{ ref: 'objectFSM', after: ['meshAnim'] },
		{ ref: 'abilityRuntime', after: ['objectFSM'] },
		{ ref: 'taskRuntime', after: ['abilityRuntime'] },
		{ ref: 'physicsSyncBefore', after: ['taskRuntime'] },
		// PostPhysics ordering
		{ ref: 'physicsPost' },
		{ ref: 'tileCollision' },
		{ ref: 'spriteColliderSync', after: ['tileCollision'] },
		{ ref: 'boundary', after: ['tileCollision'] },
		{ ref: 'physicsCollisionEvents' },
		{ ref: 'physicsSyncAfterWorld', after: ['boundary', 'tileCollision'] },
		{ ref: 'collisionBroadphase', after: ['physicsSyncAfterWorld'] },
		{ ref: 'overlapEvents', after: ['collisionBroadphase'] },
		{ ref: 'transform' },
		// Submit renderables (PreRender group)
		{ ref: 'textRender' },
		{ ref: 'spriteRender', after: ['textRender'] },
		{ ref: 'meshRender', after: ['spriteRender'] },
		{ ref: 'renderSubmit', after: ['meshRender'] },
	];
}
