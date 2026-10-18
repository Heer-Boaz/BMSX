# Memory and program storage: draft source review

2026-10-17. **Partial manuscript; publication remains blocked.** This report
records bounded accepted sections, not a complete CPU/boot/memory ABI or the
whole-book newcomer acceptance target. No architecture document or reference
PDF was used as a hardware source.

The original foundation/reader-correction checks below describe the committed
`f4a7138fb` baseline. The current continuation and its evidence are recorded in
the final section; historical counts and zero-figure statements are not current
publication claims.

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

## Remaining route

The integrated draft covers bounded scalar/MMIO access and fault entry,
BIOS handoff, fetch/domains, language slots versus byte storage, selected
nominal costs and the executed two-module storage program. The continuation
below adds first-build/result observation, installed BIOS fault inspection,
firmware VRAM reservation and DMA buffer lifetime. Remaining contracts are
full exception-handler/recovery and call/permission programming, exact
required inherited-device state and other shared-device-buffer lifetimes.
No placeholder prose, guessed
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

At that baseline there were no authored image/circuit figures, hence
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

## Current continuation: usable build, reservations, faults and DMA buffers

The public chapter now adds three independently checked hardware sections;
[the first-build companion](../../programming/getting-started.md) keeps tooling
commands out of the hardware voice. No publisher, schema, compiler, runtime,
BIOS or cartlib implementation changed. No reference PDF/architecture source
was used. Production reference study was structural only: MAME's address-space
manual and Zephyr's getting-started organization on their primary GitHub trees,
not hardware facts or imported commands.

- **VRAM:** separate extraction/producer replay followed by facts-only authorship
  and root nonauthor primary-owner check. The named BIOS query returns origin/
  extent in16-bit-word columns and rows. Current216x12 atlas gives320x252 bound,
  not a maximum-derived universal320x304. Actual imported BIOS unit call returns
  `02d002c0`/`00fc0140`; the original memory integration case also passes after
  packaging that suite. Preserve the whole firmware bounding region; no release,
  globally enforced protection, complement-free or restoration rule is invented.
  Persistent facts: [memory-vram](../facts/memory-vram.md). Detailed acceptance:
  `/tmp/bmsx-memory-vram-source-review.md` and
  `/tmp/bmsx-memory-vram-prose-source-review.md`.
- **Build/observe route:** a separate extractor checked the actual manifest,
  module/entry producer, automatic matching-BIOS dependency, debug packaging,
  result runner, derived test image and ordinary player. A different facts-only
  author wrote the95-line companion; root checked it against the live owners
  and executed the exact minimal sequence. It does not claim a fresh-platform
  dependency install, numerical test/production address identity, ordinary-player
  value assertions or full SDK coverage. Persistent facts:
  [memory-workflow](../facts/memory-workflow.md); owner audit and execution logs
  `/tmp/bmsx-memory-workflow-source-review.md`,
  `/tmp/bmsx-memory-first-build-minimal.log`,
  `/tmp/bmsx-memory-first-build-player.log`.
- **Installed fault route:** public prose uses source-backed paired CPU/Memory,
  compiler namespace/vector, COP0 and BIOS monitor/command facts. A nonauthor
  independently checked the exact text, complete11-line fault cartridge,
  45-line existing-harness keyboard case and actual320x240 image. Actual
  validation and MEM/FAULT CLEAR/CONT case pass20assertions. The Memory report
  is not CP0 BAD_ADDRESS; declaring a cart exception does not replace system
  dispatch; clearing a report is not repair; unchanged-EPC CONT re-faults. Core
  source facts extend [memory-faults](../facts/memory-faults.md) as BF42–49;
  observations are MF01–08 in [memory-example](../facts/memory-example.md).
  Nonauthor report `/tmp/bmsx-memory-monitor-example-source-review.md`; actual
  execution `/tmp/bmsx-memory-fault-manual-execution.log`.
- **DMA lifetime:** root extracted paired admission/capture/live-read/writeback/
  fault/completion facts; a different author wrote the ordered preparation,
  start, wait/check/reuse and overlap section. Root nonauthor checked exact
  claims and reran the existing complete DMA cartridge/case successfully. One
  mistaken attribution of the test's GPUREAD pixel to the program's retained
  fields was found and removed by its original author. No force-ready fallback,
  successful-DONE certificate, transactional copy or all-unit lifetime is
  promised. [memory-buffers](../facts/memory-buffers.md) holds DB01–09;
  `/tmp/bmsx-memory-dma-prose-source-review.md` and
  `/tmp/bmsx-memory-dma-lifetime-validation.log` record source/execution.

The sole image is the unmodified real BIOS terminal capture following
`MEM 08010208 3`, independently viewed and traced to the actual program/command
and physical words; no diagram or mock output substitutes for it. Its bytes
match captured frame00146 exactly, SHA256
`3885d206b7bd465c5e82b7165f5f30d3ed86aca3cd787ed51b2a0e76a32ca77d`.
The full public storage listings remain the exact original32/30lines; the
fault listing is the exact11-line production program, not a host test. The
six-line BIOS query/decode follows the existing production calling convention.

Current source/figure review is bounded to these factual claims and actual
image. Independent whole-reader findings and final actual-PDF readability are
recorded separately. Full CPU/call/dynamic/string-byte contracts, non-DMA
buffer lifetimes, supervisor permissions/state restoration/successful recovery,
remaining access/timing/reset and complete SDK/Book II still prevent claiming
a complete console manual. Green executions and a longer PDF do not close them.

### Pre-reader continuation checks

A second independent DMA auditor accepted the current public prose against
paired admission/service/Memory owners and actual cartridge/assertion/log
sources. Its two internal fact precision findings were corrected: capture
explicitly excludes a status snapshot, and DB08's storage citation includes
its BSS declaration/export. Public text did not need another rewrite. Evidence:
`/tmp/bmsx-memory-dma-lifetime-independent-source-review.md`.
The separate bounded handler extraction also corroborates the narrow installed
route; broader nested/missing-vector outcomes are withheld, not added as claims.

Root's final literal checks confirm that both facts-only VRAM/DMA sections
are included unchanged, the companion exactly matches its separate author's
final text, and all three complete programs exactly match their actual source
files. The image is byte-identical to the capture; linked local paths exist.
The hardware chapter contains no tooling/source-path prose. The companion's
file roles, commands, environment boundary and test-versus-player observations
pass root's nonauthor live-owner and actual-execution check; internal symbol
facts are deliberately not promoted to a newcomer inspection API.

The final 22-page DRAFT was inspected as actual original-detail PDF rasters:
root pages 1–11, separate reviewer pages 12–22. The genuine image/caption split
was corrected using only existing authored grouping and every changed final
page was re-viewed. [The print report](memory-print.md) records bounded DRAFT
readability, not public approval. `npm run test:manual` passes all 17 tests;
this proves the existing publisher contracts, not whole-book completeness.

### Reader findings and final corrections

A fresh reviewer read only public memory/companion material and the reached DMA
chapter. Storage ownership/build/check was reconstructible, but three genuine
local gaps remained: **R1**, launching/typing into the fault monitor; **R2**,
obtaining the retained DMA results; **R3**, distinguishing this operation's
fault from an older first-pending record. These were not dismissed as style or
closed by already-green executions.

Separate source extraction and facts-only authorship add explicit fault-project
roles, debug browser/cart/server commands, the direct index URL, keyboard input
and readable PICTURE=FIT. Root actually built/launched that ordinary browser
product and typed MEM/FAULT CLEAR/CONT; all four final menu/output images were
individually viewed. The direct index avoids the existing root redirect's lost
query; FIT avoids the default overscan's cropped monitor edges. No server,
player or input code was changed. The companion separately supplies the exact
DMA result-case commands, freshly rerun successfully, without guessed BSS
addresses. Primary/source/actual-input evidence:
[memory-workflow](../facts/memory-workflow.md),
`/tmp/bmsx-memory-observation-prose-source-review.md`,
`/tmp/bmsx-memory-fault-browser-execution.md`,
`/tmp/bmsx-memory-dma-reader-command.log`.

A different extractor checked the paired Memory/DMA/CPU access owners before
a separate author supplied the before-START fault-record procedure. Root
nonauthor checked every new claim: save old information, ordinary Word/U32
ACK1, clean baseline, real completion and new-record inspection are expressly
conditional on no other fault producer or acknowledger. Keeping the old latch
or concurrent actors prevents attribution; zero CODE plus DONE still does not
prove delivery to an unready port. The registers expose no new-fault counter;
no internal API, automatic isolation, hardware restore, transaction or newly
executed corruption test is claimed. DAF01–09 extend
[memory-buffers](../facts/memory-buffers.md); independent source disposition:
`/tmp/bmsx-memory-dma-fault-attribution-source-review.md`.

The same public-only reader then re-exercised exactly these amended routes.
**R1–R3 closed on paper within this supplied-program scope; no remaining local
instruction gap found.** Evidence:
`/tmp/bmsx-memory-continuation-reader-review.md`, final recheck. This is not
source/execution/print certification or whole-console acceptance. The existing
coverage questions remain open; broader calls/dynamic storage, other buffers,
supervisor/recovery/reset/timing and general SDK inspection are not silently
closed.

Final independent integration recheck accepts only the documented edit set:
847-line chapter, 157-line companion with exact original-prefix/author-append,
unchanged complete listings and image bytes, correct links and no hardware-
voice implementation leakage. The final three changed PDF pages (16/21/22)
were independently viewed and pass bounded DRAFT readability. Evidence:
`/tmp/bmsx-memory-continuation-integration-review.md`, final addendum, and
[the print report](memory-print.md). The final publisher regression run again
passes all 17 tests. `manual:check -- memory` intentionally exits 1 for the
remaining named coverage questions and public print review, not a hidden
source/figure failure. No chapter/book completion is claimed.

## Device-specific buffer continuation

This continuation preserves the entire committed 847-line memory chapter and
157-line programming companion as exact prefixes. Separate facts-only writers
supply GEO/GTE, IMGDEC, APU and the result-observation appendix; no hardware
writer is asked to retell the architecture document or a foreign manual.
The installed BIOS image and all three complete BLua listings are unchanged.
No runtime, BIOS, cartridge, assertion, publisher or review framework is added.

- **GEO:** [GB01–07](../facts/memory-geo.md) distinguish captured configuration
  from addressed live payload, valid empty records, launch-time summaries,
  destructive busy-CMD rejection, partial writes and local fault ACK versus
  central interrupt ACK. An independent first check found an imprecise command
  alias and an overbroad matrix-read statement; the author corrected both.
  Root checked the exact final prose against paired current controllers,
  contracts and XFORM owners: bounded PASS. No arbitrary alias safety or
  allocator/ownership grant follows. Evidence:
  `/tmp/bmsx-memory-geo-gte-final-prose-source-review.md`.
- **GTE PLUS:** [GT01–03](../facts/memory-gte.md) establish five writable
  operands, pending-result capture, joint publication and CPU-only interlocked
  command submission. The exact prose respects the independent auditor's
  restriction to operand writes, not every bank word. Root separately checked
  paired bindings, computation, readiness and publication: bounded PASS in the
  same report. Existing normal GTE triangle execution is not PLUS execution.
- **IMGDEC:** [IB001–017](../facts/memory-imgdec.md) distinguish supplied word
  copies, input-DMA source release, header-inclusive output counts, progress,
  decoder/output-DMA/downstream completion, retained DATA and partial output.
  Root nonauthor checked actual paired stream/FIFO/controller and narrow DMA
  owners, including admitted-block persistence across local IMGDEC reset or
  START: bounded PASS. This is not a whole-machine reset claim or arbitrary
  failed-stream recovery recipe. Evidence:
  `/tmp/bmsx-memory-imgdec-lifetime-source-review.md`.

The companion's exact build/test pairs and expected named pass lines are
checked against the actual supplied suites and freshly executed minimal
commands. GEO is numeric geometry, IMGDEC's extra GPUREAD words are separate
test observations, and APU result checks are not audible evidence. The complete
validation routes for GEO/GTE/IMGDEC/APU and the separate 43-test GTE owner suite
also pass, within the limits in [the execution facts](../facts/memory-example.md)
and [BW01–05](../facts/memory-workflow.md). No new active-buffer mutation,
native-parity or physical-timing test is claimed. Appendix source check:
`/tmp/bmsx-memory-buffer-example-workflow-source-review.md`.

A separate public-only reader reconstructed the new sections and the reached
public programming procedures without opening facts, specs, owners or tests.
No further local route gap was found in GEO/GTE/IMGDEC or the command appendix.
Two genuine APU summary ambiguities were retained as findings, not dismissed
because the owning chapter already contains the answers: `END` must name the
actual `SLOT_ENDED` notification (not promised by immediate STOP), and a fade
must not be presented as safely clamped to source exhaustion. Narrow paired
source extraction AB13–14 supports the corrections; author revision and exact
source/reader recheck were required before accepting the final subsection.
Initial report: `/tmp/bmsx-memory-buffer-reader-review.md`.


The final 478-word APU subsection now includes those corrections and expressly
limits CMD capture to supported nonzero commands, excluding NONE. A fresh
nonauthor independently checked [AB01–14](../facts/memory-apu.md) and every final
claim against the paired APU/Memory/DMA owners, then checked the final literal
revision: **bounded factual PASS**, no genuine mirror/spec disagreement.
The initially overbroad pause-ownership, fade-residency and CMD-capture phrases
are resolved, not hardware fixes. Evidence:
`/tmp/bmsx-memory-apu-lifetime-source-review.md`.

The same public-only reader checked the revised APU text and the reached
public procedures: fade caution, SLOT_ENDED terminology/no immediate-STOP event,
and nonzero CMD qualification now answer all its local questions. **No local
finding remains in these bounded additions.** This is not whole-book acceptance
or a promise of arbitrary partial-stream recovery. The requested actual GEO
sprite/hull plates, GPU/PCRTC shared-VRAM contracts, full CPU/call/dynamic/string
route, supervisor/recovery/inheritance and broader live inspection remain open.

Final independent integration accepts the 897-line manuscript and 214-line
companion: exact 847/157-line committed prefixes, all four literal separately
authored device sections, unchanged 32/30/11-line complete programs, eight
existing groups and identical image bytes. Every new public link reaches its
intended procedure. The sole print correction joins the unchanged shared
result-procedure sentence to the preceding paragraph; no source claim changes.
Evidence: `/tmp/bmsx-memory-buffers-integration-review.md` and
[the current print report](memory-print.md).

Final `npm run test:manual` passes all 17 existing tests. Current preview receipt
has no layout errors; actual final-page checks are separate. The publication
check still deliberately exits 1 for the named GPU/PCRTC, CPU/call/dynamic/string,
supervisor/recovery/inheritance/timing/inspection coverage and public print
approval, not an unresolved source/figure finding. Neither the successful cases
nor the 24-page DRAFT is whole-console completeness evidence.

## Shared graphics storage and executed display route

Separate GPU and PCRTC extraction, followed by a nonauthor cross-boundary
audit, supplies [copied/live GPU storage](../facts/memory-gpu.md),
[PCRTC lifetime](../facts/memory-pcrtc.md) and
[publication/IRQ ordering](../facts/memory-video-publication.md). A facts-only
author wrote the shared-storage section without owners, architecture or PDF
input. A separate live-source review accepts the exact section and its
ceiling: a command limit does not undo later VRAM writes already applied,
and a published configuration does not supply a pixel snapshot or release.
Evidence: `/tmp/bmsx-memory-shared-video-source-review.md` and
`/tmp/bmsx-memory-shared-vram-boundary-source-review.md`.

The same author then received only the [executed example facts](../facts/memory-display-example.md)
and its two frozen complete modules. The nonauthor checked every resulting
claim/caption, the raw configuration arithmetic, true BIOS export, fresh-edge
procedure and exact listings against live paired sources and actual artifacts:
**bounded source PASS**, no mirror/spec disagreement. The 16-line const module
is literal; concatenating the three printed entry parts exactly reproduces the
132-line ordinary entry. Formatting-only splitting and semantic headings resolve
actual print findings, not hardware defects. The 897-line chapter and 214-line
companion remain exact prefixes; prior programs, groups and image are unchanged.
Evidence: `/tmp/bmsx-memory-display-example-final-source-review.md`.

Root executed the forced cart validation, exact minimal build/result commands
and separate ordinary timeline. `publication_and_two_surface_reuse` passes;
it checks four retained pixel words, programmed A/B/A words, three fresh callback
observations, phases and the current BIOS query, not displayed output. The
three ordinary-ROM PNGs are byte-identical to their manuscript assets. Root and
the independent reviewer individually viewed all three and checked every pixel:
each has 1024 white marker pixels and 48128 expected background pixels, no
mismatch. The 82-test TS GPU owner bundle and existing GPU result case also pass.
This is not native/all-backend execution, a DMA image-rate trace or GEO imagery.

A separate public-only reader followed the printed modules and reached public
GPU/IRQ/PCRTC/companion material, without facts, implementation or external
examples. **Bounded PASS:** publication versus snapshot/release, complete
prepare/switch/reuse, stale-event attribution, reservation scope and upload-prefix
wording now answer all five local questions. Global allocation, supervisor and
multiple-reader ownership remain open, alongside the other recorded CPU/SDK
contracts. Evidence: `/tmp/bmsx-memory-display-public-reader-review.md`.

Initial integration captures held the earlier blue image; an extra tick was
ineffective and removed. Those captures are not accepted plates. Independent
source diagnosis and the retained observer follow-up distinguish the pending
presentation/fixture defect from hardware timing; no runtime/harness change or
guest delay is introduced. Final print evidence is recorded separately, and
the remaining coverage still blocks public release.


## Newcomer route: values, calls and text

Separate bounded extraction produced [call facts MC01–33](../facts/memory-calls.md),
[value facts MD01–16](../facts/memory-values.md) and
[text facts MS01–09](../facts/memory-strings.md). Separate facts-only authors
wrote the values/text and call sections, followed by the complete program from
[LE01–10](../facts/memory-language-example.md) and its frozen ordinary sources.
No architecture document, reference PDF or other machine's language semantics
were author inputs. The new public text distinguishes typed bytes, dynamic
values, ordinary functions, static BIOS targets and shared installed globals.

Independent live-source reviews accept every final bounded claim and result
cell. Two genuine draft overstatements were corrected: universal same-address
byte aliasing was deleted, and numeric packing was narrowed to the numeric
fields of `string.pack`. A one-line internal select-binding pointer was
corrected to `base.lua:8`. Cartridge compilation and on-console `load` have
different parenthesized-call producers; the prose scopes each rule rather than
inventing a common ABI. The zero-maxStack clearing difference is withheld from
the public contract and recorded in the technical follow-up, not repaired here.
Final source disposition: **bounded PASS**, no unresolved public-source finding.
Evidence: `/tmp/bmsx-memory-language-final-source-review.md` and
`/tmp/bmsx-memory-values-text-prose-source-review.md`.

The printed 34-line results module exactly equals its actual source; joining
the consecutive 36/42-line entry parts exactly reproduces the full 78-line
entry, including blank lines and escapes. Removing only the four new authored
sections restores the previous chapter byte-for-byte. The old guide remains
an exact prefix; all previous images, keep groups and program bodies are
unchanged. Evidence: `/tmp/bmsx-memory-language-integration-review.md`.

The forced validation and exact minimal build/test commands succeed.
`calls_values_and_utf8_storage` checks all 35 retained words and the 140-byte
layout on a fresh target. The existing real on-console loader call/global
suites separately pass 48/48 tests. Neither result merges the two producers or
proves native parity, visible output, ordinary-ROM retained-result playback,
arbitrary loading, successful language-fault recovery or a complete BIOS API.
Command provenance and current build artifact identity are retained in LE07.

A separate public-only reader found a genuine reproduction gap: the new
listing's basenames did not state its project/manifest layout. The companion
now gives exact source/manifest paths and the literal minimal manifest. The
reader rechecked the final public route; a nonauthor independently checked the
path/manifest delta. **No remaining local newcomer call/value/text finding.**
Evidence: `/tmp/bmsx-memory-language-public-reader-review.md`. This is bounded
route acceptance, not whole-book completeness: full BIOS signatures, source
loading/environment, CPU/timing, interrupt/supervisor/recovery and inherited
device contracts remain recorded coverage gaps. No runtime, BIOS, compiler,
cartlib, publisher or harness implementation changed.


Final `npm run test:manual`: 17 existing tests pass. The current preview has
no layout errors and retains the source/figure approvals. The publication
check deliberately exits 1 only for the named remaining coverage and public
print approval, not a pending factual/figure correction. Actual-page evidence
is in [the print review](memory-print.md); neither check closes whole-book
acceptance.

## ROM-header layout — bounded continuation, 2026-10-18

The fresh Memory inventory and a source-blind reader independently identified
one actual baseline gap: Book III delegated its header to Memory, but Memory
only gave the four BIOS readiness checks, not the field locations. The new
**ROM header fields** subsection supplies one authoritative layout, not a
second startup procedure. Book III now targets its explicit anchor.

A fresh author used only the [frozen header packet](../facts/memory-rom-header.md).
Root integration removed guest terminology and unnecessary token-generation
exposition; it added no technical claim. A different reviewer checked every
new sentence and all 18 table rows against actual sources, not the packet:
paired `spec/bmsx/{rom_header,rom_package}` leaves; TS
`toolchain/ts/rompack/header_encode.ts:27-46` and
`machine/ts/rompack/format.ts:53-99`; native
`machine/cpp/rompack/format.cpp:20-111`; the ROM builder/prefix producers;
paired `machine/execution_address_space` boot resolution; BIOS readiness;
paired 96-byte image-header leaves and CPU system-exception entry.
No unsupported or mismatched fact remains in this finite subsection.
The independent detailed report is `/tmp/bmsx-rom-header-source-review.md`.

The checks distinguish full current package format from the smaller boot-read
prefix, ROM-relative offsets from absolute function-record addresses, and
package physical DATA from writable program DATA. They establish neither a
60-byte fully valid package nor a universal malformed-offset overflow rule.
A raw overflowing addition's differing intermediate representation is withheld;
no downstream guest divergence or runtime repair is claimed from it.

All three existing TS ROM-header tests pass; the existing native
`bmsx_rompack_format_tests` suite passes (ninja required no rebuild).
The current Memory example ROM also parses through the owning header reader,
with header size 72 and distinct image offset/function-address words. These
are format/test observations, not a new complete boot replay, public-program
execution, arbitrary-image guarantee or closure of the remaining chapter gaps.
Production GitHub reference before the edit: z88dk's
[MSX ROM startup](https://github.com/z88dk/z88dk/blob/master/lib/target/msx/classic/rom.asm),
header declaration versus startup code only; no foreign hardware fact was
provided to the author or copied into the BMSX layout. No runtime, compiler,
BIOS, publisher, CSS, schema, helper or new test implementation was changed.

A separate source-blind reader now accepts the new section and Book III route:
all earlier offset/width/endian/address gaps are resolved within this finite
assignment. The 60-byte prefix is not read as a complete-validity promise.
Report: `/tmp/bmsx-rom-header-public-reader.md`. All 16 existing fenced listings
remain exactly equal to the accepted baseline; no example code was rewritten
or rerun as supposed evidence for this table. All 19 existing manual tests pass;
they are publishing regressions, not a substitute for actual-page inspection.
The chapter remains a DRAFT with its pre-existing open coverage/print flags.

## Ordinary BIOS handoff — bounded reader bridge, 2026-10-18

A fresh source-blind reader found existing CPU/IRQ/SYSTEM/DMA contracts hard
to discover from Memory, rather than missing replacement chapters. A separate
author used only the HB01–05 packet, now retained in
[the boot facts](../facts/memory-boot.md). The new ownership subsection and
reciprocal SYSTEM link connect prior BIOS use, mask-zero versus pending/CPU IE,
first-source preparation, the firmware reservation and context-versus-pixels.
The timing paragraph links canonical CPU accounting/transfer tables and DMA
budgets without duplicating them. No universal device reset or entry snapshot
is supplied.

Independent actual-source review accepts every new claim: BIOS handoff/setup;
paired CPU EXEC/status leaves; IRQ mask, pending and selected ACK owners; GPU
register/packet banking without VRAM copies; later monitor atlas reuse; and
the distinct CPU instruction versus DMA service accounting owners. The final
ROM-tail sentence is also checked against paired Memory scalar helpers: backed
bytes remain, absent bytes are zero, and the full-access-in-window condition
is retained. Detailed report: `/tmp/bmsx-memory-handoff-source-review.md`.
Final public-source SHA256:
`364571f94a3857069707437f0010eaa3273ba4c6e84124c8d28bbddfb3f4ff77`.

A separate public-only review accepts the final route and all 11 distinct
heading/anchor targets: `/tmp/bmsx-memory-handoff-public-review.md`. The old
remaining-CPU-reference and timing-route obligations are resolved by real
existing contracts, not deleted on a build result. Full inherited per-unit
state, privileged supervisor programs, multiple-reader VRAM, coordinated
cancellation/restart and successful recovery remain open. Markdown target
existence does not close the portable-PDF navigation issue NAV01.

The current product/BIOS and unchanged IRQ cartridge build; its existing
`masked_pending_coalescing_and_source_ack` integration case passes, observing
phases 0–7, handler flags `44/44`, two services, final pending `04` and MASK zero.
This is a derived integration execution, not new ordinary-ROM output, native
parity or exhaustive entry-state proof. All 16 existing Memory fenced listings
and all image references are unchanged. The 19 existing manual tests pass.
No runtime, BIOS, compiler, cartlib, publisher, CSS, helper or test code changed.
Production reference before the edit: PSn00bSDK's
[GPU common routines](https://github.com/Lameguy64/PSn00bSDK/blob/master/libpsn00b/psxgpu/common.c),
separating reset, DMA and drawing synchronization. No foreign address, timing or
behavior was supplied to the author or used as a BMSX fact.

## Mutable word-load recovery — bounded continuation, 2026-10-18

The separate [recovery facts](../facts/memory-recovery.md) supplied two
facts-only authors: the new hardware lesson and its development-companion
route. The complete 32-line listing exactly matches
`carts/memory_recovery_manual/cart.lua`; the earlier constant-address fault
probe is unchanged. No low-level helper API, runtime, compiler, BIOS, publisher
or CSS change is included.

Independent actual-source review accepts the added claims against installed
BIOS command/scope owners and paired CPU/Memory/SYSTEM owners: mutable live
register assignment, hexadecimal frame selection, same-EPC retry, old CODE
versus a new access fault, post-read ACK and restart versus repair. It also
accepts the unmodified 320×240 pre-CONT figure and its caption. Detailed
report: `/tmp/bmsx-memory-recovery-source-review.md`. A separate public-only
reader reconstructs the source/manifest/build/browser/command/result route:
`/tmp/bmsx-memory-recovery-public-reader.md`.

Root executed the exact minimal tooling/cart/keyboard-scenario commands; the
ordinary default-O3 debug ROM passes all ten assertions without host evaluation
or guest writes outside the BIOS keyboard path. The result is two payload
words `12345678/9ABCDEF0`, old CODE1 then CODE0, with no further physical fault.
O0 was separately exercised. An ordinary Chromium/Linux browser run used real
mouse/key input; its console supplies those diagnostics while old monitor
pixels remain visible. The figure is before CONT, not synthetic success output.
These are not native, other-browser, fresh-installation or arbitrary-local
recovery guarantees. REBOOT is source-checked, not an executed restart claim.

All 19 existing manual tests pass. Public source SHA256:
`7dd0b87f41abbeb1e31f092e5f58a1a126cd77a8e32c081b0c07432a434b3d3e`.
Production reference before this slice: MAME's
[debugger reset/continue commands](https://github.com/mamedev/mame/blob/master/src/emu/debug/debugcmd.cpp),
ownership distinction only; no foreign behavior was supplied as a BMSX fact.
Privileged handlers, other fault classes, coordinated cross-unit recovery and
whole-console reader acceptance remain open. BH01 remains a separate API audit.
