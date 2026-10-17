# GEO source, programming and figure review

Source, semantic-figure and complete-reader reviews pass for the current
chapter. Controller, XFORM2/SAT2 and OVERLAP2D extractions and authorship were
separate tasks; their nonauthor checks are recorded below. Actual print
acceptance is separate in geo-print.md. Book I remains unfinished.

## Authority and scope

This edition follows the live software contract. The chapter must not invent
independent electrical memory clocks, bus waveforms or a geometry-operations
rating from the controller's record budget. No architecture document or
historical PDF supplied the extraction or runnable program. Book II owns
cartridge socket/card protocols.

Before implementation, MAME's
[Model1 TGP source](https://github.com/mamedev/mame/blob/master/src/mame/sega/model1_m.cpp)
was inspected for separation of programmed address state, operand storage,
command transport and side-effecting access. None of its memory sizes, FIFO
capacities, math operations, CPU timing or hardware programming API is a BMSX
fact. Actual BIOS and existing direct GEO source-language precedents are frozen
separately as GBL facts; no private firmware helper is invented as a cart export.

## Ordinary executable BLua program

The [cartridge](../../../carts/geo_manual/README.md) has two actual modules,
[entry](../../../carts/geo_manual/cart.lua) and
[typed storage](../../../carts/geo_manual/results.lua). The
[integration case](../../../tests/carts/geo_manual/geo_manual_assert.lua)
observes it under normal BIOS startup. It does not invoke the device from a test
hook. The program owns GEO and only its two completion sources. It uses
readonly integer-word operands, typed register runs and scalar ports, explicit
BSS, typed F32 stores and completion-sequence predicate waits.

The current readonly initializer producer does not support F32 operands. The
first prototype exposed that restriction; its F32 shape now uses explicit BSS
staging, as the existing collision library does. The compiler was not changed
and no local float/fixed encoder was added. Likewise the two-instance count is
the authored hardware count 2, not an unsupported array-length operation on a
struct-valued memory expression.

The first run passed XFORM2/SAT2 and then caught a wrong expected OVERLAP normal:
SAT orients A→B, while OVERLAP orients B→A. Source inspection established the
correction to -Y; the assertion was corrected rather than changing the device.
Both OVERLAP modes, all contact fields and subsequent fault/recovery phases
then passed. Full validation and repeat ordinary execution also pass.

Executed commands:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:bios -- --debug
npm run validate:toolchain:cart -- geo_manual --debug
npm run headless:test -- geo_manual tests/carts/geo_manual/geo_manual_assert.lua
```

Observed and asserted:

| Observation | Result |
|---|---|
| XFORM2 vertices | All 16 Q16 coordinate words match the two squares 0…4 and 1…5 |
| Optional bounds | All 8 Q16 extent words match |
| SAT2 | hit 1, normal (0,65536), depth 196608, metadata 0 |
| Candidate and full-pass contact | Binary32 normal (0,-1), depth 3, point (2.5,2.5), piece 0/0, feature 0 |
| Pair metadata | Authored 12345678H versus generated 1 |
| Both summaries | One result, one exact pair, one broadphase pair, flags 0 |
| Six processed observations | 2,1,1,2,0,0 |
| Deliberate bad record | STATUS 6, FAULT 00080000H; no successful record |
| Local ACK | STATUS 2, FAULT 0; separate from handler's central IRQ ACK |
| Recovery | Zero-count XFORM2 completes without reading the programmed bad record |
| IRQ totals | DONE 5, ERROR 1, six service sequences; owned pending bits clear, MASK 0 |

This is ordinary TypeScript guest execution. It is not native guest/backend
execution, an observed display screenshot, electrical throughput or an IRQ
latency measurement. GEO writes RAM; the example deliberately does not pretend
it is a rasterizer or submit a picture.

## Paired current-owner timing and state replay

Scratch fixtures constructed actual Memory, CPU, IRQ, scheduler and GEO owners
with installed 33,868,800/16,384,000 timing. Twelve result records were
byte-identical between TypeScript and rebuilt native owners:

| Case | Observed result |
|---|---|
| Count 0/1/2/4/16/64/640, fresh budget | Completion cycles 0/3/5/9/34/133/1323; exact progress/DONE/source asserted |
| First service delayed to 10, count 8 | Four completed records, next deadline 11; final completion 17 |
| Idle until 1000, then count 1 | Deadline/completion 1003; idle time supplies no credit |
| CMD while BUSY after one completed record | STATUS 8, PROCESSED 0, FAULT 8001FFFFH, job no longer pending |
| Captured source address, live record data | Changing the admitted record's flags then rewriting SRC0 still faults at captured source, BAD_RECORD_FLAGS record 0 |
| Real two-record XFORM2 then SAT2 | Both polygons and AABBs exactly match; XFORM completion 5, new SAT completion 8 and all five result words 1/0/65536/196608/0 |

These are explicitly controlled device-service fixtures, not timings from the
caller's HALT return. Zero-vertex records isolate controller budgeting; the
real XFORM→SAT case separately exercises actual arithmetic and data dependency.
No payload-byte bandwidth or physical service-width rating follows from them.

The existing 7 geometry/save-state tests pass. The freshly built ordinary
mirrored conformance runner passes 156 raw RAM/MMIO vectors for SAT/OVERLAP,
including non-axis-aligned geometry, binary32 edge cases and unfused-arithmetic
controls. Those vectors do not claim XFORM coverage or full guest execution.
All 16 existing manual tests pass both before and after GEO draft catalog admission. No runtime,
BIOS, cartlib, compiler, runner, publisher or stylesheet was edited.

## Independent source and complete-reader acceptance

Three fresh facts-only authors wrote nonoverlapping controller/register/timing,
XFORM2/SAT2, and OVERLAP2D sections. Root integrated the installed-resource
introduction, functional diagram and actual executable example. Authors did not
open owners, architecture prose or reference PDFs. The original extractors then
independently checked the other authors' claims against paired live owners;
they did not approve their own prose. A separate fresh agent read the entire
integrated chapter and both actual modules.

The control/semantic audit found no failure in the resource, register, capture,
timing, fault/IRQ/reset, predicate-wait or diagram claims. It separately checked
the CPU accepted-interrupt event latch, rather than inferring that HALT cannot
lose the completion wake-up. The XFORM/SAT audit found no factual failure and
verified exact reconstruction of both modules from all 11 printed code blocks.
Final author-merge deltas (including double-precision arithmetic wording and
installed-main-RAM terminology) were independently rechecked.

The OVERLAP audit found three editorial failures:

1. A piece descriptor was described as read once. Its span/bounds check precedes
   the B loop, but exact loading rereads both descriptors per overlapping piece
   pair. GOV.22's same shorthand was corrected at the fact producer too.
2. The code 6 row omitted zero-piece compounds. The row now names that emitted
   condition as well as unsupported kinds.
3. The claimed fault order omitted candidate-record and instance-record source
   checks. Those stages now explicitly precede the common pair checks.

All three corrections and the final numerical-precision wording were rechecked
against both live owners: no remaining failures. These were extraction/prose
errors, not owner/spec disagreements or reasons to change hardware behavior.

The complete reader found no instructional failure, confirmed the eleven parts
reconstruct the two actual modules, and referred one HALT-race source question
to the independent source auditor. That question was resolved by the paired CPU
latch evidence above; the reader did not pretend to verify hardware from prose.
No source, semantic-figure, numerical or whole-reader finding remains open.

## Explicit limits and remaining handbook work

The scoped owners do not supply independent electrical bus clocks/rated GEO
bandwidth or per-vertex/pair charge terms. The software-authoritative edition
states the actual record budget instead. No safe normalization, fabricated
malformed-shape rejection, arbitrary-alias guarantee or universal nonfinite
clipping safety is inferred. Large-counter and malformed-geometry conformance
beyond this extraction remain separate implementation/evidence decisions; they
are not relabeled as tested by the 156 ordinary/raw parity vectors.

No runtime, BIOS, compiler, cartlib, runner or publisher was changed to produce
this chapter. The broad technical inventory, real graphical-output plates and
other installed-unit chapters remain scheduled; GEO acceptance does not finish
Book I or the handbook.
