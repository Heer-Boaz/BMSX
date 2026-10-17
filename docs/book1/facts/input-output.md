# INPUT output-port facts (live owner/spec audit)

Scope: only paired spec leaves, paired device owners, directly reachable output receivers, and history interposer. No architecture document, reference PDF, manual prose, runtime edits, or tests were used. This is a fact sheet, not publication prose. Output values outside the exact common interval are deliberately not assigned a universal physical behavior.

## Common register and command facts

### IO01 — Word addresses

| Address | Name | Word index | Access | Reset |
|---|---|---:|---|---|
| 0800010CH | INP_OUTPUT_PORT | 67 | Read/write | 00000000H |
| 08000110H | INP_OUTPUT_INTENSITY_Q16 | 68 | Read/write | 00000000H |
| 08000114H | INP_OUTPUT_DURATION_MS | 69 | Read/write | 00000000H |
| 08000118H | INP_OUTPUT_STATUS | 70 | Read-only | 00000000H |
| 0800011CH | INP_OUTPUT_CTRL | 71 | Read; command write | 00000000H |

Addresses derived directly from IO_BASE=08000000H, IO_WORD_SIZE=4 and the listed symbolic word indices. The output fields are not reset to device-specific capability values; OUTPUT_STATUS remains zero until a snapshot is latched.

Sources: `machine/ts/spec/bmsx/memory_map.ts:6,23,32`; `machine/cpp/spec/bmsx/memory_map.h:12,29,38`; `machine/ts/spec/bmsx/io.ts:3-20,37-56,292-296`; `machine/cpp/spec/bmsx/io.h:15-32,49-68,305-309`; `machine/ts/machine/devices/input/registers.ts:39-53,104-118`; `machine/cpp/machine/devices/input/registers.h:12-24`; `machine/cpp/machine/devices/input/registers.cpp:8-9,42-55`; `machine/ts/machine/devices/input/controller.ts:50-58`; `machine/cpp/machine/devices/input/controller.cpp:20-28`; `machine/ts/machine/memory/memory.ts:366-376,852-855,873-874`; `machine/cpp/machine/memory/memory.cpp:245-259,729-732,750-751`.

### IO02 — Raw latches and selected pad

PORT, INTENSITY_Q16 and DURATION_MS writes store their complete raw words immediately. A PORT write does not replace the stored word with a truncated port number. The selected pad used for dispatch is `PORT & 3`: only bits1:0 select one of four pad indices0..3. Upper bits remain stored/readable but do not affect the selected index.

Sources: `machine/ts/machine/devices/input/registers.ts:81-83,109-117,137-139`; `machine/cpp/machine/devices/input/registers.cpp:20-22,47-55,75-77`; `machine/ts/machine/devices/input/contracts.ts:9`; `machine/cpp/machine/devices/input/contracts.h:17`; raw MMIO storage before callback `machine/ts/machine/memory/memory.ts:371-376,627-642`; `machine/cpp/machine/memory/memory.cpp:253-259,522-536`.

### IO03 — APPLY is a complete command word, not a tested flag bit

The APPLY command word is exactly00000001H. An OUTPUT_CTRL write dispatches only when its whole word equals APPLY. Thus00000003H,00000101H or80000001H do not dispatch despite bit0 being set. After any ordinarily returning OUTPUT_CTRL write handler, OUTPUT_CTRL is zero. Commands other than exact APPLY do not alter the stored output parameters.

Sources: `machine/ts/machine/devices/input/contracts.ts:141-145`; `machine/cpp/machine/devices/input/contracts.h:125-129`; `machine/ts/machine/devices/input/output_port.ts:17-25`; `machine/cpp/machine/devices/input/output_port.cpp:16-24`.

### IO04 — Visibility edge and command operands

A matching OUTPUT_CTRL write calls the input-source output method synchronously with the selected pad, current raw duration word, and decoded intensity. It does not wait for ARM or VBlank and the output port contains no command queue. Merely writing PORT/INTENSITY/DURATION does not call the output method. Device sampling on an armed VBlank and output APPLY are separate paths.

Sources: `machine/ts/machine/devices/input/output_port.ts:17-25`; `machine/cpp/machine/devices/input/output_port.cpp:16-24`; `machine/ts/machine/devices/input/controller.ts:42-47,61-100`; `machine/cpp/machine/devices/input/controller.cpp:13-17,31-69`; `machine/ts/machine/devices/input/registers.ts:104-118`; `machine/cpp/machine/devices/input/registers.cpp:42-55`.

### IO05 — Exact common intensity interval; full raw word is not clamped by the device

The denominator is65536 (00010000H). For raw words00000000H..00010000H inclusive, both owners produce exactly `word / 65536`: zero, unit intensity at00010000H, and one part in65536 between consecutive words. This interval is exactly representable by both arithmetic representations. The device itself does not reject, clamp, sign-extend or mask larger intensity words before decoding. The differing arithmetic representation for larger words is IO-D01 below, not a common public guarantee.

Sources: `machine/ts/machine/common/numeric.ts:1-12`; `machine/cpp/machine/common/numeric.h:10-12`; `machine/ts/machine/devices/input/contracts.ts:141-145`; `machine/cpp/machine/devices/input/contracts.h:125-129`; `machine/ts/machine/devices/input/output_port.ts:18-23`; `machine/cpp/machine/devices/input/output_port.cpp:17-22`. Exactness of the restricted interval is a direct arithmetic deduction from these formulas, not an external actuator promise.

### IO06 — Duration operand

DURATION_MS is stored as a full unsigned32-bit word and passed as the numeric millisecond duration operand. No scaling, truncation, range clamp, deadline, elapsed counter or duration decrement is performed by the device output port. The native conversion to f64 preserves every unsigned32-bit word exactly.

Sources: `machine/ts/machine/devices/input/registers.ts:35,115-116`; `machine/cpp/machine/devices/input/registers.h:23`; `machine/cpp/machine/devices/input/registers.cpp:53-54`; `machine/ts/machine/devices/input/output_port.ts:19-22`; `machine/cpp/machine/devices/input/output_port.cpp:18-21`; receiver interface `machine/ts/machine/devices/input/contracts.ts:132-138`; `machine/cpp/machine/devices/input/contracts.h:115-122`.

### IO07 — Status is latched capability, not output completion

OUTPUT_STATUS is copied from `snapshot.rumbleSupportMask` when a snapshot is latched. It has one capability bit per pad. The raw owner copies the complete supplied mask rather than masking it to four bits. Output dispatch does not test this latched status word, update it, clear it, set busy/done, or write an error result. An armed VBlank sample refreshes it along with the other snapshot words; without that sample the status may retain an earlier capability value. A nonzero bit is not a completion acknowledgement.

Sources: `machine/ts/machine/devices/input/contracts.ts:69-76`; `machine/cpp/machine/devices/input/contracts.h:72-79`; `machine/ts/machine/devices/input/registers.ts:85-101,140`; `machine/cpp/machine/devices/input/registers.cpp:24-39,78`; `machine/ts/machine/devices/input/controller.ts:78-100`; `machine/cpp/machine/devices/input/controller.cpp:48-69`; dispatch full bodies `machine/ts/machine/devices/input/output_port.ts:17-25`; `machine/cpp/machine/devices/input/output_port.cpp:16-24`.

### IO08 — Device reset and RESET command effects

Full input-device reset zeroes all four output register-state fields and OUTPUT_CTRL and mirrors the register file. INP_CTRL RESET (exact2) also resets the register file, thus zeroing PORT/INTENSITY/DURATION/STATUS, and clears the input sampling arm/sequence/last-cycle. Neither reset path calls the output method to send a stop/cancellation to an already dispatched effect. Full reset explicitly zeroes OUTPUT_CTRL; the INP_CTRL RESET branch does not separately write OUTPUT_CTRL. This distinction must not be expanded into a claim about platform-wide reset, which may reset external input by separate paths.

Sources: `machine/ts/machine/devices/input/registers.ts:39-61`; `machine/cpp/machine/devices/input/registers.h:12-24`; `machine/cpp/machine/devices/input/registers.cpp:8-9`; `machine/ts/machine/devices/input/controller.ts:50-75`; `machine/cpp/machine/devices/input/controller.cpp:20-45`; RESET constants `machine/ts/spec/bmsx/io.ts:412-413`; `machine/cpp/spec/bmsx/io.h:425-426`.

### IO09 — Captured state is raw register state, not actuator state

Device capture includes PORT, INTENSITY_Q16, DURATION_MS and OUTPUT_STATUS verbatim as fields of its captured register file, together with sampleArmed, sampleSequence, lastSampleCycle and remembered supervisor-request-line state. OUTPUT_CTRL is not a captured register-state field. Device restore restores the raw register file, writes OUTPUT_CTRL zero, mirrors the restored register words, and does not replay APPLY or call the output method. External output deadline/current motor state is not represented in this input-device capture structure.

Sources: `machine/ts/machine/devices/input/registers.ts:24-36,63-78`; `machine/cpp/machine/devices/input/registers.h:12-24`; `machine/cpp/machine/devices/input/registers.cpp:12-18`; `machine/ts/machine/devices/input/save_state.ts:3-9`; `machine/cpp/machine/devices/input/save_state.h:5-10`; `machine/ts/machine/devices/input/controller.ts:107-125`; `machine/cpp/machine/devices/input/save_state.cpp:7-25`.

### IO10 — Output faults and IRQ boundaries

The output command handler has no output-specific fault latch, IRQ signal, acknowledgement or completion signal; it invokes the receiver for exact APPLY and clears control. The paired IRQ bit declarations contain no INPUT-output interrupt. Writing the read-only OUTPUT_STATUS word through mapped32-bit access raises the shared BUS_FAULT_READ_ONLY code3 before the I/O slot/handler is written. This does not establish that arbitrary external callbacks cannot throw or fail.

Sources: complete output handler `machine/ts/machine/devices/input/output_port.ts:17-25`; `machine/cpp/machine/devices/input/output_port.cpp:16-24`; IRQ declarations `machine/ts/spec/bmsx/io.ts:362-372`; `machine/cpp/spec/bmsx/io.h:375-385`; status RO and bus path `machine/ts/machine/memory/memory.ts:627-642,873-874`; `machine/cpp/machine/memory/memory.cpp:522-536,750-751`; fault numeric constants `machine/ts/spec/bmsx/io.ts:399-402`; `machine/cpp/spec/bmsx/io.h:412-415`.

## Direct receiver boundaries (internal evidence, not a universal cartridge ABI)

### IO11 — Common input owner and channel routing

The primary TS input source forwards output only when it is the current guest input recipient; an InputChannel likewise forwards only when it is the current recipient. The chosen player is padIndex+1. PlayerInput forwards only when a gamepad is attached and currently reports support; GamepadInput then passes the same duration/intensity to its physical device adapter. None of these common methods clamps or encodes the intensity. Capability is sampled from attached gamepad support even when captured input clears action states, so capability bits need not mean a particular recipient can actuate output at that time.

Sources: `hosts/common/input/channel.ts:5-14`; `hosts/common/input/manager.ts:198-212,574-590,608-620`; `hosts/common/input/player.ts:56-60`; `hosts/common/input/gamepad.ts:35-36,220-223`; physical adapter interface `hosts/common/input/contracts.ts:24-30`.

### IO12 — Native Libretro receiver

The native receiver first tests its live capability mask (not the device's latched OUTPUT_STATUS). Supported calls clamp intensity to0..1, convert it to a16-bit strength by multiplication by65535 and unsigned16 conversion, and send the same strength to strong and weak callbacks. Duration<=0 sends zero strength. If neither callback applies the request, live capability and active-output bits are cleared. If strength is zero, active output is cleared. Otherwise one deadline per port is replaced with current polled time + duration and active is set. Subsequent polls stop active output at the first poll whose supplied time is >=that deadline. This is not a device-cycle deadline or a FIFO; the current request overwrites the per-port deadline. Capability changes become visible to device status only on a later snapshot latch.

Sources: `hosts/libretro/input.cpp:150-161,483-495,545-580`; state fields `hosts/libretro/input.h:103-105,130-133`. Capability creation/install/device-change and active cancellation sources `hosts/libretro/input.cpp:498-542`; external-input reset cancellation `hosts/libretro/input.cpp:611-617`. These external reset effects are distinct from IO08.

### IO13 — History modes suppress output outside live execution

The paired history interposer discards output calls while Replaying or Reviewing; other modes forward the current duration/intensity unchanged. Thus saved/replayed input observations or a restored OUTPUT_STATUS do not prove that an actuator was driven. No output command replay journal is called by this method.

Sources: `machine/ts/machine/runtime/history/input_source.ts:26-29`; `machine/cpp/machine/runtime/history/input_source.cpp:22-25`.

## Mirrored difference / stop affected common claim

### IO-D01 — Full-word intensity decode precision differs

TS decodes `(value >>> 0) /65536` as a binary64 number. Native decodes `static_cast<f32>(value) / static_cast<f32>(65536)`, with f32 in its input-source interface. For FFFFFFFFH this yields65535.99998474121 on TS and65536 on native. All raw values0..00010000H decode exactly and equally (IO05). Do not describe the entire32-bit word interval as one bit-exact common decoded-number ABI.

Opposing locations: `machine/ts/machine/devices/input/contracts.ts:138,144-145`; `machine/cpp/machine/devices/input/contracts.h:122,128-129`.

### IO-D02 — Full-word differences cannot be declared globally unobservable

For FFFFFFFFH the native Libretro receiver clamps both possible high decoded magnitudes to1, so the precision difference is masked in its resulting16-bit strength. This does not prove the whole program has a universal saturation rule: the TS common route does not clamp, and its browser gamepad adapter forwards intensity directly to both API magnitude fields, or falls through to `navigator.vibrate(durationMs * intensity)`. The onscreen adapter also forwards the duration*intensity product. Consequently the high decoded value reaches an externally called argument on existing TS routes. The Sony HID adapter instead applies intensity*255 integer conversion into byte storage and timed stop, another receiver-specific transform. No physical actuator outcome or cross-platform API acceptance was established in this read-only audit.

Sources: `hosts/libretro/input.cpp:557-580`; forwarding chain IO11; `hosts/browser/input.ts:76-95`; `hosts/browser/onscreen_gamepad.ts:154-155`; `hosts/browser/sony_gamepad_hid.ts:87-115,241-249`. This is a source-reachability boundary, not an executed hardware observation and not a chosen intended behavior.

## Author scope

Safe common chapter material: IO01..IO10, retaining the exact normal intensity interval and reset/capture distinctions. Receiver mechanics IO11..IO13 and IO-D01..02 belong internal authority notes/follow-up; do not put host/browser/history terminology into console-manual prose. Do not promise physical vibration strength/duration/completion, universal full-word saturation, a queued effect FIFO, output busy/done status, or an output IRQ. No runtime change is authorized by this audit.

# INPUT output follow-up (not a runtime repair)

## G-OUTPUT-01 — Full raw intensity decoder representation

Common decoded-number ABI for all unsigned32-bit words remains unestablished. TS uses binary64 arithmetic at `machine/ts/machine/devices/input/contracts.ts:144-145`; native narrows the numerator and result to binary32 at `machine/cpp/machine/devices/input/contracts.h:128-129` and its receiver interface line122. FFFFFFFFH differs65535.99998474121 versus65536. The shared raw register word and exact0..00010000H interval are established; no need to block those facts or normal programming instructions. Do not repair either runtime or select intended semantics during documentation work.

## G-OUTPUT-02 — Arbitrary raw physical output behavior is not one common hardware rule

Native Libretro clamps at `hosts/libretro/input.cpp:566`; TS common owner forwards unchanged at `hosts/common/input/manager.ts:206-212`, `hosts/common/input/player.ts:56-60`, `hosts/common/input/gamepad.ts:221-222`. Existing browser routes forward API magnitude arguments or multiply duration by intensity at `hosts/browser/input.ts:82-95` / `hosts/browser/onscreen_gamepad.ts:154-155`; HID transforms into byte reports at `hosts/browser/sony_gamepad_hid.ts:87-115`. Thus high-word precision is masked on the inspected native path, not proven masked on every existing path. Source audit establishes different outbound arguments/transforms; no platform/physical acceptance or motor output observation was obtained. Exact high-bit intensity physical semantics remain follow-up.

## G-OUTPUT-03 — Capability is not acknowledgement or completion

OUTPUT_STATUS is sampled capability, while output receiver support/routing can change independently. Device dispatch never checks or updates the latched word (`machine/ts/machine/devices/input/output_port.ts:17-25`, native16-24); snapshot latch does (`registers.ts:94`, native registers.cpp32). Never teach successful physical output, completion, supported-target ownership, interrupt acknowledgement or exact current actuator state from this status word. Public cautions can accurately name this distinction without inventing a fallback.

## G-OUTPUT-04 — Device reset/restore is not external actuator reset

Device reset and captured-state restore do not call output (`controller.ts:50-75,117-125`, `controller.cpp:20-45`, `save_state.cpp:17-25`). LibretroInput has its own cancellation reset (`hosts/libretro/input.cpp:611-617`) and history suppresses replay/review output (`machine/ts/machine/runtime/history/input_source.ts:26-29`, native input_source.cpp22-25). No universal statement that INPUT RESET stops an active physical effect, or save-state restore reinstates it, is supported.

## Audit limits

Read-only; no tests, no runtime mutation, no manual prose, no files under repository edited. References to binary32/binary64 arithmetic are internal audit vocabulary, not register types for the public manual.
