# Design Note: Input Controller Chip (MMIO Action Query via `string_ref`)

## Goal

Maintain the **Input Controller chip** — a memory-mapped I/O device on the BMSX fantasy console that allows cart Lua code to query input actions via `mem[]` MMIO writes using `&'...'` string_ref syntax. Cart code writes an action expression string_ref into an IO register and reads the boolean result from another IO register; sampling is owned by the ICU VBlank edge, not by host/runtime shortcuts.

BMSX is a fantasy console with real console discipline: cart-visible behavior should route through the machine memory map and device controllers, not through host/runtime shortcuts.

---

## Context: How the Fantasy Console Works

BMSX is a fantasy console with a custom Lua VM. The architecture mirrors retro hardware:

- **Memory-mapped I/O**: Cart code writes to special addresses via `mem[addr] = value`. The compiler lowers this to `STORE_MEM` opcodes. `Memory.mapIoWrite()` connects IO addresses directly to device-owned write callbacks.
- **IO slots**: `memory.ts` stores IO values in `ioSlots[]`. IO slots can hold non-numeric values (including `StringValue` objects) — unlike RAM which only accepts numbers.
- **Device pattern**: Device controllers own their register callbacks, reset state, save-state capture/restore, and service/edge transitions. The ICU is constructed by `Machine` with `Memory`, `Input`, and `StringPool` ownership references.
- **String refs**: The `&'...'` syntax creates a `StringRefLiteralExpression` in the AST, which the compiler interns as a `StringValue` via `program.internString()`. At runtime this is a `StringValue` object (with `.id` and `.text`). When written to an IO slot, the `StringValue` is stored directly (not as a number).
- **Compile-time enforcement**: `registers.ts` defines `MMIO_REGISTER_SPECS` entries with `writeRequirement: 'string_ref'`. The compiler's `validateMemoryStore()` uses flow-sensitive analysis (`compile_value_flow.ts`) to verify that values written to action/bind/query/consume registers are provably `string_ref` values.
- **Input expression evaluator**: The MMIO query path calls `PlayerInput.checkActionTriggered(actionDef)`. This evaluates action parser expressions like `'up[jp] || a[jp]'` via `ActionDefinitionEvaluator`. The result is mirrored to the ICU status register as a boolean word. A lower-level `get_action_state(action, player, window?)` still returns packed flags for callers that need the flag ABI.

---

## Architecture: Input Controller Chip

### Concept

The Input Controller is an MMIO device over the existing `PlayerInput` / `ContextStack` / `InputStateManager` infrastructure. The cart interacts with it purely via MMIO:

1. **Register** action bindings during init: `mem[sys_inp_action] = &'dash'`, `mem[sys_inp_bind] = &'lb,left'`, `mem[sys_inp_ctrl] = inp_ctrl_commit`
2. **Query** a plain action name: `mem[sys_inp_query] = &'left'`
3. **Read** the packed result flags: `local flags = mem[sys_inp_status]`
4. Optionally set the player index: `mem[sys_inp_player] = 2`

The query register accepts **action expressions** — the same expression language used by `action_triggered()`. This includes simple queries like `&'left[p]'` (is left pressed?), `&'jump[jp]'` (was jump just pressed?), and complex boolean expressions like `&'up[jp] || a[jp]'`. The chip dispatches to `PlayerInput.checkActionTriggered(expr)` — the same code path as `action_triggered()` — and writes the boolean result (1 = triggered, 0 = not) to the status register. Root-level actions require a modifier (`[p]`, `[jp]`, `[jr]`, etc.) — this is enforced by the parser's `enforceRootModifiers()`, same rule as `action_triggered()`.

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
| `IO_INP_STATUS_INDEX` | `sys_inp_status` | base+5 | Read | number | Query result: 1 (triggered) or 0 (not triggered). |
| `IO_INP_VALUE_INDEX` | `sys_inp_value` | base+6 | Read | number | Analog value (float in [-1,1] or [0,1]) for analog queries. |
| `IO_INP_CONSUME_INDEX` | `sys_inp_consume` | base+7 | Write | `string_ref` | Plain action name string_ref. Writing triggers `consumeAction()` for that action on the current player. **MMIO write requirement: `string_ref`**. |

Total size: `IO_INP_SIZE = 8`

### Control Commands (`sys_inp_ctrl`)

These are numeric constants written to `sys_inp_ctrl` to trigger chip operations:

| Constant | Name | Value | Description |
|---|---|---|---|
| `INP_CTRL_COMMIT` | `inp_ctrl_commit` | `1` | Commit the current action definition. Reads action name from `sys_inp_action` and bindings from `sys_inp_bind`, then registers the mapping into the chip's **persistent context** for the current player. The first commit creates and pushes a `MappingContext` (id `'inp_chip'`) onto the player's `ContextStack`; subsequent commits update that same context with additional actions. |
| `INP_CTRL_ARM` | `inp_ctrl_arm` | `2` | Arm the ICU sample latch. The next runtime VBlank edge calls `InputController.onVblankEdge(currentTimeMs, nowCycles)`; when armed, the ICU records `sampleSequence`/`lastSampleCycle` and asks the input owner to `samplePlayers(currentTimeMs)` exactly once and clears the latch. |
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
2. If `inp_ctrl_arm` set the private sample latch, `InputController.onVblankEdge(currentTimeMs, nowCycles)` records `sampleSequence`/`lastSampleCycle`, calls `Input.samplePlayers(currentTimeMs)` once, and clears the latch
3. `Input.samplePlayers(currentTimeMs)` iterates all players, calling `playerInput.beginFrame(currentTime)`
4. `PlayerInput.beginFrame()` iterates all input sources (keyboard, gamepad, pointer), calling `stateManager.beginFrame(currentTime)` (which clears `justpressed`/`justreleased` edge flags) and then `stateManager.latchButtonState(button, handler.getButtonState(button), currentTime)` for every tracked button

This already snapshots a consistent per-frame `ButtonState` for all tracked buttons before any cart Lua code runs. The `getActionState()` path reads from these latched states.

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

## Implementation Plan

### Step 1: IO Register Constants (`src/bmsx/machine/bus/io.ts`)

Insert the Input Controller register block. The base index follows the last existing device. Currently the last device block ends at `IO_PAYLOAD_WRITE_PTR_INDEX`. Insert the Input Controller block *before* the payload region:

```ts
// Input Controller registers
export const IO_INP_BASE_INDEX = IO_VDP_STATUS_INDEX + IO_VDP_STATUS_SIZE;
// (Adjust to chain after the actual last non-payload device index)
export const IO_INP_PLAYER_INDEX = IO_INP_BASE_INDEX;
export const IO_INP_ACTION_INDEX = IO_INP_BASE_INDEX + 1;
export const IO_INP_BIND_INDEX = IO_INP_BASE_INDEX + 2;
export const IO_INP_CTRL_INDEX = IO_INP_BASE_INDEX + 3;
export const IO_INP_QUERY_INDEX = IO_INP_BASE_INDEX + 4;
export const IO_INP_STATUS_INDEX = IO_INP_BASE_INDEX + 5;
export const IO_INP_VALUE_INDEX = IO_INP_BASE_INDEX + 6;
export const IO_INP_CONSUME_INDEX = IO_INP_BASE_INDEX + 7;
export const IO_INP_SIZE = 8;
```

**Important**: Adjust the chain so that the GEO block chains into the INP block, and the INP block chains into the payload block. Update `IO_PAYLOAD_WRITE_PTR_INDEX` to `= IO_INP_BASE_INDEX + IO_INP_SIZE`.

Also add the full IO addresses:

```ts
export const IO_INP_BASE = IO_BASE + IO_INP_BASE_INDEX * IO_WORD_SIZE;
export const IO_INP_PLAYER = IO_BASE + IO_INP_PLAYER_INDEX * IO_WORD_SIZE;
export const IO_INP_ACTION = IO_BASE + IO_INP_ACTION_INDEX * IO_WORD_SIZE;
export const IO_INP_BIND = IO_BASE + IO_INP_BIND_INDEX * IO_WORD_SIZE;
export const IO_INP_CTRL = IO_BASE + IO_INP_CTRL_INDEX * IO_WORD_SIZE;
export const IO_INP_QUERY = IO_BASE + IO_INP_QUERY_INDEX * IO_WORD_SIZE;
export const IO_INP_STATUS = IO_BASE + IO_INP_STATUS_INDEX * IO_WORD_SIZE;
export const IO_INP_VALUE = IO_BASE + IO_INP_VALUE_INDEX * IO_WORD_SIZE;
export const IO_INP_CONSUME = IO_BASE + IO_INP_CONSUME_INDEX * IO_WORD_SIZE;
```

Also add control command constants (these are value constants, not addresses):

```ts
// Input Controller control commands (written to IO_INP_CTRL)
export const INP_CTRL_COMMIT = 1;  // Commit current action definition
export const INP_CTRL_ARM = 2;   // Latch (sample) input state for this frame
export const INP_CTRL_RESET = 3;   // Reset all action definitions
```

### Step 2: MMIO Register Specs (`src/bmsx/machine/bus/registers.ts`)

Add the string_ref-enforced registers to `MMIO_REGISTER_SPECS`:

```ts
import { IO_INP_ACTION, IO_INP_BIND, IO_INP_QUERY, IO_INP_CONSUME } from './io';

export const MMIO_REGISTER_SPECS: ReadonlyArray<MmioRegisterSpec> = [
    { name: 'sys_inp_action', address: IO_INP_ACTION, writeRequirement: 'string_ref' },
    { name: 'sys_inp_bind', address: IO_INP_BIND, writeRequirement: 'string_ref' },
    { name: 'sys_inp_query', address: IO_INP_QUERY, writeRequirement: 'string_ref' },
    { name: 'sys_inp_consume', address: IO_INP_CONSUME, writeRequirement: 'string_ref' },
];
```

This makes the compiler enforce `&'...'` syntax for writes to the action, bind, query, and consume registers.

### Step 3: Lua Global Constants (`src/bmsx/machine/firmware/globals.ts`)

Register the IO address constants and control command constants as Lua globals:

```ts
// Input Controller IO addresses
luaPipeline.registerGlobal(runtime, 'sys_inp_player', IO_INP_PLAYER);
luaPipeline.registerGlobal(runtime, 'sys_inp_action', IO_INP_ACTION);
luaPipeline.registerGlobal(runtime, 'sys_inp_bind', IO_INP_BIND);
luaPipeline.registerGlobal(runtime, 'sys_inp_ctrl', IO_INP_CTRL);
luaPipeline.registerGlobal(runtime, 'sys_inp_query', IO_INP_QUERY);
luaPipeline.registerGlobal(runtime, 'sys_inp_status', IO_INP_STATUS);
luaPipeline.registerGlobal(runtime, 'sys_inp_value', IO_INP_VALUE);
luaPipeline.registerGlobal(runtime, 'sys_inp_consume', IO_INP_CONSUME);

// Input Controller control commands
luaPipeline.registerGlobal(runtime, 'inp_ctrl_commit', INP_CTRL_COMMIT);
luaPipeline.registerGlobal(runtime, 'inp_ctrl_arm', INP_CTRL_ARM);
luaPipeline.registerGlobal(runtime, 'inp_ctrl_reset', INP_CTRL_RESET);
```

Also add matching entries to `builtin_descriptors.ts` under the system constants section.

### Step 4: Input Controller Device (`src/bmsx/machine/devices/input/controller.ts`)

Create a new device class following the existing device pattern (see `controller.ts`, `controller.ts`):

```ts
import { Memory } from '../memory';
import { StringValue } from '../string_pool';
import {
    IO_INP_PLAYER, IO_INP_ACTION, IO_INP_BIND, IO_INP_CTRL,
    IO_INP_QUERY, IO_INP_STATUS, IO_INP_VALUE, IO_INP_CONSUME,
    INP_CTRL_COMMIT, INP_CTRL_ARM, INP_CTRL_RESET,
} from '../io';
import { Input } from '../../manager/manager';
import type { KeyboardInputMapping, GamepadInputMapping } from '../../manager/models';

export class InputController {
    private readonly memory: Memory;
    private readonly input: Input;

    // Accumulated action definitions per player (chip-owned persistent context).
    // Maps action name → array of binding IDs.
    private chipKeyboard: KeyboardInputMapping = {};
    private chipGamepad: GamepadInputMapping = {};
    private contextPushed = false;  // Whether 'inp_chip' context is on the stack

    constructor(memory: Memory, input: Input) {
        this.memory = memory;
        this.input = input;
        this.memory.writeValue(IO_INP_PLAYER, 1);
    }

    public reset(): void {
        if (this.contextPushed) {
            const playerIndex = this.memory.readValue(IO_INP_PLAYER) as number;
            this.input.getPlayerInput(playerIndex).clearContext('inp_chip');
            this.contextPushed = false;
        }
        this.memory.writeValue(IO_INP_PLAYER, 1);
        this.memory.writeValue(IO_INP_STATUS, 0);
        this.memory.writeValue(IO_INP_VALUE, 0);
        this.chipKeyboard = {};
        this.chipGamepad = {};
    }

    public onCtrlWrite(): void {
        const cmd = this.memory.readValue(IO_INP_CTRL) as number;
        switch (cmd) {
            case INP_CTRL_COMMIT: this.commitAction(); break;
            case INP_CTRL_ARM: this.latchInput(); break;
            case INP_CTRL_RESET: this.resetActions(); break;
        }
    }

    /**
     * COMMIT: reads action name from sys_inp_action and bindings from sys_inp_bind,
     * parses the comma-separated binding string, accumulates into chip-owned maps,
     * and pushes/replaces the persistent 'inp_chip' context on the player's ContextStack.
     */
    private commitAction(): void {
        const actionName = (this.memory.readValue(IO_INP_ACTION) as StringValue).text;
        const bindStr = (this.memory.readValue(IO_INP_BIND) as StringValue).text;
        const bindings = bindStr.split(',');  // e.g. 'lb,left' → ['lb', 'left']

        // For keyboard: resolve each abstract button name to its default keyboard key(s)
        // using Input.DEFAULT_INPUT_MAPPING.keyboard (e.g. 'a' → 'KeyX', 'lb' → 'ShiftLeft').
        // For gamepad: use button names directly (they ARE gamepad button IDs).
        this.chipGamepad[actionName] = bindings.map(b => ({ id: b }));
        this.chipKeyboard[actionName] = [];
        for (const binding of bindings) {
            this.chipKeyboard[actionName].push(...Input.DEFAULT_INPUT_MAPPING.keyboard[binding]);
        }

        // Manage the persistent context: replace the same context id.
        const playerIndex = this.memory.readValue(IO_INP_PLAYER) as number;
        const playerInput = this.input.getPlayerInput(playerIndex);
        if (this.contextPushed) {
            playerInput.clearContext('inp_chip');
        }
        playerInput.pushContext('inp_chip', this.chipKeyboard, this.chipGamepad, {});
        this.contextPushed = true;
    }

    /**
     * ARM: set the private ICU sample latch. The runtime VBlank edge consumes
     * this latch by calling InputController.onVblankEdge(currentTimeMs, nowCycles), which performs the
     * single `Input.samplePlayers(currentTimeMs)` transition for the frame.
     */
    private latchInput(): void {
        this.sampleArmed = true;
    }

    /** RESET: clear the chip's context and all accumulated action definitions */
    private resetActions(): void {
        if (this.contextPushed) {
            const playerIndex = this.memory.readValue(IO_INP_PLAYER) as number;
            this.input.getPlayerInput(playerIndex).clearContext('inp_chip');
            this.contextPushed = false;
        }
        this.chipKeyboard = {};
        this.chipGamepad = {};
    }

    /**
     * QUERY: dispatches to PlayerInput.checkActionTriggered(expr) — the same
     * expression evaluator used by action_triggered(). Accepts both simple queries
     * like 'left[p]' and complex expressions like 'up[jp] || a[jp]'.
     * Writes the boolean result (1/0) to the status register.
     */
    public onQueryWrite(): void {
        const expr = (this.memory.readValue(IO_INP_QUERY) as StringValue).text;
        const playerIndex = this.memory.readValue(IO_INP_PLAYER) as number;
        const playerInput = this.input.getPlayerInput(playerIndex);
        const triggered = playerInput.checkActionTriggered(expr);
        this.memory.writeValue(IO_INP_STATUS, triggered ? 1 : 0);
    }

    /**
     * CONSUME: dispatches to PlayerInput.consumeAction(actionName).
     * Accepts plain action names (no modifiers/expressions) — consumeAction()
     * marks all pressed+unconsumed bindings for that action as consumed.
     */
    public onConsumeWrite(): void {
        const actionName = (this.memory.readValue(IO_INP_CONSUME) as StringValue).text;
        const playerIndex = this.memory.readValue(IO_INP_PLAYER) as number;
        this.input.getPlayerInput(playerIndex).consumeAction(actionName);
    }
}
```

**Key implementation notes**:
- **Persistent chip context**: The InputController owns a SINGLE `MappingContext` per player (id `'inp_chip'`) that accumulates action definitions across multiple `inp_ctrl_commit` calls. It uses `pushContext()` / `clearContext()` for lifecycle management. Commit manages the context; latch does NOT.
- **Binding resolution**: Uses `Input.DEFAULT_INPUT_MAPPING.keyboard` directly (e.g. `Input.DEFAULT_INPUT_MAPPING.keyboard['a']` → `['KeyX']`). No new `resolveKeyboardKey()` method needed — the mapping table already exists as a frozen object on `Input`. For gamepad, the abstract names ARE the button IDs (identity mapping via `Input.DEFAULT_INPUT_MAPPING.gamepad`).
- **Query semantics**: `onQueryWrite()` calls `checkActionTriggered(expr)` — the same expression evaluator used by `action_triggered()`. It parses the expression via `ActionDefinitionEvaluator` (which uses cached ASTs from `InputActionParser`), calls `getActionState()` internally for each referenced action, and evaluates the boolean expression (including modifiers like `[p]`, `[jp]`, `[jr]` and operators `||`, `&&`, `!`). The status register holds 1 (triggered) or 0 (not triggered). The cart puts the "which flag to check" logic into the expression string itself (e.g. `'left[jp]'` for just-pressed, `'left[p]'` for pressed). Root-level actions require a modifier — enforced by the parser's `enforceRootModifiers()`.
- **Consume semantics**: `onConsumeWrite()` calls `consumeAction(actionName)` — an existing method that iterates all sources, finds pressed+unconsumed bindings for the action, and marks them consumed. Takes a plain action name (no modifiers, no expressions).
- **Latch mechanism**: No new `latchFrame()` method is needed. The runtime VBlank `InputController.onVblankEdge(currentTimeMs, nowCycles)` → `Input.samplePlayers(currentTimeMs)` → `PlayerInput.beginFrame()` → `InputStateManager.beginFrame()` + `latchButtonState()` path snapshots all tracked buttons before cart code runs. The chip's `inp_ctrl_arm` sets the private sample latch; `onVblankEdge()` performs the armed sample transition.

**Note**: The `InputController` does not use `packActionStateFlags` — the status register is a simple boolean (1/0) since modifier semantics are embedded in the expression string. The `ACTION_STATE_FLAG_*` constants remain useful for the existing `get_action_state()` Lua native function.

### Current Integration Owners

- `Machine` constructs `InputController(memory, input, cpu.stringPool)` on both TS and C++ runtimes.
- `InputController` maps its own write callbacks with `Memory.mapIoWrite()` for `sys_inp_player`, `sys_inp_action`, `sys_inp_bind`, `sys_inp_ctrl`, `sys_inp_query`, and `sys_inp_consume`.
- String-ref registers are stored in the memory IO slot and decoded by the device callback via the CPU/StringPool string id contract.
- `inp_ctrl_commit` owns the chip action table and refreshes the `inp_chip` context with `PlayerInput.pushContext()`.
- `inp_ctrl_reset` clears the chip context with `PlayerInput.clearContext()`.
- `inp_ctrl_arm` sets only the private ICU sample latch.
- Runtime VBlank calls `InputController.onVblankEdge(currentTimeMs, nowCycles)`. When armed, the ICU records `sampleSequence`/`lastSampleCycle`, samples players once through `Input.samplePlayers(currentTimeMs)`, and clears the latch.
- Save-state captures the private sample latch, sample sequence/cycle latches, mirrored registerfile, and committed per-player action string ids. Restore rebuilds the chip-owned contexts from those action records.
- TS and C++ use the same ownership topology: `machine/devices/input/controller.*` owns the ICU registerfile/latches/context replay, `input/manager.*` owns host device polling and player sampling, and `input/player.*` owns per-player context evaluation.

### Lua Builtin Descriptors

The system constants are exposed through firmware globals and builtin descriptors:

```ts
{ name: 'sys_inp_player', description: 'Input Controller: player index register (1-based).' }
{ name: 'sys_inp_action', description: 'Input Controller: write a string_ref action name for define/commit.' }
{ name: 'sys_inp_bind', description: 'Input Controller: write string_ref button bindings (comma-separated) for current action.' }
{ name: 'sys_inp_ctrl', description: 'Input Controller: write a control command (inp_ctrl_commit, inp_ctrl_arm, inp_ctrl_reset).' }
{ name: 'sys_inp_query', description: 'Input Controller: write a string_ref action expression to evaluate (e.g. left[p], up[jp] || a[jp]).' }
{ name: 'sys_inp_status', description: 'Input Controller: read query result (1 = triggered, 0 = not triggered).' }
{ name: 'sys_inp_value', description: 'Input Controller: read analog value after a query.' }
{ name: 'sys_inp_consume', description: 'Input Controller: write a string_ref action name to consume it.' }
{ name: 'inp_ctrl_commit', description: 'Input Controller command: commit the current action definition (reads sys_inp_action + sys_inp_bind).' }
{ name: 'inp_ctrl_arm', description: 'Input Controller command: latch (sample) input state for this frame.' }
{ name: 'inp_ctrl_reset', description: 'Input Controller command: reset all action definitions to empty.' }
```

### Action State Flag Constants for Lua

The `ACTION_STATE_FLAG_*` constants from `engine.ts` remain useful as Lua globals for the existing `get_action_state()` native function. The MMIO chip itself does not use them: its status register is boolean 1/0 because modifier semantics live in the expression string.

Cart usage:

```lua
mem[sys_inp_query] = &'a[jp]'
if mem[sys_inp_status] ~= 0 then
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
| `src/bmsx/machine/devices/input/controller.ts` | TS ICU MMIO device/registerfile/latches/context replay/query path |
| `src/bmsx/machine/machine.ts` | TS machine construction, reset, capture, restore wiring for the ICU |
| `src/bmsx/machine/runtime/vblank.ts` | TS VBlank edge call into the ICU sample transition |
| `src/bmsx_cpp/machine/bus/io.h` | C++ IO_INP_* address constants and INP_CTRL_* command constants |
| `src/bmsx_cpp/machine/devices/input/controller.cpp/.h` | C++ ICU MMIO device/registerfile/latches/context replay/query path |
| `src/bmsx_cpp/machine/machine.cpp/.h` | C++ machine construction, reset, capture, restore wiring for the ICU |
| `src/bmsx_cpp/machine/runtime/vblank.cpp` | C++ VBlank edge call into the ICU sample transition |

## Technical Constraints

1. **No defensive coding**: Trust compiler/MMIO enforcement for string-ref registers. Cast/read the owned representation directly.
2. **No runtime dispatch facade**: ICU writes are delivered through `Memory.mapIoWrite()` callbacks owned by the device.
3. **Performance**: `checkActionTriggered(expr)` uses the shared cached action parser/evaluator. Do not add per-query wrapper allocation, DTO validation, or fallback parsing.
4. **Serialization**: ICU save-state captures the private sample latch, sample sequence/cycle latches, mirrored registers, and committed per-player action string ids. Restore rebuilds chip-owned mapping contexts from those action records.
5. **Latch semantics**: `inp_ctrl_arm` sets the ICU's private sample latch. The runtime VBlank path calls `InputController.onVblankEdge(currentTimeMs, nowCycles)`; when armed, that edge records `sampleSequence`/`lastSampleCycle`, performs the single `Input.samplePlayers(currentTimeMs)` transition, and clears the latch. The sample edge does not mutate mapping contexts.
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
- Action parser: `src/bmsx/input/action_parser.ts`, `src/bmsx_cpp/input/action_parser.cpp` (expression evaluation — used by the chip's query path via `checkActionTriggered()` → `ActionDefinitionEvaluator`)
- Engine core: `src/bmsx/core/engine.ts` (`action_triggered`, `get_action_state`, `packActionStateFlags`)
- Lua globals registration: `src/bmsx/machine/firmware/globals.ts` (pattern: `registerGlobal(runtime, 'sys_*', IO_*)`)
- Lua builtin descriptors: `src/bmsx/machine/firmware/builtin_descriptors.ts`
- Firmware API: `src/bmsx/machine/firmware/api/index.ts` (`action_triggered` implementation via `checkActionTriggered`)
- C++ input: `src/bmsx_cpp/input/manager.h`, `src/bmsx_cpp/input/player.h/.cpp`
- C++ firmware: `src/bmsx_cpp/machine/firmware/api.cpp`, `src/bmsx_cpp/machine/firmware/globals.cpp`
