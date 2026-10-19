# Input controller

## Function and resources

The input controller samples a keyboard, a pointing device and four game pads.
A program requests one sample with ARM. At the next VBlank-begin edge, the
controller copies the control states into its registers and advances the sample
sequence. The program can then read a stable set of key, button and axis values
while it updates the game. Each subsequent sample requires another ARM.

Sampling follows the display timing, so a game can acquire one set of controls
per display interval without tying input acquisition to the duration of its
update routine. Register reads leave the captured values unchanged.

The controller provides eight keyboard words, a pointer button word with three pointer data words, and four pad records. Each pad record contains a button word, two pairs of stick-axis words and two trigger words. A separate output port accepts vibration requests for a selected pad; its capability word is sampled with the input data.

The register block occupies 47 consecutive 32-bit words, from byte address `08000064H` through `0800011CH`. Use aligned, whole-word accesses.

| Resource | Capacity or condition |
|---|---|
| Register word | 32 bits |
| Mapped register block | 47 words, 188 bytes |
| Sampled data | 41 words, 164 bytes: 8 keyboard + 4 pointer + 28 pad + 1 capability |
| Keyboard bitmap | 256 HID usage bits |
| Pad records | 4 pads; 7 words, 28 bytes per pad |
| Sample sequence | 32 bits, incrementing modulo 2³² |
| Sample publication | A pending ARM request accepted at VBlank begin |

The sampling interval follows the programmed [PCRTC](pcrtc.md) timing.
[Interrupt controller](irq.md) describes the VBlank interrupt used to wait for
this edge.

![Armed sample latch and independent output request](figures/input-flow.svg)

The capture path transfers control states into the snapshot registers. The
separate output path sends vibration parameters to the selected pad when APPLY
is written. Solid arrows carry data; dashed arrows show the control sequence.
The capability register belongs to the captured input data.

## Raw input representations

### Keyboard usage bitmap

The keyboard occupies eight words: 256 bits indexed by USB HID keyboard/keypad usage on page `07H`. A set bit means that usage is pressed. The bitmap identifies key usages; this table does not define character or text-composition input.

For usage `u`, select word `u >> 5` and bit `u & 31`. Its word is at the keyboard bitmap base plus `4 × (u >> 5)` bytes. The mask within that word is `1 << (u & 31)`.

For example, `KeyA` is usage `04H`: word 0, bit 4, mask `00000010H`. This is not pad A. Pad A is bit 0 of a pad's buttons word, with mask `00000001H`.

<div class="keep-together">

The following table gives the keyboard usage assignments. Usage IDs are decimal.

| Key names | Usage IDs |
| --- | --- |
| `KeyA` … `KeyZ` | 4 … 29, consecutive |
| `Digit1` … `Digit9`, `Digit0` | 30 … 38, 39 |
| `Enter`, `Escape`, `Backspace`, `Tab`, `Space` | 40, 41, 42, 43, 44 |
| `Minus`, `Equal`, `BracketLeft`, `BracketRight`, `Backslash` | 45, 46, 47, 48, 49 |
| `Semicolon`, `Quote`, `Backquote`, `Comma`, `Period`, `Slash` | 51, 52, 53, 54, 55, 56 |
| `CapsLock` | 57 |
| `F1` … `F12` | 58 … 69, consecutive |
| `PrintScreen`, `ScrollLock`, `Pause` | 70, 71, 72 |
| `Insert`, `Home`, `PageUp`, `Delete`, `End`, `PageDown` | 73, 74, 75, 76, 77, 78 |
| `ArrowRight`, `ArrowLeft`, `ArrowDown`, `ArrowUp` | 79, 80, 81, 82 |
| `NumLock`, `NumpadDivide`, `NumpadMultiply`, `NumpadSubtract`, `NumpadAdd`, `NumpadEnter` | 83, 84, 85, 86, 87, 88 |
| `Numpad1` … `Numpad9`, `Numpad0` | 89 … 97, 98 |
| `NumpadDecimal`, `IntlBackslash`, `ContextMenu`, `Power`, `NumpadEqual` | 99, 100, 101, 102, 103 |
| `F13` … `F24` | 104 … 115, consecutive |
| `IntlRo`, `IntlYen` | 135, 137 |
| `Lang1`, `Lang2` | 144, 145 |
| `ControlLeft`, `ShiftLeft`, `AltLeft`, `MetaLeft` | 224, 225, 226, 227 |
| `ControlRight`, `ShiftRight`, `AltRight`, `MetaRight` | 228, 229, 230, 231 |

</div>

### Pad records

There are four raw pad records, indexed 0 through 3. Each record occupies 28 bytes: one buttons word followed by six signed 16.16 axis words. Offsets below are bytes from that pad's base.

| Offset | Word | Axis index |
| --- | --- | --- |
| `+00H` | Buttons | — |
| `+04H` | Left X | 0 |
| `+08H` | Left Y | 1 |
| `+0CH` | Right X | 2 |
| `+10H` | Right Y | 3 |
| `+14H` | Left trigger | 4 |
| `+18H` | Right trigger | 5 |

The pad button assignments are:

| Bit | Button | Bit | Button |
| --- | --- | --- | --- |
| 0 | A | 9 | Start |
| 1 | B | 10 | Left stick |
| 2 | X | 11 | Right stick |
| 3 | Y | 12 | Up |
| 4 | Left bumper | 13 | Down |
| 5 | Right bumper | 14 | Left |
| 6 | Left trigger | 15 | Right |
| 7 | Right trigger | 16 | Home |
| 8 | Select | 17 | Touchpad |

Stick axes use −1 at the left or upper endpoint, zero at center, and +1 at
the right or lower endpoint. Trigger travel uses zero at release and one at full
travel. Digital trigger attachments supply only zero or one; analog attachments
also supply intermediate values. Travel updates independently of the trigger's
button bit, including movement while the button remains pressed. The button
threshold belongs to the attachment, not the controller latch. Neutral words
alone do not identify whether a pad is connected.

### Pointer words

The pointer has a buttons word, X, Y and wheel, in that order. Its button positions are:

| Bit | Button |
| --- | --- |
| 0 | Primary |
| 1 | Aux |
| 2 | Secondary |
| 3 | Back |
| 4 | Forward |

X and Y are retained signed 16.16 positions in the displayed image's raster
coordinate system, not movement deltas or physical screen coordinates. The
upper-left pixel is (0,0); X increases rightward and Y downward. Standard pointing
attachments map the image to its displayed extent and clip position to
`0..width−1` and `0..height−1`. Changing the display mode does not itself clear
the retained controller snapshot.

The wheel word is a signed 16.16 delta in logical scroll steps, positive
downward and negative upward. One step is `00010000H`; a half step is
`00008000H`. It describes the most recent attachment update, not an absolute
wheel position or an accumulation since ARM. A subsequent stationary update
supplies zero. Reading the retained controller word does not consume or clear
it, so skipped controller samples can miss movement.

### Signed 16.16 values

Interpret a signed 16.16 word as a signed 32-bit integer divided by 65536.

| Raw word | Numeric value |
| --- | --- |
| `00000000H` | 0 |
| `00010000H` | +1 |
| `FFFF0000H` | −1 |

The representation has a quantum of `1/65536` and a range of −32768 through
`32767 + 65535/65536`. Stick and trigger operating ranges are given above; pointer
positions use raster coordinates. The controller retains the attachment's words
unchanged. Apply any additional calibration or dead zone in the program.

### Retained levels and software edges

Keyboard and button words describe sampled levels. They are not an event queue. A cartridge can compare a current mask with its own previous mask:

- pressed: `current & ~previous`;
- released: `previous & ~current`.

These expressions detect transitions between the samples the cartridge actually observes. They cannot recover a press and release that both occurred between those samples. A pointer movement delta likewise requires subtraction of retained positions; X and Y themselves are not movement-delta registers.

## Sampling and snapshot reads

The sampling path is one-shot. Write the complete word `00000001H` (ARM) to `IO_INP_CTRL` to leave one sample request pending. At an accepted VBlank-begin edge, the controller latches the keyboard, pointer, all four pad records and output-capability word as one snapshot. It then increments `IO_INP_STATUS` modulo 2³². The accepted sample clears the pending request; it does not clear the retained ARM word in `IO_INP_CTRL`.

Use this order to obtain a new snapshot:

1. Read and retain `IO_INP_STATUS`.
2. Write ARM to `IO_INP_CTRL`.
3. Read `IO_INP_STATUS` until it differs from the retained value.
4. Read the required snapshot words before requesting another sample.

Use the sequence change as the completion indication; CTRL retains its last
written command rather than reporting a pending request. The captured words
remain stable until the next accepted sample or reset. To detect button edges,
compare successive snapshots as described above. A press and release between
samples is lost.

Repeated ARM writes before an accepted sample leave one pending request, not several. An unarmed VBlank does not latch a snapshot or advance `IO_INP_STATUS`. All sampled register words retain their raw bits; the latch does not clear unnamed bits or clamp sampled data.

### BIOS handoff and supervisor sampling

The BIOS samples this controller during boot and does not reset INPUT when
handing control to the cartridge. The register table's reset words are not a
cartridge-entry snapshot. Retain the **current** STATUS as the baseline for
the sampling sequence above; do not require an initial sequence of zero.

INPUT is not context-banked. Cartridge and supervisor share its pending ARM
request, accepted-sample sequence and register file. The BIOS monitor arms
captures while it runs: each accepted capture replaces the shared snapshot
and advances the same sequence. LEAVE does not restore the cartridge's earlier
snapshot or sequence. After resuming, request and observe a new capture before
treating those words as a fresh cartridge sample. See
[SYSTEM, Device boundaries during supervisor service](system.md#device-boundaries-during-supervisor-service),
for the other units' preservation rules.

<a id="complete-input-sampling-program"></a>

## Sample input in BLua

This sequence assumes ordinary BIOS cartridge entry, a running beam, and
exclusive ownership of INPUT and the VBlank interrupt route. The handler
acknowledges only VBlank. The retained sequence, not a wake-up or CTRL
readback, tells the caller that a sample has completed.

```lua
local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
local control<const>: *word = 0x08000064
local status<const>: *word = 0x08000068
local keys<const>: *word = 0x0800006c

function irq(flags)
    *irq_ack = flags & 0x00000004
end

*irq_mask = 0
*irq_ack = 0x00000004
*irq_mask = 0x00000004
local previous_key = 0
while true do
    local before<const> = *status
    *control = 1
    while *status == before do
        halt_until_irq
    end
    local current<const> = keys[0] & 0x00000010
    local pressed<const> = current & ~previous_key
    local released<const> = previous_key & ~current
    -- Use the levels and software edges here; read any other snapshot words.
    previous_key = current
end
```

The initial STATUS read accommodates samples taken during BIOS boot. Read all
required keyboard, pointer and pad words before the next ARM. With exclusive
use of INPUT, the snapshot remains stable throughout those reads. The register
map below gives the four pad bases and individual snapshot words.

### Worked KeyA transition sequence

The KeyA mask is `00000010H`, not pad A's `00000001H`. With
`previous_key` initially zero, four completed samples give:

| Sample | KeyA level | Pressed mask | Released mask | Cumulative presses | Cumulative releases |
| --- | --- | --- | --- | --- | --- |
| 1 | `0` | `0` | `0` | 0 | 0 |
| 2 | `10H` | `10H` | `0` | 1 | 0 |
| 3 | `10H` | `0` | `0` | 1 | 0 |
| 4 | `0` | `0` | `10H` | 1 | 1 |

The cumulative columns show the counts a program obtains from the edge masks.
An unchanged released sample has both masks zero.

## Register map

All addresses below are byte addresses. `R` denotes a read-only word; `R/W` denotes a readable word with write behavior. Command words must be written in full, rather than treated as independently writable control bits. Every listed word has reset value `00000000H`.

### Sampling control

| Address | Register | Access | Bits and use | Reset |
|---|---|---|---|---|
| `08000064H` | `IO_INP_CTRL` | R/W | 31:0: exact command word; ARM = `00000001H`, RESET = `00000002H` | `00000000H` |
| `08000068H` | `IO_INP_STATUS` | R | 31:0: accepted-sample sequence, modulo 2³² | `00000000H` |

### Keyboard and pointer snapshot

| Address | Register | Access | Bits and use | Reset |
|---|---|---|---|---|
| `0800006CH`–`08000088H`, stride 4 | `IO_INP_KEYS[0..7]` | R | 31:0 of each word: keyboard bitmap | All `00000000H` |
| `0800008CH` | `IO_INP_POINTER_BUTTONS` | R | 31:0: pointer button word | `00000000H` |
| `08000090H` | `IO_INP_POINTER_X` | R | 31:0: pointer X word | `00000000H` |
| `08000094H` | `IO_INP_POINTER_Y` | R | 31:0: pointer Y word | `00000000H` |
| `08000098H` | `IO_INP_POINTER_WHEEL` | R | 31:0: pointer wheel word | `00000000H` |

### Pad snapshot records

`IO_INP_PADS` contains four records. Each record occupies seven words, or `1CH` bytes.

| Pad index | Record base |
|---|---|
| 0 | `0800009CH` |
| 1 | `080000B8H` |
| 2 | `080000D4H` |
| 3 | `080000F0H` |

The following offsets apply to each record base.

| Offset | Register field | Access | Bits and use | Reset |
|---|---|---|---|---|
| `+00H` | Buttons | R | 31:0: pad button word | `00000000H` |
| `+04H` | Left X | R | 31:0: left-stick X word | `00000000H` |
| `+08H` | Left Y | R | 31:0: left-stick Y word | `00000000H` |
| `+0CH` | Right X | R | 31:0: right-stick X word | `00000000H` |
| `+10H` | Right Y | R | 31:0: right-stick Y word | `00000000H` |
| `+14H` | Left trigger | R | 31:0: left-trigger word | `00000000H` |
| `+18H` | Right trigger | R | 31:0: right-trigger word | `00000000H` |

### Pad output port

| Address | Register | Access | Bits and use | Reset |
|---|---|---|---|---|
| `0800010CH` | `IO_INP_OUTPUT_PORT` | R/W | 1:0: selected pad index; 31:2 retained | `00000000H` |
| `08000110H` | `IO_INP_OUTPUT_INTENSITY_Q16` | R/W | 31:0: raw intensity word | `00000000H` |
| `08000114H` | `IO_INP_OUTPUT_DURATION_MS` | R/W | 31:0: unsigned duration in milliseconds | `00000000H` |
| `08000118H` | `IO_INP_OUTPUT_STATUS` | R | 3:0: sampled vibration-capability bits for pads 3 through 0; 31:4 retain supplied bits | `00000000H` |
| `0800011CH` | `IO_INP_OUTPUT_CTRL` | R/W | 31:0: exact command word; APPLY = `00000001H`; reads zero after a command write | `00000000H` |

## Control words and reset

`IO_INP_CTRL` recognizes complete words, not combinable flags.

| Written word | Effect |
|---|---|
| `00000000H` | Retains zero in CTRL; does not arm, reset or cancel a pending request |
| `00000001H` | Arms one sample; leaves CTRL equal to `00000001H` |
| `00000002H` | Resets the sampling register file and sequence; CTRL becomes zero |
| `00000003H` | Retains `00000003H`; does not combine ARM and RESET and does not cancel a pending request |
| Any other word | Retains the complete word; leaves the pending request, sequence and other register state unchanged |

RESET takes effect on the control write. It clears any pending sample, sets `IO_INP_STATUS` to zero and zeroes the keyboard, pointer and pad words. It also zeroes the output port, intensity, duration and capability words. A console input-controller reset additionally sets `IO_INP_OUTPUT_CTRL` to zero.

The RESET command does not clear the previously sampled supervisor-request
level. Holding that wire high across this command therefore does not create
a new rising edge. A whole-unit reset initializes its edge history to low.

An accepted sample does not replace the output parameter words. ARM itself does not sample immediately, increment the sequence or clear the existing snapshot. Unrecognized control words cause no input-specific fault.

## VBlank ordering, interrupts and access faults

At VBlank begin, the display controller presents the frame, INPUT captures any
armed sample, and the central controller raises `IRQ_VBLANK` (`00000004H`), in
that order. The interrupt handler can therefore read the new snapshot and
STATUS sequence. Handler entry depends on the CPU interrupt-enable state and
other pending work.

Independently of ARM, the controller also observes the dedicated supervisor-request
wire at each VBlank. A low-to-high transition is forwarded to SYSTEM; holding
the wire high does not generate another transition. This wire is not a
keyboard usage or a pad bit, and does not require a cartridge sample. See
[SYSTEM, Privilege and supervisor entry](system.md#privilege-and-supervisor-entry).

There is no separate input-complete interrupt. VBlank pending state is coalesced, not a count of completed samples, so test the sample sequence even when using VBlank interrupts. A cartridge that waits with HALT must first enable an owned VBlank interrupt route, and must recheck `IO_INP_STATUS` after waking. An interrupt source that is merely pending but masked does not guarantee a wakeup.

The snapshot words, `IO_INP_STATUS` and `IO_INP_OUTPUT_STATUS` are read-only. A mapped whole-word write to one of these words raises the shared bus fault `BUS_FAULT_READ_ONLY` (code 3), without changing the word. The controller defines no separate input fault register. General alignment and access-size rules are those of the memory interface.

## Pad output commands

The output port uses three retained parameter words and one command word. Write the selected pad to `IO_INP_OUTPUT_PORT`, the requested intensity to `IO_INP_OUTPUT_INTENSITY_Q16`, and the requested duration to `IO_INP_OUTPUT_DURATION_MS`. These parameter writes alone do not request output. Write the complete word `00000001H` (APPLY) to `IO_INP_OUTPUT_CTRL` after preparing the parameters.

APPLY uses the parameters present at that write. The selected pad is `IO_INP_OUTPUT_PORT & 3`, so only the low two bits select pads 0 through 3. The upper bits remain stored and readable; they do not select additional pads.

The command is dispatched on the APPLY write, without waiting for ARM or a VBlank edge. There is no output command queue. Each exact APPLY write issues a request with the current parameters. APPLY does not alter those parameters or the sampled capability word.

`IO_INP_OUTPUT_CTRL` tests the entire command word. A word such as `00000003H`, `00000101H` or `80000001H` is not APPLY, even though bit 0 is set. Other command words issue no request. After a command write completes, the control word reads zero; that zero is not an output-completion indication.

### Intensity and duration

The normal intensity interval is `00000000H` through `00010000H`, inclusive.
Intensity is the raw word divided by 65536: zero at `00000000H`, one-half at
`00008000H`, and maximum at `00010000H`, with a step of 1/65536. The actuator's
physical response depends on the attached pad.

The intensity register retains all 32 bits, and APPLY decodes the full
unsigned U16.16 word exactly: `FFFFFFFFH` requests
`65535 + 65535/65536`. The output attachment saturates requests above one to
its maximum intensity. This saturation does not rewrite the programmed word.
Unsupported output attachments produce no effect.

`IO_INP_OUTPUT_DURATION_MS` holds the requested duration as an unsigned 32-bit
millisecond count. The complete word is retained unchanged throughout the effect;
readback gives the programmed duration, not remaining time.

For example, the following ordered writes request pad 0 at half intensity for 100 milliseconds. The last write is the command; the preceding writes only prepare its operands.

| Order | Register | Written word |
|---|---|---|
| 1 | `IO_INP_OUTPUT_PORT` | `00000000H` |
| 2 | `IO_INP_OUTPUT_INTENSITY_Q16` | `00008000H` |
| 3 | `IO_INP_OUTPUT_DURATION_MS` | `00000064H` |
| 4 | `IO_INP_OUTPUT_CTRL` | `00000001H` |

### Capability and completion

`IO_INP_OUTPUT_STATUS` contains sampled vibration-capability bits, one per pad in bits 0 through 3. It is refreshed with the other input words when an armed sample is accepted. Until then it retains the previous snapshot's value; after reset it is zero until a new sample is accepted. The complete supplied word is retained, including bits above bit 3.

Use the capability bits to identify pads supporting vibration. They retain
their sampled values when APPLY is written. The output port supplies no busy,
completion or error indication and raises no output-complete interrupt.

Input RESET zeroes the output parameters and capability word without issuing a stop or cancellation command for an earlier request. Do not use a register reset as an output-stop operation.
