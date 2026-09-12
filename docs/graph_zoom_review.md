# Graph zoom: discrete pixel scales and target-owned menus

2026-09-12; review against `04913678b`, after the BT/ActionEffect authoring
slices. This corrects the interaction policy in `graph_zoom_design.md`, not
the machine's PCRTC or the existing host-overlay transform representation.

## Confirmed causes and references, before implementation

- Commands multiply/divide the current zoom by `1.2`, then clamp it to
  `0.25..4`. Those endpoints are not members of the sequence from `1`.
  Starting at `4`, repeated minus reaches `1.1163265889`, then `0.9302721574`;
  starting at `0.25`, plus reaches `0.8957952`, then `1.07495424`. Neither route
  visits 100%. This is not a mouse-repeat or focus diagnosis.
- The graph's transform has **one** scale for both axes. GPU glyph quads
  multiply widths/heights and advances by that scale without changing atlas
  coordinates. Tiny bitmaps sampled nearest at fractional magnifications lose
  uniform pixel widths/heights. Software additionally quantizes each glyph's
  destination extent at its existing raster boundary. Changing a font's width
  or adding feature-local renderer corrections would be the wrong owner.
- [Aseprite's zoom owner](https://github.com/aseprite/aseprite/blob/09538f9a1aa247919ac19992db173050e173a860/src/render/zoom.cpp)
  steps through a canonical scale table. Its factors in BMSX's existing range
  are `1/4, 1/3, 1/2, 1, 2, 3, 4`.
  [Godot EditorZoomWidget](https://github.com/godotengine/godot/blob/c24bf5d933c53d9477d5e82c51403856a9e7da62/editor/gui/editor_zoom_widget.cpp)
  explicitly provides these integer/reciprocal factors for pixel art. Its
  normal geometric policy also recomputes from a step rather than accumulating
  multiplication drift. BMSX's tiny bitmap canvas uses the pixel-art policy,
  not new typefaces, a second unscaled text layout or an offscreen blur pass.
- [LimboAI's task context menu](https://github.com/limbonaut/limboai/blob/3f14ea4c26911e8b8e30c6bcdb575fc589a59deb/editor/limbo_ai_editor_plugin.cpp)
  is built around the selected task's operations. A command being available
  does not make it a contextual operation on a task or transition.

## Owner contract

- `WorkbenchGraphViewport` owns the bounded canonical step sequence. Both
  focus commands and Ctrl-wheel request signed steps from that owner. From an
  arbitrary view scale, the first step selects the next scale in the requested
  direction. Subsequent opposite steps retrace the same levels exactly,
  including 100%. Saturation does not create a new multiplication sequence.
- `setZoom` remains the direct view-transform setter used by view restoration;
  source bookmarks and scroll coordinates do not acquire a second zoom state.
  Changing scale still uses the old inverse anchor before updating extents.
- Integer magnification gives uniform bitmap texel blocks. Below 100%, nearest
  downsampling necessarily discards detail; overview is not a claim that a
  five-pixel font remains readable at 25%. Whole-pixel enlargement and reliable
  return to 100% are the reading routes. Host display scaling remains separate.
- Graph view-title buttons and palette keep zoom. Node/state/transition and
  canvas context menus do not include zoom actions. Source, details, supported
  source edits and ordinary history continue through their existing owners.
- There is no new machine/C++ representation or render hot-path. The seven
  levels are retained constants; stepping performs bounded comparisons only
  on an input event. No model rebuild, font measurement or frame allocation.

## Required proof

Exact bidirectional levels, endpoint saturation, arbitrary starting scales and
multi-notch wheel input; old inverse anchor and source/history preserved;
focus/capture revocation unchanged. Shared host-overlay tests check uniform
tiny-glyph magnification without atlas changes. Actual BT/FSM pointer, menus,
source navigation and authoring flows run on all three Studio renderers.
Inspect real captures at 100%, overview and magnification. Retained paint and
gesture cost are measured separately; do not call a unit test a GPU proof.

## Executed evidence

- 1,693 Lua tests pass, one existing skip (1,694 total). The existing graph,
  menu and host-overlay fixtures cover the correction; no parallel control or
  renderer oracle was introduced. IDE typecheck passes; tests-project checking
  retains exactly the same 51 diagnostics as `5a7b28c3e`. Strict architecture
  boundaries, core parity and indentation pass. Browser Studio builds normally.
- Real Pietious navigation/authoring passes on software, WebGL2 and WebGPU,
  including cross-depth drag, the narrower target menus and source Undo.
  The dedicated FSM drag/review/Save/Hot Resume flow also passes on all three
  renderers with the corrected zoom. Tests assert every level in both
  directions, command availability at endpoints, exact 100%, inverse pointer
  anchors, Source/Back and unchanged source/guest state during navigation.
- The final complete Studio workflow and the dedicated live BT reparent/Save/
  Hot Resume/Undo flow also pass on all three renderers. This includes normal
  fault/recovery, actual WebGPU readback lifetime, source installation, paused
  authoring and the Scene/Problems final composition. BT captures at overview,
  100% and integer magnification were inspected alongside the FSM captures.
- Actual tiny-font FSM captures were inspected at 100%, 33.33% overview and
  300% magnification. Before inspecting magnified texels the test reveals its
  selected item through the real viewport: center-anchored zoom can otherwise
  move a left-aligned graph offscreen. Software captures publish its existing
  framebuffer at the checkpoint, not a replacement drawing. The three inspected
  magnified glyph regions match pixel-for-pixel across software/WebGL2/WebGPU;
  the complete images differ in route/outline rasterization. Overview discards
  small text detail, as documented; it is not a full-quality rendering claim.
- Two test expectations were corrected during validation: a menu separator is
  not a command string, and the old canvas test explicitly expected the removed
  zoom item. No product guard, retry or replacement menu was added to make those
  tests pass. Artifacts and captures are in `/tmp/bmsx-graph-zoom-review/`.

### Retained paint cost

The existing graph-viewport profiler, four alternating isolated baseline/current
process pairs on Node 22.23.1; identical 256-node/255-edge fixtures at 100%,
1,000 warmups and 5,000 operations per phase. Baseline owners: `5a7b28c3e`.
Median host paint + quad generation, in microseconds:

| Operation | Baseline | Current |
| --- | ---: | ---: |
| Stationary pointer + paint | 14.612 | 14.520 |
| Panned pointer + paint | 15.663 | 16.086 |

Both retain quad storage, emit 585 final visible quads, perform zero warm font
measurements and one stationary hit test. The panned sample is slightly slower;
this is not described as an optimization or a heap/GC/complete-frame/GPU result.
The new level lookup runs only for a zoom event, over seven retained constants;
the steady render/control path is unchanged. Choosing a wider overview can
expose more geometry and is not a free performance operation.
