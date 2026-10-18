# PCRTC source and figure review

Scope: the chapter, both PCRTC spec leaves and device owners, and the scoped
local-memory/software-scanout, VBlank, GPU command/readback, mapped-memory and
CPU owners linked in [the fact sheet](../facts/pcrtc.md). Neither
`docs/architecture.md` nor the reference PDF was chapter input.

## Authority and completeness

All eight formerly open questions have sourced resolutions: PMODE operations;
packing, addressing, wrap and zero samples; blend arithmetic and channel order;
the local-memory word unit; the VBlank-entry latch; the three event positions
without normal producers; CPU access/fault policy; and RESET/FLUSH retirement.
The topic-by-topic decisions are recorded in [pcrtc.json](pcrtc.json).

Matching TS/C++ software composition is authoritative by explicit user direction.
The [WebGPU constant-blend correction](pcrtc-webgpu-constant-blend.md) records
its separate reproduced-before/GPU-tested-after runtime fix. This documentation
slice changes no backend and does not claim to have rerun that GPU regression.
The same software composition contract remains authoritative.

## Claim review

Extraction, chapter authorship from the fact sheets, and source audits were
separate passes. Independent audits covered:

- All 26 register words: addresses, names, access, reset values and decoded bits.
- Sampling, format selection, word units, swizzles, wrap, composition, RGB
  coefficient/rounding and alpha selection against mirrored software owners.
- Clock/beam equations and reset landmarks, FIELD, latch order, event producers,
  pending/mask/W1C behavior, IRQ delivery and both numerical setting examples.
- Ordinary CPU widths/alignment/modes, successive word accesses, fault causes
  and latching, and GPU RESET/FLUSH/readback/partial-upload behavior.

Four overclaims were found and corrected in both the sheet and chapter:

1. A live beam stop suppresses timing events but does not immediately blank
   already-latched pixel output. Output activation uses presentation timing.
   Sources: [TS live write](../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L587-L598),
   [C++](../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L332-L343),
   [TS latch](../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L723-L729),
   [C++](../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L446-L452).
2. RESET has bounded GPU-register scope, not a universal GPU-register reset;
   the programmed VRAM Y address extension survives.
   Sources: [TS reset](../../../machine/ts/machine/devices/gx/gpu.ts#L755-L773),
   [C++](../../../machine/cpp/machine/devices/gx/gpu.cpp#L285-L303),
   [TS presentation](../../../machine/ts/machine/devices/gx/gpu.ts#L746-L753),
   [C++](../../../machine/cpp/machine/devices/gx/gpu.cpp#L276-L283).
3. Accepted upload-prefix pixels are processed in row order subject to the
   retained mask controls; each pixel does not unconditionally write memory.
   Sources: [TS upload](../../../machine/ts/render/backend/software/gx_gpu_commands.ts#L86-L96),
   [C++](../../../machine/cpp/render/backend/software/gx_gpu_commands.cpp#L54-L72),
   [TS masked write](../../../machine/ts/render/backend/software/gx_gpu_vram.ts#L38-L45),
   [C++](../../../machine/cpp/render/backend/software/gx_gpu_vram.h#L50-L62).
4. F64's two word accesses do not imply a non-atomic CPU instruction or a
   VBlank latch between its halves.
   Sources: [TS accesses](../../../machine/ts/machine/memory/memory.ts#L664-L671),
   [C++](../../../machine/cpp/machine/memory/memory.cpp#L563-L567),
   [TS instruction timing](../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L656-L663),
   [C++](../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L380-L386).

The corrected claims were rechecked against the mirrored owners. No unsupported
or mismatched claims remain in the audited scope. The subsequent print-grouping
edits changed markup only, not hardware text.

## Semantic figure review

All three SVGs were traced against the sourced datapath and timing:

- Overview: reading circuits 1 and 2 and background enter output control
  independently, without an invented shared upstream bus. SMODE2 controls
  interlaced reading; the timing path names its actual controls and outputs.
- Window: dimension endpoints match the rectangle; horizontal and vertical
  extent-plus-one labels and signal origins agree with the geometry.
- Reset timing: beam start, HSync, VBlank begin 576, VSync/VSINT 585 and field
  end 628 agree with reset timing. Interval brackets match their endpoints.
  The figure explicitly says not to scale; it is a landmark chart, not an
  electrical waveform.

No semantic figure findings remain. Generated-PDF presentation is reviewed
separately in [pcrtc-print.md](pcrtc-print.md).

## Technical-specification supplement

Section1.1 adds a consolidated licensee-facing resource, clock and cycle summary
without replacing the existing exact datapath/register material. Extraction,
authorship and independent source/math review were separate passes. Both mirrored
owners agree; no unresolved factual, representation, timing or reader-blocking
error was found in this addition. Narrow anchors and derived values are retained
in the technical-specification supplement to [facts/pcrtc.md](../facts/pcrtc.md).

The review independently checked:

- 4MiB main RAM versus shared2MiB local memory;16-bit storage versus32-bit
  programming words;26 slots split12+14;22 programmed words plus a separate
  nonaddressable22-word display latch; two reading circuits and the raw window,
  magnification and signal-step field capacities.
- 33,868,800Hz installed system cycles versus the13.5MHz beam reference. Neither
  is promoted to an independent PCRTC/PLL/electrical bus or pixel clock.
- Reset32µs half-lines and20.096ms fields: exact field frequency31250/628Hz,
  rounded deadlines2168/624270/634024/680628 from restart at cycle0, retained
  fractional phase, late service and pending-HSINT suppression. Two independent
  arithmetic reviews agree with fresh live timing/deadline-owner execution.
- Ordinary scalar word transfers cost2base cycles, so22 separately issued
  configuration stores contribute44base cycles before preparation/waiting.
  Word-sequence base2+up(n/4) is per actual instruction, not a contiguous22-word
  update across the intervening device gap or an automatic language block copy.
- Physical clocks, pins, contention/arbitration, per-pixel fetch costs, rated
  modes and sustained rates are undefined by the audited contract and clearly
  labeled, not fabricated from word width or representable window ranges.

Fresh owner assertions also verify reset-disabled output, maximum field decoding,
zero-step output suppression and register/latch capacities. These are arithmetic
and state checks, not a measured CPU application workload or physical output test.
The current TS GPU suite passes78 tests. Native execution and the separately
recorded WebGPU regression were not rerun for this documentation-only slice.

## Partial-upload wording precision — 2026-10-17

Section 2.9 and its fact sheet now distinguish payload consumed by image
assembly and retained with the upload from words merely admitted to either
input FIFO. Both FIFOs are discarded before the retained prefix is flushed.
The existing pixel-count formula, mask behavior and missing-remainder rule
are unchanged. A nonauthor independently checked the exact changed prose and
fact labels against both live owners and their consumers: **bounded PASS**,
no source mismatch or unsupported claim. Evidence:
`/tmp/bmsx-pcrtc-prefix-source-review.md`.

Section 3.1 also links the complete shared-storage cartridge and actual output
in the Memory chapter; it adds no register or behavior claim. Publication still
requires the current changed-page print check, not the earlier page-9 proof.

## Actual source-origin versus window-position program — 2026-10-18

The [bounded source, actual-output, execution and fresh-reader review](pcrtc-window-source.md)
accepts the new154-line BLua cartridge and three unchanged256×192 output
plates. Separate live paired-owner checks cover the program and entire new
public section. Ordinary guest assertions, independently inspected captures,
full RGB scene comparison and byte-exact public reconstruction supply distinct
evidence. Source pixels, signal placement, output coordinates, programmed
readback and VBlank-latched publication remain separate. No native/accelerated
backend parity or sample-alpha inference from the opaque PNG is claimed.
The final actual-PDF review is separately recorded in pcrtc-print.md.

## Exact unequal horizontal sampling — 2026-10-18

The [finite sampling review](pcrtc-sampling-source.md) accepts the new Section6,
91 literal BLua lines and actual eight-pixel output strip. Paired producers and
actual software consumers jointly ground first-pixel phase, integer source
selection and independently converted output boundaries. All eight raw packed
source words pass the ordinary guest case; separate captured RGB samples match
all table entries. Independent source/image and public-only reader checks pass,
including byte-exact reconstruction and the corrected explicit manifest path.
No reciprocal register, physical rate or native/accelerated parity is invented.
Actual PDF acceptance is separately recorded in pcrtc-print.md.


## Constant coefficient and source/output alpha — 2026-10-18

The [finite composition review](pcrtc-mix-source.md) records Section7's complete
125-line BLua cartridge, four exact PMODE words and three distinct actual RGB
plates. Paired owners ground the coefficient equation and independent alpha
selection; actual raw-RGBA execution corroborates all four output rows rather
than inferring alpha from opaque PNGs. Ordinary guest, independent source/image
and public-only reconstruction evidence remain separate from final PDF review.
This closes the bounded contrast, not whole-console or backend-matrix acceptance.
