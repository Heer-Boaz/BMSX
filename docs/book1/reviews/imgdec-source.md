# IMGDEC source, programming and figure review

The earlier source/numeric and complete-reader passes accepted the four-job
program. The added displayed-output continuation now passes bounded source,
image and public-reader checks; prior print acceptance does not approve the
changed chapter. Print remains separate in
imgdec-print.md. This chapter does
not finish Book I or the handbook's broader technical/output-illustration work.

## Authority and extraction boundary

This edition documents the live software contract. Its output-word charge is
not an independent electrical oscillator or an end-to-end transfer guarantee.
Neither the architecture document nor a historical reference PDF was opened.
Cartridge socket/card protocols belong to Book III.

Before implementation, DuckStation's
[MDEC source](https://github.com/stenzek/duckstation/blob/master/src/core/mdec.cpp)
was inspected for separation of input/output FIFOs, data-port effects and
request ownership only. Its codec, addresses, constants and timing are not
BMSX facts and did not enter the chapter.

The frozen sheet records paired IMGDEC register/stream specs, controllers and
save state. Named adjacent scope supplies only the actual memory admission and
read-only policy, DMA control/request/transport, IRQ pending/ACK and accepted
HALT event, installed cycle basis, and GP0 packet/readback behavior required by
the examples. Raw internal save-state fields remain editorial facts, not
additional cartridge registers.

## Separate authors and independent checks

Five fresh facts-only writers supplied nonoverlapping register/resource,
DATA/IRQ/reset, timing, compressed-stream, and complete-program sections.
They received frozen relevant facts, not owners, architecture prose or PDFs.
The initial overly broad control-writing assignment produced no manuscript;
it was stopped and replaced by the three bounded control sections above.
Root integrated their prose, functional diagram and ordered starting route.

The original stream extractor independently checked every merged control,
register, timing, IRQ/reset and program claim against live paired owners.
It independently recomputed all eleven timing events and conversions and
checked all six printed code blocks against the two actual modules. The
control extractor separately audited the other writer's complete stream
section, every token field/range/modulo expression, both long examples and all
four compact examples. Neither reviewer approved prose it had written.

No contradicted or unsupported factual sentence/table/example was found.
Source approval includes the CPU/DMA write-admission difference, DMA block-end
effects, generated-header versus payload counts, partial fault prefixes,
post-DONE empty-read IRQ edge and final optional GPU readback procedure.

The nonauthor figure check traced every input/output FIFO connection,
configuration-to-header path, dashed header-stage control, both payload-history
directions and DATA output. Generated headers have no history connection.
The diagram makes no direct IMGDEC-to-VRAM write or bus-waveform claim.

A separate whole-reader agent used only the complete chapter and both actual
modules. It found five teaching problems: ambiguous input-FIFO wording; a
fault-wait instruction incorrectly applying to the valid empty-stream row;
failure to distinguish new CPU-write admission from stalled-write release;
missing known-valid limitation beside DMA-completion-first waits; and an
optional readback procedure worded as though the listing had executed it.
All five were corrected and independently reread. The readback is now clearly
an additional procedure inserted before the final parking loop, with direct
comparison and expected results, not a false claim about the listing. The
changed hardware wording was returned to the independent source pass and
rechecked against both live owners: no remaining failure. All six printed code
blocks remain exact after these editorial corrections.

## Actual ordinary BLua cartridge

The [cartridge](../../../carts/imgdec_manual/README.md) consists of the 53-line
[typed const module](../../../carts/imgdec_manual/results.lua) and 213-line
[entry module](../../../carts/imgdec_manual/cart.lua). All six printed code
blocks reconstruct those files byte-for-byte. It uses normal BIOS startup,
typed direct register ports, readonly word streams, explicit BSS and three
independent completion-sequence predicates. No table-based register facade,
local encoder, submission helper or new BIOS export was introduced.

Executed commands:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:bios -- --debug
npm run validate:toolchain:cart -- imgdec_manual --debug
npm run headless:test -- imgdec_manual tests/carts/imgdec_manual/imgdec_manual_assert.lua
```

The [ordinary integration case](../../../tests/carts/imgdec_manual/imgdec_manual_assert.lua)
observes the real cartridge, not a device hook:

| Phase | Observed and asserted |
|---|---|
| ROM→IMGDEC→RAM | All 26 generated words; received 19, decoded 20, DONE; DMA0/DMA1/IMGDEC sequences 1/1/1 |
| ROM→IMGDEC→fixed GP0 | Same input/counts and terminal state; both DMA completions, independent decoder completion and GPU command idle; sequences 2/2/2 |
| CPU-fed invalid first back-reference | FORMAT_FAULT, received 4, decoded 0; exact three-word retained header and retained empty DATA read; no DMA armed; sequences 2/2/3 |
| Fresh START after fault | Separate three-word RAM header, received 3, decoded 0, DONE; sequences 3/3/4 |
| Independent storage check | C0/GPUREAD returns all 12 texture and 8 CLUT words equal to the retained payload |

All valid phases record both channels BUSY before START, then count 0/STATUS
DONE afterward. Phase 3's armed-status fields are unrecorded BSS zeros, not
observed channel status. Final owned pending bits 181H are clear and MASK is
zero; unrelated pending flags are not acknowledged. The separate integration
case executes the readback; the printed four-phase listing does not.

Three long predicate lines originally exceeded print width. They were wrapped
in the actual cart producer and exact printed copies; full cart validation and
ordinary execution were repeated successfully. No type was shrunk or compiler
changed to make the listing fit.

This is ordinary TypeScript guest execution and raw GPU storage verification,
not native guest execution, a displayed picture, a screenshot or a latency
measurement of the cartridge's HALT waits.

## Paired controlled owner replays

Scratch fixtures constructed actual Memory, CPU, IRQ, scheduler, DMA and
IMGDEC owners with installed timing. The timing fixture used readonly-ROM
input and RAM output, with both channels armed at cycle 0 and no GPU or guest
instructions. Eleven event records and the complete 26-word final record
were byte-identical between TypeScript and rebuilt native owners:

| Edge | Cycle |
|---|---:|
| First 16 input words | 132 |
| Texture header | 138 |
| Literal 2 / repeat 2 / back-reference 4 | 142 / 146 / 154 |
| Input tail 3; input DMA DONE | 160 |
| Zero 4 / CLUT header | 162 / 168 |
| CLUT literal 8 | 184 |
| Output block 16 | 185 |
| Output tail 10; decoder and output DMA DONE | 196 |

ROM input blocks cost 132/28 cycles, RAM output blocks 17/11; the 26 generated
words charge 52 decode cycles. These budgets overlap. The controlled 196-cycle
interval is not a fixed GP0/VRAM completion time or whole guest-routine latency.

A second paired fixture produced ten byte-identical complete output/state
records: overlapping history across the CLUT header, empty payload, invalid
first back-reference, overlong zero run, truncated literal, bad magic,
incomplete input header, zero input count, missing repeat value and trailing
word. All prefixes, progress, terminal status, retained DATA and IRQ effects
were asserted. Both valid cases also explicitly ACKed DONE and proved a
further empty read raises IRQ80 again; the eight fault cases did not acquire
a successful completion from their extra empty read.

The existing seven IMGDEC tests and rebuilt native IMGDEC suite pass. The
sixteen existing manual tests pass with this chapter admitted to the catalog.
Those results supplement, not replace, the source, reader and actual-page
reviews. No runtime, BIOS, compiler, cartlib, publisher, stylesheet, font or
general test framework was changed.

## Software-authority note and remaining work

The post-DONE empty-read IRQ edge has no active guard in either owner and is
not one-shot. It is documented as installed behavior, including exact-count
read cautions, not fixed here or disguised as an owner disagreement. A future
hardware-policy decision is recorded in
[technical follow-up](../../manual/technical-follow-up.md).

No independent electrical memory/bus rating, entropy codec, automatic image
format validation, general malformed-stream DMA recovery or screenshot is
invented. This known-valid demonstration intentionally uses CPU access for its
fault job. Other installed-unit chapters, broader rate/technical inventory,
raw GPU image-transport teaching and real graphical-output plates remain open.

## Actual indexed-patch output — 2026-10-19

**Bounded source, figure and public-reader PASS.** The existing four jobs and
19-word stream now feed an actual displayed palette4 patch. Separate extraction
checked the decoder/upload route and paired GPU/PCRTC packet, sampling and source
mapping. A fresh facts-only author supplied the two new code-part introductions
and six-row visible-output explanation. An independent actual-owner reviewer
checked the merged program, prose, table and original image; another reader used
only public material. No architecture prose or reference-console data supplied facts.

The unchanged53-line const module and seven printed entry parts reconstruct the
executed258-line cartridge exactly. Source SHA256:
`c197385806b271d82034ceb8b946330b262fb7bc8247ec6106cab6f9c1bb3225`.
All original26 RAM output comparisons, four phase snapshots, fault/recovery,
IRQ totals3/3/4 and20 source/CLUT GPUREAD words still pass. Six complete picture
rows add360 packed words and the outside background adds one:381 GPUREAD
comparisons, not every displayed pixel. The actual capture precedes all probes.
The separate ordinary-ROM run reaches its virtual2000ms TTL; exit alone does
not check its picture. Logs: `/tmp/bmsx-imgdec-plate-{cart-build,guest,ordinary}.log`.

The unmodified full256×192 public PNG equals the test capture byte-for-byte,
SHA256 `c4b069af22a2c0ec85ad08ce1f89eb027bb560a096ed8f1f544601629414666d`.
Independent ORIGINAL-image inspection and full-region pixel counts agree with
source arithmetic: red336, green336, blue384, white960, gray960, purple1824,
outer dark blue44352. The explanation separates4×6 storage halfwords,16×6
indexed texels and the120×40 GPU draw. Both zero-fetching indices retain the
purple destination. Endpoint sample widths/heights are4, interiors8; no uniform
8× enlargement or direct decoder rendering is invented.

Two review findings were resolved without changing hardware behavior:
- The termination sentence now names callback-owned181 and separately ACKed
  GPU-marker40. Only pending bits outside both sets are preserved.
- An extractor inferred a need for initial Y-extension0 because CSR reset
  preserves that latch. Actual paired address paths use masks511/1023, identical
  for every authored Y0…191; GX16 scanout has its own linear source. The inferred
  precondition is unnecessary. No GP1 reset write or BIOS dependency was added.

Independent reports: `/tmp/bmsx-imgdec-plate-program-image-review-current.md`
(combined actual-source/program/image) and
`/tmp/bmsx-imgdec-plate-public-reader-current.md` (including final IRQ recheck).
Frozen downstream facts are in `../facts/imgdec-indexed-output.md`.
Production study used PSn00bSDK GPU common.c for distinct transport, command
and display completion methodology only, not foreign BMSX facts or code.
All24 manual tests and `git diff --check` pass. No runtime, BIOS, compiler,
publisher or harness implementation changed. Native/accelerated parity,
physical throughput, fixed IRQ latency, final print and whole-book completion
remain outside this acceptance.

2026-10-19: The completed hardware-first port/FIFO/overlap opening passes the
paired source check: IMGDEC `controller.ts:358–425,486–509,583–641` and
`controller.cpp:258–330,391–414,491–544`; both endpoint requests are required
by DMA `controller.ts:487–503` / `controller.cpp:412–426`. Source transport,
decoder production and GPU completion remain distinct. Removing external
metadata links and dispatcher wording changes no retained program operation.
Current source approval does not supply final print acceptance.
