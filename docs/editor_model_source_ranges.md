# Model-owned source ranges

Starting at `8d7bd6f95`. This is a B04 ownership/lifetime slice; it does not claim
that the behavior recognizer already follows imports or proves callee identity.

## References and contract before implementation

[VS Code TextModel](https://github.com/microsoft/vscode/blob/0ac867d1f00150db3a91c10edc1295eccd75c16d/src/vs/editor/common/model/textModel.ts#L1503-L1528)
updates tracked decorations before notifying content observers. Its
[decoration collections](https://github.com/microsoft/vscode/blob/0ac867d1f00150db3a91c10edc1295eccd75c16d/src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts#L2428-L2508)
own explicit removal, and its
[reference collection](https://github.com/microsoft/vscode/blob/0ac867d1f00150db3a91c10edc1295eccd75c16d/src/vs/base/common/lifecycle.ts#L682-L713)
destroys shared resources when the last reference is released. No disposal
fallbacks, single-call guards or additional string-encoded identities are copied.

Live gap: each behavior view forwards a content event to a shared source index,
which uses a version guard to avoid mapping it again for the next view. Source
positions therefore depend on feature notification order. The index also takes
an arbitrary buffer rather than retaining its actual model owner.

- `EditorTextModel` owns the live tracking of registered source-range sets.
  It maps them once, before ordinary content observers, through the existing
  UTF-16, application-order `mapTrackedTextRange` implementation. No second
  position mapper, AST/token index or source decoder is introduced.
- A behavior source index is acquired for a document generation and its actual
  text model. Views share the index, not an idempotence/version workaround.
  The index's last release removes both the model tracking registration and
  the cache entry. No old generation is retained merely because the model stays
  open. A replacement generation is acquired before releasing the previous one.
- The retained behavior input owns the lease, including when its pane is hidden.
  Closing the input releases it; reattaching a pane does not discard it. View
  callbacks still map their own selection/bookmark values and process edit-state
  restoration, but they no longer map the shared source index.
- Undo records remain immutable values. They are not live range registrations.
  Removing source still collapses its old marker; Undo does not turn an obsolete
  marker into proof that newly inserted source is the old occurrence.
- This adopts the model/collection lifetime pattern, not VS Code's complete
  decoration renderer or interval tree. The existing source-range mapping is
  linear in retained ranges per content edit, with no per-frame work. Measure
  ordinary typing with no ranges and many shared/retired diagram generations;
  do not claim asymptotic improvement or add an unneeded renderer abstraction.

Tests must exercise notification order, multiple views, multiple models,
edit/Undo/Redo/revert, complete source replacement, hidden generations, closing
one of several views and last-release cleanup. Actual Studio Source/Back and
graph edits on all renderers remain regression gates. Resource-owned multi-file
source origins and B03/B06 authoring are still separate open work.

## Evidence

- Eight independent model/index tests pass. The notification-order test fails
  against `8d7bd6f95`: a content observer still reads offset 63 instead of 72.
  The corrected model publishes the already mapped source before that observer.
- Two hidden/visible inputs share one range set. Twenty replacement generations
  retain only the current and the still-hidden generation; refreshing the hidden
  input reduces this to one. Closing the first input preserves tracking; closing
  the last reduces it to zero and removes the cache entry. Reopening acquires a
  new index rather than a detached/stale one.
- Full Lua suite: 1,526 passed, one existing skip, no failures. IDE typecheck
  passes; tests retain their exact 51 baseline diagnostics. Architecture/parity/
  indentation audits pass. Full Studio workflows and Pietious navigation pass
  on software, WebGL2 and WebGPU, including Source/Back, graph Undo and restore.
- Four alternating isolated-process comparisons against `8d7bd6f95`, using
  `profile_model_ranges.ts`. Each sample contains 100 edit + Undo cycles; table
  entries are microseconds per cycle, including PieceTree, history, model events
  and all view notifications, excluding parsing/layout/rendering/guest work:

  | Children / retained views | Baseline median | Current median |
  | --- | ---: | ---: |
  | 0 / 0 | 1.701 µs | 1.648 µs |
  | 32 / 1 | 1.091 µs | 1.007 µs |
  | 32 / 16 | 0.662 µs | 0.910 µs |
  | 1,024 / 1 | 7.249 µs | 6.652 µs |
  | 1,024 / 16 | 7.744 µs | 6.778 µs |

  These are narrow host microbenchmarks, not a universal speedup or heap/GC
  certification. In particular the small 16-view case is slower in this run;
  JIT state differs between cases, so its absolute time is not a scaling claim.
  Mapping remains linear in live ranges per edit, but not multiplied by views
  of the same generation. No range work runs on unchanged Studio frames.

Artifacts: `/tmp/bmsx-model-ranges/`, including the independent red baseline,
four profile pairs and actual browser conformance logs/screenshots.
