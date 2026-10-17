# INPUT register and latch fact sheet

Extraction: 2026-10-17. Read-only. Public hardware facts and internal evidence are separated. No architecture.md, PDF, public manual prose, tests, BIOS, cartlib, host input producer, or unrelated device implementation was opened. Memory access-right facts are supplied by the separate access/timing extraction, not inferred from device callback registration.

## IR01 — Register geometry and byte addresses

The input word size is 4 bytes. IO_BASE = RAM_BASE = 0x08000000. Input base index is 25: IRQ size 3 + first DMA register file size 6 + GEO size 16. Input block contains 47 words = 188 bytes, from 0x08000064 through 0x0800011C inclusive; next byte is 0x08000120. Numeric addresses below are direct arithmetic evaluation of the mirrored definitions, not a new mapping.

Sources:
- machine/ts/spec/bmsx/memory_map.ts:6,23,32
- machine/cpp/spec/bmsx/memory_map.h:12,29,38
- machine/ts/spec/bmsx/io.ts:3–20,37–56,275–296
- machine/cpp/spec/bmsx/io.h:15–32,49–68,288–309

| Byte address | Name | Reset | Access established by Input owner only |
|---|---|---:|---|
| 0x08000064 | IO_INP_CTRL | 0 | Write callback installed; readable backing/access rights require Memory fact |
| 0x08000068 | IO_INP_STATUS | 0 | Owner mirrors sample sequence; read-only classification requires Memory fact |
| 0x0800006C–0x08000088, stride 4 | IO_INP_KEYS[0..7] | all 0 | Snapshot mirroring; read-only classification requires Memory fact |
| 0x0800008C | IO_INP_POINTER_BUTTONS | 0 | Snapshot mirroring; read-only classification requires Memory fact |
| 0x08000090 | IO_INP_POINTER_X | 0 | Snapshot mirroring; read-only classification requires Memory fact |
| 0x08000094 | IO_INP_POINTER_Y | 0 | Snapshot mirroring; read-only classification requires Memory fact |
| 0x08000098 | IO_INP_POINTER_WHEEL | 0 | Snapshot mirroring; read-only classification requires Memory fact |
| 0x0800009C–0x08000108 | IO_INP_PADS, four seven-word records | all 0 | Snapshot mirroring; read-only classification requires Memory fact |
| 0x0800010C | IO_INP_OUTPUT_PORT | 0 | Write callback installed |
| 0x08000110 | IO_INP_OUTPUT_INTENSITY_Q16 | 0 | Write callback installed |
| 0x08000114 | IO_INP_OUTPUT_DURATION_MS | 0 | Write callback installed |
| 0x08000118 | IO_INP_OUTPUT_STATUS | 0 | Snapshot mirroring; read-only classification requires Memory fact |
| 0x0800011C | IO_INP_OUTPUT_CTRL | 0 | Write callback installed; callback explicitly writes backing to 0 |

Address-name sources are the spec ranges above. Reset sources for all register words except STATUS/OUTPUT_CTRL:
- machine/ts/machine/devices/input/registers.ts:39–61,121–140
- machine/cpp/machine/devices/input/registers.h:12–24
- machine/cpp/machine/devices/input/registers.cpp:8–10,59–78

STATUS and OUTPUT_CTRL full-device reset sources:
- machine/ts/machine/devices/input/controller.ts:50–59
- machine/cpp/machine/devices/input/controller.cpp:20–29

Write callback registration sources:
- machine/ts/machine/devices/input/controller.ts:22–26,37–48
- machine/cpp/machine/devices/input/controller.cpp:8–18

## IR02 — Pad record layout

Pad numbers are 0..3. Each pad record has seven words, stride 28 bytes (0x1C). Bases are 0x0800009C, 0x080000B8, 0x080000D4, 0x080000F0.

| Offset within pad record | Word |
|---:|---|
| +0x00 | Buttons |
| +0x04 | Left X |
| +0x08 | Left Y |
| +0x0C | Right X |
| +0x10 | Right Y |
| +0x14 | Left trigger |
| +0x18 | Right trigger |

- machine/ts/spec/bmsx/io.ts:48–50,283–291
- machine/cpp/spec/bmsx/io.h:60–62,296–304
- machine/ts/machine/devices/input/contracts.ts:16–25,57–60
- machine/cpp/machine/devices/input/contracts.h:24–34,67–70

## IR03 — Exact control words, not independent enable/reset bits

INP_CTRL_ARM is the whole word 1 (0x00000001). INP_CTRL_RESET is the whole word 2 (0x00000002). Both owners switch on exact equality of the full CTRL word; they do not mask individual bits. Word 3 does not combine ARM and RESET.

- machine/ts/spec/bmsx/io.ts:412–413
- machine/cpp/spec/bmsx/io.h:425–426
- machine/ts/machine/devices/input/controller.ts:61–76
- machine/cpp/machine/devices/input/controller.cpp:31–46

## IR04 — ARM behavior

A CTRL write stores the full raw word into register state. Exact ARM=1 sets the pending arm Boolean true and returns. It does not sample immediately, change sequence, clear register state, or write a completion value to CTRL. Repeated ARM writes before an accepted edge leave one pending Boolean, not a count or queue. Calling cancelSampleArm clears that Boolean without changing register state or sequence; no cartridge-accessible cancel register is defined in these files.

- machine/ts/machine/devices/input/controller.ts:61–66,78–100,103–105
- machine/cpp/machine/devices/input/controller.cpp:31–36,48–69,72–74
- machine/ts/machine/devices/input/registers.ts:104–118
- machine/cpp/machine/devices/input/registers.cpp:42–56

Actual guest readback immediately following a write depends on Memory write/callback ordering. This sheet does not infer that ordering from device state; root is extracting it separately.

## IR05 — CTRL RESET behavior

Exact RESET=2 immediately:
1. clears pending arm;
2. sets sample sequence to zero;
3. sets last sample cycle to zero;
4. resets the entire Input register state to the zero values in IR01, including CTRL itself, all sampled words, output parameters, and output support mask;
5. mirrors that state to MMIO;
6. writes STATUS=0.

Consequently the stored control-state word after this operation is 0, not 2. This branch does not reset the remembered supervisor request-line level, does not issue a vibration effect, and does not explicitly write OUTPUT_CTRL. Full-device reset has additional behavior, listed in IR06.

- machine/ts/machine/devices/input/controller.ts:67–74
- machine/cpp/machine/devices/input/controller.cpp:37–44
- machine/ts/machine/devices/input/registers.ts:39–61,121–140
- machine/cpp/machine/devices/input/registers.cpp:8–10,59–78
- machine/cpp/machine/devices/input/registers.h:12–24

## IR06 — Full-device reset is not identical to writing CTRL RESET

The full reset operation clears pending arm, sequence, last sample cycle, and remembered supervisor request-line level; resets register state; explicitly writes OUTPUT_CTRL=0; mirrors registers; and writes STATUS=0. The CTRL RESET branch omits the request-line-memory clear and explicit OUTPUT_CTRL write. Neither reset implementation calls applyInputControllerVibrationEffect. No claim about physical vibration cancellation may be inferred from resetting parameter words alone.

- machine/ts/machine/devices/input/controller.ts:50–59,67–74
- machine/cpp/machine/devices/input/controller.cpp:20–29,37–44

## IR07 — Unrecognized CTRL words

Every CTRL write first stores the entire word. Any value other than exact 1 or exact 2 falls through without modifying pending arm, sequence, last sample cycle, or other register state. Thus CTRL=0 is not an arm-cancel command; CTRL=3 is not ARM+RESET; an unrecognized write after ARM does not cancel the pending sample. The original unrecognized raw word remains the control-state word and is included in the next register mirror. No Input-specific error/fault is raised by this branch.

- machine/ts/machine/devices/input/controller.ts:61–76,95–100
- machine/cpp/machine/devices/input/controller.cpp:31–46,64–69
- machine/ts/machine/devices/input/registers.ts:121–122
- machine/cpp/machine/devices/input/registers.cpp:59–60

The sentence about no Input-specific fault is limited to the controller dispatch branch, not a claim about all bus access faults or System behavior.

## IR08 — Accepted VBlank edge

onVblankEdge first checks pending arm. If armed, it asks the input source for one full snapshot. The requested context is Supervisor when system.supervisorContextActive() is true, otherwise Normal. It next handles the independent supervisor request line as IR09. If still armed, it increments the sample sequence modulo 2^32, records the supplied cycle word as lastSampleCycle, clears pending arm, latches the entire snapshot into register state, mirrors register state, and writes the incremented sequence to STATUS. An accepted edge does not reset CTRL; ARM's raw control-state word remains 1 unless another write changed it.

If not armed, the method does not request a new input snapshot, increment sequence, record cycle, latch data, mirror registers, or update STATUS. It still evaluates the independent supervisor request line.

- machine/ts/machine/devices/input/controller.ts:78–101
- machine/cpp/machine/devices/input/controller.cpp:48–70
- machine/ts/machine/devices/input/contracts.ts:11–14,132–139
- machine/cpp/machine/devices/input/contracts.h:19–22,115–123

No VBlank frequency, CPU cycle cost, synchronization to IRQ service, or physical device polling latency is defined by these methods. Those require timing/Memory/runtime scheduler facts outside this extraction.

## IR09 — Independent supervisor request-line edge

At every onVblankEdge invocation, armed or not, the controller reads supervisorRequestLineHigh(). If true after the previously remembered level was false, it calls system.requestSupervisorLineEdge(). It then remembers the current line level. Consecutive high observations do not repeatedly request edges; an observed low permits another subsequent rising observation. Full reset clears the remembered level; CTRL RESET does not. Effects of the System request beyond this call are outside these owners.

- machine/ts/machine/devices/input/controller.ts:32,50–54,67–74,87–94
- machine/cpp/machine/devices/input/controller.h:30
- machine/cpp/machine/devices/input/controller.cpp:20–24,37–43,56–63

## IR10 — Snapshot latches preserve all raw word bits

The latch copies eight keyboard words, pointer buttons, pointer X/Y/wheel, the rumble-support mask into outputStatus, four pad button words, and six axis words per pad. The owners apply no button-bit, axis, coordinate, or support-mask clamp/mask while latching. All 32 bits of each source word reach the corresponding stored word. The mirror writes those words, CTRL, and output parameters. Output parameters are not replaced by the snapshot. STATUS is written separately by the controller after the mirror; OUTPUT_CTRL is not part of the register mirror.

- machine/ts/machine/devices/input/registers.ts:85–102,121–140
- machine/cpp/machine/devices/input/registers.cpp:24–40,59–78

This is a raw-latch fact, not evidence of which bits/ranges an external physical input producer emits.

## IR11 — Declared raw keyboard/button representations

The keyboard has eight 32-bit words = 256 bits. Keyboard bits are indexed by USB HID usage IDs on usage page 0x07; pressed state is a set bit. As arithmetic of the indexed 256-bit word array, usage u selects word u >> 5 and bit u & 31, for represented usages 0..255. The device performs no key-name lookup, mapping, binding, or action semantics.

- machine/ts/machine/devices/input/contracts.ts:3–8,69–70
- machine/cpp/machine/devices/input/contracts.h:10–17,72–73

Pad button positions:
0 A; 1 B; 2 X; 3 Y; 4 Left bumper; 5 Right bumper; 6 Left trigger; 7 Right trigger; 8 Select; 9 Start; 10 Left stick; 11 Right stick; 12 Up; 13 Down; 14 Left; 15 Right; 16 Home; 17 Touchpad.

- machine/ts/machine/devices/input/contracts.ts:27–48
- machine/cpp/machine/devices/input/contracts.h:36–58

Pointer button positions:
0 Primary; 1 Auxiliary; 2 Secondary; 3 Back; 4 Forward.

- machine/ts/machine/devices/input/contracts.ts:50–55
- machine/cpp/machine/devices/input/contracts.h:60–65

These are named bit positions, not an assertion that remaining bits read zero: IR10 shows all raw source bits are copied. No supported-key list or HID name/number table appears in the allowed files.

## IR12 — Coordinate and axis representations, bounded

All six pad axis words are explicitly described as raw signed s16.16 words in both contracts. The pointer X word is explicitly described as a raw s16.16 pointer-space coordinate; Y and wheel are named Q16 fields but lack a separate units/range declaration in these contracts. No pointer resolution, origin, coordinate extent, wheel accumulation/consumption rule, pad axis range, dead zone, trigger interval, normalization, absent-controller rule, or connection flag is defined in these allowed files. Do not invent these from the raw-latch names.

- machine/ts/machine/devices/input/contracts.ts:57–76
- machine/cpp/machine/devices/input/contracts.h:67–80

## IR13 — Output parameter words and port selection

PORT, INTENSITY_Q16, and DURATION_MS writes store the entire raw word in register state without clamping or masking. These writes do not invoke an effect. Applying an effect selects pad index PORT & 3 (low two bits), while preserving the entire PORT word in state/mirror. OUTPUT_STATUS is the rumbleSupportMask from the most recently accepted snapshot; the register-state declaration describes a support bit per pad. The APPLY callback does not inspect this support mask before invoking the input source.

- machine/ts/machine/devices/input/registers.ts:33–36,81–83,94,104–118,137–140
- machine/cpp/machine/devices/input/registers.h:21–24
- machine/cpp/machine/devices/input/registers.cpp:20–22,32,42–56,75–78
- machine/ts/machine/devices/input/output_port.ts:17–25
- machine/cpp/machine/devices/input/output_port.cpp:16–24

## IR14 — Exact output APPLY control

INP_OUTPUT_CTRL_APPLY is exact whole word 1. On an OUTPUT_CTRL write equal to 1, the callback immediately calls applyInputControllerVibrationEffect with selected pad index, current raw unsigned duration word, and decoded intensity. Other OUTPUT_CTRL words do not call that method. Every output-control write, recognized or not, ends by writing OUTPUT_CTRL backing to zero. This control is not bit-combinable: 3 is not an APPLY. No VBlank arm is required for the callback. Output parameter words and support-mask register are unchanged by this callback.

- machine/ts/machine/devices/input/contracts.ts:132–146
- machine/cpp/machine/devices/input/contracts.h:115–130
- machine/ts/machine/devices/input/output_port.ts:17–26
- machine/cpp/machine/devices/input/output_port.cpp:16–25

Physical effect acceptance, duration truncation, intensity clamping, and device availability belong to the input-source implementation, which was not read here. Do not equate callback invocation with proven physical feedback.

## IR15 — STOPPED affected fact: decoded intensity precision disagreement

The numerator is unsigned in both owners and the divisor is the shared named INPUT_CONTROLLER_OUTPUT_INTENSITY_Q16_ONE = FIX16_ONE, but TypeScript returns an ordinary binary64 quotient while native explicitly converts the numerator to f32 and divides in f32. For arbitrary full raw words, these are not the same numeric result. Do not publish a common exact full-word decoded-intensity result or silently clamp unsupported values.

Opposing lines:
- machine/ts/machine/devices/input/contracts.ts:141–145: `(value >>> 0) / INPUT_CONTROLLER_OUTPUT_INTENSITY_Q16_ONE`
- machine/cpp/machine/devices/input/contracts.h:125–129: `static_cast<f32>(value) / static_cast<f32>(INPUT_CONTROLLER_OUTPUT_INTENSITY_Q16_ONE)`

No runtime change or code execution was performed. The numeric value of FIX16_ONE is owned outside the allowed files; root may supply that separate fact. The shared raw Q16 register, exact control-word dispatch, port mask, and source call timing are unaffected by this stopped exact-result claim.

## IR16 — Internal save-state evidence only; not a cartridge ABI

Captured controller state contains pending-arm Boolean, sequence word, last-sample-cycle word, remembered supervisor-request-line Boolean, and register state. Register state contains CTRL; eight key words; pointer buttons/X/Y/wheel; four pad-button words; twenty-four pad-axis words; output port/intensity/duration/status. This corresponds to 45 numeric register-state fields/array entries, but these owners do not define a packed external save-state byte format. STATUS is reconstructed from sampleSequence; OUTPUT_CTRL is not captured and is explicitly restored as zero. The scratch snapshot object is not included in captured controller state.

Restore reinstates controller state and register state, writes OUTPUT_CTRL=0, mirrors register state, and writes STATUS from restored sequence. Restore does not request a new input sample or invoke an output effect. TS clones the three register-state arrays at capture/restore; native copies its aggregate arrays by value.

- machine/ts/machine/devices/input/save_state.ts:3–9
- machine/cpp/machine/devices/input/save_state.h:5–10
- machine/ts/machine/devices/input/registers.ts:24–37,63–79
- machine/cpp/machine/devices/input/registers.h:12–24
- machine/cpp/machine/devices/input/registers.cpp:12–18
- machine/ts/machine/devices/input/controller.ts:107–126
- machine/cpp/machine/devices/input/save_state.cpp:7–26

## Extraction boundaries and unresolved facts

- Access modes/readback/write ordering/bus faults: require paired Memory-owner facts; do not infer RO from no callback. Root is independently extracting them.
- VBlank trigger identity/frequency, CPU/IO bus transfer costs, and whether sample completion precedes a specific IRQ: require scheduler/timing/IRQ owners.
- Supervisor request handling, visibility during supervisor execution, pending-arm cancellation caller policy: require System/caller owners.
- Pointer coordinate space, signed wheel unit/consumption, pad value ranges/absence, physical device support: require producers.
- FIX16_ONE numeric scale and arbitrary-intensity precision: numeric owner fact plus the explicit IR15 discrepancy.
- No input IRQ bit or input fault register is defined in this allowed spec/owner surface. This is not proof that all possible accesses cannot raise generic bus faults.

All remaining compared input spec geometry, control dispatch, latch/mirror, reset and save-state behaviors agree between the inspected mirrors. The single stopped full-domain numeric-result claim is IR15.

## Separate bounded extractions

- [Access, runtime edge and IRQ route](input-timing.md)
- [Raw formats and producer boundaries](input-formats.md)
- [Output command and precision boundary](input-output.md)
- [Complete executed program](input-example.md)
