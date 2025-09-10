ECS Pipelines
=============

Overview
--------

- The `World` owns the ECS system manager and update loop, but it does not decide which systems run.
- Pipelines (the concrete list and order of systems) are selected and applied by `Game`.
- Systems are excluded from serialization; after loading a save, re-apply the selected pipeline.

Available Pipelines
-------------------

- Gameplay: `src/bmsx/core/pipelines/gameplay.ts`
  - BehaviorTrees, StateMachines, Ability/Task runtime, Physics sync/post, Tile/Boundary collisions, Physics events, Mesh animation, Transform updates.
- Headless: `src/bmsx/core/pipelines/headless.ts`
  - Simulation-oriented; excludes `MeshAnimationSystem` and `TransformSystem` to avoid rendering work.
- Editor: `src/bmsx/core/pipelines/editor.ts`
  - Mirrors gameplay today; dedicated entry point for editor-only systems (gizmos, overlays) later.

How To Select a Pipeline
------------------------

Preferred (via Game init):

```
import { Game } from "src/bmsx/core/game";

const game = new Game();
await game.init({
  rompack,
  worldConfig,
  sndcontext,
  gainnode,
  debug: false,
  ecsPipeline: 'headless', // 'gameplay' | 'headless' | 'editor'
});
```

Advanced: provide a custom spec

```
import type { NodeSpec } from "src/bmsx/ecs/pipeline";

const spec: NodeSpec[] = [
  { ref: 'prePosition' },
  { ref: 'behaviorTrees' },
  { ref: 'objectFSM', after: ['behaviorTrees'] },
  // ...
];

await game.init({
  rompack, worldConfig, sndcontext, gainnode,
  ecsPipeline: spec,
});
```

Default behavior (no pipeline provided):

- `game.init({ ... })` applies the gameplay pipeline.

Notes & Guidance
----------------

- Keep rendering work inside rendering systems; do not introduce render logic in game logic.
- If you add a new pipeline, place it under `src/bmsx/core/pipelines/` and export a `xxxSpec(): NodeSpec[]` function.
- For performance-sensitive builds (server sims/tests), prefer the headless pipeline to minimize CPU/GPU overhead.

Extensions
----------

- Modules can extend the ECS pipeline by registering an extension during their boot phase:

```
import { registerEcsPipelineExtension, DefaultECSPipelineRegistry as ECSReg } from 'bmsx';

registerEcsPipelineExtension(({ world, profile, registry }) => {
  // Optionally register new systems first using registry (ECSReg)
  // registry.register({ id: 'mySystem', group: TickGroup.Simulation, defaultPriority: 31, create: p => new MySystem(p) });
  return [ { ref: 'mySystem', after: ['objectFSM'] } ];
});
```

- The Game composes `baseSpec + extensions` after plugin `onBoot()` and before the first frame.

Debugging
---------

- In debug mode, the engine logs the resolved ECS pipeline order, per-group ordering, constraints, and whether cycles were detected. You can also call `dumpEcsPipeline(ECSReg.getLastDiagnostics()!)` manually.
