# PCRTC Display Controller

The PCRTC generates display timing and supplies scanout through two programmable display
circuits. Each circuit selects a framebuffer source and places its display rectangle in
signal coordinates. PMODE controls circuit enables and composition, while BGCOLOR
supplies the background color. The timing registers establish horizontal and vertical
progression; status and mask registers provide event acknowledgement and interrupt
control.

## Display circuits

`PMODE_LOW.EN1` enables circuit 1 and `EN2` enables circuit 2. Each enabled circuit uses
its own `DISPFB` and `DISPLAY` words. The framebuffer base word address is the nine-bit
base field shifted left by 12. The framebuffer width is the six-bit width field
multiplied by 64. Source X and Y are the eleven-bit coordinates in the high framebuffer
word.

Both magnification fields use encoded-plus-one values: an encoded zero gives a
magnification of one. Extents use the same plus-one convention. A circuit occupies the
horizontal signal interval from signal X, inclusive, to `signal X + horizontal extent +
1`, exclusive. Its vertical height is `vertical extent + 1`.

Horizontal boundaries are rounded upward to signal-step boundaries before conversion to
output pixels. The minimum enabled signal X and signal Y establish the output origin,
and the output bounds cover both enabled circuits. Pixel output requires running beam
timing, a nonzero signal step X and at least one enabled circuit.

The storage field selects these framebuffer formats:

| Storage selector | Format | Circuits |
|---:|---|---|
| 0 | CT32 | 1 and 2 |
| 1 | CT24 | 1 and 2 |
| 2 | CT16 | 1 and 2 |
| 10 | CT16S | 1 and 2 |
| 18 | GPU24 | 1 |
| 31 | GX16 | 1 and 2 |

`BGCOLOR_LOW[23:0]` supplies the background color. `PMODE_LOW.ALP` supplies the constant
blend alpha. MMOD, AMOD and SLBG are the composition selectors.

### Interlaced traversal

`SMODE2_LOW.INT` selects interlaced traversal. FFMD selects frame mode only while INT is
set. Interlaced output advances by two rows; non-interlaced output advances by one.

For interlaced traversal without frame mode, the source stride is two and the source
phase is `(signal Y XOR FIELD) AND 1`. In all other cases, source stride is one and
phase is zero. The phase uses the signal Y of the corresponding circuit.

## Programmed and latched display words

The first 22 words form the programmed configuration. A changed write replaces its
programmed word immediately and makes a display update pending. Reads return this
programmed value, not the latched display value. Writing the same word again has no
effect.

At a VBlank presentation edge, the display latch transfers all 22 programmed words
together to the latched display configuration. It also updates the latched timing when a
beam-timing word has changed. Composition and display programming therefore have a
programmed copy and a latched copy; an immediate readback does not establish that the
new display configuration is already in use.

Beam timing has an additional, immediate write effect. Both `SMODE1` words and all six
`SYNCH1`, `SYNCH2` and `SYNCV` words are beam-timing words. A changed write to any of
them recomputes timing and restarts the beam at the write cycle. This includes
`SYNCH2_HIGH`, although it has no decoded field. Neither `SMODE2` word causes this
restart.

A restart returns the beam to half-line zero, clears its fractional remainder and leaves
VBlank inactive. The first HSync point follows at half-line 2. `FIELD` and pending CSR
events are unchanged.

## Register organization

Each register word occupies four bytes. The 26 words occupy two address ranges: the
first twelve begin at `08010354H`, and the remaining fourteen begin at `080103ACH`. The
ten intervening words belong to the GTE-plus region, not to the PCRTC register file.

`LOW` and `HIGH` identify separately addressed words. `DISPFBn_LOW` selects the
framebuffer base, width and storage format; `DISPFBn_HIGH` supplies the source
coordinates. `DISPLAYn_LOW` supplies signal position and magnification, while
`DISPLAYn_HIGH` supplies extents.

In the table, **R/W** means that the complete written word is retained and returned on
reads. **Special** refers to the status and mask rules below. **R0/W–** means that reads
return zero and writes have no action. A dash in the field column indicates no decoded
field in that word; the access column still applies. Bit numbers are inclusive, with bit
0 the least significant bit. Reset values are hexadecimal words.

| Address | Word | Access | Fields and bit positions | Reset |
|---|---|---|---|---|
| `08010354H` | `PMODE_LOW` | R/W | EN1 0; EN2 1; MMOD 5; AMOD 6; SLBG 7; ALP 8–15 | `00000000H` |
| `08010358H` | `PMODE_HIGH` | R/W | — | `00000000H` |
| `0801035CH` | `DISPFB1_LOW` | R/W | Base 0–8; width 9–14; storage 15–19 | `000FA000H` |
| `08010360H` | `DISPFB1_HIGH` | R/W | Source X 0–10; source Y 11–21 | `00000000H` |
| `08010364H` | `DISPLAY1_LOW` | R/W | Signal X 0–11; signal Y 12–22; X magnification 23–26; Y magnification 27–28 | `018252A8H` |
| `08010368H` | `DISPLAY1_HIGH` | R/W | Horizontal extent 0–11; vertical extent 12–22 | `000EF4FFH` |
| `0801036CH` | `DISPFB2_LOW` | R/W | Base 0–8; width 9–14; storage 15–19 | `000FA000H` |
| `08010370H` | `DISPFB2_HIGH` | R/W | Source X 0–10; source Y 11–21 | `00000000H` |
| `08010374H` | `DISPLAY2_LOW` | R/W | Signal X 0–11; signal Y 12–22; X magnification 23–26; Y magnification 27–28 | `018252A8H` |
| `08010378H` | `DISPLAY2_HIGH` | R/W | Horizontal extent 0–11; vertical extent 12–22 | `000EF4FFH` |
| `0801037CH` | `BGCOLOR_LOW` | R/W | Background color 0–23 | `00000000H` |
| `08010380H` | `BGCOLOR_HIGH` | R/W | — | `00000000H` |
| `080103ACH` | `SMODE1_LOW` | R/W | RC 0–2; LC 3–9; divider factor 10–11; CMOD 13–14; PRST 16; SINT 17; signal step X 21–24 | `40806504H` |
| `080103B0H` | `SMODE1_HIGH` | R/W | Vertical-unit selector 4 | `00000007H` |
| `080103B4H` | `SMODE2_LOW` | R/W | INT 0; FFMD 1 | `00000000H` |
| `080103B8H` | `SMODE2_HIGH` | R/W | — | `00000000H` |
| `080103BCH` | `SYNCH1_LOW` | R/W | HFP 0–10; HBP 11–21 | `1FC83030H` |
| `080103C0H` | `SYNCH1_HIGH` | R/W | HS 11–26 | `0007F5C2H` |
| `080103C4H` | `SYNCH2_LOW` | R/W | HF 0–10; HB 11–26 | `003484BCH` |
| `080103C8H` | `SYNCH2_HIGH` | R/W | — | `00000000H` |
| `080103CCH` | `SYNCV_LOW` | R/W | VFP 0–9; VFPE 10–19; VBP 20–31 | `02101404H` |
| `080103D0H` | `SYNCV_HIGH` | R/W | VBPE 0–9; VDP 10–20; VS 21–31 | `00A90005H` |
| `080103D4H` | `CSR_LOW` | Special | SIGNAL 0; FINISH 1; HSINT 2; VSINT 3; EDWINT 4; FLUSH 8; RESET 9; FIELD 13 | `551B4000H` |
| `080103D8H` | `CSR_HIGH` | R0/W– | — | `00000000H` |
| `080103DCH` | `IMR_LOW` | Special | Event masks 8–12; fixed-one bits 13–14 | `00007F00H` |
| `080103E0H` | `IMR_HIGH` | R0/W– | — | `00000000H` |

The high words of `CSR` and `IMR` cannot acknowledge events, change masks or issue
actions. Use their low words. Other high words marked R/W retain writes even where no
field is decoded.

## Beam timing

Timing uses a reference clock of 13,500,000 Hz. Define:

```text
H = HFP + HBP + HS + HF + HB
D = RC × (divider factor + 1)
U = 2 when SMODE1_HIGH[4] is one, otherwise 1

Half-line period = (H × D) / (2 × 13,500,000 × LC) seconds
Total half-lines = (VFP + VFPE + VBP + VBPE + VDP + VS) × U
Active-display half-lines = VDP × U
VSync half-line = (VDP + VFP + VFPE) × U
```

The vertical-unit selector thus scales the vertical field counts by one or two
half-lines. The divider factor uses its encoded value plus one; the other terms in these
formulas are their decoded field values.

Timing runs only when PRST and SINT are both zero and the half-line numerator,
denominator and total half-line count are all nonzero. Either stop control being set
stops timing. A zero timing term that makes one of those three quantities zero also
stops timing.

HSync points start at half-line 2 and repeat every two half-lines. While HSINT is
pending, subsequent HSync points do not create a new event request. Acknowledging HSINT
enables the next HSync point after the current half-line; elapsed points are not
replayed.

VBlank begins at the active-display half-line count. VSync occurs at the calculated
VSync half-line, and the field ends at the total half-line count. Within a field, VBlank
is inactive below the active-display count and active thereafter.

At VSync, `FIELD` toggles if CMOD is nonzero and VFP is odd. Otherwise, VSync sets
`FIELD` to one. VSync updates the selected scanout field and raises VSINT.

## Events, acknowledgement and IRQ masks

`CSR_LOW[4:0]` contains SIGNAL, FINISH, HSINT, VSINT and EDWINT. These bits are
write-one-to-clear: write one to acknowledge an event and zero to leave it unchanged.
`FIELD` is read at bit 13 and is not assigned by CSR writes. FLUSH and RESET are
actions, not latched CSR bits.

`IMR_LOW[12:8]` masks the five events in the same order: mask bit 8 corresponds to CSR
bit 0, through mask bit 12 for CSR bit 4. One masks an event; zero unmasks it. Writes
retain only these mask bits, force bits 13 and 14 to one, and clear the other bits.

A newly set event requests a PCRTC IRQ only if its mask is zero. Raising an event
already pending produces no new request. Unmasking a pending event requests an IRQ
immediately. PCRTC timing generates HSINT and VSINT. PCRTC requests reach the interrupt
controller as `IRQ_GX_PCRTC`, mask bit `00000002H`.

## RESET and FLUSH

Writing `CSR_LOW.RESET` clears GP0 input, resets GPU draw and display registers,
restores the complete PCRTC configuration and CSR/IMR reset values, and restarts the
beam. The reset scanout configuration is installed immediately. RESET takes priority if
RESET and FLUSH are written together.

FLUSH clears the GP0 input FIFO and partial command state without resetting PCRTC. It
can flush image-load data to VRAM; it is not a display reset.

## Programming cautions

- Program timing words with their immediate beam restart in mind. Each changed word
  restarts timing, including a changed `SYNCH2_HIGH` word with no decoded field.
- Acknowledge CSR events with an explicit bit mask. Writing back a read CSR word also
  acknowledges every other event bit returned as one.
- Account for pending events before unmasking them in IMR: the mask write itself can
  request an IRQ.
- RESET affects GPU drawing and command input as well as display configuration. FLUSH
  can transfer image-load data to VRAM without resetting the display registers.
