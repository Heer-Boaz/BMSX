# Definition inputs and preview lifetime (STUDIO-UX-A04)

## Owners and production references

Lua remains the authored document. An `EditorTextModel` owns its text, dirty
state and undo history; an editor input owns one view of that document. A
Behavior Lens input addresses one **registration occurrence**, not its file,
runtime id, label, or ordinal. The existing tracked registration-call range
provides source correspondence through edits. Closing a view disposes its
layout work and navigation subscriptions, not the shared working copy.

Reference: VS Code at `7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca`:
- [EditorGroupModel](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/workbench/common/editor/editorGroupModel.ts):
  input matching, a single preview slot, promotion rather than repurposing an input.
- [EditorGroupView](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/workbench/browser/parts/editor/editorGroupView.ts):
  detach/focus ownership and promotion on working-copy dirty changes.
- [MultiEditorTabsControl](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/workbench/browser/parts/editor/multiEditorTabsControl.ts):
  double-click keeps a preview open; duplicate names get source descriptions;
  non-wrapping horizontal scrolling, vertical-wheel translation, explicit active
  reveal and drop feedback are separate from group membership.
- [SearchEditorInput](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/workbench/contrib/searchEditor/browser/searchEditorInput.ts):
  a view's input identity need not be its backing resource identity.
- [HistoryService](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/workbench/services/history/browser/historyService.ts):
  disposed editor lifetimes cannot remain navigation destinations. Preview
  replacement also retires a departure entry captured before that replacement.
- [OutlineModelService](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/editor/contrib/documentSymbols/browser/outlineModel.ts):
  shared source-derived structure is cached by text model and generation, not
  independently parsed for every view. BMSX keeps its own generic Lua producer.

## Contract

- Open keeps a definition. Opening another registration retains the first input,
  selection and viewport. Opening the same surviving occurrence activates it.
  The input id is a workbench lifetime id, never a guest or persistent asset id.
- Preview is an explicit opener option. The group replaces only its previous
  clean preview, after its pane has detached. Kept inputs never become previews
  merely because an opener requests preview. Dirty inputs are always kept.
- `Editor: Keep Open`, double-clicking its tab, dragging its tab, or editing its
  shared working copy promotes the preview. This is not sticky-tab pinning.
  Bitmap tabs show `PREVIEW` explicitly; no alternate font or shortcut is needed.
- Titles name the selected definition. The group adds descriptions only for
  duplicate titles; descriptions identify source domain/path/registration line.
  Scene views retain their file-level scope and use source disambiguation too.
- Source topology and FSM indices are shared immutable document generations.
  `BehaviorSourceDocuments` caches by model/version; the shared source index
  retains node/parent/occurrence maps per document generation and consumes each
  model content event once. Each view retains its own mapped selection and
  presentation. Source edits and Undo never retarget sibling inputs to the
  edited definition. Weak-key generations do not subscribe to model lifetimes.
- Renaming an id or inserting source before a registration preserves its view.
  Deleting/replacing the complete registration clears that view's target; a
  same-named insertion is not the deleted occurrence. No compatibility reader,
  positional fallback, executable graph or second model is introduced.
- Source/Back/Forward preserves the concrete input and contribution selection.
  Cross-registration source-review links must not mutate an input's identity.

## Bounded tab strip

The full Studio regression exposed a prerequisite: retaining individual
definitions multiplied tabs, and the old unlimited wrapped tab rows consumed
the entire viewport, including the Problems resize target. Closing tabs in the
test would hide the missing chrome contract rather than fix it.

The workbench now gives the tab strip one clipped row and a horizontal track
only when content overflows. The existing `Scrollbar` owns range, position,
thumb geometry and minimal interval reveal. Its geometry revision invalidates
captured thumb gestures, not stationary frames. Wheel over tabs moves that
axis, never the active document. Active-tab reveal follows group or geometry
changes; it does not undo manual scrolling every frame. Font, viewport width
and label changes invalidate the measured label cache. Hidden tabs retain hit
geometry but emit no glyphs; input disposal releases their geometry entries.

`WorkbenchScrollbarControl` owns the physical thumb gesture without changing
editor focus. The tab-drag owner uses the same pointer-capture service as pane
controls: insertion feedback is not a group mutation, an accepted physical
release moves the tab, and Escape, lost input, a blocking surface or a changed
group ends the gesture without rollback. Graph and tab drags share the existing
host-time edge-scroll primitive. Tabs do not add an independent input loop,
keyboard shortcut or selection history.

No runtime, cartlib or TS/C++ hardware changes. Session serialization is A07;
this slice does not promise to restore visual inputs across a browser restart.

## Evidence required

Independent same-file FSM/BT/ActionEffect fixtures; duplicate ids and names;
mapped edits and deletion; shared undo isolation; open/preview/keep/dirty/close
lifetimes; source/back/forward. Exercise the actual tiny-font Studio on software,
WebGL2 and WebGPU, not just model tests. Measure shared generation reuse and
retain labels outside the frame hot path.

Also prove bounded height at both bitmap fonts and 256/384px widths, reveal
versus manual wheel scrolling, thumb capture, tab-drop cancellation, disposal,
stable measurement and visible-only painting. The actual Studio regression
must retain enough tabs to overflow and still resize Problems and Scene
details. Its fixture reaches offscreen tabs through real pointer wheel input,
not a direct activation shortcut or an out-of-bounds click.

### Reproduce and results

```sh
npx tsx --tsconfig tsconfig.base.json --test --import ./tests/lua/test_setup.ts \
  tests/lua/editor_group_preview.test.ts tests/lua/editor_tabs.test.ts \
  tests/lua/workbench_scrollbar.test.ts tests/lua/behavior_registration_index.test.ts \
  tests/lua/behavior_source_bookmark.test.ts tests/lua/state_machine_edit.test.ts
npm run test:lua
npx tsc -p ide/tsconfig.json --noEmit
npm run build:product:browser-studio -- --debug --force
BMSX_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
  node tests/conformance/runtime_replay/browser.mjs --studio \
  dist/bmsx-bios.debug.rom dist/nemesis_s.debug.rom /tmp/studio-a04.png
npm run audit:architecture-boundaries:strict
npm run audit:core-parity
git diff --check
```

The actual three-renderer Studio suite passes, including its existing
Save/Hot Resume/Reboot/scenario flows. `studio_definition_inputs.ts` uses the
independent `tests/fixtures/studio/navigation.ts` source through ordinary
workspace Save, not a game-definition assertion or replacement VM. A04 source
edits, tab gestures and navigation leave paused machine cycles and installed
media unchanged. The suite's existing tests still include deliberate compiler
and guest faults and sourcefetch 404s; this is not a zero-console-messages claim.

Full Lua suite: 1285 passed, 1 existing skip. IDE typecheck/build, strict
boundaries (0 issues), core parity and diff checking pass. The broad tests
typecheck retains the same 51 pre-existing diagnostics as A03, compared without
line-number shifts. Local evidence is under `/tmp/bmsx-a04/`.

Shared-cache tests issue 1000 same-generation requests and map one content event
through ten consumers without multiplying its offset change. Tab tests at both
fonts and 256/384px widths retain geometry and label measurements across 100
stationary frames and paint only visible tabs. These bound specific work and
lifetime costs; they do not establish end-to-end Studio or SNES Mini latency.
