# Workbench navigation history (STUDIO-UX-A03)

## Reference and owner decision

VS Code stores an editor identity and an optional editor-pane selection in its
navigation stack. The selection belongs to the editor contribution, not to the
history service. Resource-backed editors can be reopened through their editor
registration; entries for non-reopenable inputs end with the input's lifetime.
See [selection contract](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/workbench/common/editor.ts#L270-L324)
and [navigation, opening and disposal](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/workbench/services/history/browser/historyService.ts#L1638-L1825).

BMSX already has resource-owned text models, retained editor inputs, reusable
panes, a resource-editor resolver and a single Back/Forward owner. That owner
must store concrete editor destinations, not reinterpret every destination as
`domain/path/row/column`. No second navigation stack belongs in Behavior Lens.

## Contract

- `EditorPanes` supplies the active pane to the existing navigation owner.
  A pane may capture an opaque, contribution-owned `EditorPaneSelection`.
  The selection compares locations; its concrete pane consumes the restore
  option during its single activation, after source refresh and before binding
  controls. History does not activate a pane a second time to restore its data.
  History never reads Lua, graph items, list ordinals or working-copy contents.
- Each navigation entry owns its selection lifetime. Eviction, branch pruning,
  reset and input disposal release its subscriptions. Back/Forward restore under
  capture suppression and release the consumed entry after activation.
- Text/resource inputs expose their registered resource-editor identity. A
  closed source tab is reopened through that registration, not through a stale
  input. Non-resource visual inputs are removed from history when disposed.
  Preview/pin and definition-level input identity remain A04, not an implicit
  implementation of those product choices here.
- Every explicit tab/source/picker navigation captures its departure location
  before changing the destination. In particular, choosing another definition
  in the same currently retained Behavior Lens input must not overwrite the
  departure bookmark. Ordinary cursor movement/panning is not a navigation jump.
- Text selections track UTF-16 positions through the text model's change events.
  Visual selections reuse their source-correspondence bookmarks, including FSM
  return evidence and BT occurrence ancestry. They never retain old graph items
  or a source-generation AST. A deleted occurrence becomes unselected, not the
  next ordinal or a same-named definition.
- Restoring a view does not edit source, acquire a runtime owner, apply undo
  state, reset a simulation or invoke Hot Resume. Source changes only remap
  bookmarks. Navigation history and undo history are different lifetimes.
- Viewport restoration is consumed by the presentation owner, including an
  asynchronously published FSM layout. It must not be overwritten by default
  initial positioning or selection reveal.
- `Go: Back` and `Go: Forward` are shared workbench commands. Alt+Left/Right
  use the same command admission from code, graphs, properties and lists,
  including committing a focused value draft. They are not gameplay bindings
  or a second pair of Behavior Lens commands.

## Retained code views must track external edits

The full Studio regression exposed an older model/view ownership error:
source edits made outside the code control left its retained cursor at removed
lines. The former history implementation clamped these invalid positions and
hid the cause. Removing that clamp correctly exposed the error in the existing
table-transfer workflow. Wrapped visual scroll rows also are not buffer lines.

`EditorTextModel` now publishes one old-buffer boundary per atomic edit.
`CodeEditorViewBinding`, owned by the retained code-input manager, converts its
cursor/anchor to offsets there and maps them through the final application-order
changes. An explicit code-owned edit/Undo/Redo result still takes precedence.
Foreign edit state is not cast to a cursor snapshot. The model itself knows
neither code views nor graph selections; visual scroll is left to layout.

This adapts the separation in
[VS Code's model-change cursor handling](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/editor/common/cursor/cursor.ts#L207-L249)
and the position/selection affinity rules in
[CodeMirror ChangeDesc](https://github.com/codemirror/state/blob/9c801279cb83011e6f92af778f4443406e8f1200/src/change.ts#L105-L144),
[SelectionRange](https://github.com/codemirror/state/blob/9c801279cb83011e6f92af778f4443406e8f1200/src/selection.ts#L64-L79).
The BMSX adaptation uses its existing PieceTree and change-event representation,
not another text store or per-frame cursor repair.

## Cost and lifetime

Both stacks retain at most 64 entries. Capturing a navigation allocates its
entry and contribution-owned coordinates, not a document copy, graph, parser
result or machine snapshot. Text changes map only subscribed retained locations;
ordinary stationary frames do no history capture or remapping. The code-view
binding retains its scratch position. Duplicate capture, eviction, branch
pruning, consumed entries, input replacement and shutdown release subscriptions.
These are bounded-work/lifetime properties, not an end-to-end latency claim.

## Validation gate

Independent source fixtures and real Studio input exercise diagram → Source →
definition → Back → Back → Forward, including prefix edits, deleted occurrences,
multiple definitions in one document, viewport restoration and shared-model
dirty/version checks. The same history must cover Scene and Scenario sources.
Check branch pruning, the bounded stack, closed source reopening and disposed
visual inputs separately. Browser evidence must cover software, WebGL2 and
WebGPU without restricting the test to one backend. This slice changes IDE
owners only; there is no machine/guest ABI or TS/C++ runtime representation edit.

### Reproduce

```sh
npx tsx --tsconfig tsconfig.base.json --test --import ./tests/lua/test_setup.ts \
  tests/lua/navigation_history.test.ts tests/lua/code_editor_view_binding.test.ts \
  tests/lua/text_change.test.ts tests/lua/behavior_source_bookmark.test.ts \
  tests/lua/state_machine_selection.test.ts tests/lua/scenario_lab_view.test.ts
npm run test:lua
npx tsc -p ide/tsconfig.json --noEmit
npm run build:product:browser-studio -- --debug --force
BMSX_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
  node tests/conformance/runtime_replay/browser.mjs --studio \
  dist/bmsx-bios.debug.rom dist/nemesis_s.debug.rom /tmp/studio-a03.png
npm run audit:architecture-boundaries:strict
npm run audit:core-parity
git diff --check
```

The independent `tests/fixtures/studio/navigation.ts` document supplies two
FSM registrations sharing two equal return expressions, two BT registrations
sharing leaf occurrences, an ActionEffect and a Scene. The browser test goes
through actual keyboard, palette, toolbar, focus, editor panes and the FSM
worker. The installed cart is workspace/boot transport, not the source oracle.
Scenario source navigation uses the actual catalog identity without running a
test or assuming a particular scenario name. Separate projection tests cover
result-log eviction and collapsed-run restoration.
