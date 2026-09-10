# Graph navigation

## Owners and production references

This is host workbench input and presentation, not a guest/runtime feature.
Lua remains canonical. Panning, scrolling and selection do not edit a text model,
create history or change a machine clock. BT and FSM contributions supply a
complete retained diagram; the shared graph control owns physical navigation.

References studied before implementation:

- Godot [`ViewPanner`](https://github.com/godotengine/godot/blob/4cefd60f5a3d733506cb557d6cd26263b3fbd17f/scene/gui/view_panner.cpp):
  middle-button drag and Space + primary drag, separate from node interaction;
  Shift swaps wheel axes. BMSX latches the pan intent and initiating button at
  press, rather than changing a source-edit gesture when Space changes mid-drag.
- Godot [`GraphEdit::_update_scrollbars`](https://github.com/godotengine/godot/blob/4cefd60f5a3d733506cb557d6cd26263b3fbd17f/scene/gui/graph_edit.cpp):
  graph extents plus a viewport margin, bounded scroll offsets, independent
  axes and non-overlapping scrollbar gutters. BMSX includes routed edges and
  labels in the extents, not just node rectangles.
- Godot [`Range`](https://github.com/godotengine/godot/blob/4cefd60f5a3d733506cb557d6cd26263b3fbd17f/scene/gui/range.cpp):
  a scrollbar stores its actual clamped value between minimum and maximum/page.
  GraphEdit supplies signed graph coordinates; code/resource scrolling starts
  at zero. Conversion to thumb travel belongs to the scrollbar, not per-item
  renderer reads. There is no second graph-position cache to synchronize.
- VS Code [`ScrollbarState`](https://github.com/microsoft/vscode/blob/8a344c1efe17c6d7b5ce0c53d26459ac72b2e5e0/src/vs/base/browser/ui/scrollbar/scrollbarState.ts):
  cached thumb geometry derived from viewport, content and position; minimum
  grabbable size and a single mapping between thumb travel and content travel.
  No DOM adapter, defensive fallback or second graph-local thumb formula is
  needed in BMSX.
- W3C [Pointer Events: chorded buttons](https://www.w3.org/TR/pointerevents3/#chorded-button-interactions):
  additional button edges can arrive as `pointermove`. The browser boundary
  consumes `button`/`buttons` there; the IDE never reconstructs missing edges.

## Contract

- BT diagrams show all statically recognized children. There is no Children
  command, card expander, fold shortcut or gamepad fold action. Source outline
  and property-tree folding remain separate controls. Dynamic/recursive Lua
  retains its source diagnostic, not fabricated children.
- Tiny font and measured card sizes stay unchanged. Large graphs scroll; they
  do not shrink to fit. Nodes, routes, labels and overall bounds are published
  together in one immutable geometry generation.
- The viewport owns two scrollbars and one scroll position. Its inner clip
  excludes both gutters. Scroll limits include the graph and one viewport of
  surrounding space, so negative coordinates and centering small graphs work.
- Middle-button drag and Space + primary drag pan over nodes, edges and blank
  canvas without changing selection. Primary drag on blank canvas also pans.
  Ordinary primary input continues to select/drag nodes or connection grips;
  secondary input is not commandeered for panning.
- The pointer producer projects held, press and release masks for all three
  buttons once. Capture stores the initiating button. Another button's release
  never finishes that gesture. Lost/consumed input, focus/pane changes, modal
  input, Escape and replacement geometry cancel; none authorizes a source drop.
  Browser pointer cancellation resets that logical device without manufacturing
  release edges or resetting a held keyboard key. An implicit capture loss after
  an already completed physical release has no remaining gesture to cancel.
- Pan intent is chosen at press, not inferred anew on each motion. Space is
  only read inside the diagram's pointer route; no gameplay shortcut is added.
- Wheel scrolls vertically; Shift + wheel horizontally. Thumb/track input,
  pointer panning, wheel, keyboard reveal and source-drag edge scrolling all use
  the viewport's clamped position and synchronized thumb geometry.
- Shared scrollbar geometry has no code-editor kind. Code/resource routing
  remains in the editor scrollbar controller; graph gestures use the existing
  shared pointer capture, not a second feature-specific drag dispatcher.
  Only an attached pane can hit its scrollbar kinds; chrome owns only the
  visible resource panel's bars. Retained geometry of a hidden code editor must
  not intercept a graph thumb. The application callback is retained at the
  editor owner's initialization, not allocated on every drag frame.

## Input ownership and external cancellation

`BrowserInputHub` owns DOM button conversion, press IDs, chord edges and native
capture loss. `Input.resetInput(deviceId)` cancels that connected logical device;
the no-argument path still resets the host's complete input. The IDE snapshot
projects the resulting held/press/release masks once and its capture service
latches a `PointerButton`, rather than assuming every gesture uses primary.
No ICU, replay/save-state representation, machine or C++ runtime ABI changes.

The actual Chromium probe observed `lostpointercapture` in some multi-button
sequences after releasing the non-initiating button. Native capture loss is a
real interruption and cancels the gesture; the product does not recapture it.
The probe records whether that external event occurred. Separate capture tests
prove that a non-initiating release **without** external loss does not cancel
or drop. An actual admitted connection preview followed by native capture loss
must produce zero source drops.

## Cost and proof gates

Overall bounds are computed once when geometry is published, never by scanning
nodes during pan, resize or paint. Viewport range/thumb updates are constant
work with retained rectangles. Unchanged layout/position does not rebuild the
graph or remeasure text. No per-motion closures or geometry arrays.

Tests must cover physical initiating-button lifetime, pan over editable items,
selection/source/history invariance, both scrollbars including release outside
the graph, padded negative bounds, reveal and bounded auto-scroll. Independent
Lua fixtures must show full BT membership at open and after source undo/redo.
Actual Studio and shared graph browser probes run on software, WebGL2 and
WebGPU; a typecheck alone does not prove these flows.

## Validation and measured boundary

The navigation slice is based on `e7523b52c`; the earlier FSM-retarget feature
remains a separate commit. Commands and independent fixture entry points are
documented in [`graph_viewport/README.md`](../tests/conformance/graph_viewport/README.md)
and [`behavior_graph/README.md`](../tests/conformance/behavior_graph/README.md).

- IDE typecheck, browser Studio and Node headless product builds pass; strict
  architecture-boundary, core-parity, indentation and diff checks pass.
- Full Lua suite: 1,236 passed, one pre-existing skip. The tests TypeScript
  project still has its 51 existing diagnostics, with 51 on the baseline and
  no new diagnostic. This is not a claim that the tests project typechecks cleanly.
- Shared graph fixture: actual DOM navigation/cancellation, six pixel-crop
  oracles, worker lifetime/fault gates, compound layout, connection control and
  target resize pass on software, WebGL2 and WebGPU.
- Actual Studio: BT navigation, full authoring/source/history workflows,
  pause/rewind/Hot Resume and Scenario Lab pass on all three backends. The
  separate FSM-retarget run tests navigation with the overflowing source editor
  hidden, then the actual shared-source review and live Save/Hot Resume.
- Pietious source/navigation/autosave regression passes on all three backends;
  current cart definitions are integration smoke, not the new unit contracts.
  The real headless Behavior Lens run passes 60 assertions.
- Actual tiny-font BT and FSM canvas captures were inspected. The final FSM
  workflow screenshot shows its source-review panel, so a separate test-only
  capture at the navigation checkpoint verifies the graph itself.

The bundled Node profile entry points ran without concurrent builds/browser
tests on Node 22.23.1. Values
below are medians across three fresh processes; each new navigation measurement
uses ten warmup batches and 25 samples. Captured input batches contain 1,000
operations. Very small costs are timer/JIT-sensitive, not absolute latency promises.

| Retained graph | Publication, ms | Moving pan, µs/op | Thumb drag, µs/op | Resize, µs/op | Draw + quad emission, µs/frame |
| --- | ---: | ---: | ---: | ---: | ---: |
| 32 nodes / 31 routes | 0.0057 | 0.046 | 0.038 | 0.046 | 7.52 |
| 1,024 nodes / 1,023 routes | 0.0069 | 0.028 | 0.026 | 0.042 | 18.38 |

Pan and thumb motion perform **zero hit scans and zero font measurements** in
the probe. Model, selection, viewport/track/thumb rectangles and quad backing
storage remain retained. Bounds/layer publication still traverses the model;
draw still visits retained geometry to cull offscreen cards/routes. The existing
pointer snapshot/mapping allocation is not removed by this slice. These probes
exclude DOM polling, Lua analysis, GPU uploads/rasterization, guest execution,
complete Studio frame time and heap/GC instrumentation.

The first implementation normalized graph coordinates at every viewport read.
The 256-node draw probe rose from roughly 12.42 to 18.61 µs idle. Moving the
signed range into the scrollbar, following Godot's owner, removes that repeated
conversion without a second cached scroll position. Final idle/during-pan values
are 14.37/15.68 µs versus 12.42/14.76 before; the two bars/corner add five emitted
quads (580 → 585 in the final panned frame). This is a measured small cost, not
a zero-regression claim.

The already-fully-expanded BT comparison does not compare a formerly collapsed
tree against a larger new tree. At 3,074 cards, source-card projection is about
2.48 ms, layout/routes/bounds publication 0.48 ms and warm draw/quad emission
117 µs (opaque-child variant: 3.65 ms / 0.45 ms / 121 µs). The earlier warm draw
measurements were about 99/101 µs; card heights/visible glyph counts also change
when the fold label disappears. The range/culling and additional scrollbar work
are not free. No new per-motion graph projection, sorting, layout or text
measurement is introduced, and these numbers do not prove a device-wide FPS.
