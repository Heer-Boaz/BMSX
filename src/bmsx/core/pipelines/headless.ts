import type { NodeSpec } from "../../ecs/pipeline";

/** Headless pipeline spec: no mesh animation or transform output. */
export function headlessSpec(): NodeSpec[] {
  return [
    { ref: 'prePosition' },
    { ref: 'behaviorTrees' },
    { ref: 'objectFSM', after: ['behaviorTrees'] },
    { ref: 'abilityRuntime', after: ['objectFSM'] },
    { ref: 'taskRuntime', after: ['abilityRuntime'] },
    { ref: 'physicsSyncBefore', after: ['taskRuntime'] },
    { ref: 'physicsPost' },
    { ref: 'tileCollision' },
    { ref: 'boundary', after: ['tileCollision'] },
    { ref: 'physicsCollisionEvents' },
    { ref: 'physicsSyncAfterWorld', after: ['boundary', 'tileCollision'] },
    // Note: no 'meshAnim' or 'transform'
  ];
}
