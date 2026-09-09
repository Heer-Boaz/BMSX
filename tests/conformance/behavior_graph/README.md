# Source-backed BT graph

The concrete Behavior Lens graph consumes the existing typed source projection.
Lua remains the document; graph cards, links, fold state and geometry are not
runtime or authored scene data. See
[the owner contract and pinned production references](../../../docs/behavior_graph_design.md).

## Independent contracts

```sh
npx tsx --tsconfig tsconfig.base.json --test --import ./tests/lua/test_setup.ts \
  tests/lua/behavior_source_graph.test.ts tests/lua/behavior_tree_graph_view.test.ts \
  tests/lua/workbench_tree_layout.test.ts tests/lua/workbench_graph.test.ts \
  tests/lua/editor_focus.test.ts
```

The shared `tests/helpers/behavior_source_fixture.ts` is authored Lua, not a
fake parser, second graph schema or generated game ROM. Tests cover:

- independent registrations in one file and distinct uses of shared subtrees;
- ordered children, parallel roles, choice weights, attachments and blackboard;
- a weighted link's **choice use**, distinct from its shared initializer/child;
- partial membership and dynamic roots without fabricated ordered endpoints;
- source-backed node/edge selection, hidden edits, removal, Undo and pan anchors;
- variable-width/height tidy layout, asymmetry and a 10,000-level iterative tree;
- shared retained geometry, clipping, pointer capture and focus/input lifecycle.

## Actual Studio, all three backends

Build the BIOS and the two debug carts through the normal product toolchain.
Playwright/Chromium is a host test tool. If installed outside this checkout, set
`BMSX_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs`.

```sh
mkdir -p /tmp/bmsx-bt-graph
node tests/conformance/runtime_replay/browser.mjs --studio-navigation nemesis_s \
  dist/bmsx-bios.debug.rom dist/nemesis_s.debug.rom /tmp/bmsx-bt-graph/nemesis.png
node tests/conformance/runtime_replay/browser.mjs --studio-navigation pietious \
  dist/bmsx-bios.debug.rom dist/pietious.debug.rom /tmp/bmsx-bt-graph/pietious.png
node tests/conformance/runtime_replay/browser.mjs --studio \
  dist/bmsx-bios.debug.rom dist/nemesis_s.debug.rom /tmp/bmsx-bt-graph/studio.png
```

Each command runs software, WebGL2 and WebGPU independently. Accelerated tests
use Chromium/SwiftShader, not a software fallback. The current game-source
navigation cases are integration smoke; they do not define the graph contract.

`studio_behavior_source.ts` and `studio_behavior_graph.ts` install the same
independent Lua fixture into a **text model only**, open registrations through
the real Command Palette and exercise keyboard, controller and pointer routes.
They test held Space, modifier/focus scoping, spaces typed in the palette,
Children/Details/Source actions, weight/decorator field
navigation, physical edge selection, pane return, hidden edits and Undo. The
paused machine's position and installed media do not change. The original
source is restored before further product workflows; only the final screenshot
presentation leaves its fixture in the unsaved text model. It never installs a
fixture cartridge. Captures show the expanded weighted fixture at 384×288 with
the actual IDE tiny font, not a mock drawing or a screenshot of a game BT.

The full Studio suite also checks the ordinary Scene Editor, FSM/ActionEffect
outlines, focus, source save, pause/rewind/Hot Resume, reboot and Scenario Lab.
Expected negative guest-fault cases retain their existing fault gate. A passing
build alone is not evidence for these workflows or physical-device performance.

The existing headless cart integration remains runnable after rebuilding its
product (its game-specific golden assertions remain a separate test-fixture task):

```sh
npm run build:product:node-headless-tooling -- --debug
npm run ide:test -- nemesis_s tests/ide/behavior_lens.idetest.js
```

## Separate cost boundaries

```sh
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/behavior_graph/profile.ts
```

The profile measures source recognition on already-built semantic data, source-
to-card projection, tidy placement plus routes, hit testing and warm overlay
emission plus quad-stream conversion **separately**. It uses 24 and 1,024 shared
subtree uses, fully expanded (74 and 3,074 cards). Cold phases have 10 warmups
and 25 median samples; warm phases have 1,000 operations per sample. Font
measurement count and quad-backing identity are checked after draw warmup.
This excludes parsing, GPU upload/raster and total Studio frame time; it is not
a JavaScript zero-allocation proof or a speed guarantee for another host.

## FSM source prerequisites (no FSM layout yet)

```sh
npx tsx --tsconfig tsconfig.base.json --test --import ./tests/lua/test_setup.ts \
  tests/lua/state_machine_source.test.ts tests/lua/fsm_hot_resume.test.ts
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/behavior_graph/profile_fsm.ts
```

`tests/helpers/fsm_source_fixture.ts` contains authored Lua independent from the
carts. Its path matrix is checked both against the source binding and the real
compiled `cartlib/fsm/fsm.lua` on the existing BIOS/cart CPU harness. Expected
plans are explicit; neither implementation generates the other's expectations.
The matrix covers root/relative paths, cancelled descents, concurrent steps,
exact/_/# lookup and quoted/escaped names. Source tests also cover first-result
callback evidence, scoped aliases, guards, parent handlers, initial entries,
multiple registrations, duplicate keys, partial source and known mutation.

The same browser commands above now run `studio_fsm_source.ts`: a real paused
Studio text model, registration picker, held Source clicks, hidden edits to a
const callback target, activation, retained idle generations and ordinary Undo.
It does not compile/install fixture media, replace the machine or depend on a
particular game's FSM line numbers.

The implemented callback subset is inline functions and file-local `<const>`
bindings. Returns in nested functions, root entry and exit handlers are not
transition-return evidence. `no-path` describes only the returned-path channel,
not absence of imperative effects. Member/cross-file callbacks, arbitrary calls
and dynamic targets do not acquire guessed endpoints. An absent explicit initial
state does not acquire host `pairs` ordering. See the pinned reference and scope
contract in `docs/behavior_graph_design.md` before extending this subset.

The FSM profile separates whole source generation on cached semantic data from
source structure and scope/return binding. The two fixtures have 73/3,073 scopes
and 72/3,072 transition slots. It uses the same warmup/median measurement owner
as the BT profile; parsing, drawing and total Studio frame time are excluded.
