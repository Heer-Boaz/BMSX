# PCRTC fact sheet

Editorial input for one hardware-manual chapter; not chapter prose. Source scope:
the mirrored PCRTC spec leaf, its address constants, the live PCRTC owners, and
PCRTC integration in the GPU owners, plus the six imported local-memory format
constant declarations. No architecture document or reference PDF was used.
Source state includes `ed2ceff96` (`retain PCRTC frame period as raw u32`).
No disagreement was found between the inspected spec definitions and owners.

## Register words

- A word occupies four bytes. PCRTC indices 0–11 use
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
  [mirror][publish-cpp]. The inspected GPU owner calls this latch in
  `presentReadyFrameOnVblankEdge()`. Sources: [callsite][presentation-ts],
  [mirror][presentation-cpp]. Which VBlank edge invokes that method is an
  editorial gap below.

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
  output bounds cover both enabled circuits. Pixel output is active only
  when beam timing runs, signal step X is nonzero, and a circuit is enabled.
  Sources: [activation/crop/extents][extents-ts], [mirror][extents-cpp],
  [output bounds][bounds-ts], [mirror][bounds-cpp].
- `BGCOLOR_LOW[23:0]` becomes the background color; `PMODE_LOW[15:8]` becomes
  the constant blend alpha. `SMODE2_LOW.INT` selects interlaced traversal;
  FFMD selects frame mode only when INT is set. Interlaced output advances
  by two rows, otherwise one. In interlaced non-frame mode, source stride is
  two and source phase is `(display signal Y XOR FIELD) AND 1`; otherwise
  source stride is one and phase zero. Sources: [decode][mode-ts],
  [mirror][mode-cpp], [field changes][field-ts], [mirror][field-cpp].
- The storage selector dispatches as follows; selectors not listed select
  the named zero path. This is path selection, not a claim about a sampled
  zero path's pixel value or storage layout. Sources: [storage dispatch][storage-ts],
  [mirror][storage-cpp], [format constants][formats-ts], [mirror][formats-cpp].

  | Selector | Circuit 1 path | Circuit 2 path |
  |---:|---|---|
  | 0 | CT32 | CT32 |
  | 1 | CT24 | CT24 |
  | 2 | CT16 | CT16 |
  | 10 | CT16S | CT16S |
  | 18 | GPU24 | zero |
  | 31 | GX16 | GX16 |
- MMOD, AMOD, SLBG and ALP select named raw/source-alpha/constant-alpha
  output paths. The owner special-cases ALP 0 and 255. This fact sheet does
  not derive a pixel blend equation from those path names.
  Sources: [path selection][blend-ts], [mirror][blend-cpp].

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
- A CSR RESET action takes priority over FLUSH when both are written.
  RESET calls the GP0 clearing path, resets GPU draw/display registers,
  restores the complete PCRTC configuration plus CSR/IMR, restarts the beam,
  and publishes reset scanout configuration immediately. The GPU then latches
  its presentation registers and marks presentation pending. Sources:
  [action dispatch][dispatch-ts], [mirror][dispatch-cpp],
  [GPU register reset][gpu-reset-ts], [mirror][gpu-reset-cpp],
  [PCRTC reset][reset-ts], [mirror][reset-cpp].
- FLUSH calls the GP0 clearing path without the PCRTC reset call. That path
  resets DMA ingress and FIFO, clears ingress state, flushes image-load data
  to VRAM, calls `abortReadbackAndQueuedCommands`, conditionally completes
  the pending accepted command target, zeroes pending completion and packet
  counts, and clears image-load/polyline state. No statement that FLUSH
  discards all accepted work or rolls back VRAM follows from these calls.
  Sources: [dispatch][dispatch-ts], [mirror][dispatch-cpp],
  [clearing path][flush-ts], [mirror][flush-cpp].

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

## Editorial gaps: omit rather than infer

- **Presentation edge:** the inspected GPU method is named
  `presentReadyFrameOnVblankEdge`; its callers selecting VBlank begin or end
  are outside this sheet's source scope. Do not say that ordinary
  configuration writes become visible specifically at VBlank begin or end.
  Sources: [latch callsite][presentation-ts], [mirror][presentation-cpp].
- **Format packing:** only the six format constant declarations were inspected
  in `gpu_local_memory`, not its storage datapath. Do not supply pixel packing,
  local-memory addressing, framebuffer-wrap claims, or infer the pixel
  result of the named zero path. Sources: [format declarations][formats-ts],
  [mirror][formats-cpp], [path dispatch][storage-ts], [mirror][storage-cpp].
- **Blend equation/color channels:** path names and the 24-bit background
  mask do not specify channel order, arithmetic, saturation, or rounding.
  The owners choosing paths do not execute the pixel blend in these files.
  Sources: [background/path selection][mode-ts], [blend selection][blend-ts],
  [mirror][mode-cpp], [mirror][blend-cpp].
- **SIGNAL/FINISH/EDWINT:** these are named CSR bits and are clearable/maskable,
  but the inspected device service generates only HSINT and VSINT. Do not
  invent producers or completion timing for the other three events.
  Sources: [bit names][bits-ts], [mirror][bits-cpp], [service][service-ts],
  [mirror][service-cpp].
- **Faults and bus access policy:** the inspected spec leaf/device owner
  does not define a PCRTC fault register or a fault-generation contract.
  Read/write callbacks alone do not prove that every width/alignment/access
  is fault-free. Do not state a fault-free guarantee, bus-width policy,
  privilege rule, or reserved-bit write requirement from this sheet.
  Sources: [register definitions][leaf-ts], [mirror][leaf-cpp],
  [MMIO callbacks][callbacks-ts], [mirror][callbacks-cpp].
- **RESET/FLUSH downstream details:** GPU callsites are inspected, but the
  command-buffer owner and GPU reset-constant leaf are outside scope. Do not
  expand `abortReadbackAndQueuedCommands` into an unsourced discard/retirement
  contract or list numeric reset values for non-PCRTC registers.
  Sources: [clearing path][flush-ts], [mirror][flush-cpp],
  [GPU register reset][gpu-reset-ts], [mirror][gpu-reset-cpp].

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
