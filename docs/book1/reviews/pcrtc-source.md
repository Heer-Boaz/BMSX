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
The [WebGPU constant-blend discrepancy](pcrtc-webgpu-constant-blend.md) remains
separate, deferred runtime work. No runtime change or real-GPU parity result is
claimed by this review.

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
