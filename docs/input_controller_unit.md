# Input Controller Unit

The Input Controller Unit (ICU) is a small MMIO hardware device. Its scope is a
registerfile, a VBlank sample latch, a raw keyboard/pointer/gamepad snapshot,
and an output (vibration) latch. It carries no action names, button-name string
ids, mapping contexts, query language, consume state, repeat logic, or gameplay
event FIFO.

## Register map (47 words)

All offsets below are word offsets from `sys_inp_ctrl` / `IO_INP_BASE`.

| Offset | Name | Dir | Type | Description |
|---:|---|:---:|---|---|
| +0 | `sys_inp_ctrl` | W | u32 | Command latch: `inp_ctrl_arm` arms the next VBlank sample; `inp_ctrl_reset` resets registers. |
| +1 | `sys_inp_status` | R | u32 | Sample sequence. Incremented when an armed VBlank edge latches a snapshot. |
| +2..+9 | `sys_inp_keys` | R | 8×u32 | Keyboard bitmap. Bit `usage & 31` of word `usage >> 5` is set when USB HID keyboard usage `usage` is held. |
| +10 | `sys_inp_pointer_buttons` | R | u32 | Pointer button bitmap. Bits use `inp_pointer_*`. |
| +11 | `sys_inp_pointer_x` | R | s16.16 | Latched pointer X coordinate in host pointer space. |
| +12 | `sys_inp_pointer_y` | R | s16.16 | Latched pointer Y coordinate in host pointer space. |
| +13 | `sys_inp_pointer_wheel` | R | s16.16 | Latched pointer wheel scalar. |
| +14..+41 | `sys_inp_pads` | R | 4×7 u32 | Four pad snapshots. Each block is `buttons`, `lx`, `ly`, `rx`, `ry`, `lt`, `rt`. Axes are s16.16. |
| +42 | `sys_inp_output_port` | W | u32 | Output port/pad select. The low two bits select pad 0..3. |
| +43 | `sys_inp_output_intensity_q16` | W | u16.16 | Output effect intensity latch (1.0 = `inp_output_intensity_q16_one`). |
| +44 | `sys_inp_output_duration_ms` | W | u32 | Output effect duration latch in milliseconds. |
| +45 | `sys_inp_output_status` | R | u32 | Output support bitmap. Bit `n` means pad `n` has output hardware. |
| +46 | `sys_inp_output_ctrl` | W | u32 | Output command: write `inp_output_ctrl_apply` to fire the effect. |

## Keyboard bitmap

Keyboard bits are indexed by USB HID Keyboard/Keypad usage IDs from usage page
`0x07`. The host translates browser/native key codes into this bitmap before the
ICU latch. Lua cartlib keeps the same code-to-usage table in
`cartlib/input/keys.lua`; bare-metal carts may use raw HID usage constants
when they intentionally bypass cartlib.

## Gamepad block

Each pad block starts at `sys_inp_pads + pad * inp_pad_stride`.

| Offset constant | Meaning |
|---|---|
| `inp_pad_buttons` | Button bitmap. Bits use `inp_btn_a`, `inp_btn_b`, `inp_btn_x`, `inp_btn_y`, `inp_btn_lb`, `inp_btn_rb`, `inp_btn_lt`, `inp_btn_rt`, `inp_btn_select`, `inp_btn_start`, `inp_btn_ls`, `inp_btn_rs`, `inp_btn_up`, `inp_btn_down`, `inp_btn_left`, `inp_btn_right`, `inp_btn_home`, `inp_btn_touch`. |
| `inp_pad_lx`, `inp_pad_ly` | Left stick axes, s16.16. |
| `inp_pad_rx`, `inp_pad_ry` | Right stick axes, s16.16. |
| `inp_pad_lt`, `inp_pad_rt` | Trigger axes, s16.16. |

## Pointer button bits

| Constant | Bit |
|---|:---:|
| `inp_pointer_primary` | 0 |
| `inp_pointer_aux` | 1 |
| `inp_pointer_secondary` | 2 |
| `inp_pointer_back` | 3 |
| `inp_pointer_forward` | 4 |

## Command constants

| Constant | Value | Effect |
|---|:---:|---|
| `inp_ctrl_arm` | 1 | Arms the sample latch; next VBlank edge latches host input state. |
| `inp_ctrl_reset` | 2 | Resets all registers to default state. |
| `inp_output_ctrl_apply` | 1 | Applies the latched output effect to `sys_inp_output_port`. |

## VBlank sample edge

Cart code writes `inp_ctrl_arm` to `sys_inp_ctrl`, then waits for the VBlank
IRQ. On the VBlank edge the ICU asks the host input owner to fill one raw
`InputControllerSnapshot`. The ICU converts that snapshot into MMIO words and
mirrors the latched registerfile. Reads for the remainder of the frame return
those stable raw words. There are no computed-on-read action queries.

## High-level input owners

Host UI code keeps using the host PlayerInput implementations in
`machine/ts/input` and `machine/cpp/input` for IDE, terminal, quick menu,
onscreen controls, host shortcuts, device assignment, and complex host-side
input behavior.

Gameplay carts use `cartlib/input/player.lua` and
`cartlib/input/action_parser.lua`. That Lua layer reads the raw ICU snapshot and
owns mapping contexts, action expression parsing, retained per-player action
state, consume state, guarded presses, repeat presses, parser cache, and scratch
buffers. Bare-metal carts may intentionally read the raw MMIO layout directly.
BIOS code stays low-level and does not own a gameplay PlayerInput framework.

## Output latch

Write `sys_inp_output_port`, `sys_inp_output_intensity_q16`, and
`sys_inp_output_duration_ms`, then write `inp_output_ctrl_apply` to
`sys_inp_output_ctrl`. The ICU decodes those latch words at the output datapath
boundary and calls the host output hardware for the selected pad.

## Save state

The ICU save state contains only the sample latch state and the raw registerfile:
control, keyboard words, pointer words, pad words, output port, output latch
words, and output support mirror. It does not serialize host PlayerInput state,
Lua action contexts, parser caches, consume state, or runtime scratch buffers.
