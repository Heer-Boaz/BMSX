# Graph zoom: one view transform, no second layout

## Production reference and live boundary

Read before implementation: Godot
[`GraphEdit::set_zoom_custom`, `_update_scroll_offset`, `_update_scrollbars`](https://github.com/godotengine/godot/blob/cb41ea115914c61a8329087b4cffbad7477b8427/scene/gui/graph_edit.cpp).
The anchor is obtained with the old inverse transform; zoom changes the view,
then scroll retains that anchor. Child geometry does not become authored
coordinates. Scroll extents include the scaled graph and viewport padding.

The live BMSX viewport currently assumes scale 1 in paint, hits, drag offsets,
source-navigation anchors and layout anchoring. Host overlay has typed retained
commands, but no view transform. Scaling only graph rectangles or manufacturing
a scaled font would leave those owners inconsistent.

## Representation table, before mirrored rendering changes

| Owner | TypeScript | C++ | Representation |
| --- | --- | --- | --- |
| Host draw transform | `HostOverlayTransform` | `HostOverlayTransform` | `scale`, `offsetX`, `offsetY`; host logical coordinates, number/f32, not guest words |
| Command discriminator | `Host2DKind.Transform` | `Host2DKind::Transform` | One new host-only retained command; no guest GPU opcode/MMIO |
| Published reference | `Host2DRef` union | `Host2DRef::transform` | Immutable for the published frame, reset to identity at next frame start |
| Workbench view | `WorkbenchGraphViewport` | No native Studio pane | Graph layout coordinates remain unchanged; scroll offsets are viewport pixels |
| Clip commands | `HostOverlayClipRect` | `HostOverlayClipRect` | Final logical viewport bounds; transform applied by producer before intersection |

Hot-path consumers to change: `HostOverlayQuadStream.appendRect/appendPoly/
appendImage/appendGlyphRun` (shared TS WebGL2/WebGPU), `renderHeadlessHost2DEntry`
and its rectangle/line/image/glyph datapaths, and C++ `renderHost2DEntrySoftware`
and `renderHost2DEntryGLES2` with the corresponding draw functions. GPU quad
positions remain floating host geometry; software raster conversion stays at
its pixel boundary. Text advances, glyph extents and atlas UVs remain distinct.
Strokes/connection hit affordances are in screen pixels; their endpoints and
glyph geometry follow the view transform. No scale-dependent guest ABI.

Producer: `OverlayRenderer` owns retained nested drawing transforms like its
existing clip scopes. Pushing snapshots the composed transform into this frame's
pool; popping publishes its parent. No per-frame object allocation after warmup,
mutation of submitted graph points, font clone or matrix opcode in the machine.

## View contract

- The viewport alone converts graph and viewport coordinates. Paint receives
  that transform; hit tests, context anchors, grips, drag offsets and insertion
  guides use its inverse. No feature-local scale factors.
- Zoom is explicit, anchored at the pointer for wheel zoom and at the canvas
  center for commands. There is a reset-to-100% action, not auto-fit.
- Ctrl + wheel and the focused Graph commands use Godot's 1.2 zoom step,
  bounded to 25–400%. Title/context actions expose `-`, `1:1`, `+`; the reset
  label is an action, not a claim about the current percentage. Keyboard
  gameplay bindings and the code editor's font scale are unchanged.
- Toolbar/menu/palette use focus-owned graph commands. Zoom/pan do not mutate
  Lua, tick the guest or invoke ELK. A transform change revokes an in-flight
  edit gesture, not its selected source occurrence.
- Scrollbars, clipping, offscreen reveal, negative graph positions, Source/Back,
  Undo and hidden model refresh must retain their existing ownership.
- Hit radii are inverse-scaled at the graph query boundary. Connection grips
  and insertion markers draw outside the graph transform through the viewport's
  forward conversion. Their screen size stays grabbable at overview scales.
- Software rounds transformed geometry at its existing raster boundary;
  hardware quads keep fractional endpoints. Atlas nearest sampling at fractional
  scales can differ between those rasterizers. No renderer-specific font clone,
  quality fallback or dishonest cross-backend pixel-identity claim is introduced.
- Paint captures the inverse visible rectangle once and uses the shared
  half-open rectangle predicate for all culling. It does not recompute scroll
  division for every node/edge. The viewport owns that retained rectangle;
  stroke margins are converted once into the same layout coordinate space.

## Required evidence

Independent transform/clip publication, retained-buffer reuse and TS/C++ host
rendering tests; graph inverse/anchor/scroll/drag tests; actual Studio BT/FSM
zoom, Source, Undo and dropdown/palette flows. Inspect tiny-font output at more
than one scale on software, WebGL2 and WebGPU. Native software/GLES2 must consume
the same transform contract. A compile alone does not close B07.

## Implemented and measured

Validation artifacts: `/tmp/bmsx-graph-zoom/`. `test:lua` passes 1,429 tests with
one existing skip; IDE typecheck, browser Studio build, strict architecture
boundaries, core parity and indentation pass. The tests-project typecheck still
has exactly the same 51 baseline diagnostics, not a clean result. Native
`bmsx_host_overlay_clip_tests` and `bmsx_host_overlay_gles2_tests` pass with actual
surfaceless EGL. Both rasterizers exercise nested clipping, identity restoration
and scaled glyph texels; TS additionally checks retained publication and quads.

Actual Studio workflows and Pietious navigation pass on software, WebGL2 and
WebGPU after the final culling change. FSM live retargeting passes on those three
backends before that culling-only optimization. These flows include zoomed BT
drag/Undo, zoomed FSM retarget/Undo, pointer anchoring, title/context/palette
commands, Source/Back and paused Save/Hot Resume. Screenshots at approximately
69% and 144% were inspected for all three backends. Overview text becomes small
and bitmap sampling differs at fractional scales; this is not a claim that 25%
text is readable or that the rasterizers are pixel-identical. Full details and
100% reset remain the reading route.

The existing `tests/conformance/graph_viewport/profile.ts` now accepts an optional
zoom argument. Four alternating isolated process pairs against `b1c9072f3` on
Node 22.23.1 / Core Ultra 7 265KF, 256 nodes / 255 edges, 1,000 warmup and 5,000
iterations per phase give these medians:

| Version / scale | Stationary draw | Panned draw | Final visible quads |
| --- | ---: | ---: | ---: |
| Before zoom, 100% | 14.764 µs | 16.851 µs | 585 |
| View transform, 100% | 15.190 µs | 17.039 µs | 585 |
| View transform, 69.44% | 20.220 µs | 29.022 µs | 1,223 |

This measures viewport paint, retained command publication and quad generation,
not GPU presentation or full Studio latency. All runs reuse quad storage, perform
zero warm font measurements and one stationary hit test. The small 100% overhead
is measured, not described as free; zooming out draws more geometry. Capturing
the inverse visible bounds once removed repeated divisions from node/edge loops.

B07's explicit shared zoom contract is complete. A minimap remains optional;
resource provenance, cross-parent authoring and ActionEffect property mutation
are not closed by this view-only slice.
