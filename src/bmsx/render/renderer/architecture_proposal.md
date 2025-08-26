# Rendering Layer Refactor Proposal

## Goals
- Unify view abstraction: remove ambiguous BaseView/RenderView split.
- Separate platform-agnostic game viewport/UI sizing from GPU rendering specifics.
- Provide a clean backend-pluggable architecture (WebGL2 now, WebGPU later) without scattering casts.
- Eliminate ad-hoc RenderContext structural casting.
- Preserve existing public API surface for game code (drawImg, drawMesh, etc.) with a thin façade.

## Proposed Layers

1. GameView (formerly BaseView)
   - Concrete class (not abstract) handling: canvas acquisition, window/canvas sizing, onscreen gamepad layout, basic 2D immediate helpers (delegating to sprite system via a bound renderer), and frame gating.
   - Owns a reference to an IRenderHost (see below). If no GPU backend is desired (headless/tests), the host can be a NoopRenderHost.
   - API surface stable: drawImg / drawRectangle / fillRectangle / drawPolygon / drawMesh etc. Each forwards to host.pipeline adapters.

2. IRenderHost (new interface)
   - startFrame(clear: boolean): FrameContext
   - executeFrame(frameData: FrameContext): void
   - resize(viewport: Size): void
   - getBackend(): GPUBackend
   - getCapabilities(): RenderCapabilities (struct with flags: supportsFloatingPointTex, maxTextureUnits, etc.)
   - dispose()

3. WebGLRenderHost implements IRenderHost (extract logic from current RenderView)
   - Owns: glctx, frame graph, textures, framebuffer objects, lighting system, pipeline state cache.
   - Exposes minimal texture binding helpers or delegates them to GPUBackend entirely.
   - Supplies a RenderContext object (stable identity) implementing required binding fields & functions used by pipelines.

4. (Future) WebGPURenderHost
   - Parallel structure; internal differences isolated.

5. GPUBackend (existing) evolves into stateless shader/program/pipeline compilation + resource utilities. State tracking like active texture units migrates inside RenderHost (or a shared minimal helper referenced by host).

6. RenderContext
   - Pure data + methods required by pipelines (glctx OR device/encoder, upload helpers, texture binding). Provided by IRenderHost each frame (or cached if immutable). No global $ casting.

## Migration Strategy (Incremental)

Phase A (Safety & Extraction):
- Introduce IRenderHost + WebGLRenderHost wrapping existing RenderView guts.
- Rename BaseView -> GameView (concrete) that holds a host reference (created with a factory: createRenderHost('webgl')).
- Replace uses of RenderView-specific fields in pipelines with context access from host.getRenderContext(). Keep getRenderContext helper but now backed by host.

Phase B (Flatten & Remove Old Types):
- Remove RenderView class after all references migrate.
- Pipelines no longer import pipeline_registry to obtain context; they import getRenderContext from render/host/context.

Phase C (Backend Agnostic Enhancements):
- Introduce capability queries, optional WebGPU host skeleton.
- Split CRT post-process into a generic PostProcessPass executed via host facilities.

## Immediate Concrete Edits (Phase A Start)
- Add interfaces: IRenderHost, RenderContext.
- Add factory: createRenderHost(kind: 'webgl'): IRenderHost.
- Implement WebGLRenderHost by moving code from RenderView (framebuffer setup, graph build, texture management, execute, resize).
- Convert Game.init to instantiate GameView + host (removing viewAs structural casts).

## Benefits
- Clear separation of concerns: UI/layout vs GPU rendering orchestration.
- Pluggable backends without entangling view lifecycle.
- No structural casting; type guards become unnecessary.
- Easier unit testing (NoopRenderHost can simulate frame execution).

## Potential Risks / Mitigation
- Large file churn: mitigate via staged extraction (copy logic first, deprecate old class, then remove).
- Subtle ordering dependencies (initialization of pipelines vs host construction). Mitigate by explicit host.init() call in Game.init after GameView creation and before model init.
- Performance regression from added indirection: minimal (single virtual dispatch per draw call path), can inline hot paths later.

## Next Steps (if approved)
1. Create new files: `render/host/interfaces.ts`, `render/host/webgl_host.ts`, `render/host/factory.ts`.
2. Copy logic from current `render_view.ts` into WebGLRenderHost (adjusting references).
3. Replace usages of `RenderView` with `GameView` + `IRenderHost` injection.
4. Provide temporary adapter so existing external code referencing `$.view` continues working until full migration.

---
Let me know if you want me to begin implementing Phase A with scaffolding.
