import { AbilityRuntimeSystem } from '../gas/abilityruntime';
import { GameplayMovementSystem } from './gameplay_movement_system';
import { InputAbilitySystem } from './input_ability_system';
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
import { FsmEventDispatchSystem } from './fsm_event_dispatch_system';
import { TimelineSystem } from './timeline_system';

/** Register built-in ECS systems with sensible defaults. */
export function registerBuiltinECS(): void {
	R.registerMany([
		{ id: 'behaviorTrees', group: TickGroup.Input, create: (p: number) => new BehaviorTreeSystem(p) },
		{ id: 'inputAbility', group: TickGroup.Input, defaultPriority: 10, create: (p: number) => new InputAbilitySystem(p) },
		{ id: 'abilityRuntime', group: TickGroup.AbilityUpdate, create: (p: number) => new AbilityRuntimeSystem(p) },
		{ id: 'fsmEventDispatch', group: TickGroup.ModeResolution, defaultPriority: 5, create: (p: number) => new FsmEventDispatchSystem(p ?? 5) },
		{ id: 'objectFSM', group: TickGroup.ModeResolution, create: (p: number) => new StateMachineSystem(p) },
		{ id: 'prePosition', group: TickGroup.Physics, create: (p: number) => new PrePositionSystem(p) },
		{ id: 'gameplayMovement', group: TickGroup.Physics, create: (p: number) => new GameplayMovementSystem(p) },
		{ id: 'physicsSyncBefore', group: TickGroup.Physics, create: (p: number) => new PhysicsSyncBeforeStepSystem(p) },
		{ id: 'physicsStep', group: TickGroup.Physics, create: (p: number) => new PhysicsWorldStepSystem(p) },
		{ id: 'physicsPost', group: TickGroup.Physics, create: (p: number) => new PhysicsPostSystem(p) },
		{ id: 'tileCollision', group: TickGroup.Physics, create: (p: number) => new TileCollisionSystem(p) },
		{ id: 'spriteColliderSync', group: TickGroup.Physics, create: (p: number) => new SpriteColliderSyncSystem(p) },
		{ id: 'boundary', group: TickGroup.Physics, create: (p: number) => new BoundarySystem(p) },
		{ id: 'physicsCollisionEvents', group: TickGroup.Physics, create: (p: number) => new PhysicsCollisionEventSystem(p) },
		{ id: 'physicsSyncAfterWorld', group: TickGroup.Physics, create: (p: number) => new PhysicsSyncAfterWorldCollisionSystem(p) },
		{ id: 'collisionBroadphase', group: TickGroup.Physics, create: (p: number) => new Collision2DBroadphaseRebuildSystem(p) },
		{ id: 'overlapEvents', group: TickGroup.Physics, create: (p: number) => new Overlap2DSystem(p) },
		{ id: 'transform', group: TickGroup.Physics, create: (p: number) => new TransformSystem(p) },
		{ id: 'timeline', group: TickGroup.Animation, create: (p: number) => new TimelineSystem(p) },
		{ id: 'meshAnim', group: TickGroup.Animation, create: (p: number) => new MeshAnimationSystem(p) },
		{ id: 'textRender', group: TickGroup.Presentation, create: (p: number) => new TextRenderSystem(p) },
		{ id: 'spriteRender', group: TickGroup.Presentation, create: (p: number) => new SpriteRenderSystem(p) },
		{ id: 'meshRender', group: TickGroup.Presentation, create: (p: number) => new MeshRenderSystem(p) },
		// No explicit PreRender submission systems; GameView.drawbase() visits objects
		{ id: 'renderSubmit', group: TickGroup.Presentation, create: (p: number) => new PreRenderSubmitSystem(p) },
	]);
}
