import { AbilityRuntimeSystem } from '../gas/abilityruntime';
import { TaskRuntimeSystem } from '../gas/tasks';
import {
	BehaviorTreeSystem,
	BoundarySystem,
	MeshAnimationSystem,
	PhysicsCollisionEventSystem,
	PhysicsPostSystem,
	PhysicsSyncAfterWorldCollisionSystem,
	PhysicsSyncBeforeStepSystem,
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
// No explicit PreRender submission systems; GameView.drawbase() visits objects

/** Register built-in ECS systems with sensible defaults. */
export function registerBuiltinECS(): void {
	const descs = [
		{ id: 'prePosition', group: TickGroup.PrePhysics, defaultPriority: 10, create: (p: number) => new PrePositionSystem(p) },
		{ id: 'behaviorTrees', group: TickGroup.Simulation, defaultPriority: 20, create: (p: number) => new BehaviorTreeSystem(p) },
		{ id: 'meshAnim', group: TickGroup.Simulation, defaultPriority: 25, create: (p: number) => new MeshAnimationSystem(p) },
		{ id: 'objectFSM', group: TickGroup.Simulation, defaultPriority: 30, create: (p: number) => new StateMachineSystem(p) },
		{ id: 'abilityRuntime', group: TickGroup.Simulation, defaultPriority: 32, create: (p: number) => new AbilityRuntimeSystem(p) },
		{ id: 'taskRuntime', group: TickGroup.Simulation, defaultPriority: 33, create: (p: number) => new TaskRuntimeSystem(p) },
		{ id: 'physicsSyncBefore', group: TickGroup.Simulation, defaultPriority: 34, create: (p: number) => new PhysicsSyncBeforeStepSystem(p) },
		{ id: 'physicsPost', group: TickGroup.PostPhysics, defaultPriority: 35, create: (p: number) => new PhysicsPostSystem(p) },
		{ id: 'tileCollision', group: TickGroup.PostPhysics, defaultPriority: 10, create: (p: number) => new TileCollisionSystem(p) },
		{ id: 'boundary', group: TickGroup.PostPhysics, defaultPriority: 20, create: (p: number) => new BoundarySystem(p) },
		{ id: 'physicsCollisionEvents', group: TickGroup.PostPhysics, defaultPriority: 28, create: (p: number) => new PhysicsCollisionEventSystem(p) },
		{ id: 'physicsSyncAfterWorld', group: TickGroup.PostPhysics, defaultPriority: 30, create: (p: number) => new PhysicsSyncAfterWorldCollisionSystem(p) },
		{ id: 'transform', group: TickGroup.PostPhysics, defaultPriority: 50, create: (p: number) => new TransformSystem(p) },
		// PreRender: typed renderers first, then custom producers
		{ id: 'textRender', group: TickGroup.PreRender, defaultPriority: 7, create: (p: number) => new TextRenderSystem(p) },
		{ id: 'spriteRender', group: TickGroup.PreRender, defaultPriority: 8, create: (p: number) => new SpriteRenderSystem(p) },
		{ id: 'meshRender', group: TickGroup.PreRender, defaultPriority: 9, create: (p: number) => new MeshRenderSystem(p) },
		{ id: 'renderSubmit', group: TickGroup.PreRender, defaultPriority: 10, create: (p: number) => new PreRenderSubmitSystem(p) },
	];
	for (const d of descs) {
		if (!R.get(d.id)) {
			R.register(d as any);
		}
	}
}
