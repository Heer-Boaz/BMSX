# APU download lesson: bounded acceptance

## Scope and authority

The new `apu-download-budget` appendix adds the missing numerical read-side
companion, one complete 74-line BLua cartridge and a linked ordinary build/run
route. Existing upload, voice formats, register reference and four-source
program are not replaced. Current paired software is authority; no architecture
or reference-console PDF supplied facts. Two fresh facts-only authors wrote
separate timing and retained-observation paragraphs; an independent actual
paired-owner reviewer checked the program, assertions and final public prose.
No runtime, BIOS, compiler, helper, framework, publisher, CSS or gate changed.

## Ordinary cartridge and exact device-work timelines are different evidence

Root built the ordinary headless-tooling product and cartridge/BIOS export,
then executed the supplied integration case. All24 raw payload words, exact
DMA count/DONE/masked pending, APU status420H at read→20H after STOP, mode0 and
zero APU/system bus faults pass. The short second read recovers unchanged
sourcewords16–19 from byteoffset40H after STOP. No source rewrite, callback,
audio asset or voice command is involved. Logs:
`/tmp/bmsx-apu-download-product.log`, `-cart-final.log`, `-guest-final.log`.
A draft's incorrect fault-port literals were corrected from the live spec
exports before first guest execution; no source or runtime repair was needed.
All 57 existing TS audio/DMA tests plus four normal permanent exact-boundary
regressions pass (61 total). The new cases reuse the existing Machine fixture
and mapped/deadline owners, assert STOP due−1 versus exactdue without a
pre-access synchronization shortcut, and preserve payload/full RAM/sentinel.
No new helper, harness or gate. Log `/tmp/bmsx-apu-download-tests-final.log`;
additional regression evidence, not ordinary guest/physical proof.

The guest's status snapshots do **not** determine STOP's exact cycle or prove
strict predeadline cancellation. Setup, polling and retained stores execute CPU
instructions; their elapsed time is not the ideal device-work sum. The public
lesson and guide state that boundary explicitly.

Separate actual-owner execution, independently produced and rerun by root,
uses six fresh Machine instances and real mapped APU/DMA accesses plus exact
device-deadline service. Both20/4 use startingoffset0 and known A5-series words;
this is not the ordinary cartridge's CPU execution/source pattern. All derived
APU/DMA dates512/529/1041/1046/1174 and512/517/645 are observed. STOP due−1
retains moving offsets128/64; exactdue gives144/80. Exactdue cases perform no
predispatch, status read or save capture before mapped CONTROL, proving that
this access services the due batch before stopping. Entire512KiB sample RAM
remain unchanged, all requested RAM words match and the following sentinel
remains intact. Existing save captures are observations only, never restored.

Scratch `/tmp/bmsx-apu-download-owner-replay.ts`; compact/full actual results
`/tmp/bmsx-apu-download-owner-observed{,-full}.json`; detailed55-line evidence
`/tmp/bmsx-apu-download-owner-observations.md`. The
[fact sheet](../facts/apu-download.md) retains paired paths and derivations.
The public timing example explicitly uses an aligned in-range O, bounded
nonwrapping source, prearmed DMA and inactive CPU/deadline service, not an
arbitrary coarse time jump or real instruction-start/latency guarantee.
No native/physical/electrical or whole-machine acceptance is claimed.

| Artifact | SHA-256 |
|---|---|
| Cart artifact | b8208fb54a44e70624399a35d60bdbea93c2f130ee0e653b13b55908a4a3d4f4 |
| Ordinary ROM | 80261368d55e0019a3d8bbd8ad6825a2fc543cbe38283acd63199c5a81ed6a36 |
| Entry module | 261c94bdfd38838ce9c8fc8e7aed4fd58e7915ac2c51312853c16310b43d55d1 |
| Results module | 77df0e5d36e0b10e204a01b54453538a37fde7bb535fdc72af9169260f70894a |
| Installed BIOS | 01b9f2f197e59144867d5844863aa7fd9752811e227e7a6901a1541a17b6e664 |
| Headless-tooling product | a38274f9eea37a4a4a759a3d0b11c72fe8170e525d2eaf0ffe1a41d069c43470 |

Before implementation, PSn00bSDK's public SPU transfer organization was studied
for peripheral mode/address, DMA transport and completion ownership. The
companion README retains its link; no foreign value or timing supplies a BMSX
fact. No audio/screenshot illustration is substituted for this raw-data lesson.
Actual PDF acceptance is separately recorded in [apu-print.md](apu-print.md).

## Independent actual-source and final-public review

# Finite source review: runnable APU download example
Scope: read-only review of the current cart, results BSS, manifest and guest assertions against paired TS/C++ APU/DMA/IRQ owners. Reviewed existing final build/test logs and artifact digest; did not rerun builds/tests, edit repository files, inspect architecture/history PDFs or author prose. No ideal-table elapsed-cycle claims are inferred from this CPU program.

## Completed findings
**No blocking source/contract defect found for the standalone fresh-boot example.** It deliberately owns DMA0 and the shared APU transfer port; it is not a drop-in service for a game with voices, another DMA owner, or unmasked interrupts.
- `carts/apu_download_manual/cart.lua:22-30` initializes sample RAM once, using MANUAL_WRITE and exactly 40 words `0x5a000000 | index`, indices 0..39. This writes bytes 0..159; no later code writes sample RAM or submits voice/APU commands. Source remains unchanged across both downloads and STOP.
- Only `results` is required (`cart.lua:3`); there is no cartlib DMA/IRQ callback registration or competing cart-side owner. IRQ_MASK is zero before programming (`cart.lua:24`); the harness starts an ordinary cartridge, not an internal APU-state injection.
- Manifest `carts/apu_download_manual/res/manifest/manifest.rommanifest:1-3` is the ordinary title plus one ROM hardware device; no alternate executable, special host hook or additional hardware is requested.

## Raw register addresses checked
All raw pointers are aligned word ports and match paired current specs, not a presumed contiguous APU fault block:
| Cart/test constant | Address |
|---|---:|
| IRQ_FLAGS / ACK / MASK | 08000000 / 08000004 / 08000008 |
| DMA0 READ / WRITE / COUNT / CONTROL / STATUS / TRIGGER | 0800000c / 10 / 14 / 18 / 1c / 20 |
| APU STATUS | 08000178 |
| TRANSFER_ADDRESS / DATA / CONTROL | 080001e8 / 080001ec / 080001f0 |
| System BUS_FAULT_CODE | **08010208** |
| APU_FAULT_CODE | **08010218** |
Cart declarations: `cart.lua:5-17`; fault declarations: `tests/carts/apu_download_manual/apu_download_manual_assert.lua:3-4`.
Paired specs: `machine/ts/spec/bmsx/io.ts:3-18,90-108,209-224,343-356`; `machine/cpp/spec/bmsx/io.h:15-30,102-121,222-237,356-369`; IO_BASE/word size `machine/ts/spec/bmsx/memory_map.ts:6,23,32` (same C++ memory-map constants).
In particular, payload RAM lies between the transfer/status block and fault block: payload buffer begins08000208, has16384 words, then BUS_FAULT_CODE is08010208; APU fault follows the bus-fault code/address/access/ack four-word block. The test does not accidentally read an event/status port instead of a fault latch.

## BSS, indexing and prearmed sequence
- `results.lua:3-14` reserves 24 received words plus six two-word status arrays and completed_phase. All fields are words; total 148 bytes. `received` begins at result+4; first 20 destination words occupy result+4..+83, second 4 occupy result+84..+99, next field starts+100. No destination overlaps the metadata arrays or crosses its declared 24-word allocation.
- `cart.lua:19-20,32-42`: phase0 COUNT 20 / sample offset 0 / result index 0; phase1 COUNT 4 / sample offset 0x40 / result index 20. The `phase * 20` destination index is 0 or 20, not an incorrect byte offset. Source 0x40 is byte 64, hence source word 16.
- Each phase selects STOP, programs the transfer address, acknowledges old DMA0 pending bit, programs all DMA registers, then STARTs DMA0 while APU_READ is still deasserted, then selects DMA_READ. Thus DMA is BUSY/request-waiting before initial prefill begins; no FORCE read drains an empty FIFO.
- CONTROL=**0x00003c12** decodes fixed read address, incrementing write address, read selector APU_READ 4, write selector FORCE 0, block 16. The final admitted block is min(count,16), hence 16+4 for phase 0 and 4 for phase 1.
Paired trigger/admission/finish: `machine/ts/machine/devices/dma/controller.ts:131-144,211-254,365-374,412-441,487-501`; `machine/cpp/machine/devices/dma/controller.cpp:62-74,141-184,289-298,336-365,412-426`.
- Polling BUSY then sampling metadata (`cart.lua:43-48`) waits for actual DMA destination accesses/count updates, not APU_TRANSFER_BUSY. STOP follows without waiting for surplus prefetch (`cart.lua:49-53`). Completed_phase is written only after STOP and all status captures; waiting for 2 cannot accept zero-initialized BSS as a pass.
- Mode 3 prefill size is FIFO free capacity, independent of DMA count; last source BLOCK_END schedules free-capacity refill even on channel completion. STOP empties/cancels but does not clear sample RAM. Paired owners: `machine/ts/machine/devices/audio/sample_transfer.ts:151-168,182-193,201-237`; `machine/cpp/machine/devices/audio/sample_transfer.cpp:122-164,195-235`.

## Assertion coverage and interpretation
`tests/carts/apu_download_manual/apu_download_manual_assert.lua:10-28` waits for both phases, then checks **all 24 payload words**, not a checksum or endpoint sample:
- Received indices 0..19 equal initialized words 0..19.
- Received indices 20..23 equal initialized words 16..19. Because there is no source rewrite between phases, this directly demonstrates preservation of the overlapping64..79 sample-RAM bytes across the first STOP and fresh address programming. It is not a second copy of source words 0..3.
- Both phases require DMA_COUNT 0, exact DMA_STATUS 2 (DONE, BUSY clear), and recorded DMA0 IRQ pending 1 even though CPU IRQ mask is 0. Each phase ACKs mask 1 (bit 0) before START, so phase1 cannot merely inherit phase0's pending bit.
- IRQ pending is raised independently of the mask; ACK clears only selected pending bits (`machine/ts/machine/devices/irq/controller.ts:72-80,102-125`; `machine/cpp/machine/devices/irq/controller.cpp:29-34,72-92`).
- Both phases require full APU status **0x420** after DMA (empty command FIFO 0x20 + scheduled transfer 0x400; no voice BUSY, APU request or fault bits), then full**0x20** and control 0 after STOP. These are complete-status assertions, not just masking out the interesting transfer bits.
- Final APU and bus fault latches must both read zero; the cart never acknowledges/clears those faults, so the test does not hide prior errors.
**Evidence limit:** status 0x420 proves refill was pending at the status-read edge; status 0x20 after STOP proves idle transfer state afterward. These two snapshots alone do not distinguish cancellation strictly before refill's deadline from completion followed by STOP. Nor does this program test exact-deadline STOP, empty CPU-read behavior, actual FIFO count/moving offset, or TS/C++ execution parity. Those need the separate source derivation or targeted timing execution. Setup, polling and result stores consume real guest cycles, so the ideal 512/529/etc table must stay separate.

## Existing ordinary-product evidence inspected
`/tmp/bmsx-apu-download-cart-final.log:1-22` shows normal cart compile/lint/ROM write/publish/export success, target apu_download_manual, debug -O3, artifact b8208fb54a44e70624399a35d60bdbea93c2f130ee0e653b13b55908a4a3d4f4.
`/tmp/bmsx-apu-download-guest-final.log:1-6` shows ordinary headless:test booting that cart with dist/system/bmsx-bios.debug.rom and `requested_words_before_surplus_prefetch: passed`; its assertions include all findings above, not just the textual test log.
Current dist/apu_download_manual.debug.rom SHA256=80261368d55e0019a3d8bbd8ad6825a2fc543cbe38283acd63199c5a81ed6a36, matching the output digest in the named artifact's artifact.json. Current cart/results timestamps precede the final cart build; final assertion source precedes the final guest run. This is artifact/log correspondence, not an independently rerun validation or proof of a separate product-host rebuild.

## Final finite public-delta review (failures only)
Reviewed only `docs/book1/apu.md:1241-1400` (download anchor through EOF) and `docs/programming/getting-started.md:1149-1180`; no whole-chapter expansion, architecture/PDF review or repository edits. Compared claims with the paired owners already reviewed, current cart/assertion source, and provided ordinary build/guest evidence. The six-case report `/tmp/bmsx-apu-download-owner-observations.md` is separate TS owner execution by another agent, not execution by this reviewer or native/C++ evidence.
1. **Missing O representation precondition**, `docs/book1/apu.md:1245,1249,1275`: O is called the programmed byte offset and used directly as initial moving offset/source-word base, but no word-aligned/in-range condition is stated. Both owners preserve raw ADDRESS while masking the moving offset with0x7fffc (`machine/ts/machine/devices/audio/sample_transfer.ts:142-145`; `machine/cpp/machine/devices/audio/sample_transfer.cpp:113-116`). For example, programming3 starts moving offset0, not3. Constrain O explicitly to an aligned low sample-RAM offset (still excluding wrap), or distinguish masked O from raw register readback. This does not affect the literal cart's0/0x40 inputs or numeric deadlines.
2. **Whitespace validation failure**, `docs/book1/apu.md:1389,1391`: both added paragraphs have trailing spaces; current `git diff --check` reports both. Remove them before final validation.
No further source/claim failure found in this finite delta. Both timeline tables,17/5-cycle DMA costs, initial16-word prefill, BLOCK_END surplus4, explicit post-DONE STOP interval, exact-due offset outcomes and CTRL3C12 agree with paired owners under the stated exact-service assumptions. Retained observations explicitly avoid claiming that guest snapshots prove exact STOP/cancellation timing.
Literal comparison passed: fenced results.lua16 lines, cart.lua58 lines (74 Lua lines total) and manifest3 lines equal their current runnable source files byte-for-byte. Guide commands name the existing ordinary product/cart/guest scripts, and its24-word/status/fault/retained-overlap coverage matches the actual assertion case. This review does not promote the separate owner replay into ordinary guest timing evidence or claim cross-platform/fresh-SDK validation.

## Resolution recheck: both public findings closed
Narrow live recheck only: `docs/book1/apu.md:1245` now explicitly defines O as a word-aligned programmed starting byte offset within sample RAM; the bounded no-wrap condition remains. This makes O agree with the owners' masked moving offset for these controlled examples without changing general raw-register semantics. The keep-together section now closes at1249, after the assumptions/cycle0 definition paragraph, rather than before it.
Trailing whitespace is absent from current retained-observation paragraphs at1389/1391. Independently rerun `git diff --check` completed successfully with no output. Both previously reported findings are resolved; no wider audit, repository edit or execution was performed for this closure.

## Bounded durable-regression review
Inspected only `git diff -- tests/lua/audio_controller.test.ts`: the two service-kind imports and new four-case parameterized block. No corrective finding. Each case refreshes installed timing, prearms mapped DMA0/APU_READ with fixed DATA/incrementing RAM and control0x3c12, dispatches actual scheduler deadlines, asserts the512/529/1041/1046 or512/517 sequence, then observes FIFO12 plus pending4 and due1174/645.
The decisive exact-edge setup is valid: after advancing to due-1 or due, only `scheduler.hasDueTimer()` runs before the mapped STOP. That scheduler query does not dispatch APU work; no capture, APU_STATUS/DATA read or timer service can pre-complete the refill. The post-STOP moving-offset assertions therefore distinguish cancellation128/64 from due-first completion144/80 through the real CONTROL access path.
The block also checks empty/stopped transfer state, DONE/count0 retained, sample-RAM equality through existing save captures, every requested destination word and the immediately following RAM sentinel. It adds tests only, not runtime/framework/helpers. No unnecessary native-parity or ordinary guest elapsed-time claim follows: these are TS owner-path regression assertions. The new block itself does not assert DATA latch, raw ADDRESS, fault latches or IRQ state; the separate prior evidence covers those other surfaces.
The reported61 audio+DMA test passes are the parent's execution result; this reviewer inspected source only and did not rerun the suite. No wider audit or repository edits performed.


## Fresh public-only reader

The fresh reader saw only the public new subsection and linked guide, no
owners/specs/facts/tests/originals. Root's three separate `cmp` checks confirm
that all reconstructed files equal the actual executed originals byte-for-byte.
This proves complete literal reconstruction, not a fresh SDK installation or
hidden assertion execution by the reader. Its bounded record follows.

# Public-only APU download reader review

Scope: only `docs/book1/apu.md` from `apu-download-budget` through EOF,
and the final `Build and inspect APU downloads` guide section.
No specs, owners, tests, private originals, PDFs or architecture were used.
No repository files were edited. No runtime or hidden-file validation is claimed.

## Literal cartridge reconstruction
Root: `/tmp/bmsx-apu-download-reader-files/`
- `results.lua`: 16 lines.
- `cart.lua`: 58 lines.
- `res/manifest/manifest.rommanifest`: 3 lines.
Total: 77 lines. All three bodies exactly equal their published fenced bodies.
Guide destination is `carts/apu_download_manual/`, with the same relative paths.

## Bounded reader findings
PASS: no demonstrated reader-blocking gap in the supplied cartridge text.
- Cycle 0 is the genuine DMA_READ-changing access edge, not setup start.
  Empty FIFO, zero carry, installed clock, inactive CPU and exclusions are explicit.
- O is a sample-RAM byte offset; Wi is at O + 4i, not a CPU address/readback.
- Twenty words use two full prefills: DMA DONE at 1046, surplus done at 1174.
  Four words still need one full prefill: DONE at 517, surplus done at 645.
- Full FIFO admission and uninterrupted admitted blocks explain 16+4 versus 4.
  Twelve leftovers and four surplus words are distinguished from requested data.
- STOP before versus exactly at the deadline, due-work ordering, FIFO discard,
  moving versus programmed offsets, DATA latch and retained DONE are explicit.
- Complete results and manifest precede the entry module. Initialization writes
  all 40 source words before either read; phase destinations are slots 0 and 20.
- Second source offset 40H selects indices 16–19, matching retained slot 20–23 data.
- DMA0/ports/source ownership, masked polling, and prohibition on mixing the
  cartlib interrupt-service route are explicit.
- Observed 420H/20H and copied words are not claimed to prove exact CPU timing,
  STOP latency or strict predeadline cancellation. No voice/audio proof is claimed.
- Root-relative commands, cartridge paths and exported debug ROM paths are given.

## Evidence boundary
The guide assumes checkout prerequisites and a supplied assertion at its explicit
`tests/carts/apu_download_manual/apu_download_manual_assert.lua` path.
That assertion is not reproduced in these sections; I did not inspect it or the
prerequisites. Its absence from these excerpts alone is not proof it is missing
from the checkout. Assertion availability, compilation and execution remain
unverified here; the quoted passing output is documentation, not my test result.

Finite check complete: three public cartridge fences reconstructed; no runtime run.

## Final bounded clarity delta
O now explicitly means a word-aligned programmed starting byte offset within
sample RAM; the bounded no-wrap qualification remains. Clarity PASS.
Rechecked extraction completeness: exactly three current public fences; all
remain byte-equal to the reconstructed files (16, 3 and 58 lines).
No additional inputs or runtime evidence used; finite recheck complete.
