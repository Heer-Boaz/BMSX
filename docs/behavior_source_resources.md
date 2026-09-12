# Behavior source locations own their resource

2026-09-12; live baseline `bbcb4eb91`. Follow-up to B04. This is the
resource/range part, not permission to feed unresolved foreign syntax into the
existing local recognizer or to close B03/B06.

## Reference and live boundary

- [VS Code FileReferences/FilePreview](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/editor/contrib/gotoSymbol/browser/referencesModel.ts): a location is a resource plus range; previews read that resource's model. Model references belong to the result lifetime.
- [VS Code DecorationsManager](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/editor/contrib/gotoSymbol/browser/peek/referencesWidget.ts): decorations are installed and mapped only in their owning model, not whichever editor is active.
- [Roslyn ValueTrackedItem](https://github.com/dotnet/roslyn/blob/0c14b7cb5e382318c4322e29e045f48b11c641ca/src/Features/Core/Portable/ValueTracking/ValueTrackedItem.cs): source text, document identity and span travel together; symbol/value identity does not replace source identity.
- [Roslyn DocumentState](https://github.com/dotnet/roslyn/blob/0c14b7cb5e382318c4322e29e045f48b11c641ca/src/Workspaces/Core/Portable/Workspace/Solution/DocumentState.cs): content/tree versions identify retained inputs independently of the complete semantic model. BMSX uses owner-produced, process-local revision identities, not serialized compiler objects or source-text comparisons.

The live Lens already navigates with `LuaSourceRange.path`, but its source index,
bookmarks, FSM proof markers and inspection excerpts all accept one unrelated
`TextBuffer`. Equal offsets in two files can therefore collide. Navigation
bookmarks and popup lifetimes observe only the registration's working copy.
Those contracts must change before broader origin recognition is connected.

## Contract

- `EditorTextModelService` remains the resource-keyed working-copy owner. No
  shadow text store and no model or editor tab constructed by a language query.
- The retained source index resolves each referenced path once through the
  contribution's workspace context, groups mapped ranges by the actual model,
  and releases tracking/subscriptions on its final lease. It does not dispose
  shared or dirty working copies.
- Tracked locations retain `ResourceIdentity` beside their half-open UTF-16
  offsets. Equality, correspondence, edit mapping, Undo selection and live
  navigation compare that identity, not just offsets or a file basename.
- Lua line/column conversion and text previews select the owner model from the
  source range. A callback's binding and body may use different models. The
  existing text-change mapper still owns coordinate movement.
- Source documents retain lightweight binder-file revisions used to build their topology, not full binder lookup tables. The semantic producer assigns the revision; the Lens never invents a parallel version counter. The cache records a workspace revision rather than pinning an entire old workspace snapshot for every hidden input.
  With [written-source recognition](behavior_written_sources.md), a new workspace
  snapshot invalidates the document: checking only previously found providers
  misses negative lookups and writers elsewhere. The retained file list names
  displayed source owners, not a complete query-dependency certificate.
- This read-many contract does not silently broaden a source edit into a
  workspace edit. Existing graph authoring remains a primary-document operation
  until the operation-specific B03/B06 contract supplies its write target.

## Proof required

Independent two-resource fixtures: deliberately different UTF-16 prefixes,
equal offsets in different files, binding/body split, provider-only edits and
Undo, hidden inputs, navigation copies and released generations. Reads must not
dirty either working copy. Ordinary Source/Back and all three browser renderers
remain regression gates, not proof that the multi-file recognizer is complete.

Review neighbouring popup invalidation and edit admission as part of the slice;
do not preserve their one-buffer assumption merely because existing tests pass.

## Review corrections

- Restoring FSM evidence from Back previously shared its mutable markers with
  the navigation entry. A subsequent edit could move them twice, or continue
  changing a disposed history entry. Restore now copies coordinate values at
  the history-to-selection boundary; ordinary live reconciliation retains its
  own markers. The browser proof includes Back, another edit, Source and Undo.
- Reusing unchanged binder syntax after delete-all/Undo could also reuse an
  index whose mapped markers had collapsed. Model edits invalidate that lease;
  another acquisition builds fresh ranges. Releasing an older hidden lease
  cannot delete the replacement's cache entry.
- Context menus, detail popups and navigation observe all contributing models.
  Prepared BT/FSM gestures retain the source-index generation. Their existing
  single-document edits are not silently permitted to write foreign ranges.
- Source mementos fingerprint the primary and dependency models. Equal primary
  bytes do not authenticate provider positions. The serialized format changes;
  no old-session compatibility reader or automatic storage deletion is added.
- The first implementation retained entire `FileSemanticData` objects and a
  complete workspace snapshot per cached document. Paired profiling exposed
  unnecessary retention. Only small producer-generated revision identities
  remain. Resource correspondence also stopped encoding a new domain/path
  string for each node: the workspace path index selects candidates and the
  full resource/range comparison proves correspondence.

## Measurements and proof boundaries

Four alternating isolated process pairs against `bbcb4eb91`, Node 22.23.1,
Core Ultra 7 265KF/WSL, unpinned. These are targeted median costs, not complete
Studio-frame budgets. No test/build/browser job ran alongside these profiles.

| Measured boundary | Baseline | Current |
| --- | ---: | ---: |
| 32 BT children, one view, model edit + Undo | 0.926 µs | 0.923 µs |
| 1,024 children, one view, model edit + Undo | 6.836 µs | 7.293 µs |
| 1,024 children, 16 shared views, model edit + Undo | 6.824 µs | 7.615 µs |
| FSM input reconciliation, 24 sibling scopes | 0.054 ms | 0.069 ms |
| FSM input reconciliation, 1,024 sibling scopes | 1.304 ms | 1.548 ms |
| Selected return bookmark resolution, 1,024 siblings | 12.796 µs | 14.766 µs |
| ActionEffect 4,096 requirements, cold property projection | 1.693 ms | 1.660 ms |
| Same property view, retained update | 0.035 µs | 0.035 µs |
| 128 working copies / 384 inputs, unchanged session capture | 0.263 ms | 0.291 ms |
| Same session, capture + envelope JSON | 0.440 ms | 0.526 ms |
| Same session, retained heap | 8,323,728 bytes | 8,929,856 bytes |
| Same session, serialized characters | 173,789 | 214,309 |

The rejected intermediate implementation retained about 15 MB in that session
probe and took about 2.9 ms for the large FSM reconciliation. The ownership
correction removes that avoidable cost. Resource-qualified coordinates and
subscriptions still have measurable costs versus the old one-buffer contract;
this is not a zero-overhead claim. Large-session serialization remains more
expensive and includes the additional resource-qualified bookmark data.

Independent tests join real parsed bindings and foreign callback bodies at the
projection boundary. They cover UTF-16/CRLF differences, provider-only edits,
Undo, same offsets across resources/domains, non-mutating inspection,
navigation-copy lifetime and dependency fingerprints. They do **not** prove
that the current local recognizer discovers imported definitions. The generic
semantic tests separately cover producer revision reuse and workspace reset.

Artifacts: `/tmp/bmsx-source-resources/`; `paired/` preserves the rejected
intermediate profile, `refined/` the retention correction, `final-paired/` the
validated source. The existing Scene/Problems capture defect remains recorded
in the UX review rather than being disguised as newly correct rendering.

Final validation: 1,641 Lua tests pass, one existing skip, no failures. Toolchain
and IDE TypeScript pass. Tests TypeScript retains exactly the 51 baseline
diagnostic blocks, normalizing source locations only; it is not a clean
typecheck. Strict architecture boundaries, core parity, indentation and
`git diff --check` pass. A fresh Studio build passes actual Studio workflows
and Pietious Source/navigation on software, WebGL2 and WebGPU, including the
new Back/edit/Source/Undo regression. All six end captures match the preceding
committed slice byte-for-byte and were reviewed. This changes tooling only;
there is no guest/runtime representation or C++ edit in this slice.
