# PCRTC fact sheet

Editorial input for one hardware-manual chapter; not chapter prose. Source scope:
the mirrored PCRTC spec/address leaves and live owners; required GPU command-buffer
and runtime VBlank callsites; local-memory addressing and TS/C++ software scanout;
and the mapped-memory/CPU owners needed to establish PCRTC access and faults.
No architecture document or reference PDF was used. The existing timing facts
include `ed2ceff96` (`retain PCRTC frame period as raw u32`).

**Editorial authority:** at the user's explicit direction, matching TS/C++
software composition is the manual's pixel-behavior authority. The independently
corrected WebGPU constant-blend coefficient and its GPU regression evidence are
recorded in [the backend correction note](../reviews/pcrtc-webgpu-constant-blend.md),
not as alternate hardware behavior. This editorial slice changes no runtime. No disagreement was
found between the inspected spec definitions and TS/C++ software/device facts.

## Register words

- A PCRTC register word occupies four bytes; a local-memory word is two bytes
  as established below. PCRTC indices 0–11 use
  `IO_GX_PCRTC_BASE + index * 4`; indices 12–25 use
  `IO_GX_PCRTC_TIMING_BASE + (index - 12) * 4`. The bases evaluate to
  `08010354H` and `080103ACH`; ten intervening words belong to the GTE-plus
  region, not this register file. Sources: [address function][addr-ts],
  [mirror][addr-cpp], [I/O layout][io-layout-ts], [mirror][io-layout-cpp],
  [base expressions][io-base-ts], [mirror][io-base-cpp], [word size][word-ts],
  [mirror][word-cpp], [I/O base][memory-base-ts], [mirror][memory-base-cpp].
- The first 22 words retain complete written words and return those words on
  reads. `CSR_LOW` and `IMR_LOW` have the special access rules below.
  `CSR_HIGH` and `IMR_HIGH` read zero; writes to these two words have no action
  in the GPU write dispatcher. All 26 addresses have read and write mappings.
  Sources: [read/config write][read-write-ts], [mirror][read-write-cpp],
  [dispatch][dispatch-ts], [mirror][dispatch-cpp], [mapping][mapping-ts],
  [mirror][mapping-cpp].
- Table names/indices and reset constants: [spec][leaf-ts], [mirror][leaf-cpp].
  Reset installs both the register and presentation copies of the 22-word
  configuration, and restores CSR/IMR. Sources: [reset][reset-ts],
  [mirror][reset-cpp]. In the table, **R/W** means retained raw word;
  **special** means the access rules below, and **R0/W–** means read zero,
  write has no action. A dash in decoded fields means no field of that word
  is decoded by these owners; it is not a reserved-bit programming rule.

| Index | Address | Name | Access | Decoded fields | Reset |
|---:|---|---|---|---|---|
| 0 | `08010354H` | `PMODE_LOW` | R/W | EN1 0; EN2 1; MMOD 5; AMOD 6; SLBG 7; ALP 8–15 | `00000000H` |
| 1 | `08010358H` | `PMODE_HIGH` | R/W | — | `00000000H` |
| 2 | `0801035CH` | `DISPFB1_LOW` | R/W | base 0–8; width 9–14; storage 15–19 | `000FA000H` |
| 3 | `08010360H` | `DISPFB1_HIGH` | R/W | source X 0–10; source Y 11–21 | `00000000H` |
| 4 | `08010364H` | `DISPLAY1_LOW` | R/W | signal X 0–11; signal Y 12–22; X magnification 23–26; Y magnification 27–28 | `018252A8H` |
| 5 | `08010368H` | `DISPLAY1_HIGH` | R/W | horizontal extent 0–11; vertical extent 12–22 | `000EF4FFH` |
| 6 | `0801036CH` | `DISPFB2_LOW` | R/W | same fields as `DISPFB1_LOW` | `000FA000H` |
| 7 | `08010370H` | `DISPFB2_HIGH` | R/W | same fields as `DISPFB1_HIGH` | `00000000H` |
| 8 | `08010374H` | `DISPLAY2_LOW` | R/W | same fields as `DISPLAY1_LOW` | `018252A8H` |
| 9 | `08010378H` | `DISPLAY2_HIGH` | R/W | same fields as `DISPLAY1_HIGH` | `000EF4FFH` |
| 10 | `0801037CH` | `BGCOLOR_LOW` | R/W | background color 0–23 | `00000000H` |
| 11 | `08010380H` | `BGCOLOR_HIGH` | R/W | — | `00000000H` |
| 12 | `080103ACH` | `SMODE1_LOW` | R/W | RC 0–2; LC 3–9; divider factor 10–11; CMOD 13–14; PRST 16; SINT 17; signal step X 21–24 | `40806504H` |
| 13 | `080103B0H` | `SMODE1_HIGH` | R/W | vertical-unit selector 4 | `00000007H` |
| 14 | `080103B4H` | `SMODE2_LOW` | R/W | INT 0; FFMD 1 | `00000000H` |
| 15 | `080103B8H` | `SMODE2_HIGH` | R/W | — | `00000000H` |
| 16 | `080103BCH` | `SYNCH1_LOW` | R/W | HFP 0–10; HBP 11–21 | `1FC83030H` |
| 17 | `080103C0H` | `SYNCH1_HIGH` | R/W | HS 11–26 | `0007F5C2H` |
| 18 | `080103C4H` | `SYNCH2_LOW` | R/W | HF 0–10; HB 11–26 | `003484BCH` |
| 19 | `080103C8H` | `SYNCH2_HIGH` | R/W | — | `00000000H` |
| 20 | `080103CCH` | `SYNCV_LOW` | R/W | VFP 0–9; VFPE 10–19; VBP 20–31 | `02101404H` |
| 21 | `080103D0H` | `SYNCV_HIGH` | R/W | VBPE 0–9; VDP 10–20; VS 21–31 | `00A90005H` |
| 22 | `080103D4H` | `CSR_LOW` | special | SIGNAL 0; FINISH 1; HSINT 2; VSINT 3; EDWINT 4; FLUSH 8; RESET 9; FIELD 13 | `551B4000H` |
| 23 | `080103D8H` | `CSR_HIGH` | R0/W– | — | `00000000H` |
| 24 | `080103DCH` | `IMR_LOW` | special | event masks 8–12; fixed one bits 13–14 | `00007F00H` |
| 25 | `080103E0H` | `IMR_HIGH` | R0/W– | — | `00000000H` |

Decoded-field sources for rows 0–11: [circuit decode][circuit-ts],
[mirror][circuit-cpp], [display extents][extents-ts], [mirror][extents-cpp],
[background/interlace][mode-ts], [mirror][mode-cpp], [blend selectors][blend-ts],
[mirror][blend-cpp]. Rows 12–21: [timing decode][timing-ts],
[mirror][timing-cpp]. Rows 22–25: [bit constants][bits-ts],
[mirror][bits-cpp], [CSR/IMR writes][status-write-ts],
[mirror][status-write-cpp], [reads][read-write-ts], [mirror][read-write-cpp].

## Configuration writes and visible copies

- A changed configuration write immediately replaces its retained register
  word and marks presentation words dirty. Writing the same word has no
  effect. The beam-timing words are both `SMODE1` words and all six `SYNCH1`,
  `SYNCH2`, `SYNCV` words. A changed write to any of those immediately
  recomputes beam timing and restarts the beam; neither `SMODE2` word is in
  this set. Sources: [write][read-write-ts], [mirror][read-write-cpp],
  [timing-word set][timing-set-ts], [mirror][timing-set-cpp].
- Beam restart sets the beam cycle to the write cycle, remainder and half-line
  to zero, next HSync half-line to two, vertical stage to VBlank-begin, and
  VBlank-active to false. It does not write CSR FIELD or event bits.
  Sources: [restart][restart-ts], [mirror][restart-cpp].
- The presentation latch copies all 22 retained configuration words to the
  presentation words together, updates presentation timing when a beam-timing
  word changed, clears the dirty flags, and publishes scanout configuration.
  Sources: [latch][latch-ts], [mirror][latch-cpp], [publication][publish-ts],
  [mirror][publish-cpp].
- The normal presentation latch occurs on **VBlank entry**, not field end.
  PCRTC service reports VBlank-begin at the active-display boundary; GPU
  service forwards the edge, and timer dispatch sends it to VBlank handling.
  VBlank-begin invokes presentation, which calls the latch; VBlank-end is
  ignored by that handler. Presentation precedes the system VBlank IRQ
  request. Sources: [service][service-ts], [mirror][service-cpp],
  [forwarding][forward-ts], [mirror][forward-cpp], [timer dispatch][timer-ts],
  [mirror][timer-cpp], [VBlank handler][vblank-ts], [mirror][vblank-cpp],
  [latch call][presentation-ts], [mirror][presentation-cpp]. PCRTC reset is
  an exception to waiting for that edge: it installs both copies and publishes
  reset configuration immediately. Sources: [reset][reset-ts], [mirror][reset-cpp].
- A timing write changes live beam timing immediately, but displayed scanout
  still consumes the retained presentation timing until that timing is latched.
  Stopping the beam suppresses its timing service; it does **not** immediately
  clear the previously published scanout. Source-derived owner witness: after
  enabling/latching circuit 1, setting SMODE1.PRST leaves live `timing.running`
  false and `nextDeadlineCycle()` at -1 while displayed `scanout.outputActive`
  remains true. Do not promise immediate blanking from a beam-stop write.
  Sources: [live timing write][read-write-ts], [mirror][read-write-cpp],
  [stopped deadline][deadline-ts], [mirror][deadline-cpp],
  [latched timing][latch-ts], [mirror][latch-cpp],
  [published scanout source][publish-ts], [mirror][publish-cpp].

## Circuit datapath facts

- There are two circuits. `PMODE_LOW` bits 0 and 1 enable circuits 1 and 2
  respectively. Each circuit independently decodes its `DISPFB` and `DISPLAY`
  words. The framebuffer base word is the nine-bit base field shifted left
  by 12; width is the six-bit width field multiplied by 64; source X/Y are
  the two eleven-bit fields. Magnification is each encoded field plus one.
  Sources: [decode][circuit-ts], [mirror][circuit-cpp].
- A circuit's horizontal signal interval is `[signal X, signal X + horizontal
  extent + 1)`. Its vertical height is vertical extent plus one. Horizontal
  boundaries are rounded upward to signal-step boundaries before conversion
  to output pixels. The output origin uses the minimum enabled signal X/Y;
  output bounds cover both enabled circuits. The displayed scanout is active
  only when its **latched presentation timing** runs, its signal step X is
  nonzero, and a circuit is enabled. These are presentation-state conditions,
  not a guarantee that stopping the live beam immediately blanks an already
  latched display. Sources: [activation/crop/extents][extents-ts],
  [mirror][extents-cpp], [output bounds][bounds-ts], [mirror][bounds-cpp],
  [presentation timing/publication][latch-ts], [mirror][latch-cpp],
  [scanout update][publish-ts], [mirror][publish-cpp].
- `BGCOLOR_LOW[23:0]` becomes the background color; `PMODE_LOW[15:8]` becomes
  the constant blend alpha. `SMODE2_LOW.INT` selects interlaced traversal;
  FFMD selects frame mode only when INT is set. Interlaced output advances
  by two rows, otherwise one. In interlaced non-frame mode, source stride is
  two and source phase is `(display signal Y XOR FIELD) AND 1`; otherwise
  source stride is one and phase zero. Sources: [decode][mode-ts],
  [mirror][mode-cpp], [field changes][field-ts], [mirror][field-cpp].
## Local-memory words, sampling and address layout

- Local memory contains `00200000H` bytes = `00100000H` sixteen-bit words in
  the installed model. A local-memory word is **two bytes**, low byte first,
  unlike a four-byte PCRTC register word. Sources: [model][model-ts],
  [mirror][model-cpp], [word allocation][vram-state-ts], [mirror][vram-state-cpp],
  [byte loading][vram-load-ts], [mirror][vram-load-cpp],
  [address geometry][vram-spec-ts], [mirror][vram-spec-cpp].
- `FBP` is the nine-bit base field. `B = FBP << 12` local-memory words, so
  one FBP unit is 4096 words = 8192 bytes (`00002000H`). `P` is the six-bit
  FBW field, and `W = 64 * P` pixels. FBW zero supplies zero row stride for
  GX16 or zero pages-per-row for the tiled formats; it does not disable the
  circuit or raise an addressing exception in these functions. Sources:
  [base/width decode][circuit-ts], [mirror][circuit-cpp],
  [addressing][address-layout-ts], [mirror][address-layout-cpp],
  [word size][vram-load-ts], [mirror][vram-load-cpp].
- Format dispatch and packing are as follows. `A` is the mapped local-memory
  word address, `L` the word at A, `H` the word at A+1. Channels are unsigned
  eight-bit sample values. Source selectors: [constants][formats-ts],
  [mirror][formats-cpp], [dispatch][storage-ts], [mirror][storage-cpp].
  Packing: [sample functions][sample-ts], [mirror][sample-cpp],
  [RGB555 palette][palette-ts], [mirror][palette-cpp],
  [five-bit expansion][expand-ts], [mirror][expand-cpp].

  | Selector | Format | Circuit availability | RGB sample | Sample alpha |
  |---:|---|---|---|---|
  | 0 | CT32 | 1 and 2 | R=L[7:0], G=L[15:8], B=H[7:0] | H[15:8] |
  | 1 | CT24 | 1 and 2 | same placement as CT32; H[15:8] ignored | 128 |
  | 2 | CT16 | 1 and 2 | R=L[4:0], G=L[9:5], B=L[14:10], each expanded | 128 when L[15]=1, otherwise 0 |
  | 10 | CT16S | 1 and 2 | same packing as CT16; different address layout | 128 when L[15]=1, otherwise 0 |
  | 18 | GPU24 | 1 only | packed byte sequence described below | 128 |
  | 31 | GX16 | 1 and 2 | same packing as CT16; linear address layout | 128 when L[15]=1, otherwise 0 |
  | other; or 18 on circuit 2 | zero sample | both remain enabled as programmed | R=G=B=0 | 0 |

- A five-bit component `c` expands as `(c << 3) | (c >> 2)`, not a shift
  alone. Sources: [expansion][expand-ts], [mirror][expand-cpp].
- GPU24 reads words L and H from CT16-mapped coordinates
  `((3*x) >> 1) + k, y`, with k=0 and 1 respectively. Even x:
  R=L[7:0], G=L[15:8], B=H[7:0]. Odd x:
  R=L[15:8], G=H[7:0], B=H[15:8]. Sources:
  [GPU24 address][address-layout-ts], [mirror][address-layout-cpp],
  [sample][sample-ts], [mirror][sample-cpp].
- Zero sampling means RGBA=(0,0,0,0), not no operation and not a disabled
  circuit. Its result follows PMODE: raw RGB clears RGB but preserves prior
  alpha; raw RGBA clears all channels; source-alpha blending leaves prior
  RGB, while AMOD=0 selects the zero source alpha. Sources:
  [selector dispatch][storage-ts], [mirror][storage-cpp],
  [zero RGB][zero-ts], [zero RGBA][zero-rgba-ts],
  [zero source blend][zero-source-ts], [zero source alpha][zero-source-rgba-ts],
  [mirror][sample-cpp],
  [operations][generic-ops-ts], [mirror][generic-ops-cpp],
  [selection][blend-ts], [mirror][blend-cpp].

### Address formulas

These are source-equivalent integer/bit formulas. `x,y` are framebuffer sample
coordinates after the circuit's source-origin/magnification/field calculation;
`>>` denotes unsigned right shift here. `B,P,W` are defined above.
All returned addresses are local-memory word indices, not byte addresses.

- The logical mask is `M = 000FFFFFH`. Every word fetch also masks with
  installed word count minus one, equal to M for the installed model. Thus
  base-plus-offset wraps, and CT32/CT24's second word wraps too. FBP values
  above the installed period are not rejected. Sources:
  [logical geometry][vram-spec-ts], [mirror][vram-spec-cpp],
  [address functions][address-layout-ts], [mirror][address-layout-cpp],
  [word fetch][word-fetch-ts], [mirror][word-fetch-cpp],
  [allocation][vram-state-ts], [mirror][vram-state-cpp],
  [model][model-ts], [mirror][model-cpp].
- CT32 and CT24 use the following address calculation. Sources:
  [CT32/24 address][address32-ts], [mirror][address32-cpp].

  ```text
  page   = (y >> 5) * P + (x >> 6)
  px     = x & 63; py = y & 31
  bx     = px >> 3; by = py >> 3
  block  = (bx & 1) | ((by & 1) << 1) | ((bx & 2) << 1)
         | ((by & 2) << 2) | ((bx & 4) << 2)
  column = (px & 1) | ((py & 1) << 1) | ((px & 6) << 1)
         | ((py & 6) << 3)
  A      = (B + (page << 12) + (block << 7) + (column << 1)) & M
  ```

- CT16 and CT16S share page and column calculations but use different
  block calculations. Sources: [CT16/16S address][address16-ts],
  [mirror][address16-cpp].

  ```text
  page   = (y >> 6) * P + (x >> 6)
  px     = x & 63; py = y & 63
  bx     = px >> 4; by = py >> 3
  column = ((px & 1) << 1) | ((px & 2) << 2) | ((px & 4) << 2)
         | ((px & 8) >> 3) | ((py & 1) << 2) | ((py & 2) << 4)
         | ((py & 4) << 4)
  CT16 block  = ((bx & 1) << 1) | (by & 1) | ((bx & 2) << 2)
              | ((by & 2) << 1) | ((by & 4) << 2)
  CT16S block = (by & 1) | ((bx & 1) << 1) | (by & 4)
              | ((by & 2) << 2) | ((bx & 2) << 3)
  A      = (B + (page << 12) + (block << 7) + column) & M
  ```

- GX16 is linear: `A = (B + y * W + x) & M`. GPU24 uses the CT16 address
  formula at the two coordinates specified above. Sources:
  [GX16/GPU24 address][address-linear-ts], [mirror][address-linear-cpp].

## PMODE composition and channel arithmetic

- Composition supplies background where needed, then circuit 2, then circuit 1.
  Background R=BGCOLOR_LOW[7:0], G=[15:8], B=[23:16], alpha=0.
  A disabled circuit performs no operation. Operations apply only inside the
  circuit's own display rectangle and selected field rows, not the whole
  output. Sources: [background decode][mode-ts], [mirror][mode-cpp],
  [background/order][composition-ts], [mirror][composition-cpp],
  [background fill][background-cpp], [windowed operations][generic-ops-ts],
  [mirror][generic-ops-cpp], [enable/operation selection][blend-ts],
  [mirror][blend-cpp].
- Circuit 2 actions are the following. Prior RGB/alpha are the background
  values at the pixel. Sources: [selector producer][blend-ts],
  [mirror][blend-cpp], [raw RGB/RGBA/alpha actions][raw-ops-ts],
  [mirror][generic-ops-cpp].

  | SLBG | AMOD | RGB after circuit 2 | Alpha after circuit 2 |
  |---:|---:|---|---|
  | 0 | 0 | circuit-2 RGB | background alpha 0 |
  | 0 | 1 | circuit-2 RGB | circuit-2 sample alpha |
  | 1 | 0 | background RGB | background alpha 0 |
  | 1 | 1 | background RGB | circuit-2 sample alpha |

- Circuit 1 actions are the following. `D` and `Ad` mean the prior RGB
  component and alpha after background/circuit 2 at this pixel; `C1` and
  `A1` are circuit-1 sample channels. Sources: [selector producer][blend-ts],
  [mirror][blend-cpp], [source-alpha operations][source-ops-ts],
  [constant operations][constant-ops-ts], [mirror operations][generic-ops-cpp].

  | MMOD | ALP | RGB action | Alpha when AMOD=0 | Alpha when AMOD=1 |
  |---:|---|---|---|---|
  | 0 | ignored | blend C1 over D with a=min(2*A1,255) | A1 unchanged | Ad unchanged |
  | 1 | 0 | retain D | A1 unchanged | Ad unchanged |
  | 1 | 1–254 | blend C1 over D with a=ALP | A1 unchanged | Ad unchanged |
  | 1 | 255 | select C1 | A1 unchanged | Ad unchanged |

- For each eight-bit R, G, B component independently:
  `output = integer_quotient(C1*a + D*(255-a) + 127, 255)`.
  The nonnegative quotient rounds the weighted sum to nearest. Inputs and
  coefficient are in 0..255, so the resulting RGB also lies in 0..255;
  no additional channel saturation is applied. MMOD=0 doubles the source
  alpha and saturates the **coefficient** at 255; MMOD=1 uses the eight-bit
  ALP directly, without doubling. Output alpha is selected, not blended
  with this equation. Sources: [RGB equation][blend-equation-ts],
  [mirror][blend-equation-cpp], [coefficient/alpha][source-ops-ts],
  [mirror][generic-ops-cpp], [constant coefficient][constant-ops-ts].
- In particular, A1=128 gives coefficient 255 with MMOD=0, but selected
  output alpha remains 128 with AMOD=0. CT24/GPU24 samples and sixteen-bit
  samples with bit15 set can therefore supply full source RGB without
  alpha255. AMOD=1 preserves alpha0 where circuit 2 supplies no alpha,
  even if circuit 1 supplies RGB. Sources: [sampling][sample-ts],
  [mirror][sample-cpp], [palette][palette-ts], [mirror][palette-cpp],
  [alpha selection][source-ops-ts], [mirror][generic-ops-cpp],
  [background/order][composition-ts], [mirror][composition-cpp].

## Timing and events

- The timing datapath uses a `13,500,000` reference clock. Let `H` be
  `HFP + HBP + HS + HF + HB`, `D` be `RC * (divider factor + 1)`, and
  `U` be two when `SMODE1_HIGH[4]` is one, otherwise one. Half-line period
  numerator is `H * D`; denominator is `2 * 13,500,000 * LC`.
  Total half-lines are `(VFP + VFPE + VBP + VBPE + VDP + VS) * U`;
  active-display half-lines are `VDP * U`; the VSync half-line is
  `(VDP + VFP + VFPE) * U`. Sources: [clock][clock-ts], [mirror][clock-cpp],
  [timing formulas][timing-ts], [mirror][timing-cpp].
- Timing runs only if both PRST and SINT are zero and the half-line
  numerator, denominator, and total half-lines are all nonzero. Otherwise
  refresh and both frame-duration values become zero; no PCRTC service
  deadline is returned. Source: [run condition][timing-ts],
  [mirror][timing-cpp], [stopped values][duration-ts], [mirror][duration-cpp],
  [deadline][deadline-ts], [mirror][deadline-cpp].
- With timing running, scaled refresh is the integer quotient
  `halfLineClockDenominator * 1,000,000 / (halfLineClockNumerator * totalHalfLines)`.
  The retained `frameDurationMillisecondsQ16` is the low 32 bits of the
  integer quotient `65,536,000,000,000 / scaled refresh`. The separate
  `frameDurationMs` is `1000 / (scaled refresh / 1,000,000)` and is not
  reconstructed from the retained Q16 word. These are owner-derived timing
  values, not additional PCRTC registers. Sources: [scale/numerator][scale-ts],
  [mirror][scale-cpp], [duration calculations][duration-ts],
  [mirror][duration-cpp].
- Evaluated diagnostic case, not a register/reset claim: begin with reset
  configuration and replace `SMODE1_LOW/HIGH` with `00200C0FH/00000010H`,
  `SYNCH1_LOW/HIGH` with `003FFFFFH/07FFF800H`, `SYNCH2_LOW` with
  `07FFFFFFH`, and `SYNCV_LOW/HIGH` with `FFFFFFFFH/FFFFFFFFH`. The
  calculations above give scaled refresh `312`, Q16 word `3892851843`, and
  separate full duration `3205128.205128205 ms`. Sources: [reset inputs][leaf-ts],
  [mirror][leaf-cpp], [calculations][duration-ts], [mirror][duration-cpp].
- Device deadlines use the rational half-line period converted to system
  cycles, including the retained remainder; a fractional cycle rounds the
  deadline upward. Servicing late advances from the retained beam epoch,
  not from the service cycle. Sources: [period/deadline][period-ts],
  [mirror][period-cpp], [service epoch][service-ts], [mirror][service-cpp].
- HSync's first scheduled point is half-line 2, then every two half-lines.
  While HSINT is pending, HSync does not select the next service deadline.
  Clearing a pending HSINT resumes at the first scheduled HSync point after
  the current half-line, skipping suppressed points. Sources: [restart][restart-ts],
  [mirror][restart-cpp], [deadline][deadline-ts], [mirror][deadline-cpp],
  [service][service-ts], [mirror][service-cpp], [CSR clear][status-write-ts],
  [mirror][status-write-cpp], [resume/skip][resume-ts], [mirror][resume-cpp].
- Vertical events use active-display half-lines for VBlank begin, the
  computed VSync half-line for VSync, and total half-lines for field end.
  Service catches up crossed periodic events. Its final within-field beam
  position determines VBlank-active: false below active-display half-lines,
  true thereafter. It reports VBlank-begin when any such crossing occurred;
  otherwise it reports VBlank-end when a field-end crossing occurred.
  Sources: [vertical events][vertical-ts], [mirror][vertical-cpp],
  [service/result][service-ts], [mirror][service-cpp].
- At VSync, FIELD toggles when CMOD is nonzero and VFP is odd; for multiple
  crossed VSyncs it toggles only on an odd count. Otherwise FIELD is set to
  one. The selected scanout field is updated, and VSINT is raised.
  Sources: [toggle condition][duration-ts], [mirror][duration-cpp],
  [VSync action][service-ts], [mirror][service-cpp].

## CSR, IRQ, reset and flush

- CSR event bits 0–4 are write-one-to-clear. Writing zero leaves an event
  unchanged. FIELD is read from bit 13 and is not assigned by CSR writes.
  FLUSH and RESET are returned as actions, not latched into CSR.
  Sources: [CSR write][status-write-ts], [mirror][status-write-cpp],
  [FIELD read][field-read-ts], [mirror][field-read-cpp], [bit masks][bits-ts],
  [mirror][bits-cpp].
- IMR writes retain only event-mask bits 8–12, force bits 13 and 14 to one,
  and clear other bits. Each mask corresponds to the CSR event eight bit
  positions below it: one masks, zero unmasks. Unmasking an already pending
  event requests a PCRTC IRQ immediately. Sources: [IMR write][status-write-ts],
  [mirror][status-write-cpp], [dispatch IRQ][dispatch-ts],
  [mirror][dispatch-cpp], [event raise][raise-ts], [mirror][raise-cpp].
- Raising an event whose CSR bit is already set produces no new request.
  A newly set event requests an IRQ only when its corresponding IMR bit is
  zero. PCRTC service generates HSINT and VSINT. The GPU forwards its IRQ
  request to `IRQ_GX_PCRTC`, the interrupt-controller mask bit `00000002H`.
  Sources: [event raise][raise-ts], [mirror][raise-cpp], [service][service-ts],
  [mirror][service-cpp], [forwarding][forward-ts], [mirror][forward-cpp],
  [IRQ constant][irq-ts], [mirror][irq-cpp].
- SIGNAL, FINISH and EDWINT are named bits 0, 1 and 4, but **normal device
  execution has no producer for them** in the searched mirrored machine/spec
  trees. The complete CSR mutation surface is reset, CSR W1C, FIELD updates,
  private event raising, and retained-state restoration; the only event-raise
  callsites pass HSINT and VSINT. These three events remain clear after reset
  during normal device execution. Do not call them hardwired zero: arbitrary
  restored pending bits remain retained, W1C and maskable, including the
  immediate-unmask IRQ rule. No draw-completion timing is implied by their
  names. Sources: [bits/reset][bits-ts], [mirror][bits-cpp],
  [reset][reset-ts], [mirror][reset-cpp], [W1C/masks][status-write-ts],
  [mirror][status-write-cpp], [all event callsites][service-ts],
  [mirror][service-cpp], [private event setter][raise-ts], [mirror][raise-cpp],
  [retained restoration][restore-ts], [mirror][restore-cpp].
- A CSR RESET action takes priority over FLUSH when both are written.
  RESET calls the GP0 clearing path, applies the bounded GPU-register reset
  listed below, restores the complete PCRTC configuration plus CSR/IMR,
  restarts the beam,
  and publishes reset scanout configuration immediately. The GPU then latches
  its presentation registers and marks presentation pending. Sources:
  [action dispatch][dispatch-ts], [mirror][dispatch-cpp],
  [GPU register reset][gpu-reset-ts], [mirror][gpu-reset-cpp],
  [PCRTC reset][reset-ts], [mirror][reset-cpp].
- FLUSH uses the same GP0 clearing path as RESET, without resetting PCRTC
  or GPU draw/display registers. Both actions drop DMA ingress and GP0 FIFO
  contents, clear partial command/polyline parsing state and pending command
  timing, and terminate readback. This is **not** a general cancellation or
  undo of accepted rendering. Sources: [action dispatch][dispatch-ts],
  [mirror][dispatch-cpp], [common clearing path][flush-ts], [mirror][flush-cpp],
  [parser reset][parser-clear-ts], [mirror][parser-clear-cpp],
  [readback cancellation][abort-ts], [mirror][abort-cpp].
- The exhaustive command-buffer cancellation cases are below. The common
  path then marks a pending accepted raster/upload target complete only if
  it is still retained; it clears its completion deadline afterward.
  Sources: [command-buffer branches][abort-ts], [mirror][abort-cpp],
  [completion condition][flush-ts], [mirror][flush-cpp].

  | Readback state | Effect on retained commands |
  |---|---|
  | idle, next unexecuted command is not VRAM-to-CPU | keep the retained raster/upload commands |
  | idle, next unexecuted command is VRAM-to-CPU | remove that readback and subsequent commands, retain its predecessors |
  | pending, readback fence retained | remove that readback and subsequent commands, retain its predecessors; reset readback |
  | submitted or ready; remaining non-idle branch | clear command/word/executed/presentation counts; reset readback |

- Readback reset returns the port to idle, clears its fence, dimensions and
  cursor, changes its completion token and drops its DMA request. Completion
  requires submitted phase plus matching token, so canceled completion does
  not make data ready afterward. The command parser cannot advance beyond
  an active readback. Sources: [readback reset/completion][readback-ts],
  [mirror completion][readback-cpp], [mirror reset][readback-reset-cpp], [DMA request][readback-request-ts],
  [mirror][readback-request-cpp], [parser stop][parser-stop-ts],
  [mirror][parser-stop-cpp].
- A partial CPU-to-VRAM upload with only its three-word header is removed.
  If payload words were consumed by image assembly and retained, clearing emits
  the upload with its actual retained command word count, including the header.
  Words still only in GP0 or DMA ingress FIFO are discarded first and do not
  contribute to that count. Its pixel count is
  `min(width * height, 2 * (retained command word count - 3))`; those pixels are
  **processed** in row order, subject to the accepted command's retained
  mask-bit mode. With mask checking enabled, destination bit15 suppresses
  that pixel's write. When a write occurs, mask-setting mode forces bit15;
  otherwise source bit15 is retained. The missing rectangle remainder is
  not padded. Thus FLUSH or RESET can commit a partial upload instead of
  undoing it, but does not guarantee a memory write for every prefix pixel.
  Sources: [FIFO discard before prefix flush](../../../machine/ts/machine/devices/gx/gpu.ts#L1609-L1614),
  [mirror](../../../machine/cpp/machine/devices/gx/gpu.cpp#L1087-L1092),
  [partial upload][upload-flush-ts], [mirror][upload-flush-cpp],
  [retained payload pixel count][upload-count-ts], [mirror][upload-count-cpp],
  [retained command controls][command-controls-ts], [mirror][command-controls-cpp],
  [software upload][upload-write-ts], [mirror][upload-write-cpp],
  [masked write][masked-write-ts], [mirror][masked-write-cpp].
- GPU register reset is bounded: it clears GP0/GP1 command words, drawing
  mode, texture window, drawing-area corners, drawing offset, mask-bit mode
  and display start; restores display mode, status, horizontal display range
  and vertical display range defaults; and disables readback DMA mode.
  It does **not** reset the programmed VRAM Y address extension; the current
  extension is copied to presentation afterward. Do not generalize this into
  "all GPU registers return to defaults." Sources:
  [GPU reset assignments][gpu-reset-ts], [mirror][gpu-reset-cpp],
  [extension programming][extension-write-ts], [mirror][extension-write-cpp],
  [presentation copy][gpu-present-ts], [mirror][gpu-present-cpp].
- This GPU register reset does not separately reset the whole command buffer.
  A changed
  command serial resets the software consumer's command cursor, not its
  local-memory contents. Do not describe these actions as erasing or restoring
  local memory. Sources: [GPU register reset][gpu-reset-ts],
  [mirror][gpu-reset-cpp], [action path][dispatch-ts], [mirror][dispatch-cpp],
  [software consumption][command-consumer-ts], [mirror][command-consumer-cpp].

## Mapped access and faults

The following facts cover ordinary CPU mapped data loads/stores to the listed
PCRTC addresses. They do not claim a fault-free DMA, instruction-fetch or render
path. The PCRTC callbacks provide raw word accesses; system memory and CPU owners
supply width, alignment and exception behavior.

| CPU access | Address condition | Result | Sources |
|---|---|---|---|
| register-word/U32 load/store | four-byte aligned | one full register-word read/write | [read][bus-read-ts], [mirror][bus-read-cpp], [write][bus-write-ts], [mirror][bus-write-cpp] |
| U8 load | four-byte aligned | full register read, returning bits7:0 | [byte read][bus-u8-read-ts], [mirror][bus-u8-read-cpp] |
| U8 load | word offset1,2,3 | UNALIGNED_IO bus fault, no PCRTC callback | [byte read][bus-u8-read-ts], [mirror][bus-u8-read-cpp] |
| U8 store | any PCRTC byte address | UNALIGNED_IO bus fault, no PCRTC callback | [byte write][bus-u8-write-ts], [mirror][bus-u8-write-cpp] |
| U16 load/store | even | UNALIGNED_IO bus fault, including four-byte aligned addresses | [halfword read][bus-u16-read-ts], [mirror][bus-u16-read-cpp], [write][bus-u16-write-ts], [mirror][bus-u16-write-cpp] |
| U16 load/store | odd | CPU address exception before mapped access | [alignment masks][access-kind-ts], [mirror][access-kind-cpp], [CPU loads][cpu-load-ts], [mirror][cpu-load-cpp], [stores][cpu-store-ts], [mirror][cpu-store-cpp] |
| register-word/U32/F32/F64 load/store | not four-byte aligned | CPU address exception before mapped access | [alignment masks][access-kind-ts], [mirror][access-kind-cpp], [CPU loads][cpu-load-ts], [mirror][cpu-load-cpp], [stores][cpu-store-ts], [mirror][cpu-store-cpp] |

- F32 transfers the bits of one word. F64 transfers a word at A followed
  by a word at A+4, low word first, and stops if the first faults. F64 needs
  four-byte, not eight-byte, alignment. These are two word callbacks within
  one CPU instruction, not evidence that a VBlank service/latch can occur
  between the halves. The timing owner explicitly treats CPU instructions
  as atomic and may service a deadline afterward. Multiword stores similarly
  perform successive individual word
  writes, stopping at the first fault without undoing earlier writes. The
  two PCRTC ranges remain separated by non-PCRTC registers. Sources:
  [F32/F64 reads][bus-float-read-ts], [mirror][bus-float-read-cpp],
  [writes][bus-float-write-ts], [mirror][bus-float-write-cpp],
  [alignment][access-kind-ts], [mirror][access-kind-cpp],
  [multiword store][cpu-multiword-ts], [mirror][cpu-multiword-cpp],
  [instruction-atomic timing][instruction-timing-ts], [mirror][instruction-timing-cpp],
  [mapping][addr-ts], [mirror][addr-cpp].
- CPU data load/store dispatch has no privilege gate, and PCRTC callbacks
  have no user/supervisor selection. These accesses are available in either
  CPU mode; COP0 privilege rules do not apply to PCRTC MMIO. PCRTC installs
  no write-ready line, so these stores do not wait on a PCRTC ready signal.
  Sources: [CPU load/store dispatch][cpu-access-ts], [mirror][cpu-access-cpp],
  [callbacks][callbacks-ts], [mirror][callbacks-cpp],
  [registration][registration-ts], [mirror][registration-cpp],
  [ready rule][bus-ready-ts], [mirror][bus-ready-cpp].
- Misalignment raises CPU address-error-load (CAUSE `00000010H`) or
  address-error-store (`00000014H`) and records the attempted address in
  BAD_ADDRESS before mapped access. A new mapped-data bus fault raises
  CPU data-bus-error (`0000001CH`); a faulting load does not overwrite its
  destination. These are CPU exceptions, not PCRTC event bits or PCRTC IRQs.
  Sources: [exception constants][cause-ts], [mirror][cause-cpp],
  [load/store dispatch][cpu-load-ts], [mirror][cpu-load-cpp],
  [store][cpu-store-ts], [mirror][cpu-store-cpp],
  [address exception][cpu-address-ts], [mirror][cpu-address-cpp].
- The system bus-fault latch retains the first fault's code/address/access
  until acknowledged, while every fault increments its sequence. A nonzero
  ACK write clears the three detail words; reset/clear values are zero.
  The PCRTC word mappings are not in the memory owner's read-only set;
  CSR_HIGH/IMR_HIGH writes are ignored device writes, not READ_ONLY faults.
  Sources: [fault latch][bus-fault-ts], [mirror][bus-fault-cpp],
  [clear/reset][bus-ack-ts], [mirror][bus-ack-cpp],
  [ACK write][bus-ack-write-ts], [mirror][bus-ack-write-cpp],
  [read-only set][bus-readonly-ts], [mirror][bus-readonly-cpp],
  [PCRTC dispatch][dispatch-ts], [mirror][dispatch-cpp].
- System fault register addresses are CODE `08010208H`, ADDR `0801020CH`,
  ACCESS `08010210H`, ACK `08010214H`. Codes are NONE0, UNMAPPED1,
  UNALIGNED_IO2, READ_ONLY3. Access records combine READ bit0 or WRITE bit1
  with U8 bit8, U16 bit9, U32 bit10, Word bit11, F32 bit12 or F64 bit13.
  These are system bus words, not additional PCRTC registers. Sources:
  [fault-address expressions][fault-address-ts], [mirror][fault-address-cpp],
  [fault offsets][fault-offset-ts], [mirror][fault-offset-cpp],
  [I/O base/word][memory-base-ts], [mirror][memory-base-cpp],
  [fault codes/access bits][fault-bits-ts], [mirror][fault-bits-cpp].

## Evaluated programming inputs

These examples evaluate the reset constants through the cited field decoders.
All address/value pairs below are aligned PCRTC word writes. Their geometry and
write order do not supply assembly syntax or a cartridge-side store utility.

### E1. Circuit 1 with the reset display geometry

- Initial condition: PCRTC reset configuration and reset timing. At reset,
  `PMODE_LOW.EN1 = EN2 = 0`; the two circuits' reset geometry is configured
  but neither circuit is enabled. Sources: [reset inputs][leaf-ts],
  [mirror][leaf-cpp], [enable decode][circuit-ts], [mirror][circuit-cpp].
- The table lists the explicit circuit-1 configuration inputs, followed by
  its enable/composition word. The first four values equal their reset
  values; starting from reset they need not be written again. The only
  changed word in this example is `PMODE_LOW`.
  Sources: [reset inputs][leaf-ts], [mirror][leaf-cpp],
  [word-write equality][read-write-ts], [mirror][read-write-cpp].

  | Order | Address | Register | Value | Decoded input |
  |---:|---|---|---|---|
  | 1 | `0801035CH` | `DISPFB1_LOW` | `000FA000H` | base field 0; width field 16; storage selector 31 |
  | 2 | `08010360H` | `DISPFB1_HIGH` | `00000000H` | source X = 0; source Y = 0 |
  | 3 | `08010364H` | `DISPLAY1_LOW` | `018252A8H` | signal X = 680; signal Y = 37; magnification X = 4, Y = 1 |
  | 4 | `08010368H` | `DISPLAY1_HIGH` | `000EF4FFH` | horizontal extent = 1279; vertical extent = 239 |
  | 5 | `08010354H` | `PMODE_LOW` | `0000FF21H` | EN1 = 1; EN2 = 0; MMOD = 1; AMOD = 0; SLBG = 0; ALP = 255 |

  Sources for addresses: [address function][addr-ts], [mirror][addr-cpp].
  Sources for decoded inputs: [circuit fields][circuit-ts],
  [mirror][circuit-cpp], [extent fields][extents-ts], [mirror][extents-cpp],
  [composition fields][blend-ts], [mirror][blend-cpp].
- Evaluated geometry for the enabled circuit: framebuffer base word = 0;
  framebuffer width = `16 * 64 = 1024`; storage path = GX16. The horizontal
  signal interval is `[680, 680 + 1279 + 1) = [680, 1960)`, and the height
  is `239 + 1 = 240`. Reset signal step X is 4, so horizontal boundaries
  convert to `680 / 4 = 170` and `1960 / 4 = 490`, with no rounding.
  With only circuit 1 enabled, output origin is `(0, 0)`, output width is
  `490 - 170 = 320`, and output height is 240. Horizontal source phase is
  zero; source advance X is `4 / 4 = 1` with remainder zero; Y
  magnification is one. `SMODE2_LOW = 0` selects non-interlaced traversal.
  Sources: [reset inputs][leaf-ts], [mirror][leaf-cpp],
  [timing signal step][timing-ts], [mirror][timing-cpp],
  [source/circuit decode][circuit-ts], [mirror][circuit-cpp],
  [boundaries and phases][extents-ts], [mirror][extents-cpp],
  [output size][bounds-ts], [mirror][bounds-cpp],
  [non-interlace decode][mode-ts], [mirror][mode-cpp].
- For the stated PMODE word, MMOD = 1 and ALP = 255 select circuit 1's
  `RAW_RGBA` path because AMOD = 0. Circuit 1 covers the entire output,
  so the owner selects no circuit-2 draw path and does not require a
  background draw. The sample's original RGB and alpha are selected;
  GX16 sample alpha is 0 or 128 from local-memory bit15, not necessarily
  255. Sources: [composition selection][blend-ts], [mirror][blend-cpp],
  [sample packing][palette-ts], [mirror][palette-cpp],
  [raw operation][raw-ops-ts], [mirror][generic-ops-cpp].
- These writes are configuration writes and use the presentation-copy rule
  above. None is a beam-timing word. The write order does not establish an
  atomic update across an intervening VBlank-entry latch, nor a visible
  first-frame deadline independent of when the words are written.
  Sources: [configuration writes][read-write-ts], [mirror][read-write-cpp],
  [beam-timing set][timing-set-ts], [mirror][timing-set-cpp],
  [latch][latch-ts], [mirror][latch-cpp], [VBlank entry][vblank-ts],
  [mirror][vblank-cpp].

### E1b. Change the source origin and display-window size

- Initial condition: PCRTC reset configuration and reset timing. Issue these
  three changed configuration words in the listed order, with circuit 1
  enabled by the last write:

  | Order | Address | Register | Value | Decoded input |
  |---:|---|---|---|---|
  | 1 | `08010360H` | `DISPFB1_HIGH` | `00008020H` | source X = 32; source Y = 16 |
  | 2 | `08010368H` | `DISPLAY1_HIGH` | `000BF3FFH` | horizontal extent = 1023; vertical extent = 191 |
  | 3 | `08010354H` | `PMODE_LOW` | `0000FF21H` | EN1 = 1; EN2 = 0; MMOD = 1; AMOD = 0; SLBG = 0; ALP = 255 |

  `00008020H = (16 << 11) | 32` and
  `000BF3FFH = (191 << 12) | 1023`.
  Sources: [address function][addr-ts], [mirror][addr-cpp],
  [source and PMODE decode][circuit-ts], [mirror][circuit-cpp],
  [extent decode][extents-ts], [mirror][extents-cpp],
  [composition fields][blend-ts], [mirror][blend-cpp].
- All other configuration words retain their reset values. Framebuffer
  base word remains zero, framebuffer width remains 1024, storage selector
  remains 31 (GX16), signal origin remains `(680, 37)`, magnification
  remains `(4, 1)`, signal step X remains 4, and traversal remains
  non-interlaced. Sources: [reset inputs][leaf-ts], [mirror][leaf-cpp],
  [circuit decode][circuit-ts], [mirror][circuit-cpp],
  [timing decode][timing-ts], [mirror][timing-cpp],
  [interlace decode][mode-ts], [mirror][mode-cpp].
- The programmed signal interval is `[680, 680 + 1023 + 1) = [680, 1704)`.
  Both boundaries align to signal step 4: `680 / 4 = 170` and
  `1704 / 4 = 426`. With only circuit 1 enabled, output origin is `(0, 0)`,
  width is `426 - 170 = 256`, and height is `191 + 1 = 192`.
  Sources: [bounds and extents][extents-ts], [mirror][extents-cpp],
  [output size][bounds-ts], [mirror][bounds-cpp].
- These writes use the same presentation-copy rule and PMODE path selection
  as E1. They do not establish an atomic multiword update, sampled pixel
  contents or alpha, or a visible first-frame deadline.
  Sources: [configuration writes][read-write-ts], [mirror][read-write-cpp],
  [latch][latch-ts], [mirror][latch-cpp],
  [composition selection][blend-ts], [mirror][blend-cpp].

### Reset beam landmarks for a timing diagram

- Reset timing decodes to RC = 4, LC = 32, divider factor = 1, CMOD = 3,
  signal step X = 4, PRST = SINT = 0, and vertical-unit multiplier U = 1.
  HFP = 48, HBP = 262, HS = 254, HF = 1212, HB = 1680;
  VFP = 4, VFPE = 5, VBP = 33, VBPE = 5, VDP = 576, VS = 5.
  Therefore H = 3456, D = 8, half-line numerator = 27648,
  half-line denominator = 864000000, total half-lines = 628,
  active-display half-lines = 576, and VSync half-line = 585.
  Sources: [reset inputs][leaf-ts], [mirror][leaf-cpp],
  [timing decode/formulas][timing-ts], [mirror][timing-cpp].
- Diagram landmarks, in half-lines from beam restart: `0` beam start;
  `2` first scheduled HSync; `576` VBlank begin; `585` VSync and VSINT;
  `628` field end, returning to within-field half-line zero. HSync schedule
  is `2, 4, 6, ...`; the pending-HSINT suppression and clear rules still
  apply. Within-field VBlank-active is false below 576 and true from 576
  through the remainder of the field. The VBlank-begin landmark also
  selects the normal presentation latch. These landmarks are not an
  electrical waveform. Sources: [restart][restart-ts], [mirror][restart-cpp],
  [service][service-ts], [mirror][service-cpp],
  [vertical thresholds][vertical-ts], [mirror][vertical-cpp],
  [VBlank handling][vblank-ts], [mirror][vblank-cpp].
- Reset has even VFP, so the FIELD toggle condition is false. Reset FIELD
  is zero; the first VSync sets it to one rather than toggling it.
  Sources: [reset CSR][leaf-ts], [mirror][leaf-cpp],
  [toggle condition][duration-ts], [mirror][duration-cpp],
  [VSync action][service-ts], [mirror][service-cpp].

### E2. Clear stale HSINT and enable only its PCRTC interrupt mask

| Order | Address | Register | Value | Result |
|---:|---|---|---|---|
| 1 | `080103DCH` | `IMR_LOW` | `00007F00H` | mask all five PCRTC events |
| 2 | `080103D4H` | `CSR_LOW` | `00000004H` | clear HSINT only; do not request RESET or FLUSH |
| 3 | `080103DCH` | `IMR_LOW` | `00007B00H` | unmask HSINT; leave SIGNAL, FINISH, VSINT and EDWINT masked |

- `7F00H = 6000H | 1F00H`; `7B00H = 6000H | 1B00H` clears IMR bit 10
  only relative to `7F00H`. CSR clear value `00000004H` is HSINT bit 2.
  Sources: [addresses][addr-ts], [mirror][addr-cpp], [bit constants][bits-ts],
  [mirror][bits-cpp], [CSR/IMR writes][status-write-ts],
  [mirror][status-write-cpp].
- If HSINT was pending and timing runs, step 2 resumes the HSync schedule
  at the first scheduled point strictly after the current half-line;
  suppressed earlier HSync points are not replayed. If HSINT becomes
  pending between steps 2 and 3, step 3 immediately requests the PCRTC IRQ.
  Otherwise a newly raised HSINT requests it while this mask remains
  installed. Sources: [CSR clear/IMR unmask][status-write-ts],
  [mirror][status-write-cpp], [HSync resume][resume-ts],
  [mirror][resume-cpp], [new event][raise-ts], [mirror][raise-cpp],
  [IRQ dispatch][dispatch-ts], [mirror][dispatch-cpp].
- Step 2 leaves FIELD and the four other CSR event bits unchanged. Masking
  those other events does not clear them; a later write which unmasks an
  already pending event can request the PCRTC IRQ immediately. This
  sequence specifies only PCRTC state and its request; it does not specify
  interrupt-controller acknowledgement or CPU interrupt enable.
  Sources: [CSR/IMR writes][status-write-ts], [mirror][status-write-cpp],
  [IRQ dispatch][dispatch-ts], [mirror][dispatch-cpp].

## Retained state (editorial; not cartridge-visible registers)

- Save state retains both 22-word arrays (`registerWords`, `presentWords`),
  CSR word, IMR word, beam-cycle offset from the capture cycle, beam
  remainder, beam half-line, next HSync half-line, vertical stage, and
  VBlank-active. Sources: [state/capture][capture-ts], [mirror][capture-cpp],
  [state shape][state-ts], [mirror][state-cpp].
- Restore installs those values, recalculates beam and presentation timing
  from their own arrays, reconstructs presentation dirty flags, rebases the
  beam cycle to the restore cycle plus saved offset, recomputes half-line
  period and next VBlank budget if running, and republishes configuration
  with the saved FIELD. Sources: [restore][restore-ts], [mirror][restore-cpp],
  [dirty reconstruction][publish-ts], [mirror][publish-cpp].
- GPU context capture/restore covers only the first 12 composition words in
  each array; timing/status state is not in those two context arrays.
  Sources: [context][context-ts], [mirror][context-cpp],
  [composition count][leaf-ts], [mirror][leaf-cpp].

## Editorial closure and limits

The eight former source gaps are resolved in this sheet: PMODE operations,
packing/addressing/wrap/zero sampling, blend arithmetic/channels, two-byte
local-memory words, the VBlank-entry latch, absence of normal producers for the
three named non-beam events, mapped CPU access/faults, and downstream RESET/FLUSH
behavior. Their source links accompany the facts above. This is input for a new
chapter review, not approval of the existing chapter or its publication record.

- No producer/timing for SIGNAL/FINISH/EDWINT is invented. Normal execution
  does not generate them; arbitrary restored pending bits retain their
  documented W1C/mask semantics.
- No electrical video waveform or within-instruction MMIO/edge ordering is
  established. No global CPU/interrupt-controller service recipe follows
  from the device-level mask example.
- Numeric reset values of other GPU registers, full raster/GP0 command
  descriptions, DMA exception delivery and instruction fetches from MMIO
  remain outside this chapter's extracted contract; no blanket fault-free
  or undo guarantee is implied.
- The [WebGPU discrepancy](../reviews/pcrtc-webgpu-constant-blend.md) has a
  separate recorded runtime correction and GPU regression. Pixel behavior here
  continues to follow the user's explicit TS/C++ software-authority decision;
  no alternate accelerated contract is introduced.

[addr-ts]: ../../../machine/ts/spec/gx/pcrtc.ts#L100-L104
[addr-cpp]: ../../../machine/cpp/spec/gx/pcrtc.h#L94-L98
[io-layout-ts]: ../../../machine/ts/spec/bmsx/io.ts#L3-L130
[io-layout-cpp]: ../../../machine/cpp/spec/bmsx/io.h#L9-L143
[io-base-ts]: ../../../machine/ts/spec/bmsx/io.ts#L178-L182
[io-base-cpp]: ../../../machine/cpp/spec/bmsx/io.h#L191-L195
[word-ts]: ../../../machine/ts/spec/bmsx/memory_map.ts#L23-L23
[word-cpp]: ../../../machine/cpp/spec/bmsx/memory_map.h#L29-L29
[memory-base-ts]: ../../../machine/ts/spec/bmsx/memory_map.ts#L6-L32
[memory-base-cpp]: ../../../machine/cpp/spec/bmsx/memory_map.h#L12-L38
[leaf-ts]: ../../../machine/ts/spec/gx/pcrtc.ts#L9-L98
[leaf-cpp]: ../../../machine/cpp/spec/gx/pcrtc.h#L10-L92
[bits-ts]: ../../../machine/ts/spec/gx/pcrtc.ts#L39-L66
[bits-cpp]: ../../../machine/cpp/spec/gx/pcrtc.h#L40-L67
[read-write-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L580-L599
[read-write-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L325-L343
[dispatch-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L1400-L1427
[dispatch-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L909-L936
[mapping-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L468-L472
[mapping-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L59-L63
[reset-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L560-L572
[reset-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L305-L317
[circuit-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L361-L389
[circuit-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L120-L150
[extents-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L391-L446
[extents-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L152-L202
[mode-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L448-L459
[mode-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L204-L213
[bounds-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L461-L470
[bounds-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L215-L224
[blend-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L479-L520
[blend-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L233-L274
[timing-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L247-L282
[timing-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L66-L101
[timing-set-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L223-L227
[timing-set-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L58-L62
[restart-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L836-L855
[restart-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L558-L576
[latch-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L723-L731
[latch-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L446-L454
[publish-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L815-L827
[publish-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L538-L550
[presentation-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L1493-L1515
[presentation-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L975-L997
[field-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L348-L359
[field-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L292-L303
[storage-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L163-L173
[storage-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L3-L35
[formats-ts]: ../../../machine/ts/machine/devices/gx/gpu_local_memory.ts#L3-L8
[formats-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_local_memory.h#L7-L12
[clock-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L96-L96
[clock-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L8-L8
[scale-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L80-L84
[scale-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.h#L35-L40
[duration-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L283-L298
[duration-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L102-L117
[deadline-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L647-L654
[deadline-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L371-L378
[period-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L829-L881
[period-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L552-L603
[service-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L656-L721
[service-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L380-L444
[vertical-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L857-L866
[vertical-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L578-L587
[status-write-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L616-L628
[status-write-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L352-L364
[field-read-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L638-L640
[field-read-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.h#L165-L167
[resume-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L885-L947
[resume-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L607-L621
[raise-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L955-L959
[raise-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L628-L632
[forward-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L1313-L1330
[forward-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L665-L681
[irq-ts]: ../../../machine/ts/spec/bmsx/io.ts#L362-L364
[irq-cpp]: ../../../machine/cpp/spec/bmsx/io.h#L375-L377
[gpu-reset-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L755-L772
[gpu-reset-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L285-L302
[flush-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L1609-L1627
[flush-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L1087-L1105
[capture-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L733-L746
[capture-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L456-L469
[state-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L101-L112
[state-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.h#L49-L60
[restore-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L748-L777
[restore-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L471-L499
[context-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L779-L797
[context-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L501-L520
[callbacks-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L2071-L2083
[callbacks-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L1551-L1563
[timer-ts]: ../../../machine/ts/machine/runtime/cpu_executor.ts#L327-L337
[timer-cpp]: ../../../machine/cpp/machine/runtime/cpu_executor.cpp#L313-L323
[vblank-ts]: ../../../machine/ts/machine/runtime/vblank.ts#L44-L65
[vblank-cpp]: ../../../machine/cpp/machine/runtime/vblank.cpp#L31-L49
[model-ts]: ../../../machine/ts/spec/bmsx/model.ts#L46-L56
[model-cpp]: ../../../machine/cpp/spec/bmsx/model.h#L51-L61
[vram-state-ts]: ../../../machine/ts/render/backend/software/gx_gpu_state.ts#L104-L108
[vram-state-cpp]: ../../../machine/cpp/render/backend/software/gx_gpu_state.h#L90-L99
[vram-load-ts]: ../../../machine/ts/render/backend/software/gx_gpu_vram.ts#L4-L8
[vram-load-cpp]: ../../../machine/cpp/render/backend/software/gx_gpu_vram.cpp#L5-L12
[vram-spec-ts]: ../../../machine/ts/spec/gx/vram.ts#L1-L5
[vram-spec-cpp]: ../../../machine/cpp/spec/gx/vram.h#L9-L14
[sample-ts]: ../../../machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated.ts#L46-L95
[sample-cpp]: ../../../machine/cpp/render/backend/software/gx_gpu_scanout.cpp#L47-L91
[palette-ts]: ../../../machine/ts/render/backend/software/gx_gpu_scanout_palette.ts#L5-L11
[palette-cpp]: ../../../machine/cpp/render/backend/software/gx_gpu_scanout_palette.cpp#L7-L13
[expand-ts]: ../../../machine/ts/render/backend/software/gx_gpu_vram.ts#L21-L23
[expand-cpp]: ../../../machine/cpp/render/backend/software/gx_gpu_vram.h#L33-L35
[address-layout-ts]: ../../../machine/ts/machine/devices/gx/gpu_local_memory.ts#L10-L100
[address-layout-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_local_memory.h#L14-L84
[address32-ts]: ../../../machine/ts/machine/devices/gx/gpu_local_memory.ts#L12-L33
[address32-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_local_memory.h#L18-L34
[address16-ts]: ../../../machine/ts/machine/devices/gx/gpu_local_memory.ts#L35-L80
[address16-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_local_memory.h#L36-L75
[address-linear-ts]: ../../../machine/ts/machine/devices/gx/gpu_local_memory.ts#L83-L100
[address-linear-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_local_memory.h#L78-L84
[word-fetch-ts]: ../../../machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated.ts#L34-L36
[word-fetch-cpp]: ../../../machine/cpp/render/backend/software/gx_gpu_scanout.cpp#L35-L39
[zero-ts]: ../../../machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated.ts#L528-L545
[zero-rgba-ts]: ../../../machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated.ts#L770-L787
[zero-source-ts]: ../../../machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated.ts#L1283-L1304
[zero-source-rgba-ts]: ../../../machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated.ts#L1546-L1566
[composition-ts]: ../../../machine/ts/render/backend/software/gx_gpu_scanout.ts#L13-L44
[composition-cpp]: ../../../machine/cpp/render/backend/software/gx_gpu_scanout.cpp#L305-L340
[background-cpp]: ../../../machine/cpp/render/backend/software/gx_gpu_scanout.cpp#L95-L118
[raw-ops-ts]: ../../../machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated.ts#L98-L176
[generic-ops-ts]: ../../../machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated.ts#L1044-L1074
[generic-ops-cpp]: ../../../machine/cpp/render/backend/software/gx_gpu_scanout.cpp#L221-L269
[source-ops-ts]: ../../../machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated.ts#L1313-L1344
[constant-ops-ts]: ../../../machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated.ts#L238-L297
[blend-equation-ts]: ../../../machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated.ts#L38-L43
[blend-equation-cpp]: ../../../machine/cpp/render/backend/software/gx_gpu_scanout.cpp#L99-L104
[abort-ts]: ../../../machine/ts/machine/devices/gx/gpu_command_buffer.ts#L248-L276
[abort-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_command_buffer.h#L228-L256
[readback-ts]: ../../../machine/ts/machine/devices/gx/gpu_command_buffer.ts#L133-L159
[readback-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_command_buffer.h#L88-L101
[readback-reset-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_command_buffer.h#L144-L155
[readback-request-ts]: ../../../machine/ts/machine/devices/gx/gpu_command_buffer.ts#L187-L193
[readback-request-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_command_buffer.h#L157-L160
[parser-clear-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L1630-L1650
[parser-clear-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L1108-L1128
[parser-stop-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L1153-L1159
[parser-stop-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L721-L727
[upload-flush-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L1652-L1673
[upload-flush-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L1130-L1150
[upload-count-ts]: ../../../machine/ts/render/backend/gx_gpu_render_rules.ts#L230-L238
[upload-count-cpp]: ../../../machine/cpp/render/backend/gx_gpu_render_rules.h#L234-L242
[upload-write-ts]: ../../../machine/ts/render/backend/software/gx_gpu_commands.ts#L75-L100
[upload-write-cpp]: ../../../machine/cpp/render/backend/software/gx_gpu_commands.cpp#L40-L76
[command-consumer-ts]: ../../../machine/ts/render/backend/software/gx_gpu.ts#L18-L31
[command-consumer-cpp]: ../../../machine/cpp/render/backend/software/gx_gpu.cpp#L26-L47
[bus-read-ts]: ../../../machine/ts/machine/memory/memory.ts#L544-L555
[bus-read-cpp]: ../../../machine/cpp/machine/memory/memory.cpp#L434-L445
[bus-write-ts]: ../../../machine/ts/machine/memory/memory.ts#L627-L646
[bus-write-cpp]: ../../../machine/cpp/machine/memory/memory.cpp#L522-L540
[bus-u8-read-ts]: ../../../machine/ts/machine/memory/memory.ts#L442-L451
[bus-u8-read-cpp]: ../../../machine/cpp/machine/memory/memory.cpp#L332-L341
[bus-u8-write-ts]: ../../../machine/ts/machine/memory/memory.ts#L466-L469
[bus-u8-write-cpp]: ../../../machine/cpp/machine/memory/memory.cpp#L356-L359
[bus-u16-read-ts]: ../../../machine/ts/machine/memory/memory.ts#L503-L506
[bus-u16-read-cpp]: ../../../machine/cpp/machine/memory/memory.cpp#L393-L396
[bus-u16-write-ts]: ../../../machine/ts/machine/memory/memory.ts#L603-L606
[bus-u16-write-cpp]: ../../../machine/cpp/machine/memory/memory.cpp#L498-L501
[access-kind-ts]: ../../../machine/ts/spec/blua32/memory_access_kind.ts#L1-L10
[access-kind-cpp]: ../../../machine/cpp/spec/blua32/memory_access_kind.h#L8-L23
[cpu-load-ts]: ../../../machine/ts/machine/cpu/cpu.ts#L3080-L3115
[cpu-load-cpp]: ../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L621-L642
[cpu-store-ts]: ../../../machine/ts/machine/cpu/cpu.ts#L3117-L3152
[cpu-store-cpp]: ../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L646-L668
[bus-float-read-ts]: ../../../machine/ts/machine/memory/memory.ts#L573-L588
[bus-float-read-cpp]: ../../../machine/cpp/machine/memory/memory.cpp#L463-L482
[bus-float-write-ts]: ../../../machine/ts/machine/memory/memory.ts#L659-L671
[bus-float-write-cpp]: ../../../machine/cpp/machine/memory/memory.cpp#L553-L567
[cpu-multiword-ts]: ../../../machine/ts/machine/cpu/cpu.ts#L3155-L3170
[cpu-multiword-cpp]: ../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L672-L685
[cpu-access-ts]: ../../../machine/ts/machine/cpu/cpu.ts#L2992-L3170
[cpu-access-cpp]: ../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L554-L685
[registration-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L462-L472
[registration-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L53-L63
[bus-ready-ts]: ../../../machine/ts/machine/memory/memory.ts#L261-L265
[bus-ready-cpp]: ../../../machine/cpp/machine/memory/memory.cpp#L181-L185
[cause-ts]: ../../../machine/ts/spec/blua32/cop0.ts#L19-L22
[cause-cpp]: ../../../machine/cpp/spec/blua32/cop0.h#L25-L28
[cpu-address-ts]: ../../../machine/ts/machine/cpu/cpu.ts#L1732-L1739
[cpu-address-cpp]: ../../../machine/cpp/machine/cpu/cpu.cpp#L2290-L2297
[bus-fault-ts]: ../../../machine/ts/machine/memory/memory.ts#L811-L819
[bus-fault-cpp]: ../../../machine/cpp/machine/memory/memory.cpp#L707-L715
[bus-ack-ts]: ../../../machine/ts/machine/memory/memory.ts#L419-L423
[bus-ack-cpp]: ../../../machine/cpp/machine/memory/memory.cpp#L309-L313
[bus-ack-write-ts]: ../../../machine/ts/machine/memory/memory.ts#L822-L833
[bus-ack-write-cpp]: ../../../machine/cpp/machine/memory/memory.cpp#L695-L722
[bus-readonly-ts]: ../../../machine/ts/machine/memory/memory.ts#L852-L894
[bus-readonly-cpp]: ../../../machine/cpp/machine/memory/memory.cpp#L729-L771
[fault-address-ts]: ../../../machine/ts/spec/bmsx/io.ts#L209-L212
[fault-address-cpp]: ../../../machine/cpp/spec/bmsx/io.h#L222-L225
[fault-offset-ts]: ../../../machine/ts/spec/bmsx/io.ts#L99-L105
[fault-offset-cpp]: ../../../machine/cpp/spec/bmsx/io.h#L112-L118
[fault-bits-ts]: ../../../machine/ts/spec/bmsx/io.ts#L399-L410
[fault-bits-cpp]: ../../../machine/cpp/spec/bmsx/io.h#L412-L423
[command-controls-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L1770-L1784
[command-controls-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L1253-L1266
[masked-write-ts]: ../../../machine/ts/render/backend/software/gx_gpu_vram.ts#L38-L45
[masked-write-cpp]: ../../../machine/cpp/render/backend/software/gx_gpu_vram.h#L50-L62
[extension-write-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L1381-L1385
[extension-write-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L890-L894
[gpu-present-ts]: ../../../machine/ts/machine/devices/gx/gpu.ts#L746-L753
[gpu-present-cpp]: ../../../machine/cpp/machine/devices/gx/gpu.cpp#L276-L283
[instruction-timing-ts]: ../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L656-L663
[instruction-timing-cpp]: ../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L380-L386

## Consolidated technical specifications and reset cycle conversion

This supplement supplies the upfront resource/clock/cycle inventory rather than
implying that programming-word width defines electrical bandwidth. It does not
change the previously sourced beam, sampling, event or register contracts.

- Installed main RAM4MiB and separate shared GPU local memory2MiB:
  [TS model](../../../machine/ts/spec/bmsx/model.ts#L46-L57),
  [C++ model](../../../machine/cpp/spec/bmsx/model.h#L51-L62).
  Low-byte-first local-word loading:
  [TS](../../../machine/ts/render/backend/software/gx_gpu_vram.ts#L4-L8),
  [C++](../../../machine/cpp/render/backend/software/gx_gpu_vram.cpp#L5-L12).
- Two independently enabled reading circuits, extent/magnification fields,
  and window/step conversion:
  [TS](../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L361-L446),
  [C++](../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L120-L202).
  Derived field capacities: horizontal span1–4096 signal units, vertical1–2048,
  magnificationX1–16/Y1–4. These are representable fields, not rated video modes.
- 26 register slots in ranges12+14, of which22 programmed configuration words
  have a separate22-word display latch:
  [TS inventory](../../../machine/ts/spec/gx/pcrtc.ts#L9-L37),
  [C++ inventory](../../../machine/cpp/spec/gx/pcrtc.h#L10-L38),
  [TS programmed state](../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L539-L599),
  [C++ programmed state](../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L305-L343),
  [TS latch](../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L723-L731),
  [C++ latch](../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L446-L454).
  Address ranges/faults remain the facts above; the latch is not an extra
  cartridge-addressable register bank.
- Installed system frequency33,868,800Hz (cycle≈29.526ns):
  [TS clock](../../../machine/ts/spec/bmsx/model.ts#L7-L7),
  [C++ clock](../../../machine/cpp/spec/bmsx/model.h#L12-L12).
  Beam reference13,500,000Hz and half-line numerator/denominator/vertical counts:
  [TS](../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L247-L282),
  [C++](../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L66-L101).
  This equation specifies neither an independent execution/PLL/pixel waveform
  clock nor electrical IO/VRAM pins, arbitration or guaranteed sustained rate.
- Raw reset words:
  [TS](../../../machine/ts/spec/gx/pcrtc.ts#L75-L98),
  [C++](../../../machine/cpp/spec/gx/pcrtc.h#L69-L92).
  Derived horizontal sum3456, divider product8,LC32,U1 yield
  half-line27648/864000000s=32µs;628 half-lines give20.096ms and
  exact31250/628≈49.761146496815286 field repetitions/s, not exactly50Hz.
  The864000000 denominator is arithmetic, not a core-clock specification.
- Fractional CPU-cycle remainder, upward-rounded deadlines, restart epoch and
  half-line landmarks:
  [TS](../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L829-L881),
  [C++](../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L552-L603).
  Derived restart-at-cycle0 events: HSync2/64µs/2168cycles;
  VBlank576/18.432ms/624270; VSync585/18.720ms/634024;
  field-end628/20.096ms/680628. Exact period680627.4048system cycles;
  independent integer/rational math and live timing/deadline owner agree.
- Event service retains beam phase rather than restarting at late CPU service;
  pending HSINT suppresses repeat requests:
  [TS](../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L656-L721),
  [C++](../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L380-L444).
  These are device deadlines, not a fixed handler-response latency. Instructions
  are atomic relative to service; the existing fault/access facts qualify
  multiword accesses separately.
- PCRTC maps ordinary read/write callbacks, no write-readiness callback or
  configuration command FIFO/CYCLES register:
  [TS mapping](../../../machine/ts/machine/devices/gx/gpu.ts#L462-L472),
  [C++ mapping](../../../machine/cpp/machine/devices/gx/gpu.cpp#L53-L63),
  [TS ordinary readiness](../../../machine/ts/machine/memory/memory.ts#L261-L265),
  [C++ ordinary readiness](../../../machine/cpp/machine/memory/memory.cpp#L181-L185).
- Scalar word-load/store base cost2system cycles, including displaced forms:
  [TS charges](../../../machine/ts/spec/blua32/opcode.ts#L75-L84),
  [C++ charges](../../../machine/cpp/spec/blua32/opcode.cpp#L5-L69).
  Thus22 separately issued admitted stores charge44base cycles, excluding
  preparation/control flow and display-latch waiting. A word-sequence store has
  base2 plus n/4 rounded upward for its nwords:
  [TS sequence](../../../machine/ts/machine/cpu/cpu.ts#L2992-L3018),
  [C++ sequence](../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L605-L618),
  [TS absolute sequence](../../../machine/ts/machine/cpu/cpu.ts#L3155-L3170),
  [C++ absolute sequence](../../../machine/cpp/machine/cpu/cpu_dispatch.inl#L672-L685).
  This is per actual instruction, not an automatic block copy or a single
  contiguous22-word PCRTC update across the intervening device address gap.
  These charges do not establish electrical bus timing or sustained bandwidth.

## Actual source-origin versus window-position contrast

The separate [window programming fact sheet](pcrtc-window.md) supplies the
paired geometry/latch facts, raw A/B/C settings and actual ordinary cartridge
and RGB-output observations for the new complete example. It does not alter
the register/reset, local-memory packing or timing facts above.

## Unequal horizontal source sampling

The [finite sampling fact sheet](pcrtc-sampling.md) adds the exact integer-quotient
source progression, nonzero first-pixel phase and an eight-pixel GX16 example.
It records the actual paired software consumers as well as the PCRTC producer.
Complete real cartridge and independent actual-output evidence are retained in
[the sampling review](../reviews/pcrtc-sampling-source.md).
