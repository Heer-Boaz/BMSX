# GPU source and reader review

**Previously accepted chapter; new output-lesson source checks pass.** The
new lessons' final [print review](gpu-print.md) is pending; prior print acceptance
does not approve the changed layout. The [reader-task work list](../gpu-outline.md) separates paragraph
writing, independent checks, actual guest execution and final PDF acceptance.
No architecture document or hardware-reference PDF supplies chapter facts.

## Scoped extraction and paragraph checks

The [fact sheet](../facts/gpu.md) contains independently scoped raw-memory/pixel,
GP0 packet/timing and GP1/ingress/status extraction. Each fact identifies its
mirrored spec/owner source. Shared-language and adjacent PCRTC/IRQ bindings for
the real cartridge are identified separately, not presented as new GP0 fields.
No external console address, cache size or physical clock fills a source gap.

| Paragraphs | Completed independent evidence | Still not proved |
|---|---|---|
| P01 storage | Raw index/byte offsets, RGB555/mask distinction, closed/open Y gate; 624 raw-index cases, all 65,536 signed-half decode inputs and three raster cases. | Complete upload/display reader route by this paragraph alone |
| P02 primitive choice | Source/reader check of capabilities; independent 9+3=12 disjoint quad versus rectangle coverage. | General once-only coverage for arbitrary quads |
| P03–P05 placement/coverage/planes | Paired-source check, twelve coverage/placement cases, six finite planes, seven line cases; two actual Gouraud raster cases. Central C++ plane helpers also executed. Final shared-edge SVG coordinates/ownership agree. | Native raster or whole-chapter PDF acceptance |
| S01/P06 specifications/lines | Resource and access sources, real mapped GPU/scheduler IRQ at49/idle at50, all eight steep-line output words, clipped/parity progression and equal-X reversal. | CPU execution budget or physical sustained rate |
| S02 ports/status | All32 bits covered once; all256 mode bytes, draw/mask/direction probes, polygon DMA28 versus CPU admission and F64 two-port effects. Twelve focused owner tests pass. | A general DMA instruction/programming reference |
| S03 controls | Complete00–09 source/mask/reset/visibility check. All128 bit7 mode pairs, Y gate, preserved GPUREAD/raw memory and retained draw-state lifetime checked. Full GPU suite78/78 passes. | The remaining dedicated query/IRQ/ingress references |
| P07 textures/CLUT | Five actual palette/window draws including nonzero index0 and zero index17; deterministic direct depths2/3. Source rows and independent integer lookup arithmetic agree. | End-to-end uploaded palette cartridge example |
| P08 clipped/flipped mapping | All four independent flips, each with parity on/off, replayed through the live rectangle rasterizer; exact source words and untouched clipped/skipped destinations agree. | Native raster/backend parity |
| P09 gain/dither | Six independent integer modulation results and both absolute-coordinate dither phases agree with live central helpers. Primitive eligibility checked in both sources. | A captured polygon-dither image or native execution |
| P10 blend/mask | All four blend modes, seven zero/bit15/force cases and four destination-check/force combinations replayed through the live textured rasterizer. | A physical alpha or depth facility; neither is claimed |
| P11 fill/transfers | Four width interpretations and four actual mask/parity paths checked; X-wrapped backward copy and Y-wrapped downward overlapping copy reproduce the printed words. | Whole-rectangle snapshot semantics; explicitly not claimed |
| C01 stream framing | All256 opcode classifications replayed:38 discarded NOP,18 one-tick ignored,200 handled. Exact eight-word Gouraud stream, vertex-only sentinel, opcode-shaped payload and omitted-field continuation checked. Four focused tests pass. | Complete remaining family reference entries |
| S04 queries | All256 opcode/selector cases, raw masks/unsupported retention,256 queries during READY, printed five-read latch/READY trace and full-word byte-read side effect checked with live mapped owners. | BLua CPU or native readback execution by this query audit |
| C02 flat polygons | All eight triangle/quad aliases under three mask states replayed over a32×64 candidate grid; raw518f/6a11/d18f, coverage and52/94/100 ticks match independent arithmetic. | Native raster or CPU issue costs |
| C03 Gouraud polygons | All four triangle aliases execute E1/E2-looking colors as payload; exact plane words/intercepts and covered sample418a independently derived;342/346 timing costs replayed. | Native raster or whole-family executable cartridge coverage |
| S05 ingress | Paired source audit confirms separate DMA staging, BLOCK_END synchronization/drain, retained packet phase, ownership and linked admission/read-side rules. Existing tables are not duplicated. | A complete DMA-controller programming reference or actual DMA-workload timing |
| P12 costs | All57 independently derived bounded cases replayed through actual TS and compiled C++ timing owners. All worked values/strict thresholds/Q/OR/pre-skip H/ordinary sums agree. Real raster confirms12 samples versus6 work and the coordinate-wrap contrast; mapped scheduler checks separate round-up, late chaining, zero work and IRQ49/50. | Complete CPU work budget and physical sustained-rate guarantees |

A separate control reader-task audit found S06 and S08 already covered by the
existing reset/clear/readback-phase and GP1-versus-PCRTC sections. S07 also maps
to the existing marker/latch/timing example; its single missing positive fact,
that becoming idle does not itself raise IRQ_GPU, is now explicit beside GP1(02h).
No duplicate reset, IRQ or display paragraphs were added merely to mirror the
editorial assignment IDs.

These are scoped checks, not a declaration that the entire unit is completely
documented. The continuation below records the newly completed command families,
CPU interval and uploaded-palette cartridge extension. Complete-reader and final-print acceptance are now separately recorded; these
scoped checks alone were never treated as publication approval.

## Existing BIOS patterns and actual cartridge

The BIOS already supplies the source-language precedents that the examples must
follow: typed readonly records in `shell/commands.lua`, ROM/BSS command storage
in `tty/terminal.lua`, typed MMIO in `gpu/gpu.lua`, and fixed-port DMA plus ordered
IRQ handling in `kernel/dma.lua` and `gpu/commandlist.lua`. The GTE convention
audit also verified its eight printed fragments against the actual cart. It did
**not** invent a GTE-specific BIOS loader: no such user exists in the current
44 BIOS Lua files.

The new [GPU example](../../../carts/gpu_manual/README.md) uses a typed 4×4
halfword image, readonly complete command packets and eight bytes of BSS results.
A separate sixteen-entry palette and four packed index halfwords supply the
added palette4 strip. It adds no local ABI helper, setter facade, runtime API or
publisher machinery.
Scalar loops repeatedly store to GP0; they do not misuse contiguous word stores
as fixed-port streaming. The complete eight printed Lua fragments concatenate
to the cart, apart from print whitespace.

Actual compiled cartridge/BIOS/CPU/GPU/PCRTC execution passes the guest case:
odd three-pixel readback, odd-tail re-upload witness and twenty raw probes
for gain, T1 inheritance, zero versus black, additive color and mask protection.
The actual capture was inspected: raw/modulated texture blocks, color-interpolated
triangle, additive overlap, protected rectangles and the palette4 strip are visible. This is not a
native-runtime or multi-backend parity claim.

Independent cart review caught and resolved two small issues before acceptance:
blue gain192 saturates the already-full blue texels, so the comment no longer
promises a visible increase; a redundant GP1 RESET after PCRTC CSR RESET was
removed. A following raw textured rectangle now explicitly demonstrates the
polygon T1 page lifetime rather than only programming it correctly.

Reproduction using repository tools only:

```sh
npm run build:toolchain:cart -- gpu_manual --debug
npm run headless:test -- gpu_manual tests/carts/gpu_manual/gpu_manual_assert.lua
node --import tsx --import ./tests/lua/test_setup.ts --test tests/lua/gx_gpu.test.ts
npm run test:manual
npm run manual:preview -- gpu
git diff --check
```

`manual:check -- gpu` applies the separate recorded source/figure/print gates.
A successful preview is layout feedback, not publication approval. The final
visual report records every reviewed actual-page range and resolved print finding.

## Resolved extraction finding

The attribute-plane execution note initially said the `(0,0)/(4,0)/(0,4)`
example selects anchor2. Both source branches select anchor0 for these X values:
[TS branch](../../../machine/ts/render/backend/gx_gpu_render_rules.ts#L49-L51),
[C++ branch](../../../machine/cpp/render/backend/gx_gpu_render_rules.h#L43-L45).
The fact row's formula was already correct. The example note is corrected to0;
its intercept stays0a800 because its derivatives are exact. No runtime fix is
needed. The later nonexact-derivative lesson makes a wrong anchor observable.

## Validation limitation retained, not hidden by a runtime change

A selected two-test scanout filter exposed an existing fixture-order dependence:
the first test leaves raw word000b at(13,13); a following fixture reuses the same
snapshot revision without initializing that word but expects black. The second
test passes alone and the complete GPU suite passes78/78. Its source is the
snapshot/revision fixture contract, not the chapter's independent coverage math.
No defensive clear, fallback, runtime or test change was added for documentation.

## Complete interval and packet-reference continuation

W02 now includes the complete already-entered scalar function: all twelve
constant loads, four GP0 stores, both polling loops, two result stores, both
IRQ acknowledgements and return. Independent reconstruction and actual ordinary
and instruction-observed CPU dispatch agree on29 stored instructions,
63 executed instructions and83 system cycles. The fill starts at18/completes67;
the marker raises at67/completes68, and the successful status snapshots are
11922000/14922000. This is the specified isolated interval, not a universal
BLua compiler lowering or a measured physical transfer rate. The installed
clock is explicitly programmed at the timing owner; a scratch default-clock
fixture was corrected rather than masking the resulting beam status bit.

Additional nonauthor packet reviews now cover:

| Reference | Independent checks | Boundary of evidence |
|---|---|---|
| Flat textured polygons/E1 | All eight7/9-word variants replayed through mapped parser, retained snapshots and TS raster; independent128-position grid plus four inherited-flip rectangle samples, exact10-pixel example/raw contrast and scheduled costs agree. E1 reset/mask/all14bit bases, independent E6/status echoes, parser-start versus admission, queued T1 and old/new/following snapshots pass; direct depth3 and palette8 samples/page/gate/status arithmetic agree. | Paired C++ sources audited; not CPU program, native renderer or physical scanout. |
| Gouraud textured polygons | All eight formats; independent five finite planes and two covered samples, marked/unmarked/raw/opaque/mask/zero contrasts;13 actual mapped-parser/snapshot/TS-raster cases reproduce FE77/FE7A and559/538 ticks. T1 merges3709→36A3 before retention; later state cannot reinterpret it. | Paired C++ sources audited, not native raster execution. |
| Finite lines/polylines | All16 finite and16 polyline aliases plus seven boundary/contrast cases;39 independent actual mapped-parser/TS-raster cases. Exact4514/31ED steep samples and5 ticks, four flat-dither words, counted initial/continuation costs, shared additive joint twice, partial color/position state and marker recognition at the correct field boundaries agree. Real GP1 state produces retained parity per emission. | Paired sources audited; no native raster or CPU issue claim. |
| Rectangles | All32 aliases and seven zero/origin/extent/raw/modulation/dither contrasts. Actual mapped parser, real GP1-produced odd parity, retained states, full candidate regions and deadlines. Flat70 gives ten518F stores; textured64 gives only25AB/8000;26/36 ticks. | Fixed-port words are issued by the fixture, not a CPU workload. |
| Fill/upload/copy/readback |111 bounded actual mapped-parser/TS-software/readback cases. All32 aliases per transfer family; complete odd upload/mask table, consumed-prefix clear, header-only clear, wrapped reverse horizontal copy and protected downward cascade. All five wrapped readback words, prior latch DEADBEEF established by an actual earlier read, exact fence, retained Y gate, READY until final word and queued marker at release agree. Fill checks every installed word for its64/128/empty variants; command deadlines agree. | No native, physical throughput, full DMA program or display claim. |
| E2–E6 environment | Five zero reset words, exact masks/ignored bits, window byte operands, signed offsets, both gated areas, E6 status echoes and complete retained state agree with independent arithmetic and actual mapped-owner/spec execution. Queued changes wait behind a draw, then update current state without changing its snapshot; reversed X is empty and each one-word command has a one-cycle interval. | Not CPU issue, native execution or display proof. |

The uploaded-palette extension now also has a nonauthor source/math review:
all twenty probes, both quad UV planes, CLUT/page/nibble decoding, disjoint
source/destination regions, 55 drawing words, 72 readonly image/palette/index
bytes and eight BSS bytes agree. Its eight printed Lua fragments concatenate to
the current cart apart from whitespace. Actual rebuilt guest execution passes
the odd-tail witness/readback and all twenty probes; the new capture was viewed.
The complete BLua route now precedes the port/register inventory, as the manual
standard requires, rather than hiding the first usable program at the chapter end.

All command-family paragraph reviews are now complete. The separate full-reader
acceptance is recorded below; the separate final visual report now accepts the actual publication layout. The existing renderer and review schema are unchanged.

## Software authority and separately owned physical specifications

The chapter follows the requested software-authority decision. Installed memory,
33,868,800Hz system cycles, access charges, command-tick equations and visibility
edges are specified positively. The scoped owners do not establish a separate
GPU core/PLL frequency, electrical IO/VRAM bus clock or pin width, arbitration
schedule, per-pixel electrical fetch counts, or guaranteed sustained command/
pixel/byte rates. The public specification overview identifies these limits;
it does not turn two command ticks per system cycle into a physical raster clock.
Those ratings remain a separate hardware-specification task, not a reason to
invent Sony values or leave the software-defined chapter permanently blocked.
The upload/readback one-tick charge likewise supplies no fixed data-ready or
full-image transfer deadline. No backend implementation is changed to make a
stronger manual claim true.

## Whole-reader acceptance and resolved cross-reference

An independent complete-reader pass includes the final assembled C04/C06/C07/E1
entries, not placeholders. It finds no open GPU-side reader/completeness task
within the software-authoritative contract. The programmer can start from the
real BLua static picture, vary its complete packets/state through the operation
reference, predict numerical/memory effects, and use the separate admission,
command, readback, IRQ and display-publication conditions. Undefined electrical
rates, a full DMA-channel tutorial and a reusable frame-loop/buffer algorithm
are not silently promised by this unit chapter. Book I is not complete merely
because this chapter's scope is closed.

The pass found one real cross-reference overclaim: W01 said that PCRTC already
teaches displayed-buffer reuse/lifetime discipline. Its actual material teaches
programmed/displayed configuration, the VBlank latch and the multiword race,
not that general reuse algorithm. W01 now refers only to that sourced visibility
contract and explicitly remains a static example. The changed sentence was
independently reread; no new buffer guarantee or frame-loop implementation was
invented. The reader also rechecked all eight exact-cart code fragments, all43
internal links and the real BIOS storage/port/IRQ/DMA precedents. Earlier merged
word/number spacing in W02 was corrected without changing its instruction math.


## Final validation and publication

The final bundle passes16 manual tests and78 GPU tests, the rebuilt BLua
cartridge's actual guest case (20 raw probes plus counted readback/witness),
all8 exact public cartridge fragments,43 internal links and364 source-path/line
ranges. The capture was viewed. The independently executed complete scalar
function remains83 cycles; no runtime/compiler/backend behavior was changed.

All three recorded reviews and every coverage topic are closed. The ordinary
`manual:check -- gpu` and `manual:publish -- gpu` succeed. Every full-page raster
of canonical `build/manual/gpu.pdf`, including running matter, matches the approved
actual publication-layout proof exactly. Final `git diff --check` passes.
Machine owners, BIOS, shared publisher, stylesheet and fonts have no changes
in this slice. Book I remains an unfinished larger scope.

## Actual output plate — 2026-10-17

The static BLua picture now has its actual unmodified 256×192 output beside
the complete program, followed by a nine-region legend. The original capture
was freshly regenerated through the ordinary guest case; the copied PNG is
byte-identical. All 20 raw pixel probes and the counted odd readback/re-upload
witness pass. The image is not used to infer those raw words from displayed
colour components.

A bounded extractor read the actual cartridge/test, viewed the PNG and checked
only the named paired packet/raster/mask owners needed for these captions. A
fresh author received only that fact sheet. Independent nonauthors then checked
every caption, coordinate, sample and named effect against those primary sources
and the original image. The final merged insertion, nine legend rows, copied
bytes and appended fact sheet pass the separate integration check. The public
prose contains no backend/test implementation language; the extraction's evidence
limits remain in the internal facts/review.

The plate explains the raw/modulated direct-image contrast, indexed palette
strip, exact-zero versus bit-15 black samples, RGB triangle, additive overlay,
protected overlap and tiny upload/readback witnesses. It does not establish
all renderer paths, a complete interpolation/blending algorithm, native guest
parity or physical display/transfer timing. Existing operation-reference source
acceptance is separate from this bounded plate review.

All eight printed BLua fragments still match the actual cartridge apart from
indentation/blank lines. All 105 prior tables (515 rows) and 55 code blocks
remain unchanged; the two legend tables add nine rows. Four existing short
lead/table pairs now use the ordinary authored keep-together class. The unchanged
final fence-versus-image-readback caution moves before the timeline, avoiding
an otherwise nearly empty last page. No instruction, arithmetic or result was
altered. Actual print acceptance is recorded separately in gpu-print.md.

All 17 manual tests pass. No runtime, compiler, BIOS, cartlib, cartridge, runner,
publisher, stylesheet or font was changed in this slice. Further dither/coverage
contrasts, combined DMA image-transport execution, PCRTC before/after output and
GEO sprite/hull scenes remain open; this plate does not finish Book I or the
broader technical/visual audit.

## Executed raw-image DMA route — 2026-10-18

The [separate bounded source, replay, guest and reader record](gpu-dma-source.md)
accepts the complete 44-word RAM upload and 41-word READY-gated readback program
now printed at the chapter's end. Separate facts-only prose authorship, actual
paired-owner checking, real software-VRAM replay, ordinary compiled BLua guest
execution and fresh public-only byte-exact reconstruction all pass. The 47/44
cycle values are admitted DMA charges, not whole-program or READY latencies.
The actual final print acceptance is separately recorded in gpu-print.md.
No baseline opcode reference, image, runtime or publisher was rewritten.


## Full-device startup, stream resets and firmware ownership — 2026-10-18

The bounded [startup facts](../facts/gpu-startup.md) were refreshed from paired
live GPU/PCRTC/VRAM and shared BIOS owners, then given alone to a separate prose
author. The independent actual-source reviewer found no unsupported sentence in
the final compact startup paragraph: patterned full-device reset, GP1/CSR distinction,
conditional accepted/partial-upload effects, BIOS-before-entry and finite VRAM
reservation onramp. This is not another whole-GPU/BIOS/backend approval.
Source review: `/tmp/bmsx-gpu-startup-source-review.md`.

All78 existing TS GPU tests and the current native GPU suite pass, including
power-on digest/repeatable reset and GP1-preserved work cases. No tests, runtime,
BIOS, compiler, helper, harness or publisher changed; native build reports no
work needed. The unchanged complete `gpu_manual` cartridge passes quality
packing/compilation/linting and the ordinary guest case with counted readback,
material/mask probes and a fresh capture. That PNG equals the existing public
plate byte-for-byte (SHA256 `e1b4eed78b1b06fe737ac0e1ab69f6acfd66e3bd015d0e68ce3ee4be2bd124c4`).
The guest does not trigger a full machine reset or prove physical/native output;
existing paired owner tests cover the reset distinction separately. Logs:
`/tmp/bmsx-gpu-startup-{ts-tests,cpp-build,cpp-tests,cart,guest}.log`.

Production-reference study before the edit used PSn00bSDK's GPU common.c
ResetGraph/DrawSync separation of reset, DMA ownership and completion; none of
its numbers, APIs or console behavior supplied BMSX facts. Actual print and
public-reader decisions remain separate from tests and source agreement.

The final public-only check also passes after consolidating both additions into
that one paragraph at **Reset and display visibility**. It retains every reset,
conditional-work, prior-firmware and finite-reservation distinction and the
correctly titled actionable Memory query. Public-reader report:
`/tmp/bmsx-gpu-startup-public-reader.md`. This is not whole-book/SDK acceptance.

## Polygon dither and rectangle controls — 2026-10-19

**Bounded source and figure PASS.** The new `gpu-dither-output` lesson compares
the same material and modulation on two quads and two rectangle controls.
Only the dither-enabled quad changes. Independent review checked the actual
mirrored spec, packet/raster/VRAM, display and IRQ owners, not just the fact
sheet. It independently reproduces all sixteen printed RGB555 words and confirms
the source patch covers the rectangles' advancing UV coordinates. The repeated
2×2 result is operand-specific, not a replacement for the 4×4 dither matrix.

The two printed source parts concatenate byte-for-byte to the executed
73-line `carts/gpu_dither_manual/cart.lua`, SHA256
`e9b76ebe526f888e77eb0ee2f4ea0d57acc8dc97d44e7e8ae7490c4a28c8b60f`.
Its 35 readonly words, six setup words and marker total 42 GP0 stores.
Fresh debug-ROM build and actual guest case
`polygon_dither_and_rectangle_controls` pass: five 4×4 readbacks compare forty
packed words and check READY clears. The full, unmodified 256×192 capture is
byte-identical to the public plate, SHA256
`481d2b9874161be2d9ad0e7156a2a2efac01da1af375b5aeb42785d699bad40f`.
Independent original-image inspection confirms the three flat controls and
patterned upper-right quad. Raw words and displayed RGB remain separate evidence.

The public companion supplies the complete manifest/build/check/ordinary-playback
route. Separate ordinary-ROM execution reaches the virtual 2000-ms TTL; that
exit alone does not validate the picture. No native/accelerated parity,
arbitrary-geometry coverage or physical throughput is claimed. Production study
used DuckStation's software rasterizer for methodology only, not BMSX facts.

Independent reports: `/tmp/bmsx-gpu-dither-sentence-source-review-current.md`,
`/tmp/bmsx-gpu-dither-program-image-review-current.md` and
`/tmp/bmsx-gpu-dither-public-reader-current.md`. Actual run logs use the
`/tmp/bmsx-gpu-dither-` prefix. All24 existing manual tests and `git diff --check`
pass. No runtime, BIOS, compiler, publisher or harness implementation changed.
The DRAFT preview is not final print acceptance or completion of Book I.

## Shared polygon edges and polyline joints — 2026-10-19

**Bounded source, figure and public-reader PASS.** The new `gpu-coverage-output`
plate connects the existing edge equations to an actual normal quad, inward
fourth-vertex overlap and 24 drawn polylines. The brighter material and 16-times
vertex differences are explicit; it is not an enlarged capture of the small
numerical example. Independent actual-mirror arithmetic confirms 3072 single
normal-quad samples; the folded comparison box has 1072 single, 512 double and
1488 clear samples. The joint band has 2304 single and 24 doubled samples.

The three printed changes independently reconstruct the complete executed
71-line `gpu_coverage_manual` cartridge from the complete dither example,
apart from comments/whitespace. Source SHA256:
`68957ce0d42ebcc7cf994eaba92004a372afb9336c8341d886b8fee3767786c1`.
Its six environment words, thirteen readonly words, 24 five-word polylines and
marker total 140 GP0 stores. It preserves firmware VRAM and the accepted typed
MMIO/display/IRQ recipe, without a local ABI or runtime helper.

Fresh ordinary cartridge build and the actual derived-image guest case
`shared_polygon_edge_and_polyline_joint` pass. Capture precedes twelve complete
96-pixel quad rows and one 97-pixel joint row: 625 packed GPUREAD comparisons,
including clear samples, doubled material and zero odd high tail. This is not
complete raw readback of the whole image. Independent original-image inspection
and passive full-region counts agree with the source arithmetic. Public PNG
SHA256 `6e96d461e213b7c93eb062d58570c39a87109fc85d6b39ae7494282c3e4336f7`
is byte-identical to the unmodified 256×192 capture.

Independent reports: `/tmp/bmsx-gpu-coverage-math-review-current.md`,
`/tmp/bmsx-gpu-coverage-program-image-review-current.md`,
`/tmp/bmsx-gpu-coverage-sentence-source-review-current.md` and
`/tmp/bmsx-gpu-coverage-public-reader-current.md`. Logs use the
`/tmp/bmsx-gpu-coverage-` prefix. Separate ordinary-ROM playback reaches its
2000-ms virtual TTL; exit is not picture verification. All24 manual tests and
`git diff --check` pass. No runtime, BIOS, compiler, publisher or harness
implementation changed; an invalid scalar annotation in the first test draft
was corrected in that consumer, not made into a language contract.

This closes the finite coverage-output contrast, not arbitrary quad once-only
coverage, native/accelerated parity, physical throughput, final print or Book I.
