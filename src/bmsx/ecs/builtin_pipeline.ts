import { AbilityRuntimeSystem } from '../gas/abilityruntime';
import {
	BehaviorTreeSystem,
	BoundarySystem,
	MeshAnimationSystem,
	PhysicsCollisionEventSystem,
	PhysicsPostSystem,
	PhysicsSyncAfterWorldCollisionSystem,
	PhysicsSyncBeforeStepSystem,
	PhysicsWorldStepSystem,
	PrePositionSystem,
	StateMachineSystem,
	TickGroup,
	TileCollisionSystem,
	TransformSystem,
} from './ecsystem';
import { DefaultECSPipelineRegistry as R } from './pipeline';
import { PreRenderSubmitSystem } from './prerender_submit_system';
import { SpriteRenderSystem } from './sprite_render_system';
import { MeshRenderSystem } from './mesh_render_system';
import { TextRenderSystem } from './text_render_system';
import { SpriteColliderSyncSystem } from './spritecollider_sync_system';
import { Collision2DBroadphaseRebuildSystem } from './collision2d_broadphase_system';
import { Overlap2DSystem } from './overlap2d_system';
// No explicit PreRender submission systems; GameView.drawbase() visits objects

/** Register built-in ECS systems with sensible defaults. */
export function registerBuiltinECS(): void {
	const descs = [
		{ id: 'behaviorTrees', group: TickGroup.Input, defaultPriority: 20, create: (p: number) => new BehaviorTreeSystem(p) },
		{ id: 'abilityRuntime', group: TickGroup.AbilityUpdate, defaultPriority: 32, create: (p: number) => new AbilityRuntimeSystem(p) },
		{ id: 'objectFSM', group: TickGroup.ModeResolution, defaultPriority: 30, create: (p: number) => new StateMachineSystem(p) },
		{ id: 'prePosition', group: TickGroup.Physics, defaultPriority: 10, create: (p: number) => new PrePositionSystem(p) },
		{ id: 'physicsSyncBefore', group: TickGroup.Physics, defaultPriority: 15, create: (p: number) => new PhysicsSyncBeforeStepSystem(p) },
		{ id: 'physicsStep', group: TickGroup.Physics, defaultPriority: 20, create: (p: number) => new PhysicsWorldStepSystem(p) },
		{ id: 'physicsPost', group: TickGroup.Physics, defaultPriority: 25, create: (p: number) => new PhysicsPostSystem(p) },
		{ id: 'tileCollision', group: TickGroup.Physics, defaultPriority: 30, create: (p: number) => new TileCollisionSystem(p) },
		{ id: 'spriteColliderSync', group: TickGroup.Physics, defaultPriority: 35, create: (p: number) => new SpriteColliderSyncSystem(p) },
		{ id: 'boundary', group: TickGroup.Physics, defaultPriority: 40, create: (p: number) => new BoundarySystem(p) },
		{ id: 'physicsCollisionEvents', group: TickGroup.Physics, defaultPriority: 45, create: (p: number) => new PhysicsCollisionEventSystem(p) },
		{ id: 'physicsSyncAfterWorld', group: TickGroup.Physics, defaultPriority: 50, create: (p: number) => new PhysicsSyncAfterWorldCollisionSystem(p) },
		{ id: 'collisionBroadphase', group: TickGroup.Physics, defaultPriority: 55, create: (p: number) => new Collision2DBroadphaseRebuildSystem(p) },
		{ id: 'overlapEvents', group: TickGroup.Physics, defaultPriority: 56, create: (p: number) => new Overlap2DSystem(p) },
		{ id: 'transform', group: TickGroup.Physics, defaultPriority: 60, create: (p: number) => new TransformSystem(p) },
		{ id: 'meshAnim', group: TickGroup.Animation, defaultPriority: 10, create: (p: number) => new MeshAnimationSystem(p) },
		// Presentation: typed renderers first, then custom producers
		{ id: 'textRender', group: TickGroup.Presentation, defaultPriority: 7, create: (p: number) => new TextRenderSystem(p) },
		{ id: 'spriteRender', group: TickGroup.Presentation, defaultPriority: 8, create: (p: number) => new SpriteRenderSystem(p) },
		{ id: 'meshRender', group: TickGroup.Presentation, defaultPriority: 9, create: (p: number) => new MeshRenderSystem(p) },
		{ id: 'renderSubmit', group: TickGroup.Presentation, defaultPriority: 10, create: (p: number) => new PreRenderSubmitSystem(p) },
	];
	for (const d of descs) {
		if (!R.get(d.id)) {
			R.register(d);
		}
	}
}
