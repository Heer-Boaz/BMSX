# Design Note: Input Controller Chip (MMIO Action Query via `string_ref`)

## Goal

Implement a new **Input Controller chip** — a memory-mapped I/O device on the BMSX fantasy console that allows cart Lua code to query input actions via `mem[]` MMIO writes using the new `&'...'` string_ref syntax. This replaces the current `action_triggered(...)` native function call with a hardware-style MMIO interface where the cart writes an action expression string (as a `string_ref`) into an IO register, and reads back the boolean result from another IO register.

BMSX is a fantasy console with real console discipline: cart-visible behavior should route through the machine memory map and device controllers, not through host/runtime shortcuts.

---

## Context: How the Fantasy Console Works

BMSX is a fantasy console with a custom Lua VM. The architecture mirrors retro hardware:

- **Memory-mapped I/O**: Cart code writes to special addresses via `mem[addr] = value`. The compiler lowers this to `STORE_MEM` opcodes. The runtime dispatches IO writes to device controllers.
- **IO slots**: `memory.ts` stores IO values in `ioSlots[]`. IO writes call `ioWriteHandler.onIoWrite(addr, value)`. IO slots can hold non-numeric values (including `StringValue` objects) — unlike RAM which only accepts numbers.
- **Runtime dispatch**: `runtime.ts` has an `onIoWrite(addr, value)` method that checks the address and dispatches to the appropriate device controller (DMA, IMGDEC, GEO, etc.).
- **Device pattern**: Each device is a class with `reset()`, `onCtrlWrite()`, and `onService()` methods. Devices are instantiated in `runtime.ts` with references to `Memory`, IRQ callbacks, and scheduling callbacks. See `src/bmsx/machine/devices/*.ts` for examples.
- **String refs**: The `&'...'` syntax creates a `StringRefLiteralExpression` in the AST, which the compiler interns as a `StringValue` via `program.internString()`. At runtime this is a `StringValue` object (with `.id` and `.text`). When written to an IO slot, the `StringValue` is stored directly (not as a number).
- **Compile-time enforcement**: `registers.ts` defines `MMIO_REGISTER_SPECS` with `writeRequirement: 'string_ref'`. The compiler's `validateMemoryStore()` uses flow-sensitive analysis (`compile_value_flow.ts`) to verify that any value written to such an address is provably a `string_ref` at compile time. The spec array is currently empty (placeholder comment says "Input Controller registers will be added here").
- **Existing input API**: Cart code currently calls `action_triggered('left[p]')` — a native function that calls `PlayerInput.checkActionTriggered(actionDef)`. This evaluates action parser expressions like `'up[jp] || a[jp]'` via `ActionDefinitionEvaluator`. The result is a boolean. A lower-level `get_action_state(action, player, window?)` returns packed flags as a number. The MMIO chip mirrors the `action_triggered()` path — same expression language, same `checkActionTriggered()` dispatch.

---

## Architecture: The New Input Controller Chip

### Concept

The Input Controller is an MMIO device over the existing `PlayerInput` / `ContextStack` / `InputStateManager` infrastructure. The cart interacts with it purely via MMIO:

1. **Register** action bindings during init: `mem[sys_inp_action] = &'dash'`, `mem[sys_inp_bind] = &'lb,left'`, `mem[sys_inp_ctrl] = inp_ctrl_commit`
2. **Query** a plain action name: `mem[sys_inp_query] = &'left'`
3. **Read** the packed result flags: `local flags = mem[sys_inp_status]`
4. Optionally set the player index: `mem[sys_inp_player] = 2`

The query register accepts **action expressions** — the same expression language used by `action_triggered()`. This includes simple queries like `&'left[p]'` (is left pressed?), `&'jump[jp]'` (was jump just pressed?), and complex boolean expressions like `&'up[jp] || a[jp]'`. The chip dispatches to `PlayerInput.checkActionTriggered(expr)` — the same code path as `action_triggered()` — and writes the boolean result (1 = triggered, 0 = not) to the status register. Root-level actions require a modifier (`[p]`, `[jp]`, `[jr]`, etc.) — this is enforced by the parser's `enforceRootModifiers()`, same rule as `action_triggered()`.

The compiler statically verifies that only `string_ref` values (not plain strings or numbers) can be written to the query, action, bind, and consume registers.

### IO Register Layout

Add the following IO registers to `io.ts`, immediately after the last existing device (GEO/Payload), before `IO_SLOT_COUNT`:

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
| `INP_CTRL_ARM` | `inp_ctrl_arm` | `2` | **Acknowledge/mark the current frame's input snapshot.** The engine already calls `Input.beginFrame()` at the start of each guest update phase (in `runtime.beginGuestUpdatePhase()`), which runs `PlayerInput.beginFrame()` → `InputStateManager.beginFrame()` + `latchButtonState()` for all tracked buttons. The `inp_ctrl_arm` command hooks into this **existing** frame-sampling path — it does NOT invent a new latch mechanism or call `beginFrame()` again. It may serve as a cart-side discipline marker (chip refuses queries unless latched this frame) or as a no-op that documents intent. |
| `INP_CTRL_RESET` | `inp_ctrl_reset` | `3` | Pop the chip's `'inp_chip'` context from the current player's `ContextStack` and clear all accumulated action definitions. |

### Action Map Registration (INIT phase)

Before the main loop, the cart defines its action-to-button bindings via MMIO — the chip equivalent of `set_input_map()`:

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

**Implementation**: On `inp_ctrl_commit`, the InputController reads the `StringValue` from `sys_inp_action` (action name) and `sys_inp_bind` (comma-separated bindings), splits the bindings string by `,`, and accumulates the result into a chip-owned `KeyboardInputMapping` / `GamepadInputMapping`. The chip manages a **single persistent `MappingContext`** per player (id `'inp_chip'`, layered on top of the base context via `ContextStack`). On the first commit for a player, it creates and pushes the context via `PlayerInput.pushContext('inp_chip', kb, gp, {})`. On subsequent commits, it pops the old context, updates the mapping tables, and pushes a new one — or mutates the existing context's keyboard/gamepad fields directly if `ContextStack` permits that. Reset pops the context via `PlayerInput.popContext('inp_chip')`. Latch does NOT touch the context.

### Input Latch (per-frame)

The engine already has a complete frame-sampling pipeline:

1. `runtime.beginGuestUpdatePhase()` calls `Input.instance.beginFrame()`
2. `Input.beginFrame()` iterates all players, calling `playerInput.beginFrame(currentTime)`
3. `PlayerInput.beginFrame()` iterates all input sources (keyboard, gamepad, pointer), calling `stateManager.beginFrame(currentTime)` (which clears `justpressed`/`justreleased` edge flags) and then `stateManager.latchButtonState(button, handler.getButtonState(button), currentTime)` for every tracked button

This already snapshots a consistent per-frame `ButtonState` for all tracked buttons before any cart Lua code runs. The `getActionState()` path reads from these latched states.

The `inp_ctrl_arm` command **hooks into this existing snapshot semantics**. It does NOT invent a new sampling mechanism, does NOT call `beginFrame()` again (which would double-increment the frame counter and corrupt edge detection), and does NOT mutate any mapping contexts. Its role is one of:

- **Discipline marker**: The chip tracks a `latchedThisFrame` flag per player. `inp_ctrl_arm` sets it; queries check it and fault if the cart forgot to latch. At frame boundaries the flag resets. This enforces "latch before query" hygiene.
- **Explicit re-sample**: If a future design needs mid-frame re-sampling (e.g. for split-phase updates), `inp_ctrl_arm` could call `playerInput.beginFrame(currentTime)` again — but only if the `InputStateManager` is made reentrant-safe. For now, the engine's single `beginFrame()` per guest update phase is sufficient.

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
            this.input.getPlayerInput(playerIndex).popContext('inp_chip');
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
        // using Input.DEFAULT_KEYBOARD_INPUT_MAPPING (e.g. 'a' → 'KeyX', 'lb' → 'ShiftLeft').
        // For gamepad: use button names directly (they ARE gamepad button IDs).
        this.chipGamepad[actionName] = bindings;
        this.chipKeyboard[actionName] = bindings.map(
            b => Input.DEFAULT_KEYBOARD_INPUT_MAPPING[b]?.[0] ?? b
        );

        // Manage the persistent context: pop old, push updated
        const playerIndex = this.memory.readValue(IO_INP_PLAYER) as number;
        const playerInput = this.input.getPlayerInput(playerIndex);
        if (this.contextPushed) {
            playerInput.popContext('inp_chip');
        }
        playerInput.pushContext('inp_chip', this.chipKeyboard, this.chipGamepad, {});
        this.contextPushed = true;
    }

    /**
     * LATCH: hooks into the existing frame-sampling path.
     * The engine already calls Input.beginFrame() → PlayerInput.beginFrame() →
     * InputStateManager.beginFrame() + latchButtonState() at the start of each
     * guest update phase. This command does NOT re-sample or mutate contexts.
     *
     * If desired, implement as a discipline marker: set a latchedThisFrame flag
     * that queries check, and reset it at frame boundaries.
     */
    private latchInput(): void {
        // Acknowledge frame snapshot for the current player.
        // The actual button state sampling is already done by the engine's
        // beginGuestUpdatePhase() → Input.beginFrame() path.
        // No new latch mechanism needed — hook into existing semantics.
    }

    /** RESET: pop the chip's context and clear all accumulated action definitions */
    private resetActions(): void {
        if (this.contextPushed) {
            const playerIndex = this.memory.readValue(IO_INP_PLAYER) as number;
            this.input.getPlayerInput(playerIndex).popContext('inp_chip');
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
- **Persistent chip context**: The InputController owns a SINGLE `MappingContext` per player (id `'inp_chip'`) that accumulates action definitions across multiple `inp_ctrl_commit` calls. It uses `pushContext()` / `popContext()` for lifecycle management. Commit manages the context; latch does NOT.
- **Binding resolution**: Uses `Input.DEFAULT_KEYBOARD_INPUT_MAPPING` directly (e.g. `Input.DEFAULT_KEYBOARD_INPUT_MAPPING['a']` → `['KeyX']`). No new `resolveKeyboardKey()` method needed — the mapping table already exists as a frozen object on `Input`. For gamepad, the abstract names ARE the button IDs (identity mapping via `Input.DEFAULT_GAMEPAD_INPUT_MAPPING`).
- **Query semantics**: `onQueryWrite()` calls `checkActionTriggered(expr)` — the same expression evaluator used by `action_triggered()`. It parses the expression via `ActionDefinitionEvaluator` (which uses cached ASTs from `InputActionParser`), calls `getActionState()` internally for each referenced action, and evaluates the boolean expression (including modifiers like `[p]`, `[jp]`, `[jr]` and operators `||`, `&&`, `!`). The status register holds 1 (triggered) or 0 (not triggered). The cart puts the "which flag to check" logic into the expression string itself (e.g. `'left[jp]'` for just-pressed, `'left[p]'` for pressed). Root-level actions require a modifier — enforced by the parser's `enforceRootModifiers()`.
- **Consume semantics**: `onConsumeWrite()` calls `consumeAction(actionName)` — an existing method that iterates all sources, finds pressed+unconsumed bindings for the action, and marks them consumed. Takes a plain action name (no modifiers, no expressions).
- **Latch mechanism**: No new `latchFrame()` method is needed. The engine's existing `beginGuestUpdatePhase()` → `Input.beginFrame()` → `PlayerInput.beginFrame()` → `InputStateManager.beginFrame()` + `latchButtonState()` path already snapshots all tracked buttons per frame before cart code runs. The chip's `inp_ctrl_arm` hooks into this existing semantics — it may set a discipline flag, but it does NOT re-sample.

**Note**: The `InputController` does not use `packActionStateFlags` — the status register is a simple boolean (1/0) since modifier semantics are embedded in the expression string. The `ACTION_STATE_FLAG_*` constants remain useful for the existing `get_action_state()` Lua native function.

### Step 5: Runtime IO Write Dispatch (`src/bmsx/machine/runtime/runtime.ts`)

In `onIoWrite()`, add handling for the Input Controller registers. Note: the current `onIoWrite` early-returns if `typeof value !== 'number'` — this must be adjusted because the Input Controller accepts `StringValue` writes:

```ts
// In onIoWrite, BEFORE the typeof value !== 'number' early return:
if (addr === IO_INP_ACTION || addr === IO_INP_BIND) {
    return; // StringValue stored in IO slot; no dispatch needed (read on COMMIT)
}
if (addr === IO_INP_QUERY) {
    this.inputController.onQueryWrite();
    return;
}
if (addr === IO_INP_CONSUME) {
    this.inputController.onConsumeWrite();
    return;
}
if (addr === IO_INP_CTRL) {
    this.inputController.onCtrlWrite();
    return;
}
// The existing typeof value !== 'number' guard must come AFTER these checks,
// or be restructured to allow StringValue for known IO addresses.
```

**Critical**: The existing guard `if (typeof value !== 'number') { return; }` at the top of `onIoWrite` silently ignores all non-numeric IO writes. This must be restructured so that string_ref writes to the Input Controller registers are dispatched properly. The simplest fix is to check for the Input Controller addresses before the numeric guard.

**Note**: `sys_inp_action` and `sys_inp_bind` don't need dispatch on write — they just store the StringValue in the IO slot. The device reads them later when `sys_inp_ctrl = inp_ctrl_commit` is written. However, they still need to be handled before the `typeof value !== 'number'` guard, because they contain StringValues that would be dropped by the guard.

Also instantiate the `InputController` in the runtime constructor alongside the other device controllers:

```ts
this.inputController = new InputController(this.memory, this.input);
```

And call `this.inputController.reset()` in the runtime's reset path.

### Step 6: C++ Parity (`src/bmsx_cpp/`)

The C++ (libretro) runtime needs matching implementation:

1. **IO constants** in `src/bmsx_cpp/machine/bus/io.h`
2. **Input Controller device class** in `src/bmsx_cpp/machine/devices/input/controller.cpp/.h`
3. **Runtime dispatch** in the C++ runtime's IO write handler, same structure as TS
4. **String handling**: In C++, the IO slot will contain a string handle ID (not a `StringValue` object). The device reads the handle, resolves it via the string pool to get the text, then evaluates the action query. The C++ `PlayerInput::getActionState()` and `PlayerInput::consumeAction()` already exist.

### Step 7: Lua Builtin Descriptors (`src/bmsx/machine/firmware/builtin_descriptors.ts`)

Add descriptors for the new system constants so they appear in IDE autocomplete:

```ts
// In the system constants section — IO address registers:
{ name: 'sys_inp_player', description: 'Input Controller: player index register (1-based).' },
{ name: 'sys_inp_action', description: 'Input Controller: write a string_ref action name for define/commit.' },
{ name: 'sys_inp_bind', description: 'Input Controller: write string_ref button bindings (comma-separated) for current action.' },
{ name: 'sys_inp_ctrl', description: 'Input Controller: write a control command (inp_ctrl_commit, inp_ctrl_arm, inp_ctrl_reset).' },
{ name: 'sys_inp_query', description: 'Input Controller: write a string_ref action expression to evaluate (e.g. left[p], up[jp] || a[jp]).' },
{ name: 'sys_inp_status', description: 'Input Controller: read query result (1 = triggered, 0 = not triggered).' },
{ name: 'sys_inp_value', description: 'Input Controller: read analog value after a query.' },
{ name: 'sys_inp_consume', description: 'Input Controller: write a string_ref action name to consume it.' },

// Control command constants:
{ name: 'inp_ctrl_commit', description: 'Input Controller command: commit the current action definition (reads sys_inp_action + sys_inp_bind).' },
{ name: 'inp_ctrl_arm', description: 'Input Controller command: latch (sample) input state for this frame.' },
{ name: 'inp_ctrl_reset', description: 'Input Controller command: reset all action definitions to empty.' },
```

### Step 8: Action State Flag Constants for Lua

The `ACTION_STATE_FLAG_*` constants from `engine.ts` are still useful as Lua globals for the existing `get_action_state()` native function. The MMIO chip itself does not use them (its status register is boolean 1/0, since modifier semantics live in the expression string), but they should still be exposed:

```ts
luaPipeline.registerGlobal(runtime, 'inp_pressed', ACTION_STATE_FLAG_PRESSED);         // 1 << 0
luaPipeline.registerGlobal(runtime, 'inp_justpressed', ACTION_STATE_FLAG_JUSTPRESSED);   // 1 << 1
luaPipeline.registerGlobal(runtime, 'inp_justreleased', ACTION_STATE_FLAG_JUSTRELEASED); // 1 << 2
luaPipeline.registerGlobal(runtime, 'inp_consumed', ACTION_STATE_FLAG_CONSUMED);         // 1 << 5
luaPipeline.registerGlobal(runtime, 'inp_guardedjustpressed', ACTION_STATE_FLAG_GUARDEDJUSTPRESSED); // 1 << 9
luaPipeline.registerGlobal(runtime, 'inp_repeatpressed', ACTION_STATE_FLAG_REPEATPRESSED); // 1 << 10
```

Cart usage becomes readable:
```lua
mem[sys_inp_query] = &'a[jp]'
if mem[sys_inp_status] ~= 0 then
    jump()
end
```

---

## Files to Modify (Summary)

| File | Action |
|---|---|
| `src/bmsx/machine/bus/io.ts` | Add IO_INP_* index and address constants + INP_CTRL_* command constants |
| `src/bmsx/machine/bus/registers.ts` | Add string_ref write requirements for action, bind, query, and consume registers |
| `src/bmsx/machine/firmware/globals.ts` | Register IO address constants + control command constants + flag constants as Lua globals |
| `src/bmsx/machine/firmware/builtin_descriptors.ts` | Add descriptor entries for all new sys_inp_*, inp_ctrl_*, and inp_* constants |
| `src/bmsx/machine/devices/input/controller.ts` | **New file**: InputController MMIO device over PlayerInput / ContextStack, uses `checkActionTriggered()` for expression queries |
| `src/bmsx/machine/runtime/runtime.ts` | Instantiate InputController, dispatch IO writes in onIoWrite (including string_ref writes), fix non-numeric guard |
| `src/bmsx_cpp/machine/bus/io.h` | C++ IO constants + control command constants |
| `src/bmsx_cpp/machine/devices/input/controller.cpp/.h` | **New files**: C++ InputController with same register/query/consume semantics |
| `src/bmsx_cpp/machine/runtime/runtime.cpp` | C++ runtime dispatch |

---

## Technical Constraints

1. **No defensive coding**: Trust that the compiler's MMIO enforcement ensures only `StringValue` objects reach the Input Controller's action/bind/query/consume registers. Cast directly — don't check `isStringValue()`.
2. **No legacy fallback**: The existing `action_triggered()` native function continues to work. The MMIO Input Controller is an additional, parallel interface — not a replacement. Carts can use either. Both use the same underlying `checkActionTriggered()` → `ActionDefinitionEvaluator` path.
3. **Performance**: `checkActionTriggered(expr)` parses the expression (cached via `ActionDefinitionEvaluator.cache`), calls `getActionState()` internally for each referenced action, and evaluates the boolean. This is identical cost to the existing `action_triggered()` native — they share the same code path. No new allocations per query thanks to the AST cache.
4. **Serialization**: IO register values are transient per-frame state. The chip's accumulated action definitions (`chipKeyboard`/`chipGamepad`) and `contextPushed` flag are runtime config, not game state. `reset()` clears everything. No serialization needed.
5. **The `onIoWrite` non-numeric guard**: This is the most critical integration detail. The guard `if (typeof value !== 'number') { return; }` currently drops all non-numeric writes silently. String_ref writes to the Input Controller produce a `StringValue` which is not a number. The guard must be restructured. All four string_ref registers (`sys_inp_action`, `sys_inp_bind`, `sys_inp_query`, `sys_inp_consume`) need handling before the guard.
6. **Shared flag constants**: The `ACTION_STATE_FLAG_*` constants in `engine.ts` remain useful for the existing `get_action_state()` Lua native. The chip itself does not use them — its status register is a boolean (1/0) since modifier semantics are embedded in the action expression.
7. **Latch semantics**: The engine already calls `Input.beginFrame()` at `runtime.beginGuestUpdatePhase()`, which runs `PlayerInput.beginFrame()` → `InputStateManager.beginFrame()` (clears edge flags, increments frame counter) + `latchButtonState()` for all tracked buttons. This already provides a consistent per-frame snapshot before cart code runs. The chip's `inp_ctrl_arm` hooks into this **existing** sampling path. It does NOT call `beginFrame()` again (which would double-increment the frame counter), does NOT create a new sampling mechanism, and does NOT mutate mapping contexts. No new `latchFrame()` method is needed.
8. **Binding resolution**: The `commitAction()` flow resolves abstract button names (`a`, `lb`, `left`) to keyboard key codes via `Input.DEFAULT_KEYBOARD_INPUT_MAPPING` — an existing frozen object: `{ a: ['KeyX'], lb: ['ShiftLeft'], left: ['ArrowLeft'], ... }`. No new `resolveKeyboardKey()` method is needed — read directly from the existing mapping table. For gamepad, the abstract names ARE the button IDs (identity mapping via `Input.DEFAULT_GAMEPAD_INPUT_MAPPING`).
9. **Query semantics**: `sys_inp_query` accepts **action expressions** — the same expression language used by `action_triggered()`. Both simple queries (`'left[p]'`, `'dash[jp]'`) and compound expressions (`'up[jp] || a[jp]'`, `'left[p] && !dash[p]'`) are supported. Root-level actions require a modifier (`[p]`, `[jp]`, `[jr]`, etc.) — enforced by `enforceRootModifiers()` in the parser. The status register holds 1 (triggered) or 0 (not triggered).
10. **Consume semantics**: `sys_inp_consume` accepts **plain action names** (no modifiers, no expressions). It dispatches to `PlayerInput.consumeAction(action)`, which iterates all sources and marks pressed+unconsumed bindings for that action as consumed.
11. **Commit context lifecycle**: `inp_ctrl_commit` manages a **persistent `MappingContext`** (id `'inp_chip'`) on the player's `ContextStack`. Multiple commits accumulate actions into the same context. `inp_ctrl_reset` pops it. `inp_ctrl_arm` does NOT touch the context. The `ContextStack.push()` / `pop()` by id mechanism already supports this pattern.

---

## Verification

1. `npx tsc --noEmit` — zero errors
2. `npm run build:bios -- --debug --force` — BIOS builds
3. `npm run build:game -- pietious --debug --force` — game builds (even without using new registers)
4. `npm run headless:game -- pietious` — headless runs
5. Write a test Lua snippet that uses the MMIO Input Controller and verify it compiles and runs
6. Write a test Lua snippet with a plain string write to `sys_inp_query` and verify the compiler rejects it
7. `npm run build:platform:libretro-wsl` — libretro core builds with C++ parity

---

## Existing Code References (exact paths)

- IO register layout: `src/bmsx/machine/bus/io.ts` (all `IO_*_INDEX` / `IO_*` constants)
- Memory map base: `src/bmsx/machine/memory/map.ts` (`IO_BASE`, `IO_WORD_SIZE`)
- MMIO spec: `src/bmsx/machine/bus/registers.ts`
- Runtime IO dispatch: `src/bmsx/machine/runtime/runtime.ts` (`onIoWrite`)
- Frame latch entry point: `src/bmsx/machine/runtime/runtime.ts` `beginGuestUpdatePhase()` (calls `Input.instance.beginFrame()` at `guestUpdatePhaseDepth === 0`)
- Device examples: `src/bmsx/machine/devices/dma/controller.ts`, `src/bmsx/machine/devices/imgdec/controller.ts`
- String pool: `src/bmsx/machine/memory/string/pool.ts` (`StringValue` class, `valueIsString()`)
- Compiler validation: `src/bmsx/machine/program/compiler.ts` (`validateMemoryStore`, `resolveMemoryStoreRequirement`)
- Flow analysis: `src/bmsx/machine/program/compile_value_flow.ts` (`evaluateExpressionValueKind`)
- Input system — frame sampling: `src/bmsx/input/manager.ts` `beginFrame()` → iterates players → `PlayerInput.beginFrame()` → `InputStateManager.beginFrame()` + `latchButtonState()`
- Input system — state manager: `src/bmsx/input/manager.ts` `InputStateManager` class (`beginFrame()`, `latchButtonState()`, `getButtonState()`)
- Input system — player: `src/bmsx/input/player.ts` (`checkActionTriggered`, `getActionState`, `consumeAction`, `pushContext`, `popContext`, `setInputMap`, `beginFrame`)
- Input system (C++): `src/bmsx_cpp/input/player.cpp` (same methods)
- Input context stacking: `src/bmsx/input/context.ts` (`MappingContext`, `ContextStack` with `push`/`pop`/`enable`/`getBindings`)
- Input types: `src/bmsx/input/models.ts` (`InputMap`, `KeyboardInputMapping`, `GamepadInputMapping`, `ButtonState`, `ActionState`)
- Default keyboard mapping: `src/bmsx/input/manager.ts` `Input.DEFAULT_KEYBOARD_INPUT_MAPPING` — `{ a: ['KeyX'], lb: ['ShiftLeft'], left: ['ArrowLeft'], ... }` (frozen)
- Default gamepad mapping: `src/bmsx/input/manager.ts` `Input.DEFAULT_GAMEPAD_INPUT_MAPPING` — identity: `{ a: ['a'], lb: ['lb'], ... }`
- Button vocabulary: `src/bmsx/input/manager.ts` `Input.BUTTON_IDS` — `['a','b','x','y','lb','rb','lt','rt','select','start','ls','rs','up','down','left','right','home','touch']`
- Action parser: `src/bmsx/input/action_parser.ts`, `src/bmsx_cpp/input/action_parser.cpp` (expression evaluation — used by the chip's query path via `checkActionTriggered()` → `ActionDefinitionEvaluator`)
- Engine core: `src/bmsx/core/engine.ts` (`action_triggered`, `get_action_state`, `packActionStateFlags`)
- Lua globals registration: `src/bmsx/machine/firmware/globals.ts` (pattern: `registerGlobal(runtime, 'sys_*', IO_*)`)
- Lua builtin descriptors: `src/bmsx/machine/firmware/builtin_descriptors.ts`
- Lua builtins (set_input_map): `src/bmsx/machine/firmware/builtins.ts` (existing `set_input_map()` native — reference impl for input map application)
- Firmware API: `src/bmsx/machine/firmware/api/index.ts` (`action_triggered` implementation via `checkActionTriggered`)
- C++ input: `src/bmsx_cpp/input/manager.h`, `src/bmsx_cpp/input/player.h/.cpp`
- C++ firmware: `src/bmsx_cpp/machine/firmware/api.cpp`, `src/bmsx_cpp/machine/firmware/globals.cpp`
