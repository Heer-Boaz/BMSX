# Input Controller Unit

This is the CPU-visible contract for the Input Controller Unit (ICU). The ICU
is a machine device with a registerfile, command latch, VBlank sample latch,
per-player committed action table, sampled action status/value words, a
device-owned event FIFO, and an output command datapath.

## Register map

| Register | Direction | Value | Effect |
|---|---:|---|---|
| `sys_inp_player` | W | u32 | Selects player, 1-based. |
| `sys_inp_action` | W | interned `&` string id | Action name for the next commit. |
| `sys_inp_bind` | W | interned `&` string id | Comma-separated binding names for the selected action. |
| `sys_inp_ctrl` | W | u32 | Command latch. |
| `sys_inp_query` | W | interned `&` string id | Action expression evaluated against the ICU snapshot. |
| `sys_inp_status` | R | u32 | Query result status word. |
| `sys_inp_value` | R | s16.16 word | Query result value word. |
| `sys_inp_consume` | W | interned `&` string id | Plain action name to consume. |
| `sys_inp_event_status` | R | u32 | Event FIFO status bits. |
| `sys_inp_event_count` | R | u32 | Queued event count. |
| `sys_inp_event_player` | R | u32 | Front event player, 1-based. |
| `sys_inp_event_action` | R | string id word | Front event action name id. |
| `sys_inp_event_flags` | R | u32 | Front event packed `inp_status_*` word. |
| `sys_inp_event_value` | R | s16.16 word | Front event value word. |
| `sys_inp_event_repeat_count` | R | u32 | Front event repeat count. |
| `sys_inp_event_ctrl` | W | u32 | Event FIFO command latch. |
| `sys_inp_output_intensity_q16` | W | u16.16 word | Output intensity latch for the selected player. |
| `sys_inp_output_duration_ms` | W | u32 | Output duration latch in milliseconds. |
| `sys_inp_output_status` | R | u32 | Selected-player output status bits. |
| `sys_inp_output_ctrl` | W | u32 | Output command latch. |

The MMIO contract marks `sys_inp_action`, `sys_inp_bind`, `sys_inp_query`, and
`sys_inp_consume` as interned-string-id writes. Program images that write normal
Lua strings to those addresses fail before emission. The ICU receives interned
string-id words and reads that representation directly. Producers mark literals
or dynamic string expressions with the existing `&` operator at the producer
boundary, for example `&'left[p]'` or `&(action .. '[p]')`.

The ICU registerfile owner stores these raw words, accepts the data-latch
writes, owns the `sys_inp_status`/`sys_inp_value` result latch, and mirrors the
visible registers after reset/restore. The control port owns `sys_inp_ctrl`
command side effects after latching the incoming command word. The query port
owns `sys_inp_query` and `sys_inp_consume` write side effects after the
registerfile has latched the incoming string-id word.

## Commands

| Command | Value | Effect |
|---|---:|---|
| `inp_ctrl_commit` | 1 | Reads `sys_inp_action`/`sys_inp_bind`, updates the selected player's ICU mapping context, and records the committed action ids. |
| `inp_ctrl_arm` | 2 | Sets the private sample-arm latch. |
| `inp_ctrl_reset` | 3 | Clears the selected player's ICU mapping context and committed action records. |
| `inp_event_ctrl_pop` | 1 | Pops the front event FIFO entry. |
| `inp_event_ctrl_clear` | 2 | Clears queued events and the overflow latch. |
| `inp_output_ctrl_apply` | 1 | Applies the latched output intensity/duration to the selected player. |

`inp_ctrl_arm` does not sample immediately. The next VBlank edge consumes the
latch.

## Sample edge

On VBlank, when armed:

1. increment `sampleSequence`;
2. latch `lastSampleCycle`;
3. call the input owner to sample all players once;
4. snapshot each committed action into ICU-owned words;
5. push edge/repeat action snapshots into the event FIFO;
6. clear the arm latch.

Later `sys_inp_query` writes enter the query port and read that ICU snapshot.
They do not query live host input state.

The committed action table owns the mapping context and sampled action words.
The sample latch owns only the armed-edge sequence and last-cycle latch. The
controller's VBlank edge service point consumes that latch, samples players
once, and rings the action table. The runtime calls the ICU, not the sample
latch subunit. The control port decodes commit/arm/reset command words. The
query port evaluates query and consume latches against the action table. The
event FIFO and output port own their CPU-visible read/control banks. The
controller maps the remaining selected-player/action/bind/output-latch writes
into the ICU units.

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

## Event FIFO

The event FIFO has 32 entries. It is filled only by the ICU sample edge. Each
entry is a device-visible snapshot:

- player index;
- action string id;
- packed action status word;
- signed-Q16.16 value word;
- repeat count word.

Events are generated when the sampled status word contains one of these edge or
repeat bits: `inp_status_justpressed`, `inp_status_justreleased`,
`inp_status_alljustpressed`, `inp_status_alljustreleased`,
`inp_status_guardedjustpressed`, or `inp_status_repeatpressed`.

`sys_inp_event_status` exposes:

| Bit | Constant | Meaning |
|---:|---|---|
| 0 | `inp_event_status_empty` | FIFO has no queued events. |
| 1 | `inp_event_status_full` | FIFO is full. |
| 2 | `inp_event_status_overflow` | At least one event was dropped while full. |

When the FIFO is empty, front-event registers read zero words and string id 0.
Overflow does not overwrite queued entries; it sets the overflow latch. The clear
command resets both the queue and the overflow latch. The FIFO ring slots,
read/write pointers, queued count, and overflow latch are owned by
`machine/devices/input/event_fifo` on both runtimes.

## Output datapath

The output register bank is selected by `sys_inp_player`.
`sys_inp_output_status` exposes:

| Bit | Constant | Meaning |
|---:|---|---|
| 0 | `inp_output_status_supported` | Selected player has output-capable input hardware. |

The cart writes an unsigned Q16.16 intensity word to
`sys_inp_output_intensity_q16`, writes a duration in milliseconds to
`sys_inp_output_duration_ms`, then writes `inp_output_ctrl_apply` to
`sys_inp_output_ctrl`. The control latch self-clears. The ICU decodes the
intensity word at this output boundary and emits one selected-player output
command. Weird but representable intensity and duration words are not sanitized
by the ICU.

## Save state

Saved ICU state:

- arm latch;
- sample sequence;
- last sample cycle;
- mirrored registerfile;
- per-player committed action/bind string ids;
- sampled `statusWord`, `valueQ16`, `pressTime`, and `repeatCount` per action.
- queued event FIFO entries;
- event FIFO overflow latch;
- output intensity and duration latch words.

Restore rebuilds the ICU mapping contexts from committed action records and
preserves the sampled action words, queued FIFO entries, and output latch words.
Selected-player output support is a host capability bit and is not saved.

## Owners

- TS: `src/bmsx/machine/devices/input/controller.ts`
- TS registerfile: `src/bmsx/machine/devices/input/registers.ts`
- TS control port: `src/bmsx/machine/devices/input/control_port.ts`
- TS sample latch: `src/bmsx/machine/devices/input/sample_latch.ts`
- TS action table: `src/bmsx/machine/devices/input/action_table.ts`
- TS query port: `src/bmsx/machine/devices/input/query_port.ts`
- TS constants: `src/bmsx/machine/devices/input/contracts.ts`
- TS FIFO: `src/bmsx/machine/devices/input/event_fifo.ts`
- TS output port: `src/bmsx/machine/devices/input/output_port.ts`
- TS aggregate save state: `src/bmsx/machine/devices/input/save_state.ts`
- C++: `src/bmsx_cpp/machine/devices/input/controller.cpp/.h`
- C++ registerfile: `src/bmsx_cpp/machine/devices/input/registers.cpp/.h`
- C++ control port: `src/bmsx_cpp/machine/devices/input/control_port.cpp/.h`
- C++ sample latch: `src/bmsx_cpp/machine/devices/input/sample_latch.cpp/.h`
- C++ action table: `src/bmsx_cpp/machine/devices/input/action_table.cpp/.h`
- C++ query port: `src/bmsx_cpp/machine/devices/input/query_port.cpp/.h`
- C++ constants: `src/bmsx_cpp/machine/devices/input/contracts.h`
- C++ FIFO: `src/bmsx_cpp/machine/devices/input/event_fifo.cpp/.h`
- C++ output port: `src/bmsx_cpp/machine/devices/input/output_port.cpp/.h`
- C++ aggregate save state: `src/bmsx_cpp/machine/devices/input/save_state.cpp/.h`
- Runtime byte codec: `src/bmsx/machine/runtime/save_state/*` and
  `src/bmsx_cpp/machine/runtime/save_state/*`
