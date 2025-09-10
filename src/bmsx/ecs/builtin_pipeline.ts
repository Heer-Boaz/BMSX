import { AbilityRuntimeSystem } from "../gas/abilityruntime";
import { TaskRuntimeSystem } from "../gas/tasks";
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
} from "./ecsystem";
import { DefaultECSPipelineRegistry as R } from "./pipeline";

/** Register built-in ECS systems with sensible defaults. */
export function registerBuiltinECS(): void {
  // Guard against double registration
  try { R.get("prePosition"); } catch { /* noop */ }
  if (R.get("prePosition")) return;

  R.registerMany([
    { id: "prePosition", group: TickGroup.PrePhysics, defaultPriority: 10, create: (p) => new PrePositionSystem(p) },
    { id: "behaviorTrees", group: TickGroup.Simulation, defaultPriority: 20, create: (p) => new BehaviorTreeSystem(p) },
    { id: "meshAnim", group: TickGroup.Simulation, defaultPriority: 25, create: (p) => new MeshAnimationSystem(p) },
    { id: "objectFSM", group: TickGroup.Simulation, defaultPriority: 30, create: (p) => new StateMachineSystem(p) },
    { id: "abilityRuntime", group: TickGroup.Simulation, defaultPriority: 32, create: (p) => new AbilityRuntimeSystem(p) },
    { id: "taskRuntime", group: TickGroup.Simulation, defaultPriority: 33, create: (p) => new TaskRuntimeSystem(p) },
    { id: "physicsSyncBefore", group: TickGroup.Simulation, defaultPriority: 34, create: (p) => new PhysicsSyncBeforeStepSystem(p) },
    { id: "physicsPost", group: TickGroup.PostPhysics, defaultPriority: 35, create: (p) => new PhysicsPostSystem(p) },
    { id: "tileCollision", group: TickGroup.PostPhysics, defaultPriority: 10, create: (p) => new TileCollisionSystem(p) },
    { id: "boundary", group: TickGroup.PostPhysics, defaultPriority: 20, create: (p) => new BoundarySystem(p) },
    { id: "physicsCollisionEvents", group: TickGroup.PostPhysics, defaultPriority: 28, create: (p) => new PhysicsCollisionEventSystem(p) },
    { id: "physicsSyncAfterWorld", group: TickGroup.PostPhysics, defaultPriority: 30, create: (p) => new PhysicsSyncAfterWorldCollisionSystem(p) },
    { id: "transform", group: TickGroup.PostPhysics, defaultPriority: 50, create: (p) => new TransformSystem(p) },
  ]);
}

