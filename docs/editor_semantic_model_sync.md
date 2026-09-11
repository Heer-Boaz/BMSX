# Editor model synchronization

Starting at `6b412f5ba`. This is the document-lifetime part of B04, not a
callee-completeness certificate or the reparent/property-edit UI.

## Reference and owner contract before implementation

[VS Code's TypeScript buffer synchronizer](https://github.com/microsoft/vscode/blob/0ac867d1f00150db3a91c10edc1295eccd75c16d/extensions/typescript-language-features/src/tsServer/bufferSyncSupport.ts#L527-L545)
subscribes to document open/change/close and seeds existing documents. Visible
editors control diagnostic presentation, not whether a document is synchronized.
The [editor worker model synchronizer](https://github.com/microsoft/vscode/blob/0ac867d1f00150db3a91c10edc1295eccd75c16d/src/vs/editor/common/services/textModelSync/textModelSync.impl.ts#L93-L129)
ties content synchronization and removal to the model's lifetime. BMSX does not
copy its worker protocol, idle timers, size fallbacks or defensive guards.

Live gap: `BehaviorRegistrationIndex` polls every retained text model and owns a
second version cache. Other semantic consumers update only the current file.
Consequently a query's visibility of unsaved dependencies depends on which view
ran first. A model is not a tab and closing a source view does not discard it.

- `EditorTextModelService` owns model addition, content changes and removal.
  Removal is published after the resource is no longer available from the
  service. View focus/selection does not publish a content event.
- Each `EditorLuaSemanticProject` subscribes once and seeds existing models.
  Events queue affected paths; they do not parse, bind or run queries inside
  a content-change listener. Semantic reads flush the queue in one workspace
  update. Unchanged reads do not enumerate models or copy source text.
- The project already owns runtime-source precedence and explicit document
  inputs. It also owns the model overlay: own-domain model/document, own-domain
  base, SYSTEM model, SYSTEM base. Cart 0 and cart 1 remain distinct even when
  their paths match. SYSTEM model edits are visible in cart projects unless
  that path is supplied by the cart. Runtime refresh cannot overwrite a retained
  model; removal releases that model's document override to the current base.
- Explicit `updateDocument(s)` remains a synchronous source-input boundary for
  existing parser/diagnostic consumers; it is not another text-model database.
  Changed model sources are read from the actual retained model. The existing
  immutable file facts and snapshot generation remain the semantic cache keys.
- Reset disposes project subscriptions. Behavior registration/source providers
  consume the project; they do not maintain a second model scan or push the
  active buffer merely to make its source visible.

Independent tests must cover models before/after project creation, hidden
dependency edits, Undo, source/model removal, registry replacement, SYSTEM/cart
shadowing, domain separation, disposal and retained warm queries. Real Studio
Source/Back, graph Undo, workspace restore and Hot Resume remain regression
gates. This alone does not make a source projection depend on every imported
file; that later query dependency must still be explicit.

## Evidence

- The isolated project tests cover 14 cases; nine new ownership cases fail on
  the starting implementation. The model-service lifetime test also checks that
  removal listeners cannot still obtain the removed model. A source-query test
  follows an unchanged import into a hidden edited dependency and preserves the
  old snapshot's answer. Content callbacks read no new source, and two queued
  edits read/bind only their final text.
- Full Lua suite: 1,518 passed, one existing skip, no failures. IDE typecheck
  passes; the tests project has exactly its 51 baseline diagnostics. Architecture,
  core-parity and indentation audits pass.
- One existing storage test wrote the base-source cache while keeping an open
  model unchanged, then expected the cache text to replace that model in semantic
  queries. It now checks both distinct owners: the registry cache stays isolated
  by slot, but changing the retained source requires an actual model edit. No
  clean-model or version fallback is added to make the old assertion pass.
- Actual full Studio workflows and Pietious Source/navigation pass on software,
  WebGL2 and WebGPU, including restore, Source/Back, graph Undo and Hot Resume.
- `profile_model_sync.ts` compares the real registration index, model service
  and project against `6b412f5ba`. Medians of three alternating isolated-process
  runs, each with 25 measured batches after warmup:

  | Retained models | Baseline warm lookup | Current warm lookup | Baseline / current edit + Undo + two queries |
  | ---: | ---: | ---: | ---: |
  | 1 | 0.016 µs | 0.009 µs | 0.127 / 0.117 ms |
  | 64 | 0.275 µs | 0.010 µs | 0.176 / 0.156 ms |
  | 256 | 1.331 µs | 0.010 µs | 0.258 / 0.214 ms |
  | 1,024 | 5.610 µs | 0.009 µs | 0.801 / 0.803 ms |

  Warm times divide 10,000 retained lookups per batch; they demonstrate removal
  of the per-query model scan, not a rendering/frame-rate claim. Edit + Undo
  includes two source parses/binds and registration-generation rebuilds; it
  remains dependent on workspace size. The roughly 266 ms cold generic call
  query from the preceding slice is a different measurement, not fixed here.

Artifacts: `/tmp/bmsx-model-sync/`. The first performance pair overlapped a
typecheck and is retained but excluded from the table (pairs 2–4).
