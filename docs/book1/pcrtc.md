# PCRTC Display Controller {#sec-pcrtc}

## Purpose and data flow {#sec-pcrtc-1-outline}

The PCRTC turns images in GPU local memory into the displayed picture. The GPU
writes the stored pixels; PCRTC selects which pixels to read and how they
appear in the output. Two reading circuits can select different portions of
the same memory, each with its own source origin, display window and
magnification. Their colors are combined over a programmable background.

Use one circuit to display a completed framebuffer. Use both when two images
need independent source selections or window positions in the same output.
The source is still GPU local memory: changing a reading circuit's settings
selects stored pixels rather than drawing or moving them.

Each circuit has two groups of controls. **DISPFB** describes its stored image
and source origin. **DISPLAY** describes its output window and magnification.
**PMODE** enables the circuits and controls their composition. Separate timing
registers establish the beam sequence and its display-event interrupts.

![PCRTC display data path and controls](figures/pcrtc-overview.svg){#fig-pcrtc-overview}

## Technical specifications {#sec-pcrtc-11-technical-specifications}

PCRTC supplies two reading circuits and one output-composition path. Local
memory stores sixteen-bit words; PCRTC registers are programmed with
thirty-two-bit words. The table gives the installed resources and field ranges.

| Resource or interface | Specification |
|---|---|
| Installed main RAM | 4 MiB; separate from GPU local memory and PCRTC registers |
| Shared GPU local memory | 2 MiB: 1,048,576 sixteen-bit words; low byte first |
| Reading circuits | Two, independently enabled, with separate framebuffer, source and display-window settings |
| Register map | 26 thirty-two-bit slots in separate 12-word and 14-word address ranges |
| Configuration storage | 22 programmed words and a separate 22-word display latch |
| Programming access | Aligned thirty-two-bit register-word loads and stores; four-byte alignment |
| Configuration admission | No PCRTC write-ready wait, command FIFO or CYCLES register |
| Installed CPU/system-cycle frequency | 33,868,800 Hz; approximately 29.526 ns per system cycle |
| Beam-timing reference | 13,500,000 Hz |
| Horizontal signal step | 0–15 signal units per output pixel; a latched zero prevents pixel output |
| Per-circuit window fields | Horizontal span 1–4096 signal units; vertical height 1–2048; magnification X=1–16, Y=1–4 |

Use the signal-step conversion in @sec-pcrtc-21-framebuffer-reading-and-display-windows to calculate horizontal output
boundaries. @sec-pcrtc-33-select-a-display-geometry-and-its-timing gives complete example configurations. Both reading
circuits are disabled at reset.

## Selecting and displaying an image {#sec-pcrtc-2-function}

### Framebuffer reading and display windows {#sec-pcrtc-21-framebuffer-reading-and-display-windows}

A source origin answers **which stored pixels to read**. A display window
answers **where and over what extent a circuit contributes to the output**.
Magnification connects the source pixels to the window's signal coordinates;
the horizontal signal step then determines which signal positions become
output pixels. Keep these quantities separate when choosing a picture size.

#### Choose the stored source {#sec-pcrtc-choose-the-stored-source}

Consider a 256 × 192-pixel view of a GX16 image. Its framebuffer base is
local-memory word address zero, its row width is 1024 pixels, and the desired
source origin is `(32,16)`. The selected source rectangle is therefore
`[32,288) × [16,208)`: its last source pixel is `(287,207)`.

The framebuffer row width describes the stored image, not the displayed
window. In this GX16 example it advances 1024 sixteen-bit words between
successive source rows, even though only 256 pixels from each row will be
shown. GX16 uses one sixteen-bit word per pixel. Other storage selections have
the packing and address layouts specified under
@sec-pcrtc-23-local-memory-samples and @sec-pcrtc-24-local-memory-address-layout.

DISPFB supplies the base field FBP, the width field FBW, the storage selection,
and source X/Y. Its base and width units are:

```text
Framebuffer base B = FBP × 4096 local-memory words
Framebuffer width W = FBW × 64 pixels
Source origin       = (source X, source Y)
```

A local-memory word is **16 bits, or two bytes**; a PCRTC register word is
**32 bits, or four bytes**. One FBP unit therefore covers 8192 bytes. For the
chosen source, use FBP=0, FBW=16 and storage selector 31 (GX16).

#### Relate source pixels to the output window {#sec-pcrtc-relate-source-pixels-to-the-output-window}

Keep the reset noninterlaced timing and choose signal origin `(680,37)`, X
magnification 4 and Y magnification 1. X magnification 4 means that one source
pixel occupies four horizontal **signal units**. It does not by itself mean
four output pixels. The horizontal signal step is also 4, meaning that output
pixels are selected four signal units apart. These equal steps give one source
pixel per output pixel. Y magnification 1 in noninterlaced output similarly
selects the next source row for the next output row.

To show 256 columns, the horizontal signal span must be `256 × 4 = 1024`.
The window runs from signal X 680 up to, but excluding, 1704. Dividing these
aligned boundaries by the signal step gives 170 and 426; their difference is
256 output pixels. The vertical window has 192 rows starting at signal Y 37.

![The worked window: source origin (32,16), signal origin (680,37), a 1024-signal-unit horizontal span, and 256 × 192 output pixels with signal step 4.](figures/pcrtc-window.svg){#fig-pcrtc-window}

With only this circuit enabled, its window defines the cropped output, so
output `(0,0)` reads source `(32,16)` and output `(255,191)` reads source
`(287,207)`. With both circuits enabled, the output origin uses their minimum
signal X and Y and the bounds cover both windows. Window position then places
the circuits relative to one another. Moving a lone enabled window also moves
the crop; @sec-pcrtc-5-source-origin-and-display-window-position uses a second
circuit as a fixed canvas to demonstrate a visible placement change.

#### Encode the source and window {#sec-pcrtc-encode-the-source-and-window}

Both magnification fields and both extent fields use encoded-plus-one values:

```text
X magnification = encoded X magnification + 1
Y magnification = encoded Y magnification + 1
Horizontal span = horizontal extent + 1 signal units
Vertical height = vertical extent + 1
```

Thus this example stores encoded X magnification 3, encoded Y magnification 0,
horizontal extent 1023 and vertical extent 191. The quantities just derived produce
these circuit-1 words:

| Word | Field values | Encoded word |
|---|---|---|
| DISPFB1_LOW | FBP=0; FBW=16; storage=31 (GX16) | `000FA000H` |
| DISPFB1_HIGH | Source X=32; source Y=16 | `00008020H` |
| DISPLAY1_LOW | Signal X=680; signal Y=37; X magnification encoded 3; Y encoded 0 | `018252A8H` |
| DISPLAY1_HIGH | Horizontal extent=1023; vertical extent=191 | `000BF3FFH` |

For other windows, round each horizontal boundary upward to a signal-step
boundary before converting it to output pixels. `SMODE1_LOW[24:21]` sets this
step. Output width comes from the converted window boundaries, not from
dividing its span by X magnification. The complete sampling equation and a
case with unequal steps are in @sec-pcrtc-6-horizontal-source-sampling.

Pixel output requires running **latched** timing, a nonzero latched signal
step, and at least one latched circuit enable. Configuration writes first
change the programmed words; the display latch selects them at VBlank entry,
as explained after the following register sequence.

### Set a 256 × 192 window on circuit 1 {#sec-pcrtc-31-set-a-256-192-window-on-circuit-1}

**Starting condition:** PCRTC reset configuration and reset timing. Both reading
circuits are disabled. Circuit 1's framebuffer base is word address 0, its width is
1024, and its format selection is GX16. Its reset signal position is (680, 37), with X
magnification 4 and Y magnification 1.

1. Set the source origin to (32, 16) in `DISPFB1_HIGH`.
2. Set the display extents for a 256 × 192 output window. The horizontal span is `256 ×
4 = 1024` signal units, so write horizontal extent 1023 and vertical extent 191.
3. Enable circuit 1 last with the PMODE word shown below. Leave circuit 2 disabled.

The table gives raw address/value word writes, in order.

| Order | Address | Register | Write value | Setting |
|---:|---|---|---|---|
| 1 | `08010360H` | `DISPFB1_HIGH` | `00008020H` | Source X = 32; source Y = 16 |
| 2 | `08010368H` | `DISPLAY1_HIGH` | `000BF3FFH` | Horizontal extent = 1023; vertical extent = 191 |
| 3 | `08010354H` | `PMODE_LOW` | `0000FF21H` | EN1 = 1; EN2 = 0; MMOD = 1; AMOD = 0; SLBG = 0; ALP = 255 |

All three writes change their reset values. None restarts the beam. Other framebuffer,
signal-position, magnification, and timing words remain at their reset values.

After the display latch takes these settings, the output is the 256 × 192
view derived above, with output origin `(0,0)` and source origin `(32,16)`.

The PMODE word selects circuit-1 RGB directly. Output alpha is the original GX16 sample
alpha, 0 or 128 from bit 15; it is not forced to 255 by ALP = 255.

Read back the three programmed words to check the settings. The display uses them at
VBlank entry when the latch takes the new configuration, as shown in @sec-pcrtc-26-programmed-words-and-displayed-settings.

For a complete two-surface cartridge and its observed output, see
[Prepare, publish and reuse two surfaces](gpu.md#sec-memory-prepare-publish-and-reuse-two-surfaces).

### Programmed words and displayed settings {#sec-pcrtc-26-programmed-words-and-displayed-settings}

Finishing an image and selecting it for display are separate operations. Finish
GPU drawing before publishing the completed image's source and window settings.
GPU completion establishes that the drawing work has finished; it does not
select the PCRTC framebuffer. Likewise, a display-selection change does not
copy the pixels into private PCRTC storage. Preserve the source image while it
is still in use; [GPU Drawing Engine — A display switch selects storage; it does not save it](gpu.md#sec-memory-a-display-switch-selects-storage-it-does-not-save-it)
explains the storage lifetime when changing surfaces.

Configuration registers retain complete written words. Readback returns the
programmed value immediately, but the new words are not yet the displayed
selection. Display uses a separate configuration latch:

```text
Write a changed configuration word
                │
                ├──► Programmed word changes ──► Read returns the new word
                │
                └──► Wait for VBlank BEGIN
                                      │
                                      ▼
                      Display latch takes all 22 configuration words
                                      │
                                      ▼
                         Display uses the latched settings
```

The display latch takes all 22 configuration words together on **VBlank entry**,
at the end of the active-display interval. This precedes the system VBlank
interrupt request and operates independently of the PCRTC event masks.

Complete the configuration before its intended VBlank entry. An edge between
separate store instructions takes the values written up to that point, including
an intermediate configuration. To establish that new settings have been
displayed, observe a fresh VBlank entry after their final write, not merely an
already-pending request. The [display-switch sequence](gpu.md#sec-memory-a-display-switch-selects-storage-it-does-not-save-it)
gives this observation with unchanged timing. Use
@sec-pcrtc-34-program-the-complete-configuration-before-restarting-the-beam
when replacing the global timing configuration itself.

Writing an unchanged configuration word has no effect. A changed write to either
`SMODE1` word or any `SYNCH1`, `SYNCH2`, or `SYNCV` word also recalculates timing and
**restarts the beam immediately**. The display latch does not defer that restart.
Neither `SMODE2` word restarts the beam. Live beam timing is distinct from latched
display timing: stopping the beam does not itself blank an already-latched display.
PCRTC reset is the exception to waiting for VBlank entry: it installs the reset display
settings immediately.

#### Firmware use of the two circuits {#sec-pcrtc-firmware-use-of-the-two-circuits}

The standard BIOS convention assigns cartridge display to circuit 1. During
supervisor service, the cartridge's displayed circuit-1 framebuffer and window
become circuit 2's underlay, while firmware programs circuit 1 for its terminal.
The underlay continues to read the cartridge's stored image. Preserve
the [firmware VRAM reservation](memory.md#sec-memory-firmware-reservation-in-vram).

Both circuits remain directly programmable. A program using circuit 2 must
allow for supervisor entry displaying only the cartridge's circuit-1 view as
its underlay. The complete twelve-word
composition banks, including circuit 2, are retained separately for programmed
and displayed state and restored on leave. Timing words, CSR, IMR and the
physical beam are global: supervisor changes to them persist.
See [Device boundaries during supervisor service](system.md#sec-system-device-boundaries-during-supervisor-service)
for entry, leave and shared-memory lifetime.

### Interlaced reading {#sec-pcrtc-22-interlaced-reading}

Set `SMODE2_LOW.INT` to select interlaced traversal. Interlaced output advances by two
rows; non-interlaced output advances by one. `FFMD` selects frame mode only while `INT`
is set.

For interlaced, non-frame operation:

```text
Source row stride = 2
Source row phase  = (display signal Y XOR FIELD) AND 1
```

In other modes, the source row stride is one and its phase is zero. Read `CSR_LOW.FIELD`
for the current field value. VSync updates this value as described in @sec-pcrtc-27-beam-timing.

#### Output rows and source rows {#sec-pcrtc-output-rows-and-source-rows}

The following mapping applies independently to either enabled reading circuit.
Use its latched display configuration (@sec-pcrtc-26-programmed-words-and-displayed-settings), and the current field value
`F`. Define:

```text
S = circuit's display signal Y
D = S - minimum enabled display signal Y
H = encoded vertical extent + 1
M = encoded Y magnification + 1
B = framebuffer source Y
n = output Y - D
```

Output Y counts from the top of the combined output, not from signal Y zero.
The circuit's window contains local rows `0 <= n < H`. Non-interlaced traversal
selects every such row. Interlaced traversal selects only rows whose **output Y**
parity equals `F`:

```text
First selected local row = (D XOR F) AND 1
Following local rows     = first selected local row + 2, + 4, ...
```

Stop before `n` reaches or exceeds `H`, the window's exclusive bottom. If the first selected local row
is outside that window, the circuit supplies no row for that field. For a selected
row, calculate the framebuffer coordinate below. `div` means nonnegative integer
division, discarding the remainder.

| Traversal | Framebuffer source Y |
|---|---|
| Non-interlaced (`INT=0`) | `B + (n div M)` |
| Interlaced, non-frame (`INT=1`, `FFMD=0`) | `B + 2 * (n div (2*M)) + ((S XOR F) AND 1)` |
| Interlaced, frame (`INT=1`, `FFMD=1`) | `B + (n div (2*M))` |

Divide before applying the source row stride; add the source row phase last.
Output-row selection uses the cropped top `D`, but the non-frame source phase
uses the original signal origin `S`. They are not interchangeable. Pass the
resulting source coordinate to the storage-address calculation in @sec-pcrtc-24-local-memory-address-layout;
it is not a byte address. These equations select this circuit's samples, not
the final result of the two-circuit composition in @sec-pcrtc-25-output-composition.

#### Worked row selection {#sec-pcrtc-worked-row-selection}

Let this circuit start at signal Y 7, with source Y 20, Y magnification 2 and
height 8. A second enabled circuit starts at signal Y 5. Thus `D=2`, and this
circuit occupies output rows 2 through 9. All numbers below are decimal; each
source row corresponds to the output row in the same position.

| Traversal | FIELD | Selected output rows | Framebuffer source rows |
|---|---:|---|---|
| Non-interlaced | — | 2, 3, 4, 5, 6, 7, 8, 9 | 20, 20, 21, 21, 22, 22, 23, 23 |
| Interlaced, non-frame | 0 | 2, 4, 6, 8 | 21, 21, 23, 23 |
| Interlaced, non-frame | 1 | 3, 5, 7, 9 | 20, 20, 22, 22 |
| Interlaced, frame | 0 | 2, 4, 6, 8 | 20, 20, 21, 21 |
| Interlaced, frame | 1 | 3, 5, 7, 9 | 20, 20, 21, 21 |

Here the odd signal origin selects source phase one when `FIELD=0`, even though
the output window starts on an even row. `INT` alone does not make FIELD alternate;
the VSync rule in @sec-pcrtc-27-beam-timing still applies. FIELD is live state, not one of the
22 latched configuration words; a later read reports its value at that read.

### Output composition {#sec-pcrtc-25-output-composition}

Composition begins with the background, applies circuit 2, then applies circuit 1.
Background R, G, and B come from `BGCOLOR_LOW[7:0]`, `[15:8]`, and `[23:16]`; background
alpha is zero. A disabled circuit performs no operation.
The format-specific RGB and alpha samples are listed in @sec-pcrtc-23-local-memory-samples.

**Window limits:** each table below applies only inside that enabled circuit's display
window and selected field rows. Outside its window, the circuit leaves the prior values
unchanged. The two windows need not overlap.

Circuit 2 selects the background or its own RGB using SLBG. AMOD determines whether it
also supplies alpha:

| SLBG | AMOD | RGB after circuit 2 | Alpha after circuit 2 |
|---:|---:|---|---|
| 0 | 0 | Circuit-2 RGB | Background alpha 0 |
| 0 | 1 | Circuit-2 RGB | Circuit-2 sample alpha |
| 1 | 0 | Background RGB | Background alpha 0 |
| 1 | 1 | Background RGB | Circuit-2 sample alpha |

For circuit 1, let `C1` be one source RGB component, `A1` its original sample alpha,
and `D` and `Ad` the prior RGB component and alpha at that pixel. The prior values come
from the background and any circuit-2 operation at that pixel.

| MMOD | ALP | Circuit-1 RGB action | Alpha, AMOD = 0 | Alpha, AMOD = 1 |
|---:|---|---|---|---|
| 0 | Ignored | Blend C1 over D with coefficient `min(2 × A1, 255)` | Select A1 | Preserve Ad |
| 1 | 0 | Preserve D | Select A1 | Preserve Ad |
| 1 | 1–254 | Blend C1 over D with coefficient ALP | Select A1 | Preserve Ad |
| 1 | 255 | Select C1 | Select A1 | Preserve Ad |

The RGB blend is computed independently for R, G, and B:

```text
MMOD = 0:  a = min(2 × A1, 255)
MMOD = 1:  a = ALP

N = C1 × a + D × (255 - a) + 127
Output component = integer quotient of N / 255
```

The `+127` rounds the nonnegative weighted result to nearest. Inputs and coefficient
are 0–255, so the RGB result is also 0–255 without further saturation. Source alpha is
doubled and saturated only when deriving the MMOD = 0 **RGB coefficient**. ALP is used
directly, not doubled. Output alpha is selected by AMOD, never blended by this equation.

In particular, a sample alpha of 128 gives coefficient 255 under MMOD = 0: circuit 1
supplies full source RGB, but AMOD = 0 still selects alpha **128**, not 255. This applies
to CT24, GPU24, and sixteen-bit samples whose bit 15 is set. With AMOD = 1, a pixel can
receive circuit-1 RGB while retaining background alpha zero if circuit 2 supplies no
alpha there.

### Beam timing {#sec-pcrtc-27-beam-timing}

The timing reference clock is **13,500,000 Hz**. The `SMODE1`, `SYNCH1`, `SYNCH2`, and
`SYNCV` fields define the half-line period and vertical landmarks:

```text
H = HFP + HBP + HS + HF + HB
D = RC × (divider field + 1)
U = 1 when SMODE1_HIGH[4] = 0; otherwise 2

Half-line period = (H × D) / (2 × 13,500,000 × LC) seconds

Active-display half-lines = VDP × U
VSync half-line           = (VDP + VFP + VFPE) × U
Vertical sum              = VFP + VFPE + VBP + VBPE + VDP + VS
Total half-lines          = Vertical sum × U
```

Timing runs only when PRST and SINT are both zero and the half-line numerator,
denominator, and total half-lines are all nonzero. A stopped live beam generates no
timing events; displayed output still uses its latched timing. VBlank entry is at the
active-display boundary, VSync at its computed landmark, and field end at total
half-lines.

A beam restart begins at half-line zero, with VBlank inactive. The first HSync event
point follows at half-line two. Restarting does not acknowledge CSR events or change
FIELD. Event timing continues from the beam epoch, not from the time an event is
observed.

At reset, H = 3456, D = 8, LC = 32, and U = 1. The half-line period is:

```text
T = 27648 / 864000000 seconds = 32 microseconds
```

The reset beam sequence is:

![Reset beam events and active-display and VBlank intervals](figures/pcrtc-reset-timing.svg){#fig-pcrtc-reset-timing}

The reset vertical counts are VDP = 576, VFP = 4, VFPE = 5, VBP = 33, VBPE = 5, and
VS = 5. VBlank is inactive below half-line 576 and active for the remainder of the field.

For a beam restart at system cycle zero, the calculated event deadlines are:

| Landmark | Half-line | Time from restart | Rounded system-cycle deadline |
|---|---:|---:|---:|
| First HSync point | 2 | 64 µs | 2168 |
| VBlank entry; display latch | 576 | 18.432 ms | 624270 |
| VSync; VSINT | 585 | 18.720 ms | 634024 |
| Field end | 628 | 20.096 ms | 680628 |

This gives approximately 49.761146497 field repetitions per second. Calculate
each system-cycle deadline from the beam restart, rounding upward; do not
accumulate the error from rounding every half-line separately. Allow for CPU
interrupt acceptance and handler execution after these event deadlines.
HSync points repeat every two half-lines, but a pending HSINT suppresses further
interrupt requests until acknowledged.

At VSync, nonzero CMOD together with odd VFP toggles FIELD; otherwise FIELD becomes one.
Reset VFP is even: reset FIELD is zero, and the first VSync sets it to one. VSync also
raises VSINT.

### Events and interrupts {#sec-pcrtc-28-events-and-interrupts}

Normal operation generates **HSINT and VSINT**. The remaining event positions,
SIGNAL, FINISH and EDWINT, are retained pending bits and remain clear after
reset during normal operation. All five positions use the acknowledgement
and masking rules below. Use the GPU's own completion interface for drawing.

```text
Event raised ──► Is its CSR bit already set?
                    │                   │
                   yes                 no
                    │                   ▼
              No new request       Set CSR event bit
                                        │
                              Is its IMR mask zero?
                                   │          │
                                  yes         no
                                   │          │
                             Request IRQ   Keep pending
```

A mask value of one prevents an interrupt request; it does not clear the event.
Unmasking an already pending event requests the PCRTC interrupt immediately. Acknowledge
an event by writing one to its CSR bit; writing zero leaves that event unchanged.

The PCRTC interrupt request is `IRQ_GX_PCRTC`, interrupt-controller mask bit
`00000002H`. PCRTC acknowledgement and masking do not replace interrupt-controller
acknowledgement or CPU interrupt control.

HSync event points start at half-line 2 and repeat every two half-lines. While HSINT is
pending, later HSync points do not generate another interrupt request. Acknowledge HSINT
to enable the first HSync point strictly after the current half-line; elapsed points are
not replayed. VSINT is raised by VSync (@sec-pcrtc-27-beam-timing); VBlank entry itself is the
display-latch edge.

### RESET and FLUSH {#sec-pcrtc-29-reset-and-flush}

`CSR_LOW.FLUSH` and `CSR_LOW.RESET` are write-one actions, not retained settings. Event
acknowledgements in the same write are processed first. RESET takes priority if both
action bits are one.

Both actions discard queued DMA ingress and GP0 FIFO input, along with partial
command and polyline input state. Both terminate readback and handle a partial
image upload as described below. **Neither action is a general cancel or undo
of accepted drawing.** An executing draw, fill, copy or upload retains its
original completion time; neither action completes it early or restarts its
interval. Already-performed local-memory writes remain effective, and retained
work can still change local memory. Wait for GPU idle before the action when
the program requires all drawing to be complete.

Input queued after an active readback is discarded, not executed past that
readback. A readback command is cancelled even before its execution interval
completes. The readback port returns to idle, loses its dimensions and cursor,
and drops its DMA request. The terminated readback does not later become ready
again.

A partial CPU-to-local-memory image upload is treated according to the words already consumed by image assembly and retained with the upload. Words merely admitted to the GP0 FIFO or DMA ingress FIFO do not count; the action discards those still-queued words.

| Image assembly state | Effect |
|---|---|
| No upload words | No upload action |
| Three-word header only | Discard the header |
| Header and at least one retained payload word | Seal an upload of that payload prefix; one command tick, or one system cycle, starting at the action |

If `n` payload words have been consumed by image assembly and retained, the prefix contains
`min(width × height, 2 × n)` pixels. They are processed in row order under the accepted
upload's retained mask-bit controls. With mask checking enabled, destination bit 15 = 1
suppresses that pixel's write. On a write, mask-setting mode forces bit 15; otherwise
source bit 15 is retained. FLUSH or RESET therefore processes the retained
prefix under these mask rules and leaves the missing remainder untouched.
Here the count is in input command words; each supplies up to two local-memory
pixels.

FLUSH leaves the PCRTC and GPU draw/display settings unchanged. RESET restores the
PCRTC configuration, CSR, and IMR, sets FIELD to zero, restarts the beam, and installs
reset display settings immediately. Both reading circuits are disabled.

RESET also clears the GP0/GP1 command words, drawing mode, texture window, drawing-area
corners, drawing offset, mask-bit mode, and display start. It restores display mode,
status, and horizontal/vertical display-range defaults, and disables readback DMA mode.
The programmed VRAM Y-address extension is retained and carried into displayed settings.
Neither action performs a local-memory clear or restores earlier contents. Accepted
drawing and upload data can still change local memory.

### Bus access {#sec-pcrtc-210-bus-access}

Use aligned 32-bit register-word loads and stores at the listed addresses. These
accesses are available in either CPU mode and stores do not wait on a PCRTC ready
signal. Subword access is not a byte-lane update:

| CPU data access | Address condition | PCRTC result |
|---|---|---|
| Register-word or U32 load/store | Four-byte aligned | Read/write one complete register word |
| U8 load | Four-byte aligned | Read the complete word, return bits 7:0 |
| U8 load | Word offset 1, 2, or 3 | UNALIGNED_IO bus fault; no register access |
| U8 store | Any PCRTC byte address | UNALIGNED_IO bus fault; no register access |
| U16 load/store | Even address, including four-byte aligned | UNALIGNED_IO bus fault; no register access |
| U16 load/store | Odd address | CPU address exception before register access |
| Register-word, U32, F32, or F64 load/store | Not four-byte aligned | CPU address exception before register access |

F32 transfers one word's bits. F64 transfers the low word at address A followed by the
high word at A + 4; it requires four-byte, not eight-byte, alignment. If the first
access faults, the second is not attempted. Both word accesses occur within one CPU
instruction.

Multiword stores likewise perform successive word writes and stop at the first bus
fault. Earlier writes remain effective. The two PCRTC address ranges do not become
contiguous through a multiword instruction. Writes to `CSR_HIGH` and `IMR_HIGH` are
accepted but ignored; they do not raise READ_ONLY faults.

**CPU transfer costs.** Each ordinary scalar register-word load or store instruction,
including its displacement form, has a two-system-cycle base cost. PCRTC adds no
write-ready wait. Address and value preparation, polling and surrounding control
flow have their own instruction costs. Thus 22 separately issued configuration
stores contribute 44 base cycles before preparation or display-edge waiting; they
do not form an atomic display update. A word-sequence store instead costs two base
cycles plus `n/4` rounded upward for its `n` words. Respect the two address ranges.
Immediate readback confirms programmed words. Use a subsequent VBlank entry to
establish that the display latch has taken them.

### Faults {#sec-pcrtc-211-faults}

Access faults are **synchronous CPU exceptions**, not PCRTC events. They do not set CSR
pending bits or request `IRQ_GX_PCRTC`.

| Fault | CPU action |
|---|---|
| Misalignment rejected by the CPU | Address-error-load, CAUSE `00000010H`, or address-error-store, CAUSE `00000014H`; BAD_ADDRESS records the attempted address |
| Rejected subword I/O access | UNALIGNED_IO bus fault, code 2; CPU data-bus-error, CAUSE `0000001CH` |

CPU alignment rejection occurs before the bus access and does not enter a bus-fault
latch record. A faulting load does not overwrite its destination. The access rules in
@sec-pcrtc-210-bus-access apply equally to absolute and displacement-form data accesses.

The system bus retains the first fault's code, address, and access description until
acknowledged. Later faults still advance the fault sequence but do not replace those
latched details. These system words are separate from PCRTC:

| Address | System bus word | Operation |
|---|---|---|
| `08010208H` | BUS_FAULT_CODE | First fault code; zero means no latched fault |
| `0801020CH` | BUS_FAULT_ADDR | First fault address |
| `08010210H` | BUS_FAULT_ACCESS | First fault access description |
| `08010214H` | BUS_FAULT_ACK | A nonzero write clears code, address, and access |

The three detail words reset to zero. Fault codes are NONE = 0, UNMAPPED = 1,
UNALIGNED_IO = 2, and READ_ONLY = 3. ACCESS combines READ bit 0 or WRITE bit 1 with the
access kind: U8 bit 8, U16 bit 9, U32 bit 10, register-word bit 11, F32 bit 12, or F64
bit 13.

Storage selectors and framebuffer address wrap have the deterministic behavior in
@sec-pcrtc-23-local-memory-samples and @sec-pcrtc-24-local-memory-address-layout; they are not format, width, or framebuffer-address exceptions.

## Timing and interrupt programming examples {#sec-pcrtc-3-setting-example}

### Acknowledge stale HSINT and unmask only HSINT {#sec-pcrtc-32-acknowledge-stale-hsint-and-unmask-only-hsint}

**Starting condition:** no particular event-pending state is required. This sequence
replaces the PCRTC event masks and acknowledges HSINT only.

| Order | Address | Register | Write value | Result |
|---:|---|---|---|---|
| 1 | `080103DCH` | `IMR_LOW` | `00007F00H` | Mask all five PCRTC events |
| 2 | `080103D4H` | `CSR_LOW` | `00000004H` | Acknowledge HSINT; do not request RESET or FLUSH |
| 3 | `080103DCH` | `IMR_LOW` | `00007B00H` | Unmask HSINT; keep the other four events masked |

```text
Mask all events ──► Acknowledge HSINT ──► Unmask HSINT
  00007F00H           00000004H            00007B00H
```

`7F00H = 6000H | 1F00H`. The final word clears IMR bit 10 only, giving `7B00H = 6000H |
1B00H`. CSR bit 2 is acknowledged by `00000004H`.

**Completion:** IMR reads `00007B00H`. FIELD and the other four CSR event bits are
unchanged by step 2. HSINT need not remain clear: if it becomes pending between steps 2
and 3, unmasking it requests an interrupt immediately. Otherwise, a newly raised HSINT
requests an interrupt while this mask remains installed.

If step 2 clears a pending HSINT while timing runs, the next HSync event point is after
the current half-line. Masked events remain pending until acknowledged; a later unmask
can therefore request an interrupt immediately.

### Select a display geometry and its timing {#sec-pcrtc-33-select-a-display-geometry-and-its-timing}

Output size, source sampling and beam repetition are separate settings. Changing
`DISPLAY1_HIGH` changes the window; it does not select a corresponding field rate.
Use the following complete combinations when a 256–640-column GX16 picture is
required. They give the required register combinations; other configurations
follow the field equations in @sec-pcrtc-2-function.

Each example enables circuit 1 only, uses source origin (0,0), and reads linear
GX16 storage with a **1024-word source stride**. Prepare the source image before
publishing it. Use these common composition words:

| Address | Register | Value |
|---|---|---|
| `08010354H` | PMODE_LOW | `0000FF21H` |
| `08010358H` | PMODE_HIGH | `00000000H` |
| `0801035CH` | DISPFB1_LOW | `000FA000H` |
| `08010360H` | DISPFB1_HIGH | `00000000H` |
| `0801037CH` | BGCOLOR_LOW | `00000000H` |
| `08010380H` | BGCOLOR_HIGH | `00000000H` |

`DISPFB1_LOW` selects base word zero, FBW=16 and GX16 storage. The two
`DISPLAY1` words below choose the signal position, magnification and output
extent. All rows use X magnification 4, Y magnification 1 and horizontal signal
step 4: adjacent output columns therefore select adjacent source words.

| Output geometry | Timing group | DISPLAY1_LOW | DISPLAY1_HIGH | SYNCV_LOW | SMODE2_LOW |
|---|---|---|---|---|---|
| 256 × 192 | A | `018252A8H` | `000BF3FFH` | `02101404H` | `00000000H` |
| 256 × 212 | A | `018252A8H` | `000D33FFH` | `02101404H` | `00000000H` |
| 256 × 240 | A | `018252A8H` | `000EF3FFH` | `02101404H` | `00000000H` |
| 320 × 240 | A | `018252A8H` | `000EF4FFH` | `02101404H` | `00000000H` |
| 368 × 240 | A | `018252A8H` | `000EF5BFH` | `02101404H` | `00000000H` |
| 512 × 240 | A | `018252A8H` | `000EF7FFH` | `02101404H` | `00000000H` |
| 640 × 240 | A | `018252A8H` | `000EF9FFH` | `02101404H` | `00000000H` |
| 640 × 448, interlaced | B | `0183228CH` | `001BF9FFH` | `01A01801H` | `00000001H` |
| 640 × 480, interlaced | B | `0183228CH` | `001DF9FFH` | `01A01801H` | `00000001H` |
| 640 × 512, interlaced | A | `018482A8H` | `001FF9FFH` | `02101401H` | `00000001H` |

Write DISPLAY1_LOW at `08010364H`, DISPLAY1_HIGH at `08010368H`, SYNCV_LOW at
`080103CCH` and SMODE2_LOW at `080103B4H`. Write SMODE2_HIGH (`080103B8H`)
as zero. The remaining timing words come from the selected group:

| Address | Register or programming phase | Group A | Group B |
|---|---|---|---|
| `080103ACH` | SMODE1_LOW, hold beam during setup | `40836504H` | `40834504H` |
| `080103ACH` | SMODE1_LOW, run after setup | `40806504H` | `40804504H` |
| `080103B0H` | SMODE1_HIGH | `00000007H` | `00000007H` |
| `080103BCH` | SYNCH1_LOW | `1FC83030H` | `1F06F040H` |
| `080103C0H` | SYNCH1_HIGH | `0007F5C2H` | `0007F5B6H` |
| `080103C4H` | SYNCH2_LOW | `003484BCH` | `0033A4D8H` |
| `080103C8H` | SYNCH2_HIGH | `00000000H` | `00000000H` |
| `080103D0H` | SYNCV_HIGH | `00A90005H` | `00C78006H` |

The resulting repetition rates follow the beam equation, not the width or
height labels:

| Configuration | Half-line period | Half-lines per field | Field repetitions per second | Complete two-field pairs per second |
|---|---|---:|---:|---:|
| Group A, non-interlaced rows above | 32 µs | 628 | Approximately 49.7611465 | Not interlaced |
| Group B, interlaced rows above | `27456 / 864000000` seconds | 525 | Approximately 59.9400599 | Approximately 29.9700300 |
| Group A, 640 × 512 interlaced | 32 µs | 625 | 50 | 25 |

For an interlaced row, the stated height is the complete output rectangle.
One field traverses alternate rows: 224 of 448, 240 of 480, or 256 of 512.
`FFMD=0` in these examples, so the source row stride is two and source phase
depends on the signal Y and FIELD as described in @sec-pcrtc-22-interlaced-reading. In particular,
the two group-B examples start at signal Y=50, while the 512-line example
starts at signal Y=72. Both positions are even, so FIELD selects the source
row parity directly. Keep both sets of source rows valid.

### Program the complete configuration before restarting the beam {#sec-pcrtc-34-program-the-complete-configuration-before-restarting-the-beam}

This sequence replaces the global beam timing. Use it only while the cartridge
owns timing configuration and no other writer is changing the display words.
For an ordinary buffer switch with unchanged timing, use @sec-pcrtc-26-programmed-words-and-displayed-settings instead.

1. Write the selected group's **hold-beam** SMODE1_LOW word. PRST and SINT are
   both set, so no live beam events can occur during the remaining setup.
2. Write SMODE1_HIGH, both SYNCH1 words, both SYNCH2 words, the selected
   SYNCV_LOW, its group's SYNCV_HIGH, SMODE2_LOW and zero SMODE2_HIGH.
3. Write the framebuffer, source origin, DISPLAY1 and background words. Enable
   circuit 1 with the complete PMODE words above; EN2 remains zero.
4. Write the group's **run** SMODE1_LOW word last. This clears PRST and SINT
   and restarts at half-line zero. Observe a subsequent VBlank entry before
   treating the configuration as displayed.

Holding the live beam is not a request to blank the previously latched picture.
The new configuration becomes displayed at VBlank entry. Existing pending
interrupt flags are not acknowledged by this sequence; use a fresh VBlank
observation as in the [display-switch sequence](gpu.md#sec-memory-a-display-switch-selects-storage-it-does-not-save-it).

These writes configure PCRTC. GP1 display-mode and range words are separate
GPU state: writing them does not substitute for this timing and window setup.
Drawing bounds, offsets, texture storage and the GP1 Y-address gate likewise
remain the GPU's programming responsibility. To display another region, replace
the DISPFB base and source origin while preserving the selected format and
source stride; a DISPLAY window is not a local-memory allocation.

## REGISTER REFERENCE {#sec-pcrtc-4-register-reference}

PCRTC register words occupy four bytes. The composition registers start at
`08010354H`; the timing and status registers start at `080103ACH`. Use the
individual addresses below: the intervening addresses are not PCRTC registers.

`R/W` below means that the complete configuration word is retained and returned on read.
In its layout, `R` marks retained bits with no named operational field. These bits are
not a must-zero requirement. CSR and IMR instead use the per-bit access rules in their
entries.

### PMODE — Circuit enables and output control {#sec-pcrtc-41-pmode-circuit-enables-and-output-control}

| Address | Name | Purpose | Access | Reset |
|---|---|---|---|---|
| `08010354H` | `PMODE_LOW` | Circuit enables and output controls | R/W | `00000000H` |
| `08010358H` | `PMODE_HIGH` | Retained high word | R/W | `00000000H` |

| Word | Bits | Field |
| --- | --- | --- |
| LOW | 31:16 | R |
| LOW | 15:8 | ALP |
| LOW | 7 | SLBG |
| LOW | 6 | AMOD |
| LOW | 5 | MMOD |
| LOW | 4:2 | R |
| LOW | 1 | EN2 |
| LOW | 0 | EN1 |

: {tbl-colwidths="[18,18,64]"}

| Word | Bits | Field |
| --- | --- | --- |
| HIGH | 31:0 | R |

: {tbl-colwidths="[18,18,64]"}

| Field | Setting |
|---|---|
| EN1, EN2 | 0: disable the corresponding reading circuit; 1: enable it |
| MMOD | 0: derive the circuit-1 RGB coefficient from sample alpha; 1: use ALP |
| AMOD | 0: circuit 1 selects its sample alpha; 1: circuit 2 supplies alpha and circuit 1 preserves prior alpha |
| SLBG | 0: circuit 2 supplies RGB; 1: retain background RGB at the circuit-2 stage |
| ALP | Eight-bit circuit-1 RGB coefficient, 0–255, used directly when MMOD = 1 |

These actions apply only inside the enabled circuit's window. @sec-pcrtc-25-output-composition gives the
complete operation tables, coefficient and rounding equation, and alpha selection.
Program `DISPFB` and `DISPLAY` before enabling a circuit. The setting in @sec-pcrtc-31-set-a-256-192-window-on-circuit-1
supplies a complete PMODE word for that example.

### DISPFB1 — Circuit 1 framebuffer {#sec-pcrtc-42-dispfb1-circuit-1-framebuffer}

| Address | Name | Purpose | Access | Reset |
|---|---|---|---|---|
| `0801035CH` | `DISPFB1_LOW` | Framebuffer base, width, and storage selection | R/W | `000FA000H` |
| `08010360H` | `DISPFB1_HIGH` | Framebuffer source origin | R/W | `00000000H` |

| Word | Bits | Field |
| --- | --- | --- |
| LOW | 31:20 | R |
| LOW | 19:15 | Storage |
| LOW | 14:9 | Width |
| LOW | 8:0 | Base |

: {tbl-colwidths="[18,18,64]"}

| Word | Bits | Field |
| --- | --- | --- |
| HIGH | 31:22 | R |
| HIGH | 21:11 | Source Y |
| HIGH | 10:0 | Source X |

: {tbl-colwidths="[18,18,64]"}

Base (`FBP`) is in groups of 4096 sixteen-bit local-memory words; width (`FBW`) is in
groups of 64 framebuffer pixels. Source X and source Y specify the source origin.
Packing and address calculations are in @sec-pcrtc-23-local-memory-samples and @sec-pcrtc-24-local-memory-address-layout, including FBW = 0 and wrap.

| Storage selector | Circuit 1 format |
|---:|---|
| 0 | CT32 |
| 1 | CT24 |
| 2 | CT16 |
| 10 | CT16S |
| 18 | GPU24 |
| 31 | GX16 |
| Other | Zero RGBA sample; circuit remains enabled |

### DISPLAY1 — Circuit 1 signal window {#sec-pcrtc-43-display1-circuit-1-signal-window}

| Address | Name | Purpose | Access | Reset |
|---|---|---|---|---|
| `08010364H` | `DISPLAY1_LOW` | Signal origin and magnification | R/W | `018252A8H` |
| `08010368H` | `DISPLAY1_HIGH` | Signal-window extents | R/W | `000EF4FFH` |

| Word | Bits | Field |
| --- | --- | --- |
| LOW | 31:29 | R |
| LOW | 28:27 | Y mag |
| LOW | 26:23 | X mag |
| LOW | 22:12 | Signal Y |
| LOW | 11:0 | Signal X |

: {tbl-colwidths="[18,18,64]"}

| Word | Bits | Field |
| --- | --- | --- |
| HIGH | 31:23 | R |
| HIGH | 22:12 | Vertical extent |
| HIGH | 11:0 | Horizontal extent |

: {tbl-colwidths="[18,18,64]"}

| Field | Actual setting |
|---|---|
| X magnification | Encoded value + 1; range 1–16 |
| Y magnification | Encoded value + 1; range 1–4 |
| Horizontal extent | Signal span = encoded value + 1 |
| Vertical extent | Height = encoded value + 1 |

Set signal X/Y for the window origin. Horizontal extents use signal units, not final
output-pixel counts; apply the signal-step boundary conversion in @sec-pcrtc-21-framebuffer-reading-and-display-windows.

### DISPFB2 — Circuit 2 framebuffer {#sec-pcrtc-44-dispfb2-circuit-2-framebuffer}

| Address | Name | Purpose | Access | Reset |
|---|---|---|---|---|
| `0801036CH` | `DISPFB2_LOW` | Framebuffer base, width, and storage selection | R/W | `000FA000H` |
| `08010370H` | `DISPFB2_HIGH` | Framebuffer source origin | R/W | `00000000H` |

| Word | Bits | Field |
| --- | --- | --- |
| LOW | 31:20 | R |
| LOW | 19:15 | Storage |
| LOW | 14:9 | Width |
| LOW | 8:0 | Base |

: {tbl-colwidths="[18,18,64]"}

| Word | Bits | Field |
| --- | --- | --- |
| HIGH | 31:22 | R |
| HIGH | 21:11 | Source Y |
| HIGH | 10:0 | Source X |

: {tbl-colwidths="[18,18,64]"}

Base (`FBP`) is in groups of 4096 sixteen-bit local-memory words; width (`FBW`) is in
groups of 64 framebuffer pixels. Circuit 2 has its own source X/Y origin. Packing and
address calculations are in @sec-pcrtc-23-local-memory-samples and @sec-pcrtc-24-local-memory-address-layout, including FBW = 0 and wrap.

| Storage selector | Circuit 2 format |
|---:|---|
| 0 | CT32 |
| 1 | CT24 |
| 2 | CT16 |
| 10 | CT16S |
| 31 | GX16 |
| 18 or other | Zero RGBA sample; circuit remains enabled |

### DISPLAY2 — Circuit 2 signal window {#sec-pcrtc-45-display2-circuit-2-signal-window}

| Address | Name | Purpose | Access | Reset |
|---|---|---|---|---|
| `08010374H` | `DISPLAY2_LOW` | Signal origin and magnification | R/W | `018252A8H` |
| `08010378H` | `DISPLAY2_HIGH` | Signal-window extents | R/W | `000EF4FFH` |

| Word | Bits | Field |
| --- | --- | --- |
| LOW | 31:29 | R |
| LOW | 28:27 | Y mag |
| LOW | 26:23 | X mag |
| LOW | 22:12 | Signal Y |
| LOW | 11:0 | Signal X |

: {tbl-colwidths="[18,18,64]"}

| Word | Bits | Field |
| --- | --- | --- |
| HIGH | 31:23 | R |
| HIGH | 22:12 | Vertical extent |
| HIGH | 11:0 | Horizontal extent |

: {tbl-colwidths="[18,18,64]"}

The encoded-plus-one rules are the same as for circuit 1: X magnification is 1–16, Y
magnification is 1–4, and each extent specifies one less than the corresponding span or
height. Program this window independently; enabled circuit windows jointly determine the
output bounds.

### BGCOLOR — Background color {#sec-pcrtc-46-bgcolor-background-color}

| Address | Name | Purpose | Access | Reset |
|---|---|---|---|---|
| `0801037CH` | `BGCOLOR_LOW` | Background color input | R/W | `00000000H` |
| `08010380H` | `BGCOLOR_HIGH` | Retained high word | R/W | `00000000H` |

| Word | Bits | Field |
| --- | --- | --- |
| LOW | 31:24 | R |
| LOW | 23:0 | Background color |

: {tbl-colwidths="[18,18,64]"}

| Word | Bits | Field |
| --- | --- | --- |
| HIGH | 31:0 | R |

: {tbl-colwidths="[18,18,64]"}

Write R in bits 7–0, G in bits 15–8, and B in bits 23–16. Background alpha is zero.
PMODE controls composition with the enabled circuits as described in @sec-pcrtc-25-output-composition.

### SMODE1 — Timing factors and signal step {#sec-pcrtc-47-smode1-timing-factors-and-signal-step}

| Address | Name | Purpose | Access | Reset |
|---|---|---|---|---|
| `080103ACH` | `SMODE1_LOW` | Timing factors, run controls, and horizontal signal step | R/W | `40806504H` |
| `080103B0H` | `SMODE1_HIGH` | Vertical-unit selection | R/W | `00000007H` |

| Word | Bits | Field |
| --- | --- | --- |
| LOW | 31:25 | R |
| LOW | 24:21 | Step X |
| LOW | 20:18 | R |
| LOW | 17 | SINT |
| LOW | 16 | PRST |
| LOW | 15 | R |
| LOW | 14:13 | CMOD |
| LOW | 12 | R |
| LOW | 11:10 | Divider |
| LOW | 9:3 | LC |
| LOW | 2:0 | RC |

: {tbl-colwidths="[18,18,64]"}

| Word | Bits | Field |
| --- | --- | --- |
| HIGH | 31:5 | R |
| HIGH | 4 | U |
| HIGH | 3:0 | R |

: {tbl-colwidths="[18,18,64]"}

RC, LC, and the divider field set the half-line period through the equations in
@sec-pcrtc-27-beam-timing. Step X is the number of horizontal signal units per output pixel. A latched Step X
of zero prevents pixel output.

| Divider field | Multiplier used with RC |
|---:|---:|
| 0 | 1 |
| 1 | 2 |
| 2 | 3 |
| 3 | 4 |

| High-word bit 4 | Vertical multiplier U |
|---:|---:|
| 0 | 1 |
| 1 | 2 |

Timing runs only when PRST and SINT are both zero and the calculated half-line
numerator, denominator, and total half-lines are all nonzero. Setting either run-control
bit stops timing. CMOD participates in FIELD updates at VSync: nonzero CMOD and odd VFP
select toggling; otherwise VSync sets FIELD to one.

**Timing-write caution:** changing either word restarts the beam, even when the changed
bits are retained bits. A restart does not acknowledge CSR events or assign FIELD.

### SMODE2 — Interlaced traversal {#sec-pcrtc-48-smode2-interlaced-traversal}

| Address | Name | Purpose | Access | Reset |
|---|---|---|---|---|
| `080103B4H` | `SMODE2_LOW` | Interlace and frame-mode controls | R/W | `00000000H` |
| `080103B8H` | `SMODE2_HIGH` | Retained high word | R/W | `00000000H` |

| Word | Bits | Field |
| --- | --- | --- |
| LOW | 31:2 | R |
| LOW | 1 | FFMD |
| LOW | 0 | INT |

: {tbl-colwidths="[18,18,64]"}

| Word | Bits | Field |
| --- | --- | --- |
| HIGH | 31:0 | R |

: {tbl-colwidths="[18,18,64]"}

| INT | FFMD | Traversal |
|---:|---:|---|
| 0 | Either | Non-interlaced; FFMD does not select frame mode |
| 1 | 0 | Interlaced, non-frame mode |
| 1 | 1 | Interlaced, frame mode |

Use the source stride and phase rules in @sec-pcrtc-22-interlaced-reading. Writes to these words follow the
display-latch rule without restarting the beam.

### SYNCH1 — Horizontal timing counts {#sec-pcrtc-49-synch1-horizontal-timing-counts}

| Address | Name | Purpose | Access | Reset |
|---|---|---|---|---|
| `080103BCH` | `SYNCH1_LOW` | HFP and HBP counts | R/W | `1FC83030H` |
| `080103C0H` | `SYNCH1_HIGH` | HS count | R/W | `0007F5C2H` |

| Word | Bits | Field |
| --- | --- | --- |
| LOW | 31:22 | R |
| LOW | 21:11 | HBP |
| LOW | 10:0 | HFP |

: {tbl-colwidths="[18,18,64]"}

| Word | Bits | Field |
| --- | --- | --- |
| HIGH | 31:27 | R |
| HIGH | 26:11 | HS |
| HIGH | 10:0 | R |

: {tbl-colwidths="[18,18,64]"}

HFP, HBP, and HS contribute horizontal timing counts to H. Their time scale is set by
RC, LC, and the divider, not by the output-pixel magnification fields. A changed write
to either word recalculates timing and restarts the beam.

### SYNCH2 — Additional horizontal timing counts {#sec-pcrtc-410-synch2-additional-horizontal-timing-counts}

| Address | Name | Purpose | Access | Reset |
|---|---|---|---|---|
| `080103C4H` | `SYNCH2_LOW` | HF and HB counts | R/W | `003484BCH` |
| `080103C8H` | `SYNCH2_HIGH` | Retained timing high word | R/W | `00000000H` |

| Word | Bits | Field |
| --- | --- | --- |
| LOW | 31:27 | R |
| LOW | 26:11 | HB |
| LOW | 10:0 | HF |

: {tbl-colwidths="[18,18,64]"}

| Word | Bits | Field |
| --- | --- | --- |
| HIGH | 31:0 | R |

: {tbl-colwidths="[18,18,64]"}

HF and HB complete the horizontal sum H. **Changing `SYNCH2_HIGH` also restarts the
beam**, although its bits have no named timing field. Writing its current value does not
restart it.

### SYNCV — Vertical timing and beam phases {#sec-pcrtc-411-syncv-vertical-timing-and-beam-phases}

| Address | Name | Purpose | Access | Reset |
|---|---|---|---|---|
| `080103CCH` | `SYNCV_LOW` | VFP, VFPE, and VBP counts | R/W | `02101404H` |
| `080103D0H` | `SYNCV_HIGH` | VBPE, VDP, and VS counts | R/W | `00A90005H` |

| Word | Bits | Field |
| --- | --- | --- |
| LOW | 31:20 | VBP |
| LOW | 19:10 | VFPE |
| LOW | 9:0 | VFP |

: {tbl-colwidths="[18,18,64]"}

| Word | Bits | Field |
| --- | --- | --- |
| HIGH | 31:21 | VS |
| HIGH | 20:10 | VDP |
| HIGH | 9:0 | VBPE |

: {tbl-colwidths="[18,18,64]"}

These fields count vertical units. Multiplying by U converts them to half-lines. VDP
sets the active-display interval. VFP and VFPE offset VSync from its end; all six fields
determine field length. A changed write to either word restarts the beam.

@sec-pcrtc-27-beam-timing gives the half-line equations, reset timing landmarks, and FIELD update
rule. @sec-pcrtc-26-programmed-words-and-displayed-settings specifies the VBlank-entry display latch. These counts are not
output-pixel extents.

### CSR — Event acknowledgement, field status, and actions {#sec-pcrtc-412-csr-event-acknowledgement-field-status-and-actions}

| Address | Name | Purpose | Access | Reset |
|---|---|---|---|---|
| `080103D4H` | `CSR_LOW` | Event status, acknowledgements, FIELD, FLUSH, and RESET | Read; W1C events; write actions | `551B4000H` |
| `080103D8H` | `CSR_HIGH` | Zero high word | Read zero; writes have no action | `00000000H` |

| Word | Bits | Field |
| --- | --- | --- |
| LOW | 31:14 | — |
| LOW | 13 | FIELD |
| LOW | 12:10 | — |
| LOW | 9 | RESET |
| LOW | 8 | FLUSH |
| LOW | 7:5 | — |
| LOW | 4 | EDWINT |
| LOW | 3 | VSINT |
| LOW | 2 | HSINT |
| LOW | 1 | FINISH |
| LOW | 0 | SIGNAL |

: {tbl-colwidths="[18,18,64]"}

| Word | Bits | Field |
| --- | --- | --- |
| HIGH | 31:0 | Read zero; writes have no action |

: {tbl-colwidths="[18,18,64]"}

| Bits | Field | Access and operation |
|---|---|---|
| 0 | SIGNAL | Read pending status; write one to clear |
| 1 | FINISH | Read pending status; write one to clear |
| 2 | HSINT | Read pending status; write one to clear |
| 3 | VSINT | Read pending status; write one to clear |
| 4 | EDWINT | Read pending status; write one to clear |
| 8 | FLUSH | Write one to request a flush action; does not latch |
| 9 | RESET | Write one to request reset; does not latch |
| 13 | FIELD | Read-only field status; CSR writes do not assign it |

Write zero to event bits that must remain unchanged. Do not acknowledge events by
writing back a complete CSR read value: every event bit written as one is cleared. Use
an explicit acknowledgement mask, as in @sec-pcrtc-32-acknowledge-stale-hsint-and-unmask-only-hsint.

Only HSINT and VSINT are normally generated. SIGNAL, FINISH, and EDWINT remain retained,
W1C and maskable positions, not hardwired-zero fields; see @sec-pcrtc-28-events-and-interrupts. CSR writes do
not assign the unnamed positions.

RESET takes priority over FLUSH. Both clear queued input and terminate readback;
executing drawing retains its original completion time, and a consumed upload prefix
incurs its normal command cost. RESET restores PCRTC registers and installs
reset display settings immediately; its GPU register effects
are bounded as listed in @sec-pcrtc-29-reset-and-flush. FLUSH does not reset the display. @sec-pcrtc-29-reset-and-flush also
gives the accepted-work and upload rules.

### IMR — PCRTC event masks {#sec-pcrtc-413-imr-pcrtc-event-masks}

| Address | Name | Purpose | Access | Reset |
|---|---|---|---|---|
| `080103DCH` | `IMR_LOW` | Five event masks and fixed read bits | R/W masks; fixed bits as below | `00007F00H` |
| `080103E0H` | `IMR_HIGH` | Zero high word | Read zero; writes have no action | `00000000H` |

| Word | Bits | Field |
| --- | --- | --- |
| LOW | 31:15 | Zero |
| LOW | 14:13 | Ones |
| LOW | 12 | EDWINT |
| LOW | 11 | VSINT |
| LOW | 10 | HSINT |
| LOW | 9 | FINISH |
| LOW | 8 | SIGNAL |
| LOW | 7:0 | Zero |

: {tbl-colwidths="[18,18,64]"}

| Word | Bits | Field |
| --- | --- | --- |
| HIGH | 31:0 | Read zero; writes have no action |

: {tbl-colwidths="[18,18,64]"}

| Mask bit | Corresponding CSR event | 0 | 1 |
|---:|---|---|---|
| 8 | SIGNAL, bit 0 | Unmask | Mask |
| 9 | FINISH, bit 1 | Unmask | Mask |
| 10 | HSINT, bit 2 | Unmask | Mask |
| 11 | VSINT, bit 3 | Unmask | Mask |
| 12 | EDWINT, bit 4 | Unmask | Mask |

Writes retain mask bits 8–12, force bits 13–14 to one, and clear all other bits. Thus
bits 13–14 always read one; bits 31–15 and 7–0 read zero. Reset masks all five events.

A mask write does not acknowledge CSR. Check pending-event handling when unmasking: any
already pending event whose mask becomes zero can request the interrupt immediately. Use
the mask–acknowledge–unmask sequence in @sec-pcrtc-32-acknowledge-stale-hsint-and-unmask-only-hsint when enabling HSINT.

## Local-memory format reference {#sec-pcrtc-local-memory-format-reference}

### Local-memory samples {#sec-pcrtc-23-local-memory-samples}

Local memory holds `00200000H` bytes, or `00100000H` sixteen-bit words. Within each word,
the low byte comes first. The storage selector determines both pixel packing and the
address layout in @sec-pcrtc-24-local-memory-address-layout.

In the table, `L` is the word at the mapped pixel address and `H` is the following
word. RGB and alpha samples are eight-bit values.

| Selector | Format | Circuits | RGB packing | Sample alpha |
|---:|---|---|---|---|
| 0 | CT32 | 1, 2 | R = L[7:0]; G = L[15:8]; B = H[7:0] | H[15:8] |
| 1 | CT24 | 1, 2 | Same RGB placement as CT32; H[15:8] is ignored | 128 |
| 2 | CT16 | 1, 2 | R = L[4:0]; G = L[9:5]; B = L[14:10]; expand each component | 128 if L[15] = 1; otherwise 0 |
| 10 | CT16S | 1, 2 | Same packing as CT16; different address layout | 128 if L[15] = 1; otherwise 0 |
| 18 | GPU24 | 1 only | Three packed bytes per pixel; see below | 128 |
| 31 | GX16 | 1, 2 | Same packing as CT16; linear address layout | 128 if L[15] = 1; otherwise 0 |

Expand each five-bit RGB component `c` as follows:

```text
Eight-bit component = (c << 3) | (c >> 2)
```

GPU24 obtains two words through the CT16 address layout. For framebuffer coordinate
`(x, y)`, fetch `L` at `((3 × x) >> 1, y)` and `H` at
`(((3 × x) >> 1) + 1, y)`:

| Pixel X | R | G | B |
|---|---|---|---|
| Even | L[7:0] | L[15:8] | H[7:0] |
| Odd | L[15:8] | H[7:0] | H[15:8] |

Every unlisted selector, and selector 18 on circuit 2, supplies **zero RGBA samples**.
It neither disables the circuit nor raises a format fault. The circuit still performs
its selected PMODE operation inside its window. For example, copying zero RGB blacks
that area, whereas blending with zero source alpha preserves the prior RGB. Alpha
selection still applies as specified in @sec-pcrtc-25-output-composition.

### Local-memory address layout {#sec-pcrtc-24-local-memory-address-layout}

The following formulas map framebuffer sample coordinates `(x, y)`, including the
programmed source origin, to local-memory word addresses. They do not produce CPU byte
addresses. All arithmetic is integer arithmetic; `&`, `|`, `<<`, and `>>` denote bitwise
AND, OR, left shift, and unsigned right shift. The coordinates are nonnegative.

```text
B = FBP << 12
P = FBW
W = P × 64
M = 000FFFFFH
```

Every word fetch wraps with mask `M`, including CT32/CT24's second word. The base and
pixel offset are added before this wrap. All nine FBP bits remain representable; a
base beyond one installed-memory period aliases through the same mask.

#### CT32 and CT24 {#sec-pcrtc-ct32-and-ct24}

These formats use 64 × 32-pixel pages:

```text
page   = (y >> 5) × P + (x >> 6)
px     = x & 63
py     = y & 31
bx     = px >> 3
by     = py >> 3

block  = (bx & 1) | ((by & 1) << 1)
       | ((bx & 2) << 1) | ((by & 2) << 2) | ((bx & 4) << 2)
column = (px & 1) | ((py & 1) << 1)
       | ((px & 6) << 1) | ((py & 6) << 3)

A = (B + (page << 12) + (block << 7) + (column << 1)) & M
```

Fetch `L` at `A` and `H` at `(A + 1) & M`.

#### CT16 and CT16S {#sec-pcrtc-ct16-and-ct16s}

These formats use 64 × 64-pixel pages and share their column calculation:

```text
page   = (y >> 6) × P + (x >> 6)
px     = x & 63
py     = y & 63
bx     = px >> 4
by     = py >> 3

column = ((px & 1) << 1) | ((px & 2) << 2)
       | ((px & 4) << 2) | ((px & 8) >> 3)
       | ((py & 1) << 2) | ((py & 2) << 4) | ((py & 4) << 4)
```

Select the block calculation for the programmed format:

```text
CT16:
block = ((bx & 1) << 1) | (by & 1) | ((bx & 2) << 2)
      | ((by & 2) << 1) | ((by & 4) << 2)

CT16S:
block = (by & 1) | ((bx & 1) << 1) | (by & 4)
      | ((by & 2) << 2) | ((bx & 2) << 3)

A = (B + (page << 12) + (block << 7) + column) & M
```

#### GX16 and GPU24 {#sec-pcrtc-gx16-and-gpu24}

GX16 uses linear word addressing:

```text
A = (B + y × W + x) & M
```

GPU24 uses the CT16 calculation twice, at the two word coordinates in @sec-pcrtc-23-local-memory-samples.

**Zero-width setting:** FBW = 0 is not a disable setting. It supplies a zero row stride
for GX16 and zero pages per row for the page-based formats. The remaining coordinate
terms and address wrap still operate; no width fault is raised.

## SOURCE ORIGIN AND DISPLAY-WINDOW POSITION {#sec-pcrtc-5-source-origin-and-display-window-position}

A source origin selects which pixels a circuit reads. A display-window position selects where that circuit contributes to the picture. This example changes them separately while leaving the image in local memory unchanged. Circuit 2 supplies a fixed 256 × 192-pixel canvas; circuit 1 places a 128 × 96-pixel cutout over it. Both circuits read the same image.

The image contains twelve coloured 64 × 64-pixel cells, a white L, a black
16 × 16-pixel square and a red 8 × 8-pixel square. Finish drawing and readback
before enabling display, then leave the stored image unchanged through stages
A, B and C. Each change of source origin or window position then selects a
different view of the same pixels.

### Program the fixed canvas and initial cutout {#sec-pcrtc-program-the-fixed-canvas-and-initial-cutout}

Both framebuffer descriptors select GX16 storage, base zero, and a row width of 1024 sixteen-bit words, corresponding to 1024 pixels. Use normal reset timing, noninterlaced output, horizontal magnification 4, and vertical magnification 1. With a horizontal signal step of 4, one source pixel occupies one output pixel.

All table addresses and register words are hexadecimal. Keep both circuits
disabled while preparing their descriptors; enable the final PMODE word last.
The table describes stage A, not an ordered sequence of writes.

| Register | Address | Stage-A raw word |
|---|---|---|
| PMODE_LOW | `08010354` | `0000FF23` |
| DISPFB1_LOW | `0801035C` | `000FA000` |
| DISPFB1_HIGH | `08010360` | `00000000` |
| DISPLAY1_LOW | `08010364` | `018553A8` |
| DISPLAY1_HIGH | `08010368` | `0005F1FF` |
| DISPFB2_LOW | `0801036C` | `000FA000` |
| DISPFB2_HIGH | `08010370` | `00000000` |
| DISPLAY2_LOW | `08010374` | `018252A8` |
| DISPLAY2_HIGH | `08010378` | `000BF3FF` |

Circuit 2 starts at signal position (680, 37), spans 1024 horizontal signal units and 192 rows, and reads source (0, 0). Its window fixes the cropped output origin at (0, 0). Keep it enabled and unchanged throughout the example. The minimum enabled signal X and Y establish that origin; moving a lone enabled circuit would move the crop with it.

`PMODE_LOW = 0000FF23` enables both circuits. Circuit 2 supplies raw RGB; circuit 1 supplies direct raw RGB and its sample alpha inside its window, without RGB blending. The programmed ALP value of 255 does not force sample alpha to 255.

### Change selection, then placement {#sec-pcrtc-change-selection-then-placement}

The following table gives retained register words and decoded geometry. Source origins are framebuffer pixels; signal origins use signal coordinates. The output cutout uses output pixels, with its end coordinates excluded.

| Stage | DISPFB1_HIGH | DISPLAY1_LOW | Source origin | Signal origin | Output cutout |
|---|---|---|---|---|---|
| A | `00000000` | `018553A8` | (0, 0) | (936, 85) | [64, 192) × [48, 144) |
| B | `00008020` | `018553A8` | (32, 16) | (936, 85) | [64, 192) × [48, 144) |
| C | `00008020` | `01855428` | (32, 16) | (1064, 85) | [96, 224) × [48, 144) |

From A to B, write only `DISPFB1_HIGH`. The visible source selection changes inside the stationary window. From B to C, write only `DISPLAY1_LOW`. The selected cutout moves 32 output pixels right. Neither change alters its extent or the 256 × 192-pixel canvas.

### Prepare the source and publish the changes {#sec-pcrtc-prepare-the-source-and-publish-the-changes}

Own GP0, both circuits, the VBlank handler and source rectangle
`(0,0)…(255,191)`. Keep this storage unchanged through A, B and C, and keep
other writers and supervisor entry outside the sequence. The rectangle must not
overlap the firmware reservation; querying that reservation does not allocate
the remaining memory.

With interrupt delivery masked, write CSR RESET (`00000200H`), then PMODE=0.
Program the eight framebuffer/window words in the stage-A table. To reproduce
the source picture, send these complete GP0 packets after E1–E6 establish
zero offset, drawing area `(0,0)…(255,191)`, both row parities, no dither and
E6=1 (force stored bit 15, do not check old bit 15):

```lua
rodata scene: word[] = {
    0x600000ff, 0, 0x00400040,
    0x6000ff00, 64, 0x00400040,
    0x60ff0000, 128, 0x00400040,
    0x6000ffff, 192, 0x00400040,
    0x60ffff00, 64 << 16, 0x00400040,
    0x60ff00ff, 64 | (64 << 16), 0x00400040,
    0x60ffffff, 128 | (64 << 16), 0x00400040,
    0x60202020, 192 | (64 << 16), 0x00400040,
    0x600080ff, 128 << 16, 0x00400040,
    0x60800080, 64 | (128 << 16), 0x00400040,
    0x60808000, 128 | (128 << 16), 0x00400040,
    0x60808080, 192 | (128 << 16), 0x00400040,
    0x60ffffff, 8 | (8 << 16), 4 | (40 << 16),
    0x60ffffff, 8 | (8 << 16), 40 | (4 << 16),
    0x60000000, 96 | (64 << 16), 16 | (16 << 16),
    0x600000ff, 144 | (96 << 16), 8 | (8 << 16),
}
local gp0<const>: *word = 0x0801023c
local gp1<const>: *word = 0x08010240
for index = 0, #scene - 1 do
    *gp0 = scene[index]
end
while (*gp1 & 0x04000000) == 0 do
end
```

The three marked source pixels `(8,8)`, `(96,64)` and `(144,96)` store
FFFFH, 8000H and 801FH respectively. A 1×1 C0 read after READY returns that
raw word in its low half and zero in its high half; it is not a read of the
composed output.

Use a VBlank sequence word shared by the entry code and its interrupt handler.
This fragment owns the central interrupt mask and uses ordinary cartridge
interrupt entry with CPU interrupt acceptance enabled:

```lua
bss vblank_sequence: word
local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
local pmode<const>: *word = 0x08010354
local source1<const>: *word = 0x08010360
local window1<const>: *word = 0x08010364

function irq(flags)
    if (flags & 4) ~= 0 then
        *vblank_sequence = *vblank_sequence + 1
    end
    *irq_ack = flags & 4
end

-- A: enable the prepared composition; observe a fresh latch edge.
*irq_mask = 0
*pmode = 0x0000ff23
*irq_ack = 4
local before<const> = *vblank_sequence
*irq_mask = 4
while *vblank_sequence == before do
    halt_until_irq
end
```

For B, repeat the masked publication sequence with `*source1 = 0x00008020`
in place of the PMODE store. For C, use `*window1 = 0x01855428` instead.
Finish observing each stage before programming the next. An edge discarded by
the stale-request acknowledgement can add a refresh; the later observed edge
has latched the new setting. Masking delivery does not stop the latch or make
several stores atomic. An immediate source/window read reports the programmed
word, not display acceptance.

![Stage A](figures/pcrtc-window-a.png){#fig-pcrtc-window-a}

*Figure A. Source (0, 0), cutout at (64, 48). The copied white L starts at (72, 56), and the copied black square at (160, 112).*

![Stage B](figures/pcrtc-window-b.png){#fig-pcrtc-window-b}

*Figure B. Source (32, 16), cutout still at (64, 48). The copied black square starts at (128, 96), and the copied red square at (176, 128).*

![Stage C](figures/pcrtc-window-c.png){#fig-pcrtc-window-c}

*Figure C. The same source cutout at (96, 48). The copied black and red squares start at (160, 96) and (208, 128).*

The canvas white L stays at (8, 8) in all three pictures. The source origin (32, 16) excludes its cutout copy in B and C. These feature positions distinguish a source-origin change from a window-position change without adding a border or altering the image.

## HORIZONTAL SOURCE SAMPLING {#sec-pcrtc-6-horizontal-source-sampling}

Let `s` be signal units per output pixel, `S` the horizontal signal origin, and `M` signal units per source pixel:

```
s = (SMODE1_LOW >> 21) & 15
S = DISPLAY_LOW & 4095
M = ((DISPLAY_LOW >> 23) & 15) + 1
```

For an enabled active horizontal window with nonzero `s`, `div` denotes the nonnegative integer quotient:

```
A = (S + s - 1) div s
sourceX(n) = framebufferX + ((A*s - S + n*s) div M)
```

`framebufferX` is the source X field of `DISPFB_HIGH`. `n` is the local output-pixel index from the circuit's left display edge, not an absolute coordinate. `A*s - S` is the first-pixel phase in signal units. Each subsequent output pixel advances by `s` signal units, whereas each source pixel occupies `M` signal units. Unequal steps need not advance source coordinates by one.

Window width is separate from source magnification. Convert the left and exclusive right signal boundaries independently upward to output-pixel boundaries, then subtract. Output width is not signal width divided by `M`.

### Eight-pixel GX16 strip {#sec-pcrtc-eight-pixel-gx16-strip}

Use reset timing with `SMODE1_LOW = 40806504H` (`s = 4`) and `SMODE2_LOW = 00000000H` (noninterlaced), with these display words:

| Register | Word |
|---|---|
| PMODE_LOW | 0000FF21H |
| DISPFB1_LOW | 000FA000H |
| DISPFB1_HIGH | 00008020H |
| DISPLAY1_LOW | 010252AAH |
| DISPLAY1_HIGH | 0000001FH |

Circuit 1 selects raw GX16 RGBA from framebuffer base zero, stride 1024 source pixels, and source origin `(32,16)`. The signal origin is `(682,37)`, the signal width is 32, the height is one row, and `M = 3`.

The horizontal signal interval is `[682,714)`. Its upward-converted boundaries are 171 and 179, yielding an **8 × 1** output. The first sample is at signal X 684, giving phase `684 − 682 = 2`. Upload the sixteen GX16 words `8000H` through `800FH` at source positions `(32,16)` through `(47,16)`.

In the table, `N = 2 + 4*n`; source offset is `N div 3`. Addresses are **16-bit word addresses**, not byte offsets.

| n | Signal X | N | Source offset | Source X,Y | Word address | GX16 word |
|---:|---:|---:|---:|---|---|---|
| 0 | 684 | 2 | 0 | (32,16) | 4020H | 8000H |
| 1 | 688 | 6 | 2 | (34,16) | 4022H | 8002H |
| 2 | 692 | 10 | 3 | (35,16) | 4023H | 8003H |
| 3 | 696 | 14 | 4 | (36,16) | 4024H | 8004H |
| 4 | 700 | 18 | 6 | (38,16) | 4026H | 8006H |
| 5 | 704 | 22 | 7 | (39,16) | 4027H | 8007H |
| 6 | 708 | 26 | 8 | (40,16) | 4028H | 8008H |
| 7 | 712 | 30 | 10 | (42,16) | 402AH | 800AH |

Observed RGB, left to right:

```
(0,0,0) (16,0,0) (24,0,0) (33,0,0)
(49,0,0) (57,0,0) (66,0,0) (82,0,0)
```

These expanded RGB555 values are not raw GX16 words. Every sample has alpha `80H`.

![Eight PCRTC output pixels from unequal horizontal magnification](figures/pcrtc-sampling.png){#fig-pcrtc-sampling}

*Eight-pixel output, enlarged without smoothing. From left to right, source offsets are 0, 2, 3, 4, 6, 7, 8 and 10. The source words are consecutive; the displayed selection is not.*

### Upload and select the strip {#sec-pcrtc-upload-and-select-the-strip}

Start from reset timing with both circuits disabled and exclusive ownership of
GP0, circuit 1, the VBlank handler and raw row 16, X=32…47. The following eight
payload words store the sixteen consecutive GX16 samples. GP0 coordinates pack
Y at bit 16; DISPFB source coordinates pack it at bit 11.

```lua
rodata pixels: word[8] = {
    0x80018000, 0x80038002, 0x80058004, 0x80078006,
    0x80098008, 0x800b800a, 0x800d800c, 0x800f800e,
}
local framebuffer<const>: *word = 0x0801035c
local source<const>: *word = 0x08010360
local window<const>: *word = 0x08010364
local extent<const>: *word = 0x08010368
*irq_mask = 0
*pmode = 0
*framebuffer = 0x000fa000
*source = 0x00008020
*window = 0x010252aa
*extent = 0x0000001f
*gp1 = 0x09000000
*gp0 = 0xe6000000
*gp0 = 0xa0000000
*gp0 = 32 | (16 << 16)
*gp0 = 16 | (1 << 16)
for index = 0, 7 do
    *gp0 = pixels[index]
end
while (*gp1 & 0x04000000) == 0 do
end
```

Use the ports and VBlank handler from the preceding example. Publish with
PMODE=`0000FF21H`, acknowledge stale controller VBlank bit 2, sample the
sequence while masked, unmask bit 2 and wait for a changed sequence. The
32-signal-unit window becomes eight output pixels; the selected source words
are exactly those in the sampling table. Keep the source row unchanged while
it remains displayed. A C0 request for the original 16×1 row, if used, returns
eight packed words; it does not return the eight-pixel composed strip.

## Composition: constant coefficient and source alpha {#sec-pcrtc-7-composition-constant-coefficient-and-source-alpha}

Both reading circuits cover the same 256 × 192 output. Circuit 1 contains red across the whole picture, divided into two 128-column halves: the left half has sample alpha 0, and the right half has sample alpha 128. Circuit 2 contains blue with sample alpha 128 throughout. The background is green. These sources, their windows and the background remain unchanged through all four phases; only PMODE changes.

The stored GX16 words are `0x001F` for circuit 1's left half, `0x801F` for its
right half, and `0xFC00` for circuit 2. Both red words decode to RGB `(255,0,0)`;
bit 15 supplies their different sample alpha values. Both reading circuits
remain enabled, and ALP remains 128:

| Phase | PMODE_LOW | MMOD | AMOD | SLBG | ALP |
|---|---:|---:|---:|---:|---:|
| A | `0x00008023` | 1 | 0 | 0 | 128 |
| B | `0x00008003` | 0 | 0 | 0 | 128 |
| C | `0x00008083` | 0 | 0 | 1 | 128 |
| D | `0x00008043` | 0 | 1 | 0 | 128 |

For each RGB channel, composition uses `Q = (S*k + D*(255-k) + 127) div 255`, where S is circuit 1's channel and D is the destination channel. Multiplication and addition precede the integer quotient; the denominator is 255, with 127 added for rounding.

Compare A with B to isolate MMOD. A selects constant `k = ALP = 128`, independently of sample alpha. Both halves therefore become `(128, 0, 127)`: even the left half, whose output alpha is zero, retains this purple RGB. B selects `k = min(2*A1, 255)`, where A1 is circuit 1's sample alpha. Alpha 0 leaves blue; alpha 128 saturates k to 255 and gives full red, not half-strength red.

| Phase | Left RGB | Right RGB | Left output alpha | Right output alpha |
|---|---|---|---:|---:|
| A | `(128, 0, 127)` | `(128, 0, 127)` | 0 | 128 |
| B | `(0, 0, 255)` | `(255, 0, 0)` | 0 | 128 |
| C | `(0, 255, 0)` | `(255, 0, 0)` | 0 | 128 |
| D | `(0, 0, 255)` | `(255, 0, 0)` | 128 | 128 |

Compare B with C for SLBG: the green background replaces circuit 2's blue RGB.
Compare B with D for AMOD: RGB stays the same, while output alpha changes from
circuit 1's split values to circuit 2's constant 128. The pictures illustrate
RGB composition; the table gives the independently selected output alpha.
Use B as the reference when examining either control separately.

Prepare the two 256×192 sources in raw VRAM rows 0–191 and 256–447, with pitch
1024 words and both source origins (0,0). Circuit 2 uses FBP=64, base word
40000H. Keep both images unchanged while stepping through the four PMODE
settings, and serialize other users of the display registers and GP0 port.
Both regions lie outside the queried BIOS reservation.

After each PMODE write, acknowledge stale VBlank pending state and wait for
the VBlank counter to advance, using the sequence below. This establishes that
the display latch has taken the new composition setting. E5 is used while
drawing the source images; C0 reads their absolute raw coordinates. Such reads
return the stored words 001FH, 801FH and FC00H. To predict the displayed
composite, apply the PMODE equation to the source colors and alpha values.

![A: uniform purple output](figures/pcrtc-mix-constant.png){#fig-pcrtc-mix-constant}

*A — PMODE=8023H: constant mixing of red source 1 and blue source 2 produces uniform RGB (128,0,127), despite source 1’s split alpha.*

| B — source-alpha selection | C — background selection |
| --- | --- |
| ![B: blue left and red right](figures/pcrtc-mix-source.png){#fig-pcrtc-mix-source} | ![C: green left and red right](figures/pcrtc-mix-background.png){#fig-pcrtc-mix-background} |
| *PMODE=8003H: source 1’s alpha split yields blue source 2 on the left and red source 1 on the right.* | *PMODE=8083H: SLBG substitutes green background for blue source 2; source 1’s right half stays red.* |

### Program the composition comparison {#sec-pcrtc-program-the-composition-comparison}

Use the mapped GP0/GP1 ports and VBlank handler above. Under exclusive ownership
of both circuits and the two surfaces, mask delivery, request PCRTC RESET and
keep PMODE zero. Program these framebuffer and window words; both source origins
are zero:

| Register | Address | Word |
|---|---|---|
| DISPFB1_LOW / HIGH | `0801035C` / `08010360` | `000FA000` / `00000000` |
| DISPLAY1_LOW / HIGH | `08010364` / `08010368` | `018252A8` / `000BF3FF` |
| DISPFB2_LOW / HIGH | `0801036C` / `08010370` | `000FA040` / `00000000` |
| DISPLAY2_LOW / HIGH | `08010374` / `08010378` | `018252A8` / `000BF3FF` |
| BGCOLOR_LOW | `0801037C` | `0000FF00` |

Close the GP1 Y-address gate with `09000000H`. Establish E1=`0400H`, E2=0,
drawing area `(0,0)…(255,191)` and zero drawing offset, then prepare both raw
sources using complete GP0 packets:

```lua
-- Red, left half with bit15 clear; right half with bit15 set.
*gp0 = 0xe6000000
*gp0 = 0x600000ff
*gp0 = 0
*gp0 = 128 | (192 << 16)
*gp0 = 0xe6000001
*gp0 = 0x600000ff
*gp0 = 128
*gp0 = 128 | (192 << 16)

-- Blue with bit15 set, in the second framebuffer at raw rows 256..447.
*gp0 = 0xe3040000
*gp0 = 0xe406fcff
*gp0 = 0xe5080000
*gp0 = 0x60ff0000
*gp0 = 0
*gp0 = 256 | (192 << 16)
while (*gp1 & 0x04000000) == 0 do
end
```

The red source words are 001FH and 801FH; the blue source word is FC00H.
E5 affects these drawing coordinates, whereas a C0 read takes absolute raw
coordinates. No source pixels change during the four comparisons.

To select any one phase, use its PMODE word from the table in the same
masked publication sequence shown for stage A. For example, phase C is:

```lua
*irq_mask = 0
*pmode = 0x00008083
*irq_ack = 4
local before<const> = *vblank_sequence
*irq_mask = 4
while *vblank_sequence == before do
    halt_until_irq
end
```

Observe that phase before selecting another. Immediate PMODE readback confirms
the programmed word only. The output plates show RGB; compare the separate
alpha results in the table when distinguishing phases B and D.
