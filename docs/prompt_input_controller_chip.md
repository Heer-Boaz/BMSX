# Design Note: Input Controller Chip (MMIO Action Query via `string_ref`)

## Goal

Maintain the **Input Controller chip** — a memory-mapped I/O device that exposes action definition, sampling, query, value, and consume registers. Cart code writes action expression string_refs into IO registers and reads ICU status/value words; sampling and query state are owned by the ICU VBlank edge, not by host/runtime shortcuts.

---

## Context: CPU-visible IO

BMSX carts observe the machine through CPU-visible memory and IO words:

- **Memory-mapped I/O**: Cart code writes to special addresses via `mem[addr] = value`. The compiler lowers this to `STORE_MEM` opcodes. `Memory.mapIoWrite()` connects IO addresses directly to device-owned write callbacks.
- **IO slots**: `memory.ts` stores IO values in `ioSlots[]`. IO slots can hold non-numeric values (including `StringValue` objects) — unlike RAM which only accepts numbers.
- **Device pattern**: Device controllers own their register callbacks, reset state, save-state capture/restore, and service/edge transitions. The ICU is constructed by `Machine` with `Memory`, `Input`, and `StringPool` ownership references.
- **String refs**: The `&'...'` syntax creates a `StringRefLiteralExpression` in the AST, which the compiler interns as a `StringValue` via `program.internString()`. At runtime this is a `StringValue` object (with `.id` and `.text`). When written to an IO slot, the `StringValue` is stored directly (not as a number).
- **Compile-time enforcement**: `registers.ts` defines `MMIO_REGISTER_SPECS` entries with `writeRequirement: 'string_ref'`. The compiler's `validateMemoryStore()` uses flow-sensitive analysis (`compile_value_flow.ts`) to verify that values written to action/bind/query/consume registers are provably `string_ref` values.
- **Input expression evaluator**: The ICU VBlank edge snapshots every committed action into packed `inp_status_*` bits plus a signed Q16.16 value word. The MMIO query path evaluates expressions like `'up[jp] || a[jp]'` via `ActionDefinitionEvaluator` against that device-owned snapshot. Simple single-action queries expose the packed action status/value; complex expressions expose 1 or 0.

---

## Architecture: Input Controller Chip

### Concept

The Input Controller is an MMIO device over the existing `PlayerInput` / `ContextStack` / `InputStateManager` infrastructure. The cart interacts with it purely via MMIO:

1. **Register** action bindings during init: `mem[sys_inp_action] = &'dash'`, `mem[sys_inp_bind] = &'lb,left'`, `mem[sys_inp_ctrl] = inp_ctrl_commit`
2. **Query** an action expression: `mem[sys_inp_query] = &'left[p]'`
3. **Read** the packed result flags: `local flags = mem[sys_inp_status]`
4. Optionally set the player index: `mem[sys_inp_player] = 2`

The query register accepts **action expressions** — the same expression language used by `action_triggered()`. This includes simple queries like `&'left[p]'` (is left pressed?), `&'jump[jp]'` (was jump just pressed?), and complex boolean expressions like `&'up[jp] || a[jp]'`. The chip evaluates the expression against the ICU's sampled action table. A triggered simple single-action query writes that action's packed `inp_status_*` bits to `sys_inp_status` and its signed Q16.16 value word to `sys_inp_value`; a complex expression writes 1 or 0 to `sys_inp_status` and 0 to `sys_inp_value`. Root-level actions require a modifier (`[p]`, `[jp]`, `[jr]`, etc.) — this is enforced by the parser's `enforceRootModifiers()`, same rule as `action_triggered()`.

The compiler statically verifies that only `string_ref` values (not plain strings or numbers) can be written to the query, action, bind, and consume registers.

### IO Register Layout

The current IO register bank is:

| Register | Name | Index | Direction | Type | Description |
|---|---|---|---|---|---|
| `IO_INP_PLAYER_INDEX` | `sys_inp_player` | base+0 | Write | number | Player index (1-based, default 1). Persists until overwritten. |
| `IO_INP_ACTION_INDEX` | `sys_inp_action` | base+1 | Write | `string_ref` | Set the action name for the next define/commit. **MMIO write requirement: `string_ref`**. |
| `IO_INP_BIND_INDEX` | `sys_inp_bind` | base+2 | Write | `string_ref` | Set button bindings for the current action (comma-separated button names, e.g. `&'lb,left'` for a chord). **MMIO write requirement: `string_ref`**. |
| `IO_INP_CTRL_INDEX` | `sys_inp_ctrl` | base+3 | Write | number | Control/command register. Writing triggers a chip command (see Control Commands below). |
| `IO_INP_QUERY_INDEX` | `sys_inp_query` | base+4 | Write | `string_ref` | Action expression (e.g. `&'left[p]'`, `&'up[jp] \|\| a[jp]'`). Writing triggers `checkActionTriggered()` evaluation against the current player. Root-level actions require a modifier (`[p]`, `[jp]`, `[jr]`, etc.). **MMIO write requirement: `string_ref`**. |
| `IO_INP_STATUS_INDEX` | `sys_inp_status` | base+5 | Read | number | Simple queries return packed `inp_status_*` bits from the sampled action; complex expressions return 1 or 0. |
| `IO_INP_VALUE_INDEX` | `sys_inp_value` | base+6 | Read | number | Signed Q16.16 action value word for simple single-action queries. |
| `IO_INP_CONSUME_INDEX` | `sys_inp_consume` | base+7 | Write | `string_ref` | Plain action name string_ref. Writing triggers `consumeAction()` for that action on the current player. **MMIO write requirement: `string_ref`**. |

Total size: `IO_INP_SIZE = 8`

### Control Commands (`sys_inp_ctrl`)

These are numeric constants written to `sys_inp_ctrl` to trigger chip operations:

| Constant | Name | Value | Description |
|---|---|---|---|
| `INP_CTRL_COMMIT` | `inp_ctrl_commit` | `1` | Commit the current action definition. Reads action name from `sys_inp_action` and bindings from `sys_inp_bind`, then registers the mapping into the chip's **persistent context** for the current player. The first commit creates and pushes a `MappingContext` (id `'inp_chip'`) onto the player's `ContextStack`; subsequent commits update that same context with additional actions. |
| `INP_CTRL_ARM` | `inp_ctrl_arm` | `2` | Arm the ICU sample latch. The next runtime VBlank edge calls `InputController.onVblankEdge(currentTimeMs, nowCycles)`; when armed, the ICU records `sampleSequence`/`lastSampleCycle`, asks the input owner to `samplePlayers(currentTimeMs)` exactly once, snapshots committed action status/value words, and clears the latch. |
| `INP_CTRL_RESET` | `inp_ctrl_reset` | `3` | Clear the chip's `'inp_chip'` context from the current player's `ContextStack` and clear all accumulated action definitions. |

### Action Map Registration (INIT phase)

Before the main loop, the cart defines its action-to-button bindings via MMIO:

```lua
-- Define 'dash' as a chord: lb + left (both must be pressed)
mem[sys_inp_action] = &'dash'
mem[sys_inp_bind] = &'lb,left'
mem[sys_inp_ctrl] = inp_ctrl_commit

-- Define 'slash' as a single button: a
mem[sys_inp_action] = &'slash'
mem[sys_inp_bind] = &'a'
mem[sys_inp_ctrl] = inp_ctrl_commit

-- Define 'jump' as a single button: a (same button, different action name)
mem[sys_inp_action] = &'jump'
mem[sys_inp_bind] = &'a'
mem[sys_inp_ctrl] = inp_ctrl_commit

-- Define 'move_horizontal' with analog axis: lx
mem[sys_inp_action] = &'move_horizontal'
mem[sys_inp_bind] = &'lx'
mem[sys_inp_ctrl] = inp_ctrl_commit

-- Multiplayer: switch player, define their actions
mem[sys_inp_player] = 2
mem[sys_inp_action] = &'jump'
mem[sys_inp_bind] = &'a'
mem[sys_inp_ctrl] = inp_ctrl_commit
mem[sys_inp_player] = 1  -- switch back
```

**Binding format**: The `sys_inp_bind` register accepts a **comma-separated** list of button names as a single `string_ref`. Multiple names form a **chord** (all must be pressed simultaneously). The button names match the standard engine button vocabulary: `a`, `b`, `x`, `y`, `lb`, `rb`, `lt`, `rt`, `up`, `down`, `left`, `right`, `start`, `select`, `ls`, `rs`, `lx`, `ly`, `rx`, `ry`, etc. These map to both keyboard and gamepad bindings using the engine's default keyboard→button mapping (e.g. `a` → `KeyX` on keyboard, `a` on gamepad).

**Implementation**: On `inp_ctrl_commit`, the InputController reads the `StringValue` from `sys_inp_action` (action name) and `sys_inp_bind` (comma-separated bindings), splits the bindings string by `,`, and accumulates the result into chip-owned `KeyboardInputMapping` / `GamepadInputMapping` tables. The chip manages one persistent `MappingContext` per player (id `'inp_chip'`, layered on top of the host default base context via `ContextStack`). Each commit refreshes that context through `PlayerInput.pushContext('inp_chip', kb, gp, {})`, which replaces the same context id. Reset uses `PlayerInput.clearContext('inp_chip')`. VBlank sampling does not touch mapping contexts.

### Input Latch (per-frame)

The engine already has a complete frame-sampling pipeline:

1. `src/bmsx/machine/runtime/vblank.ts` `enterVblank()` calls `InputController.onVblankEdge(currentTimeMs, nowCycles)`
2. If `inp_ctrl_arm` set the private sample latch, `InputController.onVblankEdge(currentTimeMs, nowCycles)` records `sampleSequence`/`lastSampleCycle`, calls `Input.samplePlayers(currentTimeMs)` once, snapshots committed action status/value words, and clears the latch
3. `Input.samplePlayers(currentTimeMs)` iterates all players, calling `playerInput.beginFrame(currentTime)`
4. `PlayerInput.beginFrame()` iterates all input sources (keyboard, gamepad, pointer), calling `stateManager.beginFrame(currentTime)` (which clears `justpressed`/`justreleased` edge flags) and then `stateManager.latchButtonState(button, handler.getButtonState(button), currentTime)` for every tracked button

This snapshots a consistent per-frame `ButtonState` for all tracked buttons before any cart Lua code runs. The ICU then snapshots committed actions into its own status/value table so later cart queries read the device state, not live host `PlayerInput` state.

The `inp_ctrl_arm` command is the cart-visible latch request. Sampling happens at the hardware edge: the runtime VBlank path calls `InputController.onVblankEdge(currentTimeMs, nowCycles)`, and the ICU performs the armed sample transition exactly once. The latch is then cleared. Mapping contexts are not mutated by the sample edge.

Cart code still writes `mem[sys_inp_ctrl] = inp_ctrl_arm` at the top of the update loop, documenting the frame boundary:

```lua
-- MAIN LOOP:
mem[sys_inp_ctrl] = inp_ctrl_arm  -- acknowledge frame snapshot

mem[sys_inp_query] = &'left[p]'
if mem[sys_inp_status] ~= 0 then
    move_left()
end
```

### Cart Usage Examples

```lua
------------------------------------------------------------
-- INIT: Register action bindings via MMIO
------------------------------------------------------------
mem[sys_inp_action] = &'dash'
mem[sys_inp_bind] = &'lb,left'       -- chord: lb + left
mem[sys_inp_ctrl] = inp_ctrl_commit

mem[sys_inp_action] = &'slash'
mem[sys_inp_bind] = &'a'
mem[sys_inp_ctrl] = inp_ctrl_commit

mem[sys_inp_action] = &'jump'
mem[sys_inp_bind] = &'a'
mem[sys_inp_ctrl] = inp_ctrl_commit

------------------------------------------------------------
-- MAIN LOOP: Latch, then query action expressions
------------------------------------------------------------
-- Acknowledge frame snapshot (MUST be first)
mem[sys_inp_ctrl] = inp_ctrl_arm

-- Simple digital check: is 'left' pressed?
mem[sys_inp_query] = &'left[p]'
if mem[sys_inp_status] ~= 0 then
    move_left()
end

-- Just-pressed check: was 'jump' just pressed this frame?
mem[sys_inp_query] = &'jump[jp]'
if mem[sys_inp_status] ~= 0 then
    jump()
end

-- OR-logic: a single expression handles the combination
mem[sys_inp_query] = &'up[jp] || jump[jp]'
if mem[sys_inp_status] ~= 0 then
    jump()
end

-- Custom action (defined during INIT) with modifier
mem[sys_inp_query] = &'dash[jp]'
if mem[sys_inp_status] ~= 0 then
    do_dash()
end

-- Multiplayer: set player, then query
mem[sys_inp_player] = 2
mem[sys_inp_ctrl] = inp_ctrl_arm
mem[sys_inp_query] = &'left[p]'
local p2_flags<const> = mem[sys_inp_status]
mem[sys_inp_player] = 1              -- switch back

-- Analog value (query the axis action, read value register)
mem[sys_inp_query] = &'lx[p]'
local analog_x<const> = mem[sys_inp_value]

-- Consume an action after handling it (plain action name — no modifier)
mem[sys_inp_consume] = &'jump'

-- Flow analysis allows local variables too:
local q<const> = &'left[p]'
mem[sys_inp_query] = q  -- compiler proves q is string_ref via flow analysis
```

### What the Compiler Must Reject

```lua
-- ❌ Plain string literal (not a string_ref)
mem[sys_inp_query] = 'left[p]'  -- compile error: requires string_ref

-- ❌ Variable with unknown value kind
local x = get_some_string()
mem[sys_inp_query] = x  -- compile error: not proven to be string_ref

-- ❌ String degraded by conditional assignment
local q = &'left[p]'
if something then q = 'other' end  -- q is now 'unknown' after merge
mem[sys_inp_query] = q  -- compile error
```

---

## Implementation Contract

The current implementation is the contract:

- `machine/devices/input/controller.*` owns the ICU registerfile, sample latch, sample sequence/cycle latches, committed action table, and sampled action status/value words.
- `Memory.mapIoWrite()` connects each write register directly to the ICU. There is no runtime dispatch facade.
- `inp_ctrl_commit` updates the selected player's `inp_chip` mapping context and records the committed action ids.
- `inp_ctrl_arm` sets only the private sample latch. The VBlank edge consumes that latch, samples players once, snapshots committed actions into ICU words, and clears the latch.
- `sys_inp_query` evaluates the cached action-expression AST against the ICU snapshot. A root action node returns the sampled packed status/value for that action; any compound expression returns boolean `1`/`0` in `sys_inp_status` and `0` in `sys_inp_value`.
- `sys_inp_consume` consumes the named action in `PlayerInput` and marks the matching ICU snapshot with `inp_status_consumed`.
- Save-state captures the ICU latch/registerfile and committed per-player action records, including sampled `statusWord`, `valueQ16`, `pressTime`, and `repeatCount`; restore rebuilds contexts and preserves the active snapshot.

**Key implementation notes**:
- **Persistent chip context**: The InputController owns a SINGLE `MappingContext` per player (id `'inp_chip'`) that accumulates action definitions across multiple `inp_ctrl_commit` calls. It uses `pushContext()` / `clearContext()` for lifecycle management. Commit manages the context; latch does NOT.
- **Binding resolution**: Uses `Input.DEFAULT_INPUT_MAPPING.keyboard` directly (e.g. `Input.DEFAULT_INPUT_MAPPING.keyboard['a']` → `['KeyX']`). No new `resolveKeyboardKey()` method needed — the mapping table already exists as a frozen object on `Input`. For gamepad, the abstract names ARE the button IDs (identity mapping via `Input.DEFAULT_INPUT_MAPPING.gamepad`).
- **Query semantics**: `onQueryWrite()` calls `ActionDefinitionEvaluator` against the ICU's sampled action table. Simple single-action queries return packed `inp_status_*` bits and a signed Q16.16 value word; complex expressions return a boolean status word. The cart puts the "which flag to check" logic into the expression string itself (e.g. `'left[jp]'` for just-pressed, `'left[p]'` for pressed). Root-level actions require a modifier — enforced by the parser's `enforceRootModifiers()`.
- **Consume semantics**: `onConsumeWrite()` calls `consumeAction(actionName)` — an existing method that iterates all sources, finds pressed+unconsumed bindings for the action, and marks them consumed. Takes a plain action name (no modifiers, no expressions).
- **Latch mechanism**: No new `latchFrame()` method is needed. The runtime VBlank `InputController.onVblankEdge(currentTimeMs, nowCycles)` → `Input.samplePlayers(currentTimeMs)` → `PlayerInput.beginFrame()` → `InputStateManager.beginFrame()` + `latchButtonState()` path snapshots all tracked buttons before cart code runs. The chip's `inp_ctrl_arm` sets the private sample latch; `onVblankEdge()` performs the armed sample transition.

**Note**: The `InputController` no longer delegates query reads to live `PlayerInput`; `sys_inp_status` and `sys_inp_value` are ICU snapshot registers.

### Current Integration Owners

- `Machine` constructs `InputController(memory, input, cpu.stringPool)` on both TS and C++ runtimes.
- `InputController` maps its own write callbacks with `Memory.mapIoWrite()` for `sys_inp_player`, `sys_inp_action`, `sys_inp_bind`, `sys_inp_ctrl`, `sys_inp_query`, and `sys_inp_consume`.
- String-ref registers are stored in the memory IO slot and decoded by the device callback via the CPU/StringPool string id contract.
- `inp_ctrl_commit` owns the chip action table and refreshes the `inp_chip` context with `PlayerInput.pushContext()`.
- `inp_ctrl_reset` clears the chip context with `PlayerInput.clearContext()`.
- `inp_ctrl_arm` sets only the private ICU sample latch.
- Runtime VBlank calls `InputController.onVblankEdge(currentTimeMs, nowCycles)`. When armed, the ICU records `sampleSequence`/`lastSampleCycle`, samples players once through `Input.samplePlayers(currentTimeMs)`, snapshots committed actions, and clears the latch.
- Save-state captures the private sample latch, sample sequence/cycle latches, mirrored registerfile, committed per-player action string ids, and sampled action status/value words. Restore rebuilds the chip-owned contexts from those action records and preserves the active snapshot.
- TS and C++ use the same ownership topology: `machine/devices/input/controller.*` owns the ICU registerfile/latches/context replay, `input/manager.*` owns host device polling and player sampling, and `input/player.*` owns per-player context evaluation.

### Lua Builtin Descriptors

The system constants are exposed through firmware globals and builtin descriptors:

```ts
{ name: 'sys_inp_player', description: 'Input Controller: player index register (1-based).' }
{ name: 'sys_inp_action', description: 'Input Controller: write a string_ref action name for define/commit.' }
{ name: 'sys_inp_bind', description: 'Input Controller: write string_ref button bindings (comma-separated) for current action.' }
{ name: 'sys_inp_ctrl', description: 'Input Controller: write a control command (inp_ctrl_commit, inp_ctrl_arm, inp_ctrl_reset).' }
{ name: 'sys_inp_query', description: 'Input Controller: write a string_ref action expression to evaluate (e.g. left[p], up[jp] || a[jp]).' }
{ name: 'sys_inp_status', description: 'Input Controller: read packed status bits for simple queries, or boolean result for complex expressions.' }
{ name: 'sys_inp_value', description: 'Input Controller: read signed Q16.16 value after a simple query.' }
{ name: 'sys_inp_consume', description: 'Input Controller: write a string_ref action name to consume it.' }
{ name: 'inp_ctrl_commit', description: 'Input Controller command: commit the current action definition (reads sys_inp_action + sys_inp_bind).' }
{ name: 'inp_ctrl_arm', description: 'Input Controller command: latch (sample) input state for this frame.' }
{ name: 'inp_ctrl_reset', description: 'Input Controller command: reset all action definitions to empty.' }
```

### Action State Flag Constants for Lua

The `inp_status_*` constants describe the packed bits in `sys_inp_status` for simple single-action queries.

Cart usage:

```lua
mem[sys_inp_query] = &'a[jp]'
if (mem[sys_inp_status] & inp_status_justpressed) ~= 0 then
    jump()
end
```

## Current Files

| File | Owner role |
|---|---|
| `src/bmsx/machine/bus/io.ts` | TS IO_INP_* address constants and INP_CTRL_* command constants |
| `src/bmsx/machine/bus/registers.ts` | TS string_ref write requirements for action, bind, query, and consume registers |
| `src/bmsx/machine/firmware/globals.ts` | TS Lua globals for IO address constants, control command constants, and flag constants |
| `src/bmsx/machine/firmware/builtin_descriptors.ts` | TS IDE descriptors for sys_inp_*, inp_ctrl_*, and inp_* constants |
| `src/bmsx/machine/common/numeric.ts` | TS shared integer/Q16.16 numeric helpers |
| `src/bmsx/machine/devices/input/controller.ts` | TS ICU MMIO device/registerfile/latches/context replay/query path |
| `src/bmsx/machine/devices/input/contracts.ts` | TS packed ICU action status/value contract |
| `src/bmsx/machine/machine.ts` | TS machine construction, reset, capture, restore wiring for the ICU |
| `src/bmsx/machine/runtime/save_state/codec.ts` | TS save-state encoding/decoding for ICU register/action snapshots |
| `src/bmsx/machine/runtime/save_state/schema.ts` | TS save-state prop table for ICU snapshot fields |
| `src/bmsx/machine/runtime/vblank.ts` | TS VBlank edge call into the ICU sample transition |
| `src/bmsx_cpp/machine/bus/io.h` | C++ IO_INP_* address constants and INP_CTRL_* command constants |
| `src/bmsx_cpp/machine/common/numeric.h` | C++ shared integer/Q16.16 numeric helpers |
| `src/bmsx_cpp/machine/devices/input/controller.cpp/.h` | C++ ICU MMIO device/registerfile/latches/context replay/query path |
| `src/bmsx_cpp/machine/devices/input/contracts.h` | C++ packed ICU action status/value contract |
| `src/bmsx_cpp/machine/machine.cpp/.h` | C++ machine construction, reset, capture, restore wiring for the ICU |
| `src/bmsx_cpp/machine/runtime/save_state/codec.cpp` | C++ save-state encoding/decoding for ICU register/action snapshots |
| `src/bmsx_cpp/machine/runtime/save_state/schema.cpp` | C++ save-state prop table for ICU snapshot fields |
| `src/bmsx_cpp/machine/runtime/vblank.cpp` | C++ VBlank edge call into the ICU sample transition |

## Technical Constraints

1. **No defensive coding**: Trust compiler/MMIO enforcement for string-ref registers. Cast/read the owned representation directly.
2. **No runtime dispatch facade**: ICU writes are delivered through `Memory.mapIoWrite()` callbacks owned by the device.
3. **Performance**: `checkActionTriggered(expr)` uses the shared cached action parser/evaluator. Do not add per-query wrapper allocation, DTO validation, or fallback parsing.
4. **Serialization**: ICU save-state captures the private sample latch, sample sequence/cycle latches, mirrored registers, committed per-player action string ids, and sampled action status/value words. Restore rebuilds chip-owned mapping contexts from those action records.
5. **Latch semantics**: `inp_ctrl_arm` sets the ICU's private sample latch. The runtime VBlank path calls `InputController.onVblankEdge(currentTimeMs, nowCycles)`; when armed, that edge records `sampleSequence`/`lastSampleCycle`, performs the single `Input.samplePlayers(currentTimeMs)` transition, snapshots committed actions, and clears the latch. The sample edge does not mutate mapping contexts.
6. **Binding resolution**: `commitAction()` resolves abstract button names through `Input.DEFAULT_INPUT_MAPPING.keyboard` and `Input.DEFAULT_INPUT_MAPPING.gamepad`. Do not add a duplicate resolver.
7. **Query semantics**: `sys_inp_query` accepts action expressions in the same expression language used by `action_triggered()`.
8. **Consume semantics**: `sys_inp_consume` accepts plain action names and dispatches to `PlayerInput.consumeAction(action)`.
9. **Commit context lifecycle**: `inp_ctrl_commit` manages one persistent `MappingContext` (`inp_chip`) on the player's `ContextStack`. Multiple commits accumulate actions into the same context. `inp_ctrl_reset` clears it. `inp_ctrl_arm` does not touch the context.

## Verification

Current focused validation for ICU changes should include:

1. TS compile: `npx tsc --build ./src/bmsx --pretty false`
2. TS tests: `npx tsx --test --import ./tests/lua/test_setup.ts tests/lua/input_controller.test.ts tests/lua/core_golden.test.ts tests/lua/runtime_save_state_codec.test.ts`
3. Native tests: `cmake --build build-cpp-tests --target bmsx_core_golden_tests bmsx_libretro_save_state_tests --parallel $(nproc)` and `ctest --test-dir build-cpp-tests --output-on-failure -R 'bmsx_core_golden_tests|bmsx_libretro_save_state_tests'`
4. Scoped code-quality analyzer over touched TS/C++ input/runtime/save-state files
5. `npm run audit:core-parity`
6. `npm run build:bios -- --force`

## Existing Code References (exact paths)

- IO register layout: `src/bmsx/machine/bus/io.ts` (all `IO_*_INDEX` / `IO_*` constants)
- Memory map base: `src/bmsx/machine/memory/map.ts` (`IO_BASE`, `IO_WORD_SIZE`)
- MMIO spec: `src/bmsx/machine/bus/registers.ts`
- Frame latch entry point: `src/bmsx/machine/runtime/vblank.ts` `enterVblank()` calls `InputController.onVblankEdge(currentTimeMs, nowCycles)`, which performs the armed ICU sample transition.
- Device examples: `src/bmsx/machine/devices/dma/controller.ts`, `src/bmsx/machine/devices/imgdec/controller.ts`
- String pool: `src/bmsx/machine/cpu/string_pool.ts` (`StringPool`) and `src/bmsx/machine/cpu/cpu.ts` (`StringValue`, `valueIsString()`)
- Compiler validation: `src/bmsx/machine/program/compiler.ts` (`validateMemoryStore`, `resolveMemoryStoreRequirement`)
- Flow analysis: `src/bmsx/machine/program/compile_value_flow.ts` (`evaluateExpressionValueKind`)
- Input system — frame sampling: `src/bmsx/input/manager.ts` `samplePlayers(currentTimeMs)` → iterates players → `PlayerInput.beginFrame()` → `InputStateManager.beginFrame()` + `latchButtonState()`
- Input system — state manager: `src/bmsx/input/manager.ts` `InputStateManager` class (`beginFrame()`, `latchButtonState()`, `getButtonState()`)
- Input system — player: `src/bmsx/input/player.ts` (`checkActionTriggered`, `getActionState`, `consumeAction`, `pushContext`, `clearContext`, `beginFrame`)
- Input system (C++): `src/bmsx_cpp/input/player.cpp` (same methods)
- Input context stacking: `src/bmsx/input/context.ts` (`MappingContext`, `ContextStack` with `push`/`pop`/`enable`/`getBindings`)
- Input types: `src/bmsx/input/models.ts` (`InputMap` for the host default base context, `KeyboardInputMapping`, `GamepadInputMapping`, `ButtonState`, `ActionState`)
- Default keyboard mapping: `src/bmsx/input/manager.ts` `Input.DEFAULT_INPUT_MAPPING.keyboard` — `{ a: ['KeyX'], lb: ['ShiftLeft'], left: ['ArrowLeft'], ... }`
- Default gamepad mapping: `src/bmsx/input/manager.ts` `Input.DEFAULT_INPUT_MAPPING.gamepad` — identity: `{ a: ['a'], lb: ['lb'], ... }`
- Button vocabulary: `src/bmsx/input/manager.ts` `Input.BUTTON_IDS` — `['a','b','x','y','lb','rb','lt','rt','select','start','ls','rs','up','down','left','right','home','touch']`
- Action parser: `src/bmsx/input/action_parser.ts`, `src/bmsx_cpp/input/action_parser.cpp` (expression evaluation — used by the chip's query path via `ActionDefinitionEvaluator` over ICU snapshots)
- Lua globals registration: `src/bmsx/machine/firmware/globals.ts` (pattern: `registerGlobal(runtime, 'sys_*', IO_*)`)
- Lua builtin descriptors: `src/bmsx/machine/firmware/builtin_descriptors.ts`
- Firmware API: `src/bmsx/machine/firmware/api/index.ts` (`action_triggered` implementation via `checkActionTriggered`)
- C++ input: `src/bmsx_cpp/input/manager.h`, `src/bmsx_cpp/input/player.h/.cpp`
- C++ firmware: `src/bmsx_cpp/machine/firmware/api.cpp`, `src/bmsx_cpp/machine/firmware/globals.cpp`
