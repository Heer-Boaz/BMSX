# Memory and program storage: draft source review

2026-10-17. **Partial manuscript; publication remains blocked.** This report
records bounded accepted sections, not a complete CPU/boot/memory ABI or the
whole-book newcomer acceptance target. No architecture document or reference
PDF was used as a hardware source.

## Paragraph authorship and independent checks

- Address/data-size and installed-map units were written from only the frozen
  map and relevant installed-capacity facts. Root independently checked the
  paired map/model/Memory owners and ordinary installed-model construction
  chains. One unsupported table phrase about cartridge-dependent capacity was
  returned to the original author and narrowed to the window not specifying
  installed capacity. The corrected units pass within that scope.
- Reservation and linked-placement/startup units were written by a different
  facts-only author. A nonauthor independently checked the actual linker,
  compiler, image-spec, Memory and CPU activation/EXEC source ranges. The
  bounded prose passes. It establishes neither a free arena after BSS nor a
  universal inherited-device/RAM state.
- Integration removes the duplicated reservation table and its repeated
  warning from the map unit; the following placement unit retains that
  information. The decoded aperture's 16656 × 4 = 66624 byte arithmetic and
  end address remain explicit. Assignment numbers were removed from public
  headings. This edit adds no hardware behavior.

Primary scope and source ranges remain in the separately owned facts:
[map](../facts/memory-map.md), [placement/boot](../facts/memory-boot.md),
[lifecycle](../facts/memory-lifecycle.md), and
[typed storage](../facts/memory-storage.md). The
[foundations review](memory-foundations-source.md) records extraction limits,
independent audits and the withheld arithmetic input ranges. These do not
silently become unqualified public mirror-equivalence claims.

Evidence: `/tmp/bmsx-memory-map-prose-notes.md`,
`/tmp/bmsx-memory-map-prose-source-review.md`,
`/tmp/bmsx-memory-placement-prose-notes.md` and
`/tmp/bmsx-memory-placement-source-review.md`.

## Incomplete route

The integrated draft now covers bounded scalar/MMIO access and fault entry,
BIOS handoff, fetch/domains, language slots versus byte storage, selected
nominal costs and the executed two-module storage program. Remaining contracts
are full exception-handler/recovery and call/permission programming, exact
required inherited-device state, shared-device-buffer admission/lifetime, and
the public project/launch/inspection workflow. No placeholder prose, guessed
permission, numerical raw arena or fabricated electrical rate fills these gaps.
Whole-reader and final public-print acceptance remain open; a DRAFT rendering
is not publication approval.

## Typed BLua storage section

A third facts-only author wrote the declaration/layout/view/indexing section.
A separate nonauthor source-audited every sentence, table cell and literal
firmware fragment against actual parser/compiler/layout/linker, paired scalar
CPU/spec and narrow BIOS sources. **Bounded PASS**, with no unsupported claim
found: `/tmp/bmsx-blua-storage-prose-source-review.md`. Integration changes only
heading levels/removes assignment numbers; no hardware claim or snippet changes.
Private firmware control flow is not offered as a cartridge-callable API.

The same auditor separately confirmed the constant-export evaluator boundary:
named-static-array length support does not make `#inputs` an accepted
constant-module export expression. BS25 records this distinction. The real
example uses one accepted numeric const identifier for dimensions and export;
no compiler fallback/fix or duplicate count constant was introduced.

## Executed two-module storage example

A fourth facts-only author received [the worked facts](../facts/memory-example.md)
and the exact production modules, not an architecture narrative. Root separately
reviewed the prose against actual code/type-layout/startup sources and execution.
One final-value label incorrectly said `counter`, an address; the original author
corrected it to `*counter`, the stored scalar. Corrected bounded source PASS:
`/tmp/bmsx-memory-worked-prose-source-review.md`.

Both printed modules exactly reproduce `carts/memory_manual/storage.lua` (32
lines) and `cart.lua` (30 lines). The one ordinary integration case uses those
same linked allocations and checks initial DATA/BSS observation, all record
fields, sizeof/offsetof, element/address stride, unscaled +1 byte addressing,
every input/output word and padding, and final count/status. Root independently
ran both commands successfully:

```
npm run validate:toolchain:cart -- memory_manual --debug
npm run headless:test -- memory_manual tests/carts/memory_manual/memory_manual_assert.lua
```

The full validation build and single `startup_storage_and_scalar_copy` case
pass. The six words are 00000011/12345678/33441122/00000022/9abcdef0/77885566;
initial counter12345678, initial output OR0, final counter1234567a, completed1.
Assertions remain only in the separate guest case. No renderer, output plate,
IRQ configuration, DMA/device submission, native parity or speed claim follows.
The production program is byte-storage preparation, not an asynchronous device
ownership example. Public packaging/launch/inspection teaching and the other
reader-route gaps remain open rather than being supplied by a fake API.

## Reset/handoff and language-slot sections

A separate facts-only author supplied the reset/system-startup/BIOS-handoff
section and short language-slots-versus-byte-RAM section. Root independently
checked actual paired CPU reset/EXEC/status/thread/frame/heap sources and sole
BIOS/compiler producers. The bounded prose passes with no source failure:
`/tmp/bmsx-memory-boot-prose-source-review.md`. The retained counter>=50 test
is not replaced with a physical one-second or insertion-delay promise; CPU
interrupt enable and BIOS central mask0 remain distinct. No inherited GPU/APU/
DMA/input word, raw RAM stack, free heap arena or general call ABI is invented.

Integration removes only the typed-storage section's duplicate startup
subsection, because detailed initialization and handoff already explain it.
“Ordinary Lua” becomes “ordinary BLua” for the same table-constructor contrast;
“this initializer encoder” becomes “static initialization” with the same
restriction. The sentence saying general dynamic layouts were “not established
here” is left as an internal gap rather than public placeholder prose. The
remaining storage caution still distinguishes allocation/addressability from
device completion. These edits add no hardware behavior or example line.

## Execution and scalar/fault sections

Another facts-only author supplied execution addresses, domains, read edges and
selected nominal instruction costs. The independent EF source auditor reopened
the actual primary ranges and accepted every sentence/table of that prose:
`/tmp/bmsx-memory-execution-prose-source-review.md`. Integration only uses
sentence-case headings. The text does not make internal masks/strobes into
registers, promise arbitrary RAM execution or say every scalar operation costs
two cycles. Instruction BE and record/data LE remain separate.

A separate author supplied scalar width/alignment and the fault-register/CPU
exception reference, using BF facts plus the authorized frozen system-ROM
access facts. Root independently rechecked the paired Memory/ordinary CPU/COP0
sources, exact tables and ROM-window fill/write paths: bounded PASS in
`/tmp/bmsx-memory-access-fault-prose-source-review.md`. Construction/clear words
are not an invented full reset contract. F64 partial writes are not rolled back;
returned fault-zero is not assigned by an ordinary CPU load. ACK clears the
retained first-fault record, not the sequence or a fabricated handler state.
No recovery example was invented from incomplete supervisor/handler facts.

## Structural references and validation scope

Before this slice's implementation, the production mapping/backing distinction
was checked against MAME's [memory documentation](https://github.com/mamedev/mame/blob/master/docs/source/techspecs/memory.rst)
and [address-map owner](https://github.com/mamedev/mame/blob/master/src/emu/addrmap.h).
These were structural references only, never hardware-fact inputs to chapter
authors; no foreign console address/bit/timing was imported. Actual BIOS source
precedents and the existing cartridge/test pattern supplied the BLua model.

`npm run test:manual` passes all17 tests after this integration. This validates
the unchanged shared pipeline/contracts, not hardware completeness or guest
execution. Actual cartridge validation/execution is separately recorded above;
the [DRAFT print inspection](memory-print.md) separately records actual pages.
No machine/compiler/BIOS/cartlib/runner/publisher behavior was changed.

## Final merged-copy check

A separate nonauthor compared the entire merged manuscript to all seven
approved prose inputs and expected integration edits. No retained claim/table/
code line was silently added, lost or expanded. The pre-reader 695-line source has seven
balanced authored grouping pairs; the complete production listings remain
exactly 32 and 30 lines. All 80 distinct repository source/file references in
the relevant facts/review exist. The one stale “remaining work” paragraph in
this report was corrected to distinguish already-integrated bounded sections
from genuinely unfinished contracts. Final bounded integration PASS:
`/tmp/bmsx-memory-integration-review.md`.

There are no authored image/circuit figures in this memory-only draft, hence
no unseen figure connections or image-output claims to approve. Hardware
meaning in its tables and code is covered by the separate source checks above.
This closes current-content source/figure semantics only, not the open reader
contracts, other chapters' requested output plates, or public print approval.
The ordinary publication check still rejects the chapter for those explicit
coverage questions and pending public print review; DRAFT preview is allowed.

## Newcomer exercise and four resolved local findings

A separate reader received only the public manuscript and acceptance target,
not facts, code owners or a PDF. Paper exercises passed for ownership-safe
static allocation, address/scalar distinction, layout/padding/indexing, expected
DATA/BSS and final words, width choices, fault ACK versus exception/IRQ, and
startup/handoff sequencing. This is not execution evidence; the ordinary
executed case is recorded separately above.

Four local explanations still forced inference. They were fixed before this
slice was committed:

1. Explain why this program's top-level struct names from `storage` are visible
   to the entry module without appearing in the returned address/count table.
2. Define raw32-bit Word/U32 backed-RAM equivalence within that boundary and
   low8/16/32 static integer initializer bits, instead of an opaque “writers” label.
3. Name CPU reset/EXEC as the status-assignment edge before the selected
   startup/static function, not the later program-entry-function call.
4. Name the worked input base as linked RODATA, not a suggested RAM allocation.

Root extracted the additional owning semantic type-query/compiler/endian/Memory
ranges. A nonauthor source auditor accepted MR01–MR04, then the exact facts-only
authored correction fragments; no arbitrary numeric/device/type-collision ABI
was generalized. BS26–BS28 persist the new storage facts. Source evidence:
`/tmp/bmsx-memory-reader-correction-source-review.md`. The separate reader
rechecked applied text and resolved all four clarity findings:
`/tmp/bmsx-memory-reader-review.md`.

A final integration-delta review accepts only those fragments: current source
698 lines, same seven groups, exact unchanged 32/30-line production blocks,
no unrelated cell/claim/code change. Evidence:
`/tmp/bmsx-memory-integration-review.md`, reader-correction addendum.

Broader reader gaps B1–B4 remain deliberately open: full handler/recovery;
calls/permissions and device-buffer ownership/admission/lifetime; actual public
project/build/launch/result-inspection teaching; and the named excluded access,
reset and timing contracts. Neither these paper exercises nor green builds
establish whole-chapter/book acceptance. Current source/figure semantics pass;
public print and the explicit coverage questions still block publication.
