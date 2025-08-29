# Next steps

Continue implementing the professionalized render/pipeline foundations I approved. Prioritize according to your own will.
Always consider that:
- I also need to support both WebGL2 and WebGPU (even though WebGPU pipelines are not implemented yet).
- There are already components implemented that enable GPU API agnostic code, like the `GPUBackend`, `TextureManager`, `AssetBarrier`, `Float32Pool`, etc.
- The `GameView` class should be backend agnostic and not depend on WebGL2-specific code.

And always consider your proposed plan: A UE5-inspired, light-weight design for the render/pipeline system that fits the current codebase and conventions (e.g. `fsmlibrary.ts`, `basecomponent.ts`, `registry.ts` plus a staged roadmap to implement it safely.

## Goals

* Clean separation of concerns: view/build state vs. per-pass execution.
* Type-safe pass state and bindings; no “unknown” or “any”.
* Cross‑backend (WebGL2/WebGPU) parity via a single backend interface.
* Deterministic scheduling/resource lifetime via the render graph.
* High performance: minimal state changes, pooled submissions, VAOs, UBOs.
* Editor/dev workflows: introspection, validation, profiling, and quick toggles.

## Core Abstractions

* Renderer/Backend: A “device” facade (GPUBackend) stays the single API for WebGL2/WebGPU. Keep it small and composable.
* Pipeline Manager: Owns programs/pipelines and pass lifecycle. It binds before prepare, then exec (you already do this).
* Render Graph: Owns pass order and attachment lifetimes with aliasing (you already have this; we’ll extend typing/validation).
* Render Features: Sprite, Mesh, Particles, Skybox, PostFX. Each feature:
* Collects submissions into an internal queue
* Prepares its pass state
* Encodes draw calls during exec
* Frame Shared State: A single per-frame uniform block (time, view/proj, viewport, logical resolution, flags).
* Binding Layout: Declares the shader resources that a pass uses (uniform buffers, textures, samplers, storage). Maps to WebGL “locations” and WebGPU bind groups.

## Pass Lifecycle

* Bootstrap: One-time creation (buffers, VAOs, default textures, shader permutes).
* Prepare: With pipeline bound; update uniforms/UBOs, bind textures/samplers, upload dynamic buffers from queues.
* Exec: Record draw(s) on a provided pass encoder/FBO.
* Destroy: Lifetime end (editor reload or shutdown) to free resources.
* Type-Safe Pass State
* Replace “unknown” pass state with generics tied to pass IDs.

### Example

* RenderPassStateMap is a generic type parameter of PipelineRegistry and GraphicsPipelineManager.
* Each pass registers its own State type; setState('sprites', SpritesState) becomes type-checked.

## Sketch

* src/bmsx/render/backend/pipeline_interfaces.ts
* Add generic RenderPassStateMap (default to your built-ins); wire through RenderPassDef, PipelineRegistry, and GraphicsPipelineManager.
* src/bmsx/render/backend/pipeline_registry.ts
* Define concrete state types per pass (you already do inline; move them into a central type and export).
* Result: setState/getState/prepare/exec all get exact types by pass ID.

### Frame UBO + Bindings

* Add a small FrameUniforms UBO shared by all passes:
* u_time, u_delta, u_viewProj, u_view, u_proj, u_cameraPos, u_viewportSize, u_logicalSize, flags.
* WebGL2: Create/bind UBO once per frame and bind by index in bootstrap. Avoid per-pass uniform calls where possible.
* WebGPU: Single uniform buffer with per-frame write, bind group slot 0.

### Where

* src/bmsx/render/graph/rendergraph.ts: already centralizes frame data; add a step to upload the UBO once (“FrameResolve”).
* src/bmsx/render/backend/webgl_backend.ts: expose createUniformBuffer/updateUniformBuffer/bindUniformBufferBase (already present).

### Standardized Render Queues

* Each feature owns its queue and scratch buffers (typed arrays) with pooling:
* SpriteFeatureQueue, MeshFeatureQueue, ParticleFeatureQueue.
* Avoid reallocation; double-buffer submit lists frame-over-frame, swap at endFrame.
* Provide reserve(n) growth doubling strategy; reuse typed arrays.
* Sorting keys per feature (minimize state churn):
* Sprites: atlasId << 20 | depthBucket << 8 | translucencyFlag.
* Mesh: materialId, pipelineId, depthBucket.

### Backend State Cache + VAOs

* WebGL2: Create VAOs per pipeline in bootstrap, bind once per draw; attribute pointers live in VAOs.
* Backend state cache:
  * Track bound VAO, program, vertex/index buffer, textures per unit; short-circuit redundant binds.
  * Provide setVertexLayout(handle) convenience that binds the right VAO and buffers.
  * WebGPU: Map VAO concept to pipeline vertex-state descriptors.

### Files

  * src/bmsx/render/backend/webgl_backend.ts: add VAO helpers (many exist; wire VAO creation in pipeline bootstrap).
  * src/bmsx/render/2d/sprites_pipeline.ts: Create a VAO and stop re-specifying attrib pointers each frame.

### Shader Modules & Binding Layout

  * Introduce a small “module” wrapper for shader code:
    * Declares its binding layout and specialization constants (defines).
    * Provides a stable “material signature” key for permutation caching.
    * Optional: lightweight string preprocessor for defines, but keep it simple.

### Validation & Debug HUD

* Validation:
  * Pass ID uniqueness, binding layout agreement (declared vs. used), graph cycle/alias warnings.
  * Check for missing prepare state or null textures for required bindings.
  * HUD in bmsxdebugger.ts:
    * Framegraph pass list with timings (you already collect stats).
    * Per-pass resource usage, active pipelines count, draw call counts.
    * Toggles to pause/step frame, show viewports, visualize overdraw, runtime “force clear color” (your Clear pass already supports a debug color flag).

### Performance Practices

  * Buffer sub-allocation: Use big static buffers; write with bufferSubData or gl.mapBufferRange (if available); in WebGPU, writeBuffer once using mapped ranges.
  * Ring buffers for per-frame dynamic data (sprite vertices, particle instancing).
  * Group draws by material/texture; favor instancing where possible (particles).
  * Avoid GC pressure: reuse objects; no per-draw object creation in hot paths; typed arrays only.
  * Pixel-perfect mapping: keep u_resolution = logicalSize and viewport = offscreen size (fixed by your last change).
