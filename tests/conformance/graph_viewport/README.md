# Retained graph viewport conformance

This is a domain-free test contribution, not a second Behavior Lens or a
production graph view. `pane.ts` mounts the shared control in the real
`EditorPanes` lifecycle. Its editor inputs carry independent viewport
state; neither their text nor a Lua recognizer produces the graph. A reset,
non-executing Machine supplies real GX device output to the presentation
pipeline. No cart ROM, asset packer or current game-source location is needed.

## Browser backends

```sh
npm run build:product:browser-studio -- --debug --force
node tests/conformance/graph_viewport/run.mjs /tmp/bmsx-graph-viewport/screenshots
```

Install Playwright/Chromium as host test tools, or set
`BMSX_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs`. They are not
product dependencies. The runner explicitly exercises software, WebGL2 and
WebGPU; it does not replace a failed accelerated backend with software.
Chromium uses SwiftShader for the accelerated API paths in this headless test.

- Real 384×288 tiny-font canvas: partial nodes/text/routes, node and edge
  selection, double-click, physical drag, input switch while held, retained
  viewport on return and focus-local keyboard pan.
- Six primitive crop oracles per backend: fill, stroke, integer/fractional
  polyline, flipped/scaled atlas image and tiny glyphs with backgrounds.
  Clipped pixels must equal the original raster inside the rectangle and be
  black outside it. This tests clipping, not identical rasterization across
  different backends.
- 384×288 → 256×192 → 384×288 target changes with a retained editor viewport
  override: pass dimensions follow the presenter and the scissor stays aligned
  with the geometry. GPU validation errors fail the run.
- Screenshots are written to the supplied directory (default: ignored local
  `screenshots/`). These deliberately clipped geometry fixtures do not prove
  the readability of a concrete BT/FSM layout; those have separate Studio tests.

### Canvas input and scrollbars

The fixture uses the production `BrowserInputHub`. `pointer.mjs` drives actual
Chromium DOM mouse/keyboard events before the deterministic geometry probes:
middle-button and Space-primary pan over cards, chord edges arriving as
`pointermove`, physical initiating-button release, both scrollbar thumbs and
`releasePointerCapture` during an admitted connection preview. Pointer reset
must cancel, never drop, and must leave a held keyboard key intact. Some Chromium
chords also lose native capture when a different button is released; the probe
records and honors that external cancellation rather than recapturing or
pretending the button release itself owns the gesture. Independent capture tests
prove another button's release alone cannot end it.

Only attached panes hit their own code/resource scrollbars. The concrete FSM
Studio test covers an overflowing source editor hidden behind the graph: its
old geometry must not intercept the graph thumb. The shared viewport covers
negative graph coordinates, edge/label bounds, finite padded limits, inner
content clipping, release outside the graph, resize and retained geometry.
The [navigation contract](../../../docs/graph_navigation_design.md) names the
production references and keeps navigation separate from source authoring.

## Compound layout prerequisite

The same browser command also runs `compound.ts` with the unmodified **elkjs
0.12.0** Worker packaged as `dist/graph-layout.worker.js` by the product builder.
The production `BrowserGraphLayoutEngine` owns native errors/termination and
uses the shared `GraphLayoutRequests` protocol owner for pending replies. Tests no longer serve a separate engine
from `node_modules`. The product build gate rejects ELK inside the Studio UI
bundle. The input/render loop advances during layout; ordinary retained draw/hit
needs no worker. This geometry probe terminates its engine after completion.

`tests/helpers/compound_graph_fixture.ts` is independent geometry, not authored
Lua or a generated ROM. Eight nodes/ten links cover nested scopes, cycles,
self-loops (including the root), parent/child and cross-scope routes, and two
identically labelled links with distinct retained proof identities. Tests use
physical label clicks, header clicks and pan inside the container. Labels do
not replace line/arrow hit testing. Each backend also compares the same layout
with/without one edge: 25 visible route probes must survive the container body,
and opaque card/header interiors must remain unchanged. These are within-backend
raster oracles, not claims of pixel-identical line rasterization across APIs.
Room/lane captures use the actual tiny font without zoom-to-fit shrinking.

```sh
npx tsx --tsconfig tsconfig.base.json --test --import ./tests/lua/test_setup.ts \
  tests/lua/workbench_compound_layout.test.ts tests/lua/workbench_graph.test.ts
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/graph_viewport/profile_compound.ts
```

The Node tests use the explicitly selected in-process ELK implementation. They
check coordinate containers/endpoints, separate labels/proofs, node/label
non-overlap, minimum header size, empty/disconnected graphs, deterministic
generations, arrow bounds/hits and direct propagation of engine errors. They
do not stand in for the actual Worker test. The profile reports one first and
five subsequent independent generations (median), for 8/128/512 nodes, plus
batched warm hit/draw+quad-stream costs and retained storage/font measurement.

`lifetime.ts` additionally attaches the production `AsyncGraphLayout` session
to an independent contribution input with real model-change events and the
production group/pane/control lifetimes. It submits 1,001 generations while
the first is running: only first and last factories run, so obsolete requests
never project/measure/clone graphs. Hidden Undo/Redo invalidates results and
running work. A close during a physical pan detaches capture, terminates work,
unsubscribes the input, preserves its shared text model and never steals focus.
Clone/send failure, ELK error replies, close with pending work, actual worker
execution failure and HTTP-404 worker loading all settle requests without an
automatic restart or fallback. The native-Worker failures are not mocked promises.

`tests/lua/graph_layout_lifetime.test.ts` controls completion order independently
of ELK speed and checks lazy construction, cancellation, current/stale failures,
fresh input identity after reopening, resource-model/Undo retention and group
reset. `editor_panes.test.ts` also exercises the real last-tab-close route and
asserts that the pane is detached *before* disposal, including reopening its
retained entry context.

These tests prove the **layout/render and lifetime boundaries**. The concrete
FSM contribution now connects source/definition/font changes and per-return
selection to the same session; its separate integration proof is documented in
[`behavior_graph/README.md`](../behavior_graph/README.md). No callback, source
AST, cart ABI or graph-authoring model crosses the layout engine boundary.
Node geometry tests remain explicitly in-process; actual headless Studio uses
a native thread and a separately bundled worker asset, with its own tests.

The existing full Studio runner additionally exercises capture interruption
through the **actual** dispatcher and Command Palette in
`runtime_replay/studio_pointer_capture.ts`; closing the palette while held must
not restart a drag:

```sh
node tests/conformance/runtime_replay/browser.mjs --studio \
  dist/bmsx-bios.debug.rom dist/nemesis_s.debug.rom /tmp/studio.png
```

## Shared connection control

`connections.ts` mounts an independent third graph input with the same pane,
control, physical input, capture and renderer. Its contribution advertises
explicit source/target handles and admits three concrete test nodes, not every
graph card. It contains no Lua, current cart, recognizer or alternate topology
editor. Its single accepted drop proves callback delivery, **not FSM editing**.

The browser runner above exercises click versus drag versus Source activation,
both moving endpoints, stationary preview, Escape, capability revocation before/
after threshold, input switch while held and actual outside-graph release.
`connection-handles-*`, `connection-accepted-*` and `connection-free-*` captures
show the actual 384×288 tiny-font raster. Within-backend pixel oracles prove the
new wire is visible, only the dragged old route disappears (parallel routes stay),
and opaque header interiors/text stay unchanged even where the wire crosses
another node. Software/WebGL2/WebGPU use the same control, not backend-specific
test admission. The concrete FSM pane now consumes these controls; its separate
source-review/Save/Hot Resume proof is in the behavior-graph suite.

```sh
npx tsx --tsconfig tsconfig.base.json --test --import ./tests/lua/test_setup.ts \
  tests/lua/workbench_graph*.test.ts tests/lua/behavior_tree_drag.test.ts
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/graph_viewport/profile_connection.ts
```

The independent Node tests additionally cover coincident endpoints, source-only/
target-only capability, header-versus-handle hit priority, model/selection/focus/
input invalidation, coalesced release, invalid targets, actual release coordinates,
wheel and 50/60/120-Hz host-time scrolling. Geometry tests cover all snapping
directions, center-coincident/self endpoints, directed/undirected and repeated/
degenerate terminals. Render tests retain the preview, translated route buffers,
glyph/command storage and quad buffer while scrolling and changing targets.

The profile compares 4/1,024 retained nodes (the additional cards are offscreen).
Ten warmup batches precede 25 samples of 1,000 operations; reported medians are
µs per operation. Stationary capability/drag and moving target hits are separate
from preview emission + quad construction. It checks zero stationary target
queries, zero warm font measurements and retained storage. It excludes Lua
analysis, layout, GPU raster/upload, guest execution and heap/GC instrumentation;
moving hit cost still depends on the actual viewport node count. The unchanged
BT drag workload is `../behavior_graph/profile_drag.ts` and is also compared
against the pre-slice implementation. Results and production references live in
[`graph_connection_interaction_design.md`](../../../docs/graph_connection_interaction_design.md).

## Native renderers

```sh
cmake -S machine/cpp -B build-cpp-tests -DBMSX_BUILD_TESTS=ON \
  -DBMSX_ENABLE_GLES2=ON -DBMSX_BUILD_EGL_TESTS=ON
cmake --build build-cpp-tests --target \
  bmsx_host_overlay_clip_tests bmsx_host_overlay_gles2_tests -j4
ctest --test-dir build-cpp-tests -R 'host_overlay_(clip|gles2)' --output-on-failure
```

The ordinary software test includes mirrored scissor-coordinate/intersection
cases and the six crop oracles. The optional GLES2 test creates an explicit
surfaceless EGL 1.5/Mesa pbuffer and runs the native overlay pipeline, including
empty clipping and pass-end scissor release. EGL is a test dependency, not a
requirement for the product or a fallback context path.

## Cost boundary

```sh
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/graph_viewport/profile.ts
```

256 retained nodes and 255 routes, 1,000 warmup frames, then 5,000 idle and
5,000 panning frames. Reports geometry construction separately from command
emission plus quad-stream construction, stationary hit-test count, warm font
measurement count and retained quad-buffer identity. This excludes Lua
projection, GPU uploads/rasterization and end-to-end Studio frame time. It is
not an allocation profiler or a performance guarantee for other machines.

```sh
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/graph_viewport/profile_navigation.ts
```

The navigation profile compares 32/1,024 retained nodes and their routes. It
separates bounds/layer publication from captured pan, stationary capture,
unchanged layout, resize, thumb drag and draw+quad emission. Ten warmup batches
precede 25 median samples; warm batches contain 1,000 operations (reported as
µs/operation). Assertions cover zero pan/thumb hit scans or font measurements,
unchanged model/selection, retained viewport rectangles and retained quad storage.
This excludes browser event polling, Lua analysis/layout, GPU, guest execution
and heap/GC instrumentation. Publication still scales with graph size; drawing
still visits retained geometry to cull offscreen items.
