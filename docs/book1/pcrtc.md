# PCRTC Display Controller

## 1. OUTLINE

The PCRTC reads display images through two independent reading circuits and controls
their output geometry, background, display timing, and display-event interrupts. A
cartridge programs framebuffer selection and display windows, enables the required
circuits, and acknowledges the events it uses.

Each reading circuit has its own framebuffer selection, source position, signal
position, magnification, and window size. Output control selects the enabled circuits
and their composition settings.

```text
Local framebuffer ──► Reading circuit 1 ──┐
                     DISPFB1 / DISPLAY1  │
                                        ├──► Output control ──► Display output
Local framebuffer ──► Reading circuit 2 ──┤       PMODE
                     DISPFB2 / DISPLAY2  │         ▲
                                        └─────────┤
                                             Background
                                              BGCOLOR

Timing control ──► Signal coordinates and display cadence
SMODE1 / SMODE2 / SYNCH1 / SYNCH2 / SYNCV
       └────────► HSINT / VSINT / FIELD
```

PCRTC register words occupy four bytes. The composition registers start at `08010354H`;
the timing and status registers start at `080103ACH`. Use the individual addresses in
Section 4: the intervening addresses are not PCRTC registers.

## 2. FUNCTION

### 2.1. Framebuffer reading and display windows

For each circuit, set `DISPFB` to select the framebuffer and source origin. The base
field specifies a **local-memory word address in units of 4096 words**:

```text
Framebuffer base word address = base field × 4096
Framebuffer width             = width field × 64
Source origin                 = (source X, source Y)
```

Set `DISPLAY` to place and size the circuit in signal coordinates. Both magnification
fields and both extent fields use encoded-plus-one values:

```text
X magnification = encoded X magnification + 1
Y magnification = encoded Y magnification + 1
Horizontal span = horizontal extent + 1 signal units
Vertical height = vertical extent + 1

                   signal X                     signal X + extent + 1
                       │                                  │
 signal Y ─────────────┌──────────────────────────────────┐
                       │                                  │
                       │          Circuit window          │  vertical extent + 1
                       │                                  │
                       └──────────────────────────────────┘
                       ◄── horizontal extent + 1 ────────►
```

The horizontal interval includes its starting coordinate and excludes its ending
coordinate. Before conversion to output pixels, each horizontal boundary is rounded
upward to a signal-step boundary. `SMODE1_LOW[24:21]` sets the horizontal signal step.

With two circuits enabled, the output origin uses the minimum enabled signal X and
signal Y, and the output bounds cover both circuits. Pixel output requires running
timing, a nonzero horizontal signal step, and at least one enabled circuit.

### 2.2. Programmed words and displayed settings

Configuration registers retain complete written words. Readback returns the programmed
word immediately; it does not report whether that word has reached the display latch.

```text
Write a changed configuration word
                │
                ├──► Programmed word changes ──► Read returns the new word
                │
                └──► Wait for a VBlank presentation edge
                                      │
                                      ▼
                      Display latch takes the complete configuration
                                      │
                                      ▼
                         Display uses the latched settings
```

The display latch takes the configuration words together at a VBlank presentation edge.
Do not use immediate register readback as confirmation of display visibility. A
presentation edge between separate writes can take an intermediate configuration; the
writes themselves are not an atomic multiword update.

Writing an unchanged configuration word has no effect. A changed write to either
`SMODE1` word or any `SYNCH1`, `SYNCH2`, or `SYNCV` word also recalculates timing and
**restarts the beam immediately**. The display latch does not defer that restart.
Neither `SMODE2` word restarts the beam.

### 2.3. Interlaced reading

Set `SMODE2_LOW.INT` to select interlaced traversal. Interlaced output advances by two
rows; non-interlaced output advances by one. `FFMD` selects frame mode only while `INT`
is set.

For interlaced, non-frame operation:

```text
Source row stride = 2
Source row phase  = (display signal Y XOR FIELD) AND 1
```

In other modes, the source row stride is one and its phase is zero. Read `CSR_LOW.FIELD`
for the current field value. VSync updates this value as described beside the timing
registers.

### 2.4. Event and interrupt operation

The PCRTC timing events are HSINT and VSINT. CSR also supplies the named SIGNAL, FINISH,
and EDWINT event bits. All five events have a pending bit in CSR and a corresponding
mask bit in IMR.

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
not replayed.

## 3. SETTING EXAMPLE

### 3.1. Set a 256 × 192 window on circuit 1

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

After the display latch takes these settings, circuit 1 has the following geometry:

| Quantity | Result |
|---|---|
| Framebuffer base | Local-memory word address 0 |
| Framebuffer width | `16 × 64 = 1024` |
| Storage selection | GX16 |
| Source origin | `(32, 16)` |
| Horizontal signal interval | `[680, 1704)` |
| Reset horizontal signal step | 4 |
| Converted horizontal boundaries | `680 / 4 = 170`; `1704 / 4 = 426` |
| Output origin | `(0, 0)` |
| Output dimensions | **256 × 192** |
| Traversal | Non-interlaced |

Read back the three programmed words to check the settings. The display uses them when
the display latch takes the new configuration, as shown in Section 2.2.

### 3.2. Acknowledge stale HSINT and unmask only HSINT

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

## 4. REGISTER REFERENCE

`R/W` below means that the complete configuration word is retained and returned on read.
In its layout, `R` marks retained bits with no named operational field. These bits are
not a must-zero requirement. CSR and IMR instead use the per-bit access rules in their
entries.

### 4.1. PMODE — Circuit enables and output control

| Address | Name | Purpose | Access | Reset |
|---|---|---|---|---|
| `08010354H` | `PMODE_LOW` | Circuit enables and output controls | R/W | `00000000H` |
| `08010358H` | `PMODE_HIGH` | Retained high word | R/W | `00000000H` |

```text
LOW   31:16 | 15:8 |  7   |  6   |  5   | 4:2 |  1  |  0
        R   | ALP  | SLBG | AMOD | MMOD |  R  | EN2 | EN1
HIGH  31:0
        R
```

| Field | Setting |
|---|---|
| EN1, EN2 | 0: disable the corresponding reading circuit; 1: enable it |
| ALP | Eight-bit constant blend-alpha input, 0–255 |
| MMOD, AMOD, SLBG | Output-control selectors |

Program a circuit's `DISPFB` and `DISPLAY` words before enabling it. The circuit-1
setting in Section 3.1 supplies a complete PMODE word for that example.

### 4.2. DISPFB1 — Circuit 1 framebuffer

| Address | Name | Purpose | Access | Reset |
|---|---|---|---|---|
| `0801035CH` | `DISPFB1_LOW` | Framebuffer base, width, and storage selection | R/W | `000FA000H` |
| `08010360H` | `DISPFB1_HIGH` | Framebuffer source origin | R/W | `00000000H` |

```text
LOW   31:20 | 19:15  | 14:9  | 8:0
        R   | Storage| Width | Base
HIGH  31:22 | 21:11    | 10:0
        R   | Source Y | Source X
```

Base is in groups of 4096 local-memory words; width is in groups of 64 framebuffer
pixels. Source X and source Y specify the source origin.

| Storage selector | Circuit 1 format |
|---:|---|
| 0 | CT32 |
| 1 | CT24 |
| 2 | CT16 |
| 10 | CT16S |
| 18 | GPU24 |
| 31 | GX16 |

### 4.3. DISPLAY1 — Circuit 1 signal window

| Address | Name | Purpose | Access | Reset |
|---|---|---|---|---|
| `08010364H` | `DISPLAY1_LOW` | Signal origin and magnification | R/W | `018252A8H` |
| `08010368H` | `DISPLAY1_HIGH` | Signal-window extents | R/W | `000EF4FFH` |

```text
LOW   31:29 | 28:27 | 26:23 | 22:12    | 11:0
        R   | Y mag | X mag | Signal Y | Signal X
HIGH  31:23 | 22:12          | 11:0
        R   | Vertical extent| Horizontal extent
```

| Field | Actual setting |
|---|---|
| X magnification | Encoded value + 1; range 1–16 |
| Y magnification | Encoded value + 1; range 1–4 |
| Horizontal extent | Signal span = encoded value + 1 |
| Vertical extent | Height = encoded value + 1 |

Set signal X/Y for the window origin. Horizontal extents use signal units, not final
output-pixel counts; apply the signal-step boundary conversion in Section 2.1.

### 4.4. DISPFB2 — Circuit 2 framebuffer

| Address | Name | Purpose | Access | Reset |
|---|---|---|---|---|
| `0801036CH` | `DISPFB2_LOW` | Framebuffer base, width, and storage selection | R/W | `000FA000H` |
| `08010370H` | `DISPFB2_HIGH` | Framebuffer source origin | R/W | `00000000H` |

```text
LOW   31:20 | 19:15  | 14:9  | 8:0
        R   | Storage| Width | Base
HIGH  31:22 | 21:11    | 10:0
        R   | Source Y | Source X
```

Base is in groups of 4096 local-memory words; width is in groups of 64 framebuffer
pixels. Circuit 2 has its own source X/Y origin.

| Storage selector | Circuit 2 format |
|---:|---|
| 0 | CT32 |
| 1 | CT24 |
| 2 | CT16 |
| 10 | CT16S |
| 31 | GX16 |

### 4.5. DISPLAY2 — Circuit 2 signal window

| Address | Name | Purpose | Access | Reset |
|---|---|---|---|---|
| `08010374H` | `DISPLAY2_LOW` | Signal origin and magnification | R/W | `018252A8H` |
| `08010378H` | `DISPLAY2_HIGH` | Signal-window extents | R/W | `000EF4FFH` |

```text
LOW   31:29 | 28:27 | 26:23 | 22:12    | 11:0
        R   | Y mag | X mag | Signal Y | Signal X
HIGH  31:23 | 22:12          | 11:0
        R   | Vertical extent| Horizontal extent
```

The encoded-plus-one rules are the same as for circuit 1: X magnification is 1–16, Y
magnification is 1–4, and each extent specifies one less than the corresponding span or
height. Program this window independently; enabled circuit windows jointly determine the
output bounds.

### 4.6. BGCOLOR — Background color

| Address | Name | Purpose | Access | Reset |
|---|---|---|---|---|
| `0801037CH` | `BGCOLOR_LOW` | Background color input | R/W | `00000000H` |
| `08010380H` | `BGCOLOR_HIGH` | Retained high word | R/W | `00000000H` |

```text
LOW   31:24 | 23:0
        R   | Background color
HIGH  31:0
        R
```

Write the 24-bit background color in bits 23–0. PMODE controls the output composition
using the background and enabled reading circuits.

### 4.7. SMODE1 — Timing factors and signal step

| Address | Name | Purpose | Access | Reset |
|---|---|---|---|---|
| `080103ACH` | `SMODE1_LOW` | Timing factors, run controls, and horizontal signal step | R/W | `40806504H` |
| `080103B0H` | `SMODE1_HIGH` | Vertical-unit selection | R/W | `00000007H` |

```text
LOW   31:25 | 24:21  | 20:18 | 17   | 16   | 15 | 14:13 | 12 | 11:10   | 9:3 | 2:0
        R   | Step X |   R   | SINT | PRST | R  | CMOD  | R  | Divider | LC  | RC
HIGH  31:5 | 4 | 3:0
        R  | U |  R
```

RC, LC, and the divider field set the half-line period through the equations in Section
4.11. Step X is the number of horizontal signal units per output pixel; zero prevents
pixel output.

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

### 4.8. SMODE2 — Interlaced traversal

| Address | Name | Purpose | Access | Reset |
|---|---|---|---|---|
| `080103B4H` | `SMODE2_LOW` | Interlace and frame-mode controls | R/W | `00000000H` |
| `080103B8H` | `SMODE2_HIGH` | Retained high word | R/W | `00000000H` |

```text
LOW   31:2 |  1   |  0
        R  | FFMD | INT
HIGH  31:0
        R
```

| INT | FFMD | Traversal |
|---:|---:|---|
| 0 | Either | Non-interlaced; FFMD does not select frame mode |
| 1 | 0 | Interlaced, non-frame mode |
| 1 | 1 | Interlaced, frame mode |

Use the source stride and phase rules in Section 2.3. Writes to these words follow the
display-latch rule without restarting the beam.

### 4.9. SYNCH1 — Horizontal timing counts

| Address | Name | Purpose | Access | Reset |
|---|---|---|---|---|
| `080103BCH` | `SYNCH1_LOW` | HFP and HBP counts | R/W | `1FC83030H` |
| `080103C0H` | `SYNCH1_HIGH` | HS count | R/W | `0007F5C2H` |

```text
LOW   31:22 | 21:11 | 10:0
        R   | HBP   | HFP
HIGH  31:27 | 26:11 | 10:0
        R   | HS    | R
```

HFP, HBP, and HS contribute horizontal timing counts to H. Their time scale is set by
RC, LC, and the divider, not by the output-pixel magnification fields. A changed write
to either word recalculates timing and restarts the beam.

### 4.10. SYNCH2 — Additional horizontal timing counts

| Address | Name | Purpose | Access | Reset |
|---|---|---|---|---|
| `080103C4H` | `SYNCH2_LOW` | HF and HB counts | R/W | `003484BCH` |
| `080103C8H` | `SYNCH2_HIGH` | Retained timing high word | R/W | `00000000H` |

```text
LOW   31:27 | 26:11 | 10:0
        R   | HB    | HF
HIGH  31:0
        R
```

HF and HB complete the horizontal sum H. **Changing `SYNCH2_HIGH` also restarts the
beam**, although its bits have no named timing field. Writing its current value does not
restart it.

### 4.11. SYNCV — Vertical timing and beam phases

| Address | Name | Purpose | Access | Reset |
|---|---|---|---|---|
| `080103CCH` | `SYNCV_LOW` | VFP, VFPE, and VBP counts | R/W | `02101404H` |
| `080103D0H` | `SYNCV_HIGH` | VBPE, VDP, and VS counts | R/W | `00A90005H` |

```text
LOW   31:20 | 19:10 | 9:0
        VBP | VFPE  | VFP
HIGH  31:21 | 20:10 | 9:0
        VS  | VDP   | VBPE
```

These fields count vertical units. Multiplying by U converts them to half-lines. VDP
sets the active-display interval. VFP and VFPE place VSync after that interval; all six
fields determine field length. A changed write to either word restarts the beam.

The timing reference clock is **13,500,000 Hz**. Use the following relationships:

```text
H = HFP + HBP + HS + HF + HB
D = RC × (divider field + 1)

Half-line period = (H × D) / (2 × 13,500,000 × LC) seconds

Active-display half-lines = VDP × U
VSync half-line           = (VDP + VFP + VFPE) × U
Total half-lines          = (VFP + VFPE + VBP + VBPE + VDP + VS) × U
```

A beam restart begins at half-line zero. The first HSync event point follows at
half-line two. CSR event bits and FIELD are unchanged.

At reset, H = 3456, D = 8, LC = 32, and U = 1. The half-line period is therefore `27648
/ 864000000` seconds. The reset beam sequence is:

```text
Half-line    0       2       4       ...       576       585        628
             │       │       │                 │         │          │
             Start   HSync   HSync             │         │          │
             ├──── Active-display interval ────┤         │          │
             │                                 ├── VBlank-active ──┤
             │                                 │         │          │
             │                            VBlank begin   │       Field end
             │                                       VSync       Return to 0
             │                                       VSINT
```

The reset vertical counts are VDP = 576, VFP = 4, VFPE = 5, VBP = 33, VBPE = 5, and VS =
5. VBlank-active is false below half-line 576 and true for the remainder of the field.

At VSync, nonzero CMOD together with odd VFP toggles FIELD; otherwise FIELD becomes one.
Reset VFP is even: reset FIELD is zero, and the first VSync sets it to one. VSync also
raises VSINT.

### 4.12. CSR — Event acknowledgement, field status, and actions

| Address | Name | Purpose | Access | Reset |
|---|---|---|---|---|
| `080103D4H` | `CSR_LOW` | Event status, acknowledgements, FIELD, FLUSH, and RESET | Read; W1C events; write actions | `551B4000H` |
| `080103D8H` | `CSR_HIGH` | Zero high word | Read zero; writes have no action | `00000000H` |

```text
LOW   31:14 | 13    | 12:10 | 9     | 8     | 7:5 | 4      | 3     | 2     | 1      | 0
         —  | FIELD |   —   | RESET | FLUSH |  —  | EDWINT | VSINT | HSINT | FINISH | SIGNAL
HIGH  31:0
        Read zero; writes have no action
```

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
an explicit acknowledgement mask, as in Section 3.2.

FLUSH clears the GP0 input FIFO and partial command state. It can flush image-load data
to local video memory without resetting PCRTC. Do not use FLUSH as a display reset.

RESET takes priority when RESET and FLUSH are requested together. It clears GP0 input,
resets GPU draw/display registers, restores the PCRTC configuration and CSR/IMR reset
values, and restarts the beam. Reset display settings take effect immediately. Both
reading circuits are then disabled.

### 4.13. IMR — PCRTC event masks

| Address | Name | Purpose | Access | Reset |
|---|---|---|---|---|
| `080103DCH` | `IMR_LOW` | Five event masks and fixed read bits | R/W masks; fixed bits as below | `00007F00H` |
| `080103E0H` | `IMR_HIGH` | Zero high word | Read zero; writes have no action | `00000000H` |

```text
LOW   31:15 | 14:13 | 12          | 11         | 10         | 9           | 8           | 7:0
       Zero | Ones  | EDWINT mask | VSINT mask | HSINT mask | FINISH mask | SIGNAL mask | Zero
HIGH  31:0
        Read zero; writes have no action
```

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
the mask–acknowledge–unmask sequence in Section 3.2 when enabling HSINT.
