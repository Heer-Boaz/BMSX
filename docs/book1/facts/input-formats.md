# ICU input formats and cart-library boundary — fact sheet

Scope: read-only live-source extraction. No architecture document, manual prose or reference PDF was opened. No runtime changes or tests. Paired raw contracts, register storage and indexed MMIO layout agree on the facts below. Output intensity behavior is excluded for the separate audit. Host producer observations are explicitly scoped and are not imported as console-wide guarantees.

## Raw sampled representation

### IF01 — Counts and keyboard interpretation
- Keyboard storage is 8 words, 256 usage bits. A set bit means the corresponding USB HID keyboard/keypad usage (page 0x07) is pressed. Four pad records are sampled.
- Sources: `machine/ts/machine/devices/input/contracts.ts:3–9,69–76`; paired `machine/cpp/machine/devices/input/contracts.h:10–17,72–79`.

### IF02 — Key word and bit selection
- Usage `u` selects keyboard word `u >> 5` and bit `u & 31`; the MMIO word address is `keyboard_bitmap_address + ((u >> 5) << 2)`.
- Sources: `cartlib/input/input.lua:406–417`; producer uses the same shifts/mask in `hosts/common/input/keyboard.ts:71–75`; native bit query is `hosts/libretro/input.cpp:134–138`.

### IF03 — Established keyboard usage names
- The installed cart library explicitly maps the names below. This is the supported name table in that source, not a promise that every possible HID usage has a named mapping.

| Names | Usage IDs |
| --- | --- |
| KeyA … KeyZ | 4 … 29, consecutive |
| Digit1 … Digit9, Digit0 | 30 … 38, 39 |
| Enter, Escape, Backspace, Tab, Space | 40, 41, 42, 43, 44 |
| Minus, Equal, BracketLeft, BracketRight, Backslash | 45, 46, 47, 48, 49 |
| Semicolon, Quote, Backquote, Comma, Period, Slash | 51, 52, 53, 54, 55, 56 |
| CapsLock | 57 |
| F1 … F12 | 58 … 69, consecutive |
| PrintScreen, ScrollLock, Pause | 70, 71, 72 |
| Insert, Home, PageUp, Delete, End, PageDown | 73, 74, 75, 76, 77, 78 |
| ArrowRight, ArrowLeft, ArrowDown, ArrowUp | 79, 80, 81, 82 |
| NumLock, NumpadDivide, NumpadMultiply, NumpadSubtract, NumpadAdd, NumpadEnter | 83, 84, 85, 86, 87, 88 |
| Numpad1 … Numpad9, Numpad0 | 89 … 97, 98 |
| NumpadDecimal, IntlBackslash, ContextMenu, Power, NumpadEqual | 99, 100, 101, 102, 103 |
| F13 … F24 | 104 … 115, consecutive |
| IntlRo, IntlYen | 135, 137 |
| Lang1, Lang2 | 144, 145 |
| ControlLeft, ShiftLeft, AltLeft, MetaLeft | 224, 225, 226, 227 |
| ControlRight, ShiftRight, AltRight, MetaRight | 228, 229, 230, 231 |

- Source: `cartlib/input/keys.lua:8–37`. Independent host translation has the same complete name/usage table at `hosts/common/input/hid_keys.ts:7–38`. Native relevant alphanumeric translation is `hosts/libretro/input.cpp:43–57`; named constant KeyA/A is `hosts/libretro/hid_keys.h:12`.

### IF04 — Concrete KeyA and pad A masks
- `KeyA` usage is 4; therefore it selects keyboard word 0, bit 4, mask `0x00000010` (IF02 arithmetic, mapping IF03).
- Pad A is button bit 0, mask `0x00000001` (IF06 below). These are different source fields; the key mapping does not make raw keyboard bits equal raw pad bits.
- Sources: `cartlib/input/keys.lua:9`; `cartlib/input/input.lua:413–414`; `machine/ts/machine/devices/input/contracts.ts:28–30`; paired `machine/cpp/machine/devices/input/contracts.h:37–39`.

### IF05 — Raw pad axis order
- Each pad has one buttons word followed by six axis words. Axis indices are: 0 LeftX, 1 LeftY, 2 RightX, 3 RightY, 4 LeftTrigger, 5 RightTrigger.
- Relative byte offsets including the buttons word are: buttons +0, LeftX +4, LeftY +8, RightX +12, RightY +16, LeftTrigger +20, RightTrigger +24. Pad stride is 28 bytes; pad raw index is 0…3.
- Sources: `machine/ts/machine/devices/input/contracts.ts:16–25,57–59`; paired `machine/cpp/machine/devices/input/contracts.h:24–34,67–69`; mirrored spec offsets `machine/ts/spec/bmsx/io.ts:49–50,283–291`, `machine/cpp/spec/bmsx/io.h:61–62,296–304`.

### IF06 — Pad buttons

| Bit | Raw contract name | Cart-library binding name |
| --- | --- | --- |
| 0 | A | a |
| 1 | B | b |
| 2 | X | x |
| 3 | Y | y |
| 4 | LeftBumper | lb |
| 5 | RightBumper | rb |
| 6 | LeftTrigger | lt |
| 7 | RightTrigger | rt |
| 8 | Select | select |
| 9 | Start | start |
| 10 | LeftStick | ls |
| 11 | RightStick | rs |
| 12 | Up | up |
| 13 | Down | down |
| 14 | Left | left |
| 15 | Right | right |
| 16 | Home | home |
| 17 | Touchpad | touch |

- Sources: raw enum `machine/ts/machine/devices/input/contracts.ts:27–48`, paired `machine/cpp/machine/devices/input/contracts.h:36–58`; library names `cartlib/input/input.lua:29–35`. A library button read uses `(word & (1 << bit)) ~= 0` at `cartlib/input/input.lua:163–166,328–334`.
- No zeroing/reserved-bit behavior for bits 18…31 is asserted by this fact. Raw latch copies the complete word (IF10).

### IF07 — Pointer button positions
- Bits 0 Primary, 1 Aux, 2 Secondary, 3 Back, 4 Forward. Library binding names are respectively `pointer_primary`, `pointer_aux`, `pointer_secondary`, `pointer_back`, `pointer_forward`.
- Sources: `machine/ts/machine/devices/input/contracts.ts:50–55`; paired `machine/cpp/machine/devices/input/contracts.h:60–65`; library `cartlib/input/input.lua:47–53,181–184`.
- No zeroing/reserved-bit behavior for bits 5…31 is asserted by this fact. Raw latch copies the complete word (IF10).

### IF08 — Signed Q16 interpretation
- Pad axis words are explicitly raw signed 16.16. Pointer X and Y are explicitly raw signed 16.16 pointer-space coordinates. The mathematical format interpretation is the signed 32-bit word divided by 65536. This is not a promise that every existing numeric helper returns an exact common decoded number; native helper precision is separately qualified in G09 below. The raw INPUT latch copies words directly and does not call those decoders (IF10).
- Thus raw `0x00010000` represents +1, `0xffff0000` represents −1, and `0x00000000` represents 0. These are arithmetic consequences of the decoder, not device-range restrictions. The representable quantum is 1/65536; full signed-word mathematical range is −32768 through 32767 + 65535/65536.
- Sources: `machine/ts/machine/devices/input/contracts.ts:57–59,69–74`; paired `machine/cpp/machine/devices/input/contracts.h:67–77`; decoder `machine/ts/machine/common/numeric.ts:1,11–15,43–45`, paired `machine/cpp/machine/common/numeric.h:10–17,46–48`.
- Both inspected live pointer producers encode the wheel with the signed Q16 encoder: `hosts/common/input/pointer.ts:95–116`, `hosts/libretro/input.cpp:371–375`. Raw contract does not declare a common physical wheel unit.

### IF09 — Raw MMIO field addresses
- Keyboard bitmap begins `0x0800006c` and covers 8 words through `0x08000088` (last address derived as base + 7 × 4).
- Pointer buttons `0x0800008c`; X `0x08000090`; Y `0x08000094`; wheel `0x08000098`.
- Pad 0 base `0x0800009c`; subsequent bases are `0x080000b8`, `0x080000d4`, `0x080000f0` (derived by +0x1c stride).
- Source containing exact raw constants: `cartlib/input/icu.lua:7–22`; mirrored spec formulas `machine/ts/spec/bmsx/io.ts:39–50,275–291`, `machine/cpp/spec/bmsx/io.h:51–62,288–304`.

### IF10 — Raw snapshots are copied, not interpreted by the latch
- The register latch copies all keyboard words, pointer buttons/X/Y/wheel, and each pad's button and six axis words. It does not normalize, calibrate, dead-zone or mask these fields in the latch operation.
- Sources: `machine/ts/machine/devices/input/registers.ts:84–102`; paired `machine/cpp/machine/devices/input/registers.cpp:24–40`.
- Register creation/reset initializes these fields to zero. Sources: `machine/ts/machine/devices/input/registers.ts:38–53,63–65`; paired `machine/cpp/machine/devices/input/registers.h:11–25`, `machine/cpp/machine/devices/input/registers.cpp:8–10`.

## Temporal meaning and producer boundaries

### IF11 — Pointer position is retained position, not the raw movement delta
- Common pointer producer writes its retained X/Y fields into the sampled snapshot; `ingestAxis2('pointer_position', x, y, ...)` replaces those retained Q16 fields with the supplied coordinates.
- Sources: `hosts/common/input/pointer.ts:147–152,216–234`.
- Native retains position, either from the first pointer contact or by adding relative mouse motion, before encoding X/Y into sampled words. Sources: `hosts/libretro/input.cpp:355–372,483–495`.
- This establishes retained position versus delta. It does NOT establish one common origin, screen geometry, physical unit or clipping range across producers; see gaps G01–G02.

### IF12 — Wheel is a producer-poll delta, not an absolute wheel position
- Common producer adds received wheel events to `pendingWheel`; `pollInput` publishes that accumulated delta in Q16 and resets the pending accumulator. Snapshot write only copies the published field; it does not consume it.
- Sources: `hosts/common/input/pointer.ts:95–116,147–152,241–247`.
- Native poll replaces the wheel field with Q16 `(mouseWheelDown - mouseWheelUp)`; snapshot write copies the field and does not clear it. Sources: `hosts/libretro/input.cpp:281–288,371–375,483–495`.
- Therefore the source code does not make wheel an accumulator over every skipped ICU sample, and does not clear wheel on each ICU read. No quantitative events-per-VBlank guarantee is asserted here.

### IF13 — Source-specific coordinates and wheel units: unresolved common contract
- Browser input sends `event.clientX`, `event.clientY` unchanged to the position event and `event.deltaY` unchanged to the wheel event. Sources: `hosts/browser/input.ts:448–458,580–590`.
- Native pointer contacts are mapped to viewport extents; relative mouse motion is accumulated and clamped to 0…viewportWidth−1 / 0…viewportHeight−1. Native wheel is down minus up counts. Sources: `hosts/libretro/input.cpp:126–131,289–303,355–375`.
- STOP for a claim of console-wide pixel/display-relative pointer coordinates or a common wheel unit. The opposed producer locations are named above. No publication claim that these paths share such a coordinate/unit contract is supported.

### IF14 — Source-specific pad scale and trigger updates
- Native stick input normalizes signed 16-bit input by 32768 for negative values and 32767 otherwise, preserving −1 and +1 endpoints, then Q16-encodes it. Native trigger words are exactly 0 or Q16 one based on physical trigger button state.
- Sources: `hosts/libretro/input.cpp:120–124,217–240,260–270`.
- Browser source forwards axis values without a normalizing/clipping operation in that producer; common gamepad owner encodes received stick coordinates as Q16. Sources: `hosts/browser/input.ts:125–141`; `hosts/common/input/gamepad.ts:115–154`.
- Browser button event is emitted on pressed/released transitions, carrying `buttons[i].value` on press; common owner stores trigger Q16 from that event value, or 0 on release. Sources: `hosts/browser/input.ts:110–122`; `hosts/common/input/gamepad.ts:101–112`.
- No universal hardware dead zone, calibration, saturation, minimum trigger actuation or continuously refreshed analog trigger range is established by the raw contract. See G03.

## Existing cart-library programming boundary (not hardware registers)

### IF15 — Raw records versus library player numbering
- The raw pad records use indices 0…3 (IF05). Library player index selects pad base as `base + (player.index - 1) * stride`; raw pad 0 corresponds to library player 1.
- Source: `cartlib/input/input.lua:154–166`; four-pad raw source is IF01.

### IF16 — Library sampling owner
- `cartlib/input/input_system` constructs an input tick system. Construction writes `sample_next_vblank` to the control register; each `update_frame` calls `input.advance_frame()` then writes the arm value again. Its gameplay update only calls `input.advance_gameplay()`.
- Frame tick group input has priority −200 and clock.frame; gameplay tick priority −199 and clock.gameplay, with frame tick as prerequisite and `input.synchronize_gameplay_clock` as resume callback.
- Sources: `cartlib/input/input_system.lua:12–45`; raw arm constant/address `cartlib/input/icu.lua:7–8`.
- Do not run an independent raw-controller sampling owner alongside this system based on an assumption that the library does not program the latch: this source demonstrably owns those writes.

### IF17 — Registered players and default mappings
- `input.has_player(index)` returns registration membership. `input.add_player(index)` constructs/retains that player's input state; `new_player` installs an enabled default context at priority 0.
- Sources: `cartlib/input/input.lua:545–606,751–762`.
- Default keyboard action bindings: a=KeyX, b=KeyC, x=KeyZ, y=KeyS, lb=ShiftLeft, rb=ShiftRight, lt=ControlLeft, rt=AltLeft, select=ControlRight, start=AltRight, ls=KeyQ, rs=KeyE, up/down/left/right=ArrowUp/ArrowDown/ArrowLeft/ArrowRight, home=Escape, touch=Space.
- Source: `cartlib/input/input.lua:68–87`.
- Default gamepad actions use same-named bindings from IF06; default pointer actions include the five IF07 names plus `pointer_delta`, `pointer_position`, `pointer_wheel`.
- Sources: `cartlib/input/input.lua:89–119`.
- These mappings live in the library and are not a raw hardware keyboard-to-pad remapping (raw latch IF10).

### IF18 — Custom contexts
- Signature `input.push_context(player_index, id, keyboard, gamepad, pointer, priority, enabled)` installs source-specific action maps. Omitted priority is 100; omitted enabled is true; absent map arguments become empty maps.
- A repeated id replaces the existing context of that id. Contexts sort by increasing priority then increasing insertion order; resolving one action/source walks in reverse, taking the first enabled context defining that action/source (highest priority, latest insertion at equal priority). Bindings inside the chosen list are deduplicated.
- `input.clear_context(player_index, id)` removes that context id and refreshes action state.
- Sources: `cartlib/input/input.lua:239–244,450–474,532–542,806–825`.

### IF19 — Explicit clocks and queries
- Existing signatures:
  - `input.is_action_pressed(player_index, clock_source, action)`
  - `input.is_action_just_pressed(player_index, clock_source, action)`
  - `input.is_action_just_released(player_index, clock_source, action)`
  - `input.get_action_value(player_index, clock_source, action)`
  - `input.get_vector(player_index, clock_source, action)` → two values X and Y
  - `input.bind(player_index, clock_source, pattern)` → retained evaluator
  - `input.consume(player_index, clock_source, actions)`; actions may be one action or a list.
- Boolean query results are filtered by consumption. Scalar/vector APIs return raw `value_q16` / `value_x_q16`, `value_y_q16` fields, not decoded floating coordinates.
- Sources: `cartlib/input/input.lua:847–871,1009–1066`.
- `clock.gameplay=0x01`, `clock.frame=0x02`. Source: `cartlib/clock.lua:10–11`.
- No action-expression grammar is specified by this limited extraction; do not invent supported patterns from names.

### IF20 — Library pointer delta
- `pointer_position` bindings read raw X/Y addresses. `pointer_delta` binding computes current retained X/Y minus its own previous sampled X/Y, then updates those previous values. `pointer_wheel` reads the raw wheel word, and derives pressed from nonzero value.
- Sources: `cartlib/input/input.lua:185–192,295–325`.
- `prev_x_q16` and `prev_y_q16` initially 0; no initial-position suppression occurs in the shown library `pointer_delta` calculation. Sources: `cartlib/input/input.lua:126–151,306–312`.
- Do not relabel this library subtraction as an ICU movement-delta register.

### IF21 — Stick directions are library policy, separate from D-pad buttons
- `input.stick_directions(stick, actuation_q16)` takes stick `ls` or `rs` and returns bindings left/right/up/down. Left/up select negative X/Y magnitude; right/down select positive X/Y magnitude. Each uses the caller's Q16 actuation threshold; no raw D-pad bit is synthesized by this function.
- Sources: `cartlib/input/input.lua:36–45,262–289,722–748`.

### IF22 — Frame versus gameplay sampling
- `advance_frame` increments a retained frame serial and samples every registered player. `advance_gameplay` advances only the gameplay action-evaluation boundary to the currently sampled physical edge sequence.
- Resume synchronization advances gameplay cursors to the current sequence and resets action evaluation, preserving held levels but not replaying suspended transitions as new gameplay edges.
- Sources: `cartlib/input/input.lua:609–644,764–803`.
- This is library edge/evaluation state, not an ICU event FIFO guarantee.

## Explicit gaps / withheld claims

- **G01 — Common pointer coordinate system absent.** Raw paired contracts call X/Y signed16.16 pointer-space coordinates only; browser `clientX/clientY` and native viewport mapping differ (IF13). No shared hardware pixel origin, active-picture transform, scaling, clipping bounds or outside-picture behavior is published from these sources.
- **G02 — Common wheel physical unit / sample cadence absent.** Both inspected paths publish signed Q16 deltas at their producer poll, but browser `deltaY` and native down−up counts are different source quantities (IF12–13). No guarantee that one wheel integer equals one notch/pixel/line, or that skipped ICU samples preserve all wheel movement.
- **G03 — Universal nominal pad range / calibration / continuous triggers absent.** Raw storage is signed16.16; native normalization and browser passthrough/transition-trigger routing are source-specific (IF14). Do not claim register saturation, automatic dead zones, one continuous trigger update per latch or a common threshold.
- **G04 — No pad connection bit established.** Zero button/axis words identify neutral raw input in these sources, not by themselves connectivity. No separate connection/identity register is established by this bounded extraction. Do not overload vibration-support bits as connectivity.
- **G05 — Unnamed HID usages not exhaustively specified.** The bitmap represents 256 usage bits, but inspected name maps list the specific names in IF03. No semantics for unlisted usages or character/text/composition entry are imported from external HID/browser conventions.
- **G06 — MMIO access classes/faults/IRQ/writes intentionally delegated.** IF09 contains raw addresses/offsets, not a complete access-class table. This task did not audit full bus policy/controller status/IRQ handshake or output command acceptance. Use the parent's separate device/control fact sheet.
- **G07 — No full cartlib grammar/reference.** IF15–22 establish the existing programming owner and simple API names/clock boundary. Advanced action-expression grammar, keyboard-sequence/combo timing and full world integration need separate extraction if taught; no missing behavior inferred here.
- **G08 — Signed encoder outside representable input range.** Both in-range Q16 decode/representable-bit facts are established; no claim is made that TS truncation/wrapping and native floating-to-integer conversion agree for arbitrary out-of-range source coordinates. Hardware raw words still copy directly (IF10).

- **G09 — Central signed-decoder precision is not a shared exact numeric ABI.** `machine/ts/machine/common/numeric.ts:43–45` decodes signed word using binary64 division; `machine/cpp/machine/common/numeric.h:46–48` converts its signed numerator to binary32 and returns binary32. Large signed words can therefore round before/after division. Stop an exact full-word common helper-result claim. This does not change the explicitly signed16.16 raw format or the paired latch’s direct bit copy (`contracts.ts:57–59,69–74`, `contracts.h:67–77`; IF10 source ranges), and is not proof of a different guest-side explicit arithmetic result or an actual pointer/calibration outcome. No decoder/helper ABI is taught in the public chapter.
