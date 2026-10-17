# GPU source and reader review

**Whole-chapter review pending.** This assembling manuscript is not a publication
approval. The [reader-task work list](../gpu-outline.md) separates paragraph
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
documented. Remaining packet-family paragraphs, complete CPU work
budgets and whole-reader integration are still open. Publication flags remain
false until the complete chapter is reviewed.

## Existing BIOS patterns and actual cartridge

The BIOS already supplies the source-language precedents that the examples must
follow: typed readonly records in `shell/commands.lua`, ROM/BSS command storage
in `tty/terminal.lua`, typed MMIO in `gpu/gpu.lua`, and fixed-port DMA plus ordered
IRQ handling in `kernel/dma.lua` and `gpu/commandlist.lua`. The GTE convention
audit also verified its eight printed fragments against the actual cart. It did
**not** invent a GTE-specific BIOS loader: no such user exists in the current
44 BIOS Lua files.

The new [GPU example](../../../carts/gpu_manual/README.md) uses a typed4×4
halfword image, readonly complete command packets and eight bytes of BSS results.
It adds no local ABI helper, setter facade, runtime API or publisher machinery.
Scalar loops repeatedly store to GP0; they do not misuse contiguous word stores
as fixed-port streaming. The complete eight printed Lua fragments concatenate
to the cart, apart from print whitespace.

Actual compiled cartridge/BIOS/CPU/GPU/PCRTC execution passes the guest case:
odd three-pixel readback, odd-tail re-upload witness and fourteen raw probes
for gain, T1 inheritance, zero versus black, additive color and mask protection.
The actual capture was inspected: raw/modulated texture blocks, color-interpolated
triangle, additive overlap and protected rectangles are visible. This is not a
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

`manual:check -- gpu` must still reject publication because the actual remaining
coverage and whole-chapter reviews are open. A successful preview is layout
feedback, not permission to publish a partial reference.

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
