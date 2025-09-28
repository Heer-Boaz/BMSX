import type { NodeSpec } from "../../ecs/pipeline";

export function headlessSpec(): NodeSpec[] {
	return [
		{ ref: 'behaviorTrees' },
		{ ref: 'abilityRuntime' },
		{ ref: 'fsmEventDispatch', before: ['objectFSM'] },
		{ ref: 'objectFSM' },
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
		{ ref: 'transform', after: ['overlapEvents'] },
 		{ ref: 'spriteRender', after: ['transform'] },
 		{ ref: 'renderSubmit', after: ['spriteRender'] },
	];
}
