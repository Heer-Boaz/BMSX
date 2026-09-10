# Shared graph connection interaction

## Scope and production references

This is the shared control prerequisite for FSM endpoint authoring, not a new
retarget command. Lua, source admission, shared-consumer acceptance, text edits
and selection history remain contribution/document responsibilities. There is
no mutable graph topology, guest patch, second history or per-frame layout.

The interaction follows two inspected production implementations:

- [Godot AnimationStateMachineEditor](https://github.com/godotengine/godot/blob/4cefd60f5a3d733506cb557d6cd26263b3fbd17f/editor/animation/animation_state_machine_editor.cpp):
  latch the particular transition and moving endpoint at press; retain the
  opposite endpoint; draw a provisional connection; reconnect only on release.
- [XYFlow EdgeUpdateAnchors](https://github.com/xyflow/xyflow/blob/0a1f9575b25679f2880175de8d3eae21aedde921/packages/react/src/components/EdgeWrapper/EdgeUpdateAnchors.tsx)
  and [XYHandle](https://github.com/xyflow/xyflow/blob/0a1f9575b25679f2880175de8d3eae21aedde921/packages/system/src/xyhandle/XYHandle.ts):
  explicit source/target capabilities and endpoint hit anchors, one threshold/
  capture lifecycle, transform-aware pointer movement, auto-pan and admitted
  target feedback. Ordinary edge selection is not a reconnect gesture.

We do not copy their domain restrictions (BMSX permits self/parallel outcomes),
DOM pointer loops, fallback handles, immutable per-motion state copies or
Godot's iterative per-pixel rectangle clipping. The existing BMSX pointer
capture service remains the physical release/cancel owner. The inspected local
aigen canvas likewise distinguishes port drags from ordinary wire selection;
it is a UX reference, not a source-authoring contract.

## Owners and representations

| Owner | Contract |
| --- | --- |
| Graph model | Immutable layout-generation nodes, edges, routes and directedness. Directedness is not inferred from whether a degenerate route currently has an arrow. |
| Drag source | Advertises source/target/both handles for the selected edge, or none. This is a current, constant-time capability query, not a source-analysis scan. `begin` receives the latched item or exact edge/end only after the physical threshold. |
| Graph control | Selected-edge handle hit priority, press identity, threshold, capture, host-time auto-pan, wheel movement and cancellation. A disappearing capability cancels even a pending press. Handle clicks never become source-navigation double-clicks. |
| Contribution session | Current-source/read-only admission, candidate semantics and one accepted `drop`. An admitted connection target is a current graph node; no target means no drop. The control does not infer connectivity or resolve Lua. |
| Connection preview | One retained four-coordinate provisional line and arrow buffer per gesture. The opposite layout endpoint is fixed. A rejected pointer remains free; an admitted node snaps to its measured header boundary. No future ELK route is predicted. |
| Graph geometry | Shared arrow writer for published routes and retained previews. Header snapping uses a constant-time center ray, with a zero-length ray remaining a zero-length line. |
| Renderer | Original dragged route/labels are suppressed; provisional lines precede card headers; explicit endpoint handles follow headers. Existing clip, tiny font, overlay commands and retained quad storage, on all three browser backends. |

Handle geometry is in graph-canvas pixels, independent of viewport scrolling.
The painted square has radius three pixels, with a five-pixel hit radius.
Target is painted and hit above source when endpoints coincide. Pixel rounding
applies to handle-square centers. Routes/previews retain fractional layout and
pointer coordinates directly, like the existing polyline renderer; rounding
only the moving endpoint would create a direction for a center-coincident
fractional ray. None of this changes a machine register/fixed-point ABI.

A stationary drag repeats no hit/admission/geometry work. Moving buffers are
updated in place; no per-motion arrays, objects, font measurement or layout.
Arrow direction/visibility is separate from its six-coordinate buffer; a
zero-length route never shrinks and regrows the gesture's backing storage.
Selected-handle state is replaced only when edge/capability changes. Preview
targets are refreshed after scroll and on the actual physical release. Leaving
the graph removes admission, not the pointer's position; losing viewport/input,
opening a modal, blur, detach, changed selection/model/source or Escape cancels.
Capture and preview detach before the contribution is allowed to edit/navigate.

## Integration boundary

BT sibling insertion retains its existing node ghost, marker and source edit;
it does not gain reconnect semantics. A domain-free contribution exercises the
new connection protocol through the real editor pane, pointer capture and
384×288 renderer. That is not evidence of an FSM retarget UI or Hot Resume.

The concrete FSM slice now connects current-source/read-only capability,
proven literal/return selection, shared-consumer review and existing edit/history.
Its physical drag, Source, Undo/Redo and Save/Hot Resume proof is separate from
this domain-free control proof; see
[`state_machine_connection_edit_design.md`](state_machine_connection_edit_design.md).

## Validation — 10 September 2026

- **39 focused tests pass**, including the existing graph/BT drag regressions
  and eleven independent connection geometry/lifetime/render cases. The full
  Lua suite reports **1,217 passed, one skipped, zero failed**.
- The domain-free graph browser, complete Studio workflows and Pietious
  navigation pass on **software, WebGL2 and WebGPU**. The actual 384×288
  connection captures were inspected. Within each backend the raster oracles
  observe a new preview, removal of only the selected old route, and unchanged
  opaque header interiors. Accelerated tests use Chromium/SwiftShader, not a
  physical-GPU performance oracle. Existing Studio syntax/init-fault exercises
  and missing-source HTTP probes remain deliberate parts of those tests.
- Browser Studio and node-headless-tooling builds, IDE typecheck and real
  headless Behavior Lens (**59 assertions**) pass. Tests-project typechecking
  retains the same **51 existing diagnostics** against `04c669839`; it is not a
  clean tests-project typecheck. Strict architecture audit reports zero issues;
  core-parity, indentation and diff checks pass. No machine/cartlib/C++ edit.

### Cost boundary

Node 22.23.1; four isolated processes after builds/tests/browsers completed.
Each process uses ten warmups and 25 batches of 1,000 operations. Entries below
are medians of the four process medians, in **µs per operation**:

| Connection nodes | Stationary hover | Stationary drag | Moving target + geometry | Preview + overlay quads |
| --- | ---: | ---: | ---: | ---: |
| 4 | 0.044 | 0.022 | 0.064 | 1.263 |
| 1,024 | 0.043 | 0.012 | 0.968 | 3.475 |

Stationary polling repeats no target hits or geometry work. Preview/handle,
translated command and quad storage are retained, with no warm font measurement.
The additional cards are offscreen; the existing moving hit and render traversal
still scale with retained node count. This is not a constant-time graph claim.

The same BT workload was bundled against `04c669839` and the final working tree,
alternating baseline/current order across four process pairs:

| BT siblings | Stationary hover, before → after | Stationary drag | Moving insertion | Preview + overlay quads |
| --- | ---: | ---: | ---: | ---: |
| 24 | 0.002 → 0.039 | 0.015 → 0.010 | 0.038 → 0.031 | 3.876 → 3.822 |
| 1,024 | 0.048 → 0.044 | 0.017 → 0.012 | 1.036 → 1.031 | 8.821 → 8.930 |

These very small stationary samples have tiering/process variation (the four
24-sibling current hover medians range from 0.004 to 0.043 µs). The large BT draw
median is 0.109 µs higher in this run; these figures do not claim universal
speedup or zero overhead. No new source query, projection/layout or per-motion
buffer allocation is introduced in that path. The measurements exclude parsing,
events, layout, GPU upload/raster, guest execution, complete Studio frame time
and heap/GC instrumentation. Reproduction commands are in the
[conformance README](../tests/conformance/graph_viewport/README.md); baseline
bundles, raw runs, validation logs and captures are in `/tmp/bmsx-graph-connection/`.
