# Implementation Prompt: Input Controller Chip (MMIO Action Query via `string_ref`)

## Goal

Implement a new **Input Controller chip** — a memory-mapped I/O device on the BMSX fantasy console that allows cart Lua code to query input actions via `mem[]` MMIO writes using the new `&'...'` string_ref syntax. This replaces the current `action_triggered(...)` native function call with a hardware-style MMIO interface where the cart writes an action query string (as a `string_ref`) into an IO register, and reads back the packed result flags from another IO register.

---

## Context: How the Fantasy Console Works

BMSX is a fantasy console with a custom Lua VM. The architecture mirrors retro hardware:

- **Memory-mapped I/O**: Cart code writes to special addresses via `mem[addr] = value`. The compiler lowers this to `STORE_MEM` opcodes. The runtime dispatches IO writes to device controllers.
- **IO slots**: `memory.ts` stores IO values in `ioSlots[]`. IO writes call `ioWriteHandler.onIoWrite(addr, value)`. IO slots can hold non-numeric values (including `StringValue` objects) — unlike RAM which only accepts numbers.
- **Runtime dispatch**: `runtime.ts` has an `onIoWrite(addr, value)` method that checks the address and dispatches to the appropriate device controller (DMA, IMGDEC, GEO, etc.).
- **Device pattern**: Each device is a class with `reset()`, `onCtrlWrite()`, and `onService()` methods. Devices are instantiated in `runtime.ts` with references to `Memory`, IRQ callbacks, and scheduling callbacks. See `src/bmsx/emulator/devices/*.ts` for examples.
- **String refs**: The `&'...'` syntax creates a `StringRefLiteralExpression` in the AST, which the compiler interns as a `StringValue` via `program.internString()`. At runtime this is a `StringValue` object (with `.id` and `.text`). When written to an IO slot, the `StringValue` is stored directly (not as a number).
- **Compile-time enforcement**: `mmio_register_spec.ts` defines `MMIO_REGISTER_SPECS` with `writeRequirement: 'string_ref'`. The compiler's `validateMemoryStore()` uses flow-sensitive analysis (`compile_value_flow.ts`) to verify that any value written to such an address is provably a `string_ref` at compile time. The spec array is currently empty (placeholder comment says "Input Controller registers will be added here").
- **Existing input API**: Cart code currently calls `action_triggered('left[p]')` — a native function that calls `PlayerInput.checkActionTriggered(actionDef)`. This evaluates action parser expressions like `'up[jp] || a[jp]'` via `ActionDefinitionEvaluator`. The result is a boolean. A lower-level `get_action_state(action, player, window?)` returns packed flags as a number.

---

## Architecture: The New Input Controller Chip

### Concept

The Input Controller is a fantasy hardware chip that the cart interacts with purely via MMIO:

1. **Write** an action query string_ref to the query register: `mem[sys_inp_query] = &'left[p]'`
2. **Read** the result from the status register: `local flags = mem[sys_inp_status]`
3. Optionally write the player index first: `mem[sys_inp_player] = 2`

This gives the cart a hardware-feel API while using string_ref for type-safe action names. The compiler statically verifies that only `string_ref` values (not plain strings or numbers) can be written to the query register.

### IO Register Layout

Add the following IO registers to `io.ts`, immediately after the last existing device (GEO/Payload), before `IO_SLOT_COUNT`:

| Register | Name | Index | Direction | Type | Description |
|---|---|---|---|---|---|
| `IO_INP_PLAYER_INDEX` | `sys_inp_player` | base+0 | Write | number | Player index (1-based, default 1). Persists until overwritten. |
| `IO_INP_ACTION_INDEX` | `sys_inp_action` | base+1 | Write | `string_ref` | Set the action name for the next define/commit. **MMIO write requirement: `string_ref`**. |
| `IO_INP_BIND_INDEX` | `sys_inp_bind` | base+2 | Write | `string_ref` | Set button bindings for the current action (comma-separated button names, e.g. `&'lb,left'` for a chord). **MMIO write requirement: `string_ref`**. |
| `IO_INP_CTRL_INDEX` | `sys_inp_ctrl` | base+3 | Write | number | Control/command register. Writing triggers a chip command (see Control Commands below). |
| `IO_INP_QUERY_INDEX` | `sys_inp_query` | base+4 | Write | `string_ref` | Action query expression. Writing triggers evaluation against latched state. **MMIO write requirement: `string_ref`**. |
| `IO_INP_STATUS_INDEX` | `sys_inp_status` | base+5 | Read | number | Packed action state flags (same bit layout as `packActionStateFlags`). |
| `IO_INP_VALUE_INDEX` | `sys_inp_value` | base+6 | Read | number | Analog value (float in [-1,1] or [0,1]) for analog queries. |
| `IO_INP_CONSUME_INDEX` | `sys_inp_consume` | base+7 | Write | `string_ref` | Write an action name string_ref to consume that action. **MMIO write requirement: `string_ref`**. |

Total size: `IO_INP_SIZE = 8`

### Control Commands (`sys_inp_ctrl`)

These are numeric constants written to `sys_inp_ctrl` to trigger chip operations:

| Constant | Name | Value | Description |
|---|---|---|---|
| `INP_CTRL_COMMIT` | `inp_ctrl_commit` | `1` | Commit the current action definition. Reads action name from `sys_inp_action` and bindings from `sys_inp_bind`, then registers the mapping on the current player's input map. Multiple commits build up the full action map. |
| `INP_CTRL_LATCH` | `inp_ctrl_latch` | `2` | **Latch (sample) all input state.** Must be called once per frame before any query reads. This snapshots the current button/axis state so that all queries within the same frame see a consistent view. Without latching, queries read stale or inconsistent state. |
| `INP_CTRL_RESET` | `inp_ctrl_reset` | `3` | Reset all action definitions to empty (clear the current player's input map). |

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

**Implementation**: On `inp_ctrl_commit`, the InputController reads the `StringValue` from `sys_inp_action` (action name) and `sys_inp_bind` (comma-separated bindings), splits the bindings string by `,`, and calls `PlayerInput.pushContext()` or modifies the input map to register the action. The exact mechanism: build a `KeyboardInputMapping` / `GamepadInputMapping` entry and apply it to the player's input system.

### Input Latch (per-frame)

The input latch is the synchronization point between the host platform's raw input state and the cart's queries. **The cart must latch once per frame before reading any query results**:

```lua
-- At the start of each frame's update:
mem[sys_inp_ctrl] = inp_ctrl_latch

-- Now queries return consistent, frame-stable results:
mem[sys_inp_query] = &'dash[jp]'
if mem[sys_inp_status] & inp_justpressed ~= 0 then
    do_dash()
end

mem[sys_inp_query] = &'slash[jp]'
if mem[sys_inp_status] & inp_justpressed ~= 0 then
    do_slash()
end
```

**Why latch?** Without an explicit latch, queries could see inconsistent state if the host updates input mid-frame. The latch snapshots the current `ButtonState` for all tracked buttons, and all subsequent queries within that frame evaluate against that snapshot. This mirrors real hardware (e.g. NES controller shift register latch), and ensures deterministic behavior for replays/netplay.

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
-- MAIN LOOP: Latch, then query
------------------------------------------------------------
-- Latch input state for this frame (MUST be first)
mem[sys_inp_ctrl] = inp_ctrl_latch

-- Simple digital check
mem[sys_inp_query] = &'left[p]'
if mem[sys_inp_status] & inp_pressed ~= 0 then
    move_left()
end

-- Just-pressed check
mem[sys_inp_query] = &'jump[jp]'
if mem[sys_inp_status] & inp_justpressed ~= 0 then
    jump()
end

-- Compound expression (OR)
mem[sys_inp_query] = &'up[jp] || jump[jp]'
if mem[sys_inp_status] & inp_justpressed ~= 0 then
    jump()
end

-- Custom action (defined during INIT)
mem[sys_inp_query] = &'dash[jp]'
if mem[sys_inp_status] & inp_justpressed ~= 0 then
    do_dash()
end

-- Multiplayer: set player, then query
mem[sys_inp_player] = 2
mem[sys_inp_ctrl] = inp_ctrl_latch   -- latch player 2's state
mem[sys_inp_query] = &'left[p]'
local p2_flags<const> = mem[sys_inp_status]
mem[sys_inp_player] = 1              -- switch back

-- Analog value
mem[sys_inp_query] = &'lx[p]'
local analog_x<const> = mem[sys_inp_value]

-- Consume an action after handling it
mem[sys_inp_consume] = &'jump[jp]'

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

### Step 1: IO Register Constants (`src/bmsx/emulator/io.ts`)

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
export const INP_CTRL_LATCH = 2;   // Latch (sample) input state for this frame
export const INP_CTRL_RESET = 3;   // Reset all action definitions
```

### Step 2: MMIO Register Specs (`src/bmsx/emulator/mmio_register_spec.ts`)

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

### Step 3: Lua Global Constants (`src/bmsx/emulator/lua_globals.ts`)

Register the IO address constants and control command constants as Lua globals:

```ts
// Input Controller IO addresses
runtimeLuaPipeline.registerGlobal(runtime, 'sys_inp_player', IO_INP_PLAYER);
runtimeLuaPipeline.registerGlobal(runtime, 'sys_inp_action', IO_INP_ACTION);
runtimeLuaPipeline.registerGlobal(runtime, 'sys_inp_bind', IO_INP_BIND);
runtimeLuaPipeline.registerGlobal(runtime, 'sys_inp_ctrl', IO_INP_CTRL);
runtimeLuaPipeline.registerGlobal(runtime, 'sys_inp_query', IO_INP_QUERY);
runtimeLuaPipeline.registerGlobal(runtime, 'sys_inp_status', IO_INP_STATUS);
runtimeLuaPipeline.registerGlobal(runtime, 'sys_inp_value', IO_INP_VALUE);
runtimeLuaPipeline.registerGlobal(runtime, 'sys_inp_consume', IO_INP_CONSUME);

// Input Controller control commands
runtimeLuaPipeline.registerGlobal(runtime, 'inp_ctrl_commit', INP_CTRL_COMMIT);
runtimeLuaPipeline.registerGlobal(runtime, 'inp_ctrl_latch', INP_CTRL_LATCH);
runtimeLuaPipeline.registerGlobal(runtime, 'inp_ctrl_reset', INP_CTRL_RESET);
```

Also add matching entries to `lua_builtin_descriptors.ts` under the system constants section.

### Step 4: Input Controller Device (`src/bmsx/emulator/devices/input_controller.ts`)

Create a new device class following the existing device pattern (see `dma_controller.ts`, `imgdec_controller.ts`):

```ts
import { Memory } from '../memory';
import { StringValue } from '../string_pool';
import {
    IO_INP_PLAYER, IO_INP_ACTION, IO_INP_BIND, IO_INP_CTRL,
    IO_INP_QUERY, IO_INP_STATUS, IO_INP_VALUE, IO_INP_CONSUME,
    INP_CTRL_COMMIT, INP_CTRL_LATCH, INP_CTRL_RESET,
} from '../io';
import type { Input } from '../../input/input';
import type { KeyboardInputMapping, GamepadInputMapping } from '../../input/inputtypes';

export class InputController {
    private readonly memory: Memory;
    private readonly input: Input;

    // Pending action definitions (accumulated via COMMIT commands)
    // Maps action name → array of binding strings (each binding is a button name)
    private pendingKeyboard: KeyboardInputMapping = {};
    private pendingGamepad: GamepadInputMapping = {};

    constructor(memory: Memory, input: Input) {
        this.memory = memory;
        this.input = input;
        this.memory.writeValue(IO_INP_PLAYER, 1);
    }

    public reset(): void {
        this.memory.writeValue(IO_INP_PLAYER, 1);
        this.memory.writeValue(IO_INP_STATUS, 0);
        this.memory.writeValue(IO_INP_VALUE, 0);
        this.pendingKeyboard = {};
        this.pendingGamepad = {};
    }

    public onCtrlWrite(): void {
        const cmd = this.memory.readValue(IO_INP_CTRL) as number;
        switch (cmd) {
            case INP_CTRL_COMMIT: this.commitAction(); break;
            case INP_CTRL_LATCH: this.latchInput(); break;
            case INP_CTRL_RESET: this.resetActions(); break;
        }
    }

    /**
     * COMMIT: reads action name from sys_inp_action and bindings from sys_inp_bind,
     * parses the comma-separated binding string, and accumulates the mapping.
     */
    private commitAction(): void {
        const actionName = (this.memory.readValue(IO_INP_ACTION) as StringValue).text;
        const bindStr = (this.memory.readValue(IO_INP_BIND) as StringValue).text;
        const bindings = bindStr.split(',');  // e.g. 'lb,left' → ['lb', 'left']

        // Register into both keyboard and gamepad maps.
        // The button names (a, b, x, lb, left, etc.) are the abstract action vocabulary —
        // the engine's default keyboard mapping translates them to DOM key codes.
        // For keyboard: resolve each button name to its default keyboard key(s).
        // For gamepad: use button names directly (they ARE gamepad button IDs).
        this.pendingGamepad[actionName] = bindings;
        this.pendingKeyboard[actionName] = bindings.map(b => Input.resolveKeyboardKey(b));
    }

    /**
     * LATCH: apply all pending action definitions to the player's input system,
     * then snapshot the current input state for stable per-frame reads.
     */
    private latchInput(): void {
        const playerIndex = this.memory.readValue(IO_INP_PLAYER) as number;
        const playerInput = this.input.getPlayerInput(playerIndex);

        // If there are pending action definitions, push them as a mapping context
        if (Object.keys(this.pendingKeyboard).length > 0) {
            playerInput.pushContext('inp_chip', this.pendingKeyboard, this.pendingGamepad, {});
            // Don't clear — definitions persist until inp_ctrl_reset
        }

        // Latch/snapshot the input state
        // (The exact latch mechanism depends on how PlayerInput exposes frame-snapshotting.
        //  This may involve calling playerInput.latchFrame() or similar.)
        playerInput.latchFrame();
    }

    /** RESET: clear all action definitions for the current player */
    private resetActions(): void {
        const playerIndex = this.memory.readValue(IO_INP_PLAYER) as number;
        this.input.getPlayerInput(playerIndex).popContext('inp_chip');
        this.pendingKeyboard = {};
        this.pendingGamepad = {};
    }

    public onQueryWrite(): void {
        const queryValue = this.memory.readValue(IO_INP_QUERY);
        const actionDef = (queryValue as StringValue).text;
        const playerIndex = this.memory.readValue(IO_INP_PLAYER) as number;
        const playerInput = this.input.getPlayerInput(playerIndex);
        const state = playerInput.getActionState(actionDef);
        this.memory.writeValue(IO_INP_STATUS, packActionStateFlags(state));
        this.memory.writeValue(IO_INP_VALUE, state.value ?? 0);
    }

    public onConsumeWrite(): void {
        const consumeValue = this.memory.readValue(IO_INP_CONSUME);
        const action = (consumeValue as StringValue).text;
        const playerIndex = this.memory.readValue(IO_INP_PLAYER) as number;
        this.input.getPlayerInput(playerIndex).consumeAction(action);
    }
}
```

**Key implementation notes**:
- **Binding resolution**: The `commitAction()` method needs to map abstract button names (like `'a'`, `'lb'`, `'left'`) to keyboard key codes. The `Input` class likely has a default mapping table for this (e.g. `a` → `['KeyX']`). Add an `Input.resolveKeyboardKey(buttonName)` static method if one doesn't exist, or reuse the existing default mapping from `Input.DEFAULT_INPUT_MAPPING`.
- **Context stacking**: Uses `PlayerInput.pushContext()` to layer the MMIO-defined actions on top of the base input map. This respects the existing input context priority system.
- **Latch mechanism**: `PlayerInput.latchFrame()` is a **new method** that needs to be added. It should snapshot the current `ButtonState` for all tracked buttons. Subsequent `getActionState()` calls within the same frame read from the snapshot. Alternatively, if the engine already samples input once per frame in a fixed update tick, the latch simply marks the starting point for reads.

**Note**: `packActionStateFlags` should use the same flag bit layout as `engine_core.ts`. Extract/share the constants (`ACTION_STATE_FLAG_PRESSED = 1 << 0`, etc.) so both the `engine_core` and the `InputController` use the same definitions. Consider moving them to a shared location like `src/bmsx/input/action_state_flags.ts`.

### Step 5: Runtime IO Write Dispatch (`src/bmsx/emulator/runtime.ts`)

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

1. **IO constants** in the C++ equivalent of `io.ts` (likely `src/bmsx_cpp/emulator/io.h` or similar)
2. **Input Controller device class** in `src/bmsx_cpp/emulator/devices/input_controller.cpp/.h`
3. **Runtime dispatch** in the C++ runtime's IO write handler, same structure as TS
4. **String handling**: In C++, the IO slot will contain a string handle ID (not a `StringValue` object). The device reads the handle, resolves it via the string pool to get the text, then evaluates the action query. The C++ `PlayerInput::getActionState()` and `PlayerInput::consumeAction()` already exist.

### Step 7: Lua Builtin Descriptors (`src/bmsx/emulator/lua_builtin_descriptors.ts`)

Add descriptors for the new system constants so they appear in IDE autocomplete:

```ts
// In the system constants section — IO address registers:
{ name: 'sys_inp_player', description: 'Input Controller: player index register (1-based).' },
{ name: 'sys_inp_action', description: 'Input Controller: write a string_ref action name for define/commit.' },
{ name: 'sys_inp_bind', description: 'Input Controller: write string_ref button bindings (comma-separated) for current action.' },
{ name: 'sys_inp_ctrl', description: 'Input Controller: write a control command (inp_ctrl_commit, inp_ctrl_latch, inp_ctrl_reset).' },
{ name: 'sys_inp_query', description: 'Input Controller: write a string_ref action query to evaluate.' },
{ name: 'sys_inp_status', description: 'Input Controller: read packed action state flags after a query.' },
{ name: 'sys_inp_value', description: 'Input Controller: read analog value after a query.' },
{ name: 'sys_inp_consume', description: 'Input Controller: write a string_ref action name to consume it.' },

// Control command constants:
{ name: 'inp_ctrl_commit', description: 'Input Controller command: commit the current action definition (reads sys_inp_action + sys_inp_bind).' },
{ name: 'inp_ctrl_latch', description: 'Input Controller command: latch (sample) input state for this frame.' },
{ name: 'inp_ctrl_reset', description: 'Input Controller command: reset all action definitions to empty.' },
```

### Step 8: Action State Flag Constants for Lua

Expose the flag constants as Lua globals so cart code can test them without magic numbers:

```ts
runtimeLuaPipeline.registerGlobal(runtime, 'inp_pressed', ACTION_STATE_FLAG_PRESSED);         // 1 << 0
runtimeLuaPipeline.registerGlobal(runtime, 'inp_justpressed', ACTION_STATE_FLAG_JUSTPRESSED);   // 1 << 1
runtimeLuaPipeline.registerGlobal(runtime, 'inp_justreleased', ACTION_STATE_FLAG_JUSTRELEASED); // 1 << 2
runtimeLuaPipeline.registerGlobal(runtime, 'inp_consumed', ACTION_STATE_FLAG_CONSUMED);         // 1 << 5
runtimeLuaPipeline.registerGlobal(runtime, 'inp_guardedjustpressed', ACTION_STATE_FLAG_GUARDEDJUSTPRESSED); // 1 << 9
runtimeLuaPipeline.registerGlobal(runtime, 'inp_repeatpressed', ACTION_STATE_FLAG_REPEATPRESSED); // 1 << 10
```

Cart usage becomes readable:
```lua
mem[sys_inp_query] = &'a[jp]'
if mem[sys_inp_status] & inp_justpressed ~= 0 then
    jump()
end
```

---

## Files to Modify (Summary)

| File | Action |
|---|---|
| `src/bmsx/emulator/io.ts` | Add IO_INP_* index and address constants + INP_CTRL_* command constants |
| `src/bmsx/emulator/mmio_register_spec.ts` | Add string_ref write requirements for action, bind, query, and consume registers |
| `src/bmsx/emulator/lua_globals.ts` | Register IO address constants + control command constants + flag constants as Lua globals |
| `src/bmsx/emulator/lua_builtin_descriptors.ts` | Add descriptor entries for all new sys_inp_*, inp_ctrl_*, and inp_* constants |
| `src/bmsx/emulator/devices/input_controller.ts` | **New file**: InputController device class with action map registration, latch, query, consume |
| `src/bmsx/emulator/runtime.ts` | Instantiate InputController, dispatch IO writes in onIoWrite (including string_ref writes), fix non-numeric guard |
| `src/bmsx/input/playerinput.ts` | Add `latchFrame()` method for snapshotting per-frame input state |
| `src/bmsx/input/input.ts` | Add `resolveKeyboardKey(buttonName)` if not already present (maps abstract button names to keyboard codes) |
| `src/bmsx/core/engine_core.ts` | Extract `packActionStateFlags` constants to shared location |
| `src/bmsx_cpp/emulator/io.h` (or equivalent) | C++ IO constants + control command constants |
| `src/bmsx_cpp/emulator/devices/input_controller.cpp/.h` | **New files**: C++ InputController with same register/latch/query semantics |
| `src/bmsx_cpp/emulator/runtime.cpp` (or equivalent) | C++ runtime dispatch |
| `src/bmsx_cpp/input/playerinput.cpp/.h` | C++ `latchFrame()` method |

---

## Technical Constraints

1. **No defensive coding**: Trust that the compiler's MMIO enforcement ensures only `StringValue` objects reach the Input Controller's action/bind/query/consume registers. Cast directly — don't check `isStringValue()`.
2. **No legacy fallback**: The existing `action_triggered()` native function continues to work. The MMIO Input Controller is an additional, parallel interface — not a replacement. Carts can use either.
3. **Performance**: `getActionState()` involves ActionParser evaluation. This is already done per-frame for each `action_triggered()` call, so the MMIO path has identical cost. No new allocations per query — use the existing `ActionState` return value directly and pack flags inline. The latch itself should be O(1) or amortized per tracked button.
4. **Serialization**: IO register values are transient per-frame state. The Input Controller has no persistent state that needs serialization. `reset()` clears it. The pending action definitions (accumulated via `inp_ctrl_commit`) are runtime config, not game state.
5. **The `onIoWrite` non-numeric guard**: This is the most critical integration detail. The guard `if (typeof value !== 'number') { return; }` currently drops all non-numeric writes silently. String_ref writes to the Input Controller produce a `StringValue` which is not a number. The guard must be restructured. All four string_ref registers (`sys_inp_action`, `sys_inp_bind`, `sys_inp_query`, `sys_inp_consume`) need handling before the guard.
6. **Shared flag constants**: The `ACTION_STATE_FLAG_*` constants in `engine_core.ts` should be extracted to a shared module (e.g., `src/bmsx/input/action_state_flags.ts`) and imported by both `engine_core.ts` and the new `input_controller.ts`.
7. **Latch semantics**: The latch must capture a consistent snapshot of all tracked buttons' `ButtonState` at the moment `inp_ctrl_latch` is written. All subsequent `getActionState()` calls within that frame must read from the latched snapshot, not the live state. This ensures deterministic behavior for replays/netplay and prevents mid-frame state changes from causing inconsistencies. The `PlayerInput.latchFrame()` method is new and needs to be implemented.
8. **Binding resolution**: The `commitAction()` flow needs to translate abstract button names (`a`, `lb`, `left`) to keyboard key codes (`KeyX`, `ShiftLeft`, `ArrowLeft`). Use the engine's existing `Input.DEFAULT_INPUT_MAPPING` to derive keyboard bindings from abstract names. For gamepad, the abstract names ARE the button IDs (no translation needed).

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

- IO register layout: `src/bmsx/emulator/io.ts` (all `IO_*_INDEX` / `IO_*` constants)
- Memory map base: `src/bmsx/emulator/memory_map.ts` (`IO_BASE`, `IO_WORD_SIZE`)
- MMIO spec: `src/bmsx/emulator/mmio_register_spec.ts` (currently empty `MMIO_REGISTER_SPECS` array)
- Runtime IO dispatch: `src/bmsx/emulator/runtime.ts` line 2204 (`onIoWrite`)
- Device examples: `src/bmsx/emulator/devices/dma_controller.ts`, `src/bmsx/emulator/devices/imgdec_controller.ts`
- String pool: `src/bmsx/emulator/string_pool.ts` (`StringValue` class, `valueIsString()`)
- Compiler validation: `src/bmsx/emulator/program_compiler.ts` (`validateMemoryStore`, `resolveMemoryStoreRequirement`)
- Flow analysis: `src/bmsx/emulator/compile_value_flow.ts` (`evaluateExpressionValueKind`)
- Input system (TS): `src/bmsx/input/playerinput.ts` (`checkActionTriggered`, `getActionState`, `consumeAction`, `pushContext`, `popContext`, `setInputMap`)
- Input system (C++): `src/bmsx_cpp/input/playerinput.cpp` (same methods)
- Input context stacking: `src/bmsx/input/context.ts` (`MappingContext`, `ContextStack`, `getBindings`)
- Input types: `src/bmsx/input/inputtypes.ts` (`InputMap`, `KeyboardInputMapping`, `GamepadInputMapping`, `ButtonState`, `ActionState`)
- Default input mapping: `src/bmsx/input/input.ts` (`Input.DEFAULT_INPUT_MAPPING` — keyboard/gamepad button vocabulary)
- Action parser: `src/bmsx/input/actionparser.ts`, `src/bmsx_cpp/input/actionparser.cpp`
- Engine core: `src/bmsx/core/engine_core.ts` (`action_triggered`, `get_action_state`, `packActionStateFlags`)
- Lua globals registration: `src/bmsx/emulator/lua_globals.ts` (pattern: `registerGlobal(runtime, 'sys_*', IO_*)`)
- Lua builtin descriptors: `src/bmsx/emulator/lua_builtin_descriptors.ts`
- Lua builtins (set_input_map): `src/bmsx/emulator/lua_builtins.ts` (existing `set_input_map()` native — reference impl for input map application)
- Firmware API: `src/bmsx/emulator/firmware_api.ts` (`action_triggered` implementation)
- C++ input: `src/bmsx_cpp/input/input.h`, `src/bmsx_cpp/input/playerinput.h/.cpp`
- C++ firmware: `src/bmsx_cpp/emulator/firmware_api.cpp`, `src/bmsx_cpp/emulator/lua_globals.cpp`
