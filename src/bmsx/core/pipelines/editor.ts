import type { NodeSpec } from "../../ecs/pipeline";

/** Editor pipeline spec (mirrors gameplay; room for editor-only systems). */
export function editorSpec(): NodeSpec[] {
  return [
    { ref: 'prePosition' },
    { ref: 'behaviorTrees' },
    { ref: 'meshAnim', after: ['behaviorTrees'] },
    { ref: 'objectFSM', after: ['meshAnim'] },
    { ref: 'abilityRuntime', after: ['objectFSM'] },
    { ref: 'taskRuntime', after: ['abilityRuntime'] },
    { ref: 'physicsSyncBefore', after: ['taskRuntime'] },
    { ref: 'physicsPost' },
    { ref: 'tileCollision' },
    { ref: 'boundary', after: ['tileCollision'] },
    { ref: 'physicsCollisionEvents' },
    { ref: 'physicsSyncAfterWorld', after: ['boundary', 'tileCollision'] },
    { ref: 'transform' },
  ];
}
