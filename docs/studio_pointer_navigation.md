# Pointer gesture ownership during source navigation

## Failure and live owners

A held Behavior Lens double-click initially opens the correct source range,
then later frames move the cursor elsewhere. The existing headless lens test
checks immediately after activation; extending the hold by four frames fails
on the unchanged product: expected `144:5`, observed `111:12`.

The host `PointerInput` already publishes event-latched `justpressed` and
`justreleased` flags once per host poll. The IDE instead reconstructs primary
edges from a second `pointerPrimaryWasPressed` value. Individual views update
that value, and code activation/source selection clears it. The remaining
physical hold therefore becomes a new press in the destination. That press
can start a selection, explaining both wrong cursor positions and spurious
selected text. Secondary/auxiliary handling has the same duplicate ownership.

## Contract before implementation

- `hosts/common/input/pointer.ts` remains the sole producer of physical button
  levels and edges. Its current-frame consumption belongs to input routing,
  not a new press/release history.
- `ide/input/pointer/buttons.ts` projects those edges into the existing
  workbench dispatch mask. It does not infer edges from view-local booleans.
  Held buttons, consumed frames, editor activation and source navigation cannot
  synthesize a press. A release/press within one poll remains visible.
- The IDE retains actual gestures: code selection, click count, tab drag,
  scrollbar drag and property-field selection. Cancelling a gesture never
  modifies physical input. All former button-history writes are removed, not
  relocated behind another state object or repaired at individual links.
- Code selection is ended by release, source selection and editor/input
  changes. Destination ranges still come directly from semantic or lens source
  owners. No corrected offsets, delayed cursor writes, repeated navigation,
  behavior-specific checks or timeout-based click suppression are introduced.
- This is host/workbench input work. Machine input registers, guest values,
  cartridge code, compiler semantics and C++ do not change.

## Production references

VS Code's [mouse handler](https://github.com/microsoft/vscode/blob/4603a7f7b9102fb602967c9518ac60acddd735a6/src/vs/editor/browser/controller/mouseHandler.ts#L303-L347)
starts a selection gesture from an actual down event; its
[MouseDownOperation](https://github.com/microsoft/vscode/blob/4603a7f7b9102fb602967c9518ac60acddd735a6/src/vs/editor/browser/controller/mouseHandler.ts#L442-L525)
owns continuation and cancellation separately. Its
[ClickLinkGesture](https://github.com/microsoft/vscode/blob/4603a7f7b9102fb602967c9518ac60acddd735a6/src/vs/editor/contrib/gotoSymbol/browser/link/clickLinkGesture.ts#L165-L208)
tracks the originating gesture and resets link state on model/selection changes
rather than manufacturing input. BMSX consumes its existing polled event
representation instead of copying DOM listeners or changing every command to
mouse-up to conceal the duplicated edge state.

## Required evidence

Prove canonical definition/source ranges separately from physical navigation.
Hold the activating pointer across several host frames, test the next real
click/drag, and compare keyboard, Ctrl-click, context menu and lens links.
Include the actual Nemesis `fire_salvo_effect_id`/`sneeuwpop` and Pietious
`move_out_backward` sources. Existing menus, pickers, pane switching, drag
cancellation and Studio execution/source workflows must still pass.

## Validation

The source owners already resolve these reported examples correctly; the fix
does not alter their ranges. One-based positions in the current cart sources:

| Navigation | Expected destination |
| --- | --- |
| `fire_salvo_effect_id` definition | `player/actioneffects.lua:7:7` |
| `sneeuwpop_fsm` / `update = sneeuwpop.update_idle` Source | `enemies/sneeuwpop.lua:76:5` |
| selected `move_out_backward` BT occurrence Source | `boss/world1_daemon_tree.lua:190:14` |
| `move_out_backward` definition | `boss/world1_daemon_tree.lua:21:8` |

Lens Source reveals the authored field/reference; Go to Definition follows the
binding to its declaration. Reused BT nodes can have several authored
occurrences, so a source link must preserve the selected occurrence.

- The existing headless lens regression now holds the activating double-click
  for four additional frames: 61 assertions pass; the same hold fails on
  parent `7d3a0af06` as described above.
- `studio_pointer_navigation.ts` independently checks semantic and lens ranges,
  then uses the real palette, Ctrl-click, context menu and lens double-click.
  Held activation is observed for six frames and a subsequent new drag must
  still work. Source bytes, paused machine cycles and installed media remain
  unchanged. Both carts pass on software, WebGL2 and WebGPU; screenshots were
  inspected for the final source positions and absence of spurious selection.
- The complete existing `browser.mjs --studio` workflow also passes on all
  three backends, beyond the bounded navigation reproduction.
- `editor_pointer_edges.test.ts` uses the real host pointer/player producers:
  primary/secondary/aux holds, consumption, gesture cancellation, a complete
  click between polls and release/repress edges. No fabricated button-history
  object stands in for the input owner.
- Browser Studio and node headless tooling debug builds, IDE typecheck,
  architecture-boundary audit, core-parity audit and indentation check pass.
  Lua tests: 973 pass, one existing skip. Rompacker tests: 122 pass. The tests
  project still has the same 52 pre-existing type diagnostics; none are added
  by this slice.

The per-frame mask reads retained producer states and uses integer bit
operations. The three duplicate history fields and their view-specific writers
are gone. No new allocation, semantic query, timer or deferred retry is added
to pointer dispatch. The now-empty code-area guard forwarding layer is removed;
dispatch calls the actual runtime-error overlay input owner directly.

The bounded browser reproduction shares the existing Studio renderer/host
fixture rather than creating a different input or navigation implementation:

```sh
node tests/conformance/runtime_replay/browser.mjs --studio-navigation nemesis_s \
  dist/bmsx-bios.debug.rom dist/nemesis_s.debug.rom
node tests/conformance/runtime_replay/browser.mjs --studio-navigation pietious \
  dist/bmsx-bios.debug.rom dist/pietious.debug.rom
```

## Deferred test ownership follow-up

The real-cart regressions below reproduce the reported failures, but fixed
Nemesis/Pietious paths, line numbers and behavior definitions are not a durable
Studio test contract. Revisit the generic Studio fixture ownership separately:
stable, deliberately maintained source fixtures should prove navigation and
gesture semantics, while real-cart runs remain integration smoke tests. Do not
couple routine game authoring to frozen editor-test source positions. This is
an explicit follow-up, not additional scope for the input-owner fix.
