# Input Controller Unit

This is the CPU-visible contract for the Input Controller Unit (ICU). The ICU
is a machine device with a registerfile, command latch, VBlank sample latch,
per-player committed action table, and sampled action status/value words.

## Register map

| Register | Direction | Value | Effect |
|---|---:|---|---|
| `sys_inp_player` | W | u32 | Selects player, 1-based. |
| `sys_inp_action` | W | `string_ref` | Action name for the next commit. |
| `sys_inp_bind` | W | `string_ref` | Comma-separated binding names for the selected action. |
| `sys_inp_ctrl` | W | u32 | Command latch. |
| `sys_inp_query` | W | `string_ref` | Action expression evaluated against the ICU snapshot. |
| `sys_inp_status` | R | u32 | Query result status word. |
| `sys_inp_value` | R | s16.16 word | Query result value word. |
| `sys_inp_consume` | W | `string_ref` | Plain action name to consume. |

String-ref registers are enforced by the compiler/MMIO contract. The ICU reads
the string id representation directly.

## Commands

| Command | Value | Effect |
|---|---:|---|
| `inp_ctrl_commit` | 1 | Reads `sys_inp_action`/`sys_inp_bind`, updates the selected player's ICU mapping context, and records the committed action ids. |
| `inp_ctrl_arm` | 2 | Sets the private sample-arm latch. |
| `inp_ctrl_reset` | 3 | Clears the selected player's ICU mapping context and committed action records. |

`inp_ctrl_arm` does not sample immediately. The next VBlank edge consumes the
latch.

## Sample edge

On VBlank, when armed:

1. increment `sampleSequence`;
2. latch `lastSampleCycle`;
3. call the input owner to sample all players once;
4. snapshot each committed action into ICU-owned words;
5. clear the arm latch.

Later `sys_inp_query` writes read that ICU snapshot. They do not query live host
input state.

## Action snapshot word

Simple root-action queries return the sampled action word in `sys_inp_status`.
Compound expressions return boolean `1`/`0` and zero value.

| Bit | Constant | Meaning |
|---:|---|---|
| 0 | `inp_status_pressed` | Action is pressed. |
| 1 | `inp_status_justpressed` | Press edge in sampled frame/window. |
| 2 | `inp_status_justreleased` | Release edge in sampled frame/window. |
| 3 | `inp_status_waspressed` | Press seen in query window. |
| 4 | `inp_status_wasreleased` | Release seen in query window. |
| 5 | `inp_status_consumed` | Action/binding has been consumed. |
| 6 | `inp_status_alljustpressed` | All bindings just pressed. |
| 7 | `inp_status_alljustreleased` | All bindings just released. |
| 8 | `inp_status_allwaspressed` | All bindings were pressed in window. |
| 9 | `inp_status_guardedjustpressed` | Guarded press accepted. |
| 10 | `inp_status_repeatpressed` | Repeat pulse accepted. |
| 11 | `inp_status_has_value` | `sys_inp_value` contains the sampled Q16.16 value word. |

`sys_inp_value` stores a signed Q16.16 word. Digital actions use the same value
register as analog actions.

## Save state

Saved ICU state:

- arm latch;
- sample sequence;
- last sample cycle;
- mirrored registerfile;
- per-player committed action/bind string ids;
- sampled `statusWord`, `valueQ16`, `pressTime`, and `repeatCount` per action.

Restore rebuilds the ICU mapping contexts from committed action records and
preserves the sampled action words.

## Owners

- TS: `src/bmsx/machine/devices/input/controller.ts`
- TS constants: `src/bmsx/machine/devices/input/contracts.ts`
- C++: `src/bmsx_cpp/machine/devices/input/controller.cpp/.h`
- C++ constants: `src/bmsx_cpp/machine/devices/input/contracts.h`
- Save state: `src/bmsx/machine/runtime/save_state/*` and
  `src/bmsx_cpp/machine/runtime/save_state/*`
