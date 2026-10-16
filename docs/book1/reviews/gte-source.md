# GTE source and semantic-figure review

Scope: the [chapter](../gte.md), mirrored BMSX IO/memory/numeric spec leaves,
GTE owners, and the specific CPU, mapped-memory, scheduler and machine boundary
owners linked in [the fact sheet](../facts/gte.md). No architecture document,
reference PDF or external console specification supplied chapter facts.

## Separation and completeness

Register/interface and operation extraction were separate passes. A fresh author
used only their fact sheets and the manual brief. Independent source audits then
checked the resulting claims against live TS/C++ lines. Coverage decisions are
recorded in [gte.json](gte.json), not inferred from a successful PDF build.

The review covers all 76 mapped words, special aliases/write/read transforms,
reset, both flag sets, all 22 normal commands, nominal counts, integer arithmetic,
ordered overflow, projection/divide behavior, FIFO changes, PLUS admission and
publication, access/fault boundaries, and both programming examples.

No spec/owner or mirrored-owner disagreement was found. The IO spec establishes
placement/counts; arithmetic semantics come from the matching live owners, not
from an absent separate arithmetic specification or a historical console manual.
Names without a scoped canonical alias remain indexed or functionally described.

## Findings and resolutions

An arithmetic-notation finding required correction: matrix rows were
numbered 0–2 while MAC/IR lanes were numbered 1–3, but two stage descriptions used
the same index for both. The source maps row r to lane r+1. The fact producer and
chapter now distinguish row r and lane i=r+1 in the generic matrix stage, MVMVA
cv=2 and rotation/projection. Sources:
[TS matrix](../../../machine/ts/machine/devices/gx/gte.ts#L783-L817),
[C++ matrix](../../../machine/cpp/machine/devices/gx/gte.cpp#L646-L680),
[TS projection](../../../machine/ts/machine/devices/gx/gte.ts#L950-L972),
[C++ projection](../../../machine/cpp/machine/devices/gx/gte.cpp#L824-L846).

A second wording finding concerned F64: two word callbacks and partial fault
effects did not establish the blanket statement that the access was "not atomic".
The fact sheet and chapter now state ordered word accesses and retained earlier
effects, without implying interleaving inside a CPU instruction. Sources:
[TS split store](../../../machine/ts/machine/memory/memory.ts#L664-L671),
[C++ split store](../../../machine/cpp/machine/memory/memory.cpp#L559-L567).

The source-scope expansion for bus access explicitly resolves CPU alignment
before mapped IO faults, direct-store readiness, F64's initial-address-only
readiness, and word-sequence range readiness. The F64 second-word PLUS command
hazard is documented without claiming that ordinary CPU instructions can be
interleaved. Its final prose was audited against both access dispatchers and GTE
admission owners. No access/register/reset/IRQ findings remain.

Both corrected claims were rechecked against the mirrored owners. No factual
findings remain in the audited scope. Later print-only caption/grouping edits
preserve the ranges, register values and arithmetic; the reformatted ROM bytes
are compared again before publication.

## Semantic figures

The source audit traced both SVGs. The overview preserves independent normal
DATA/CONTROL inputs, selected result/FIFO writes, FLAG and nominal CYCLES, and a
separate PLUS operand/pending/published path. It invents no GPU/VRAM output or
shared upstream bus.

The VMAD3 diagram is a not-to-scale landmark chart, not an electrical waveform.
It shows snapshot admission, five system cycles of old visible result/flag words,
publication of all three words, busy clearing and retained duration. Input writes
are next-command-only; the wait claim is restricted to a direct 32-bit CPU store
addressed to PLUS COMMAND. No semantic figure findings remain.

## Validation, not additional fact sources

- All 22 opcode/cycle rows and all 257 ordered reciprocal ROM bytes match both
  owners. The ROM is a literal source table, not an externally recalled formula.
- The 43 existing GTE tests pass.
- Both exact raw-word examples were exercised against the live TS mapped-memory
  and GTE path: RTPS gives IR/MAC=(64,32,512), depth512 and screen pair(32,16);
  VMAD3 retains old outputs at cycle4 and publishes 28002000H/00002800H with
  FLAG0 and CYCLES5 at cycle5. Normal GTE state remains unchanged by PLUS.

These are focused owner/test results, not a cartridge execution, native execution
or new TS/C++ runtime-parity claim. Save-state facts remain editorial and are not
presented as cartridge registers. PDF presentation is reviewed separately.
