# Retained graph viewport conformance

This is a domain-free test contribution, not a second Behavior Lens or a
production graph view. `pane.ts` mounts the shared control in the real
`EditorPanes` lifecycle. Its two editor inputs carry independent viewport
state; neither their text nor a Lua recognizer produces the graph. A reset,
non-executing Machine supplies real GX device output to the presentation
pipeline. No cart ROM, asset packer or current game-source location is needed.

## Browser backends

```sh
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
  the readability of a future BT/FSM layout.

## Compound layout prerequisite

The same browser command also runs `compound.ts` with the unmodified **elkjs
0.12.0** Worker served from the installed package. The ELK API runs on the main
thread; Layered runs in an actual browser `Worker`, not the bundled in-process
engine. The existing input/render loop advances during layout. Engine lifetime
belongs to this fixture, not to a feature-global singleton. It is terminated
after the one generation completes; ordinary retained draw/hit needs no worker.

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

This closes the **layout/render boundary**, not `STUDIO-FSM-GRAPH-VIEW-01`.
The concrete FSM outline is unchanged. Product worker composition, asynchronous
source-generation publication/cancellation and per-return-proof correspondence
must be implemented before switching that view. No callback, source AST, cart
ABI or new graph authoring model is part of the generic layout request.

The existing full Studio runner additionally exercises capture interruption
through the **actual** dispatcher and Command Palette in
`runtime_replay/studio_pointer_capture.ts`; closing the palette while held must
not restart a drag:

```sh
node tests/conformance/runtime_replay/browser.mjs --studio \
  dist/bmsx-bios.debug.rom dist/nemesis_s.debug.rom /tmp/studio.png
```

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
