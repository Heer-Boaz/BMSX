# GPU raw-image DMA example — bounded independent source review

## Result and checked scope

No current source mismatch found in the checked example/test or newly appended public supplement. One genuine original failure was found and is now closed. This is a source review, not a claim that I executed the cartridge or independently reproduced root's reported guest PASS.

Checked current `carts/gpu_dma_manual/cart.lua`, `storage.lua`, `tests/carts/gpu_dma_manual/gpu_dma_manual_assert.lua`, and the new public section at `docs/book1/gpu.md` anchor `gpu-image-dma-program` (3382 through chapter end). The baseline chapter was not re-reviewed. No repository edit and no runtime/compiler repair. `docs/architecture.md` was not opened.

Current example/test SHA256:
- cart.lua: 0af86c912a7f1766d8d0077c3f11785904fe53f77fb71d273932aebfd6d4d54a
- storage.lua: a58b4453f1f5ee4c8802aa11fd680114f29f9dbb58de616e5e2489afa1173f42
- gpu_dma_manual_assert.lua: e6e50c6bd20374f130518d46c53909d2940e453ed4af3f6061c7305a51f4603e

## Closed original failure

Original cart.lua35 /70:

> `*dma_count = #upload`
> `*dma_count = #returned`

These operands were typed local numeric address views, not declared storage identifiers. Compiler `toolchain/ts/lua/compiler.ts:5127–5136` recognizes identifier lengths through BSS/data/rodata symbol bindings, and `static_constants.ts:128–143` likewise restricts identifier declarations to those storage kinds. Local pointer annotations are not dynamic capacities. The initial attempt must not count as PASS.

Fresh current cart.lua35 /70:

> `*dma_count = #storage.upload`
> `*dma_count = #storage.returned`

These are actual const-module exported storage expressions. `compiler.ts:5138–5163` resolves exported data/BSS array dimensions; `static_constants.ts:136–143` resolves exported storage declaration lengths. Finding closed. The new public explanation accurately distinguishes exported static arrays from typed local addresses.

## Checked example ownership and arithmetic

- Typed static data/BSS is real allocated storage, not Lua numeric register tables: compiler.ts3701–3717 records declarations/initializer bytes; compiler.ts1505–1555 copies .data into RAM and zeroes BSS at startup; linker `toolchain/ts/rompack/blua32_linker.ts:351–369` separates data runtime RAM addresses from ROM load addresses.
- Existing BIOS pattern matches typed mapped pointers and raw DMA setup: `machine/bios/kernel/dma.lua:4–12,26–33` uses the same DMA0 ports, fixed GP0 and CONTROL3c41. BIOS byte traversal `machine/bios/string/utf8.lua:14–18` uses ordinary address addition, while `machine/bios/math/sin.lua:46–56` uses typed word indexing.
- Test21/29 `upload + sizeof(word[44])` and `returned + sizeof(word[41])` correctly compare **byte** addresses advanced176/164bytes, not C-style pointer-element scaling. `compiler.ts:5390–5392,5419–5422` emits ordinary ADD, primitive word size4 is `compiler/struct_types.ts:54`, dimensions multiply size at58–64, sizeof emits that size atcompiler.ts4741–4742. Typed array indexing alone multiplies by element stride (`compiler.ts:4982–5015`). No pointer-unit correction is needed.
- Upload9×9=81pixels→41packedwords+3header=44words. GPUleaf TS `machine/ts/spec/gx/gp0.ts:19–22,57–60,95–100` / C++ `machine/cpp/spec/gx/gp0.h:26–29,59–62,97–103` defines operation families and dimension normalization. Actual upload owner TSgpu.ts1805–1812,1675–1680 / C++gpu.cpp1285–1293,1152–1158 consumes that complete countedpayload. Three header literals encode opcodeA0,coordinate96,64,size9,9 correctly. Forty first payload words are1…80; finalFFFF0051 supplies onlypixel81.
- Raw software execution actually writes low/high payload halves continuously across rows: TS `machine/ts/render/backend/software/gx_gpu_commands.ts:75–99` / C++ `machine/cpp/render/backend/software/gx_gpu_commands.cpp:40–76`. Readback extracts same rectangle after ordered command prefix, not invented manually supplied bytes: TSsoftware/gx_gpu.ts18–45 / C++software/gx_gpu.cpp34–64. Readback packing/oddhighzero/countrelease are TS `gpu_command_buffer.ts:163–183` / C++ `gpu_command_buffer.h:107–128`.
- CONTROL3c41 decodes readincrement1, fixedwrite, readFORCE0,writeGX_WRITE1,blockminus1=15. CONTROL3c0a decodes fixedread,writeincrement1,readGX_READ2,writeFORCE0,blockminus1=15. Leaves TS `spec/bmsx/io.ts:374–397` / C++ `spec/bmsx/io.h:387–410`. GP1direction2/3 values are TSgp0.ts39–42 / C++gp0.h41–44; opcode04 TSgp1.ts5/C++gp1.h11. DMA0 index/address words match TSio.ts3–18,218–224 / C++io.h15–30 plus memory-map IO_BASE08000000,wordsize4; GP0/GP1 match actual GPU mapping and existing BIOS fixedport.
- Actual controller blocks are min(remaining,programmedblocksize), so upload44 splits16+16+12 and read41 splits16+16+9: TSdma/controller.ts412–470 / C++dma/controller.cpp336–394. Bothrequestselectors qualify admission: TS487–501/C++412–426. A capturedblock transfersallwords atservice withBLOCK_ENDonlylast, updatesaddresses/count, then finishes/rearbitrates: TS211–253/C++141–183. This review does not generalize blocksize1 testtitles into per-wordresamplingfor16wordblocks.
- CPUdirectwrites are excluded while channel owns GP0writeport; CPUreadunderGPUREADownership returnslatchwithoutconsumption. DMAendpointownership is BUSY-based evenbeforeadmission TScontroller180–200/C++110–130; GP0read actual TSgpu1019–1031/C++536–548; directwriteadmission TSgpu2025–2034/C++1499–1508. Test25 checks appropriate retainedlatch, notreturnedpixel.
- DMAwrites stageinseparate16wordingress beforeBLOCK_END and processpipelineatblockend: TSgpu1034–1059,1135–1158/C++gpu551–576,653–668,720–726. DONEwritesstatus2andraisesownedIRQ TScontroller365–374; STARTwhileBUSYreturnswithoutrestart TS131–143/C++62–73. Status/count loops and source/destinationadvancement expectations match this ownership.
- GPUdirection3enablesreadrequest; leaving3disablesit TSgpu1862–1875/C++1340–1353. **GX_READ line is owned by readbackport**, assertedonlydmaReadEnabled&&READY: TScommand_buffer187–192/C++h157–159; matchingcompletionpublishesREADY TS155–159/C++h96–100; finalwordpublishesIDLEandclearsrequest TS163–183/C++h107–126.
- GPUSTAT27READY/26idle/28packetacceptance distinction matches TSgpu1878–1914/C++gpu1356–1390. Finalread resumescountedbarrier TSreadGp0:1025–1026/C++542–543 and parseronlyrunsreadbackIDLE TS1153–1158/C++720–726. MarkerraisesGPUrequestatdispatch TS1204–1210/C++784–792; marker'sowncompletionnotidenticaltoIRQassertion. GP1ack clearsGPUrequestseparately TS1355–1357/C++864–866. ControllerIRQbitsGPU6/DMA00 match TSio362–370/C++375–383.

## New public supplement

Read entire new supplement, including all four printed code fences, packing/count explanation, route/control table, admittedtime table, event/ownership distinctions and final retainedobservations. No current hardware-source mismatch found in the checked contracts. Supplement distinguishes47/44 admittedDMAcharges from measuredend-to-endtime and treats retainedCPUstatussamples as observations, not a promisedstate-separationinterval or universaldeadline. It does not claim displayedoutput or PCRTCpublication fromDONE/READY/marker/idle.

The **installed timing producer** supplying RAM1cycle/word+1burst was not freshly reopened in this bounded follow-up; controller's conditional arithmetic was checked (TScontroller434–441,473–483 / C++358–365,397–407). Root must retain its separately fresh producer evidence for that exact installed preset. No contrary value found; this is an explicitly unchecked producer boundary, not a source-failure allegation.

Root's normalguestexecution log, outputhashes, reader reconstruction and exact printed byteidentity remain separate evidence. They were not executed or reproduced by this reviewer. Source agreement alone is not actual-cartridge execution proof.

## Final narrow delta — installed timing producer closed

Freshly opened the actual paired producer and injection: `machine/ts/spec/bmsx/model.ts:7–12,45–52` and `machine/cpp/spec/bmsx/model.h:12–17,50–57` define the installed model's DMA RAM word charge1 and burst setup1, and populate the model fields with those constants. `machine/ts/machine/machine.ts:98–105` / `machine/cpp/machine/machine.cpp:41–48` inject those actual fields into DMA setTiming. This closes the previously explicitly unchecked installed-producer boundary above.

Together with already reviewed controller span/admission arithmetic, the new public supplement's **47cycles** for44RAM→GP0words in16+16+12 and **44cycles** for41READYGPUREAD→RAMwords in16+16+9 are source-supported **admitted DMA charges**. They are not measured cartridge CPU issue-to-DONE intervals, fixed readiness latencies, or physical bus-bandwidth claims. No current mismatch found in this final narrow delta. No further discovery or repository edit.

## Independently executed transport replay

The separately assigned replay author executed real current Memory, CPU, IRQ,
scheduler, DMA, GPU and HeadlessGPUBackend owners. The two scratch programs
use origin(96,64) and the same 44-word/81-pixel source pattern as the cartridge.
They do not manually supply readback bytes or manufacture READY. Actual software
VRAM and every returned RAM word, plus outside-pixel and RAM guards, were checked.
The ordinary BLua run below is separate from this owner/service replay.

## Service observations and admitted charges

Installed model timing is used: RAM one cycle per word plus one setup cycle
per admitted block; the mapped IO side adds no region wait. Thus:

| Route | Actual blocks | Admitted charges | Sum |
|---|---|---|---:|
| RAM to GP0 | 16,16,12 | 17+17+13 | **47 cycles** |
| GPUREAD to RAM | 16,16,9 | 17+17+10 | **44 cycles** |

These are admitted transport charges, not the whole BLua program's cycle cost,
not sustained bus bandwidth, and not a C0-to-READY deadline.

| Controlled checkpoint | Immediate-backend replay | Delayed-backend replay |
|---|---:|---:|
| Upload DMA block services | 17,34,47 | 17,34,47 |
| Upload DMA DONE | 47 | 47 |
| C0 plus marker submitted | 47 | 47 |
| C0 PENDING; read DMA armed and gated | 49 | 49 |
| Actual backend service and READY | **49** | **149** |
| Read DMA block services | 66,83,93 | 166,183,193 |
| Read DMA DONE and marker observed | 93 | 193 |

At upload DONE cycle 47 the GPU has one parsed upload command, **zero executed
commands**, and one pending command cycle. DMA DONE therefore does not mean the
image has committed to software VRAM. C0 subsequently becomes PENDING by cycle
49. Backend service was deliberately invoked at 49 in one replay and delayed
100 cycles to 149 in the other. During that deliberate wait read DMA remains
unadmitted, readback remains PENDING and the marker remains clear. Both replays
produce the same data and admitted charges. The differing READY/read-DONE times
are explicit service choices of this observation; **neither 49 nor a two-cycle
C0-to-READY interval is a hardware latency guarantee**.

The scratch sources are `/tmp/bmsx-gpu-dma-replay-{current,delayed}.ts`, with
matching JSON/log files. Both run using the ordinary repository `tsx`,
`tsconfig.base.json` and `tests/lua/test_setup.ts` import. Their matching native
case was **not executed**; paired source agreement is not native runtime parity.

## Actual ordinary cartridge execution

The normal product and BIOS were built, then the ordinary cartridge and retained
guest integration case `raw_image_roundtrip` ran successfully. A final rebuild
and execution after the printed storage indentation settled also pass.

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:bios -- --debug
npm run build:toolchain:cart -- gpu_dma_manual --debug
npm run headless:test -- gpu_dma_manual tests/carts/gpu_dma_manual/gpu_dma_manual_assert.lua
```

All first 40 packed words match the uploaded pairs; the final returned word is
00000051 rather than the source FFFF0051. The suite also checks both status2/
count0 completions, source+176/destination+164 byte endpoints with GP0 fixed,
READY with marker/idle clear before readout, immediate BUSY and the non-consuming
CPU read under DMA ownership, drained READY, separately observed marker/idle,
and the final retained latch. No image presentation or electrical-rate claim
is inferred from these checks. The source-review-caught first `#typed-local`
attempt was stopped without success and is not counted as a passing run.

Final cartridge artifact: `25b126643a681a957f68f0ffe92fb4ec7065f72fbb24031e234347c6c972f601`.
ROM SHA256: `5862f909cdafd9f5750154ee2a9c8a2cb1d1f5e6c42a65a36440f2dc411dfe81`.
BIOS SHA256: `01b9f2f197e59144867d5844863aa7fd9752811e227e7a6901a1541a17b6e664`.
The source hashes listed above are those of the final executed/printed files.
Logs: `/tmp/bmsx-gpu-dma-{product-build,bios-build,cart-build-final,guest-final}.log`.

The existing 24 TypeScript DMA tests and 19 manual-tool tests pass. These scoped
regressions do not establish all GPU/runtime/backend behavior. No runtime,
compiler, BIOS, cartlib, renderer, publisher, stylesheet, schema or helper changed.
The new cartridge is the teaching material itself, not a new testing framework.

## Fresh public-only reader

### Independent reader report

## Checked boundaries

Read only:
- `/home/boaz/BMSX/docs/book1/gpu.md`, from `<a id="gpu-image-dma-program"></a>` through the end of the new final section.
- `/home/boaz/BMSX/carts/gpu_dma_manual/README.md`, including its literal manifest and ordinary commands.

No linked implementation, actual cartridge sources, tests, owners, architecture documents, PDFs, facts/reviews, prior context, or external references were opened. No build, guest run, print rendering, or runtime validation was performed.

## Literal reconstruction

Copied the four printed BLua fence bodies without rewriting: the first became `storage.lua`; the remaining three were concatenated in order into `cart.lua`. Copied the single YAML manifest fence literally.

- `/tmp/bmsx-gpu-dma-reader-reconstruction/storage.lua`
- `/tmp/bmsx-gpu-dma-reader-reconstruction/cart.lua`
- `/tmp/bmsx-gpu-dma-reader-reconstruction/res/manifest/manifest.rommanifest`

## Scoped acceptance

The printed material supplies a complete reconstruction without guessing: initialized-RAM upload storage and separate BSS destination/status storage; all MMIO addresses and raw controls; 44 upload words and 41 returned words; fixed/incrementing endpoint selection; DMA0/GPU port ownership; interrupt masking and separate acknowledgements; READY, DMA DONE, ordered marker, and idle waits; result fields and expected returned words/address advancement; the manifest path and ordinary repository-root build/test commands.

This is instructional/source reconstruction acceptance only. Whether those files compile, execute, or match maintained cartridge files is not established by this audit. The retained execution claims in the text were read, not independently verified. Display/PCRTC, native runtime, print layout, and end-to-end timing are outside the checked boundary.

## Factual wording ambiguity

The README introduction calls the readback "the same 81 sixteen-bit words", while the GPU section consistently defines COUNT and `word` storage in packed 32-bit words: 81 sixteen-bit pixels become 41 DMA words. The complete code, count discussion, and buffer sizes resolve the operation, but the introductory use of "words" is ambiguous about the transfer unit.

No other instructional gap was found within the checked material.

## Wording finding closure

Re-read only the README first paragraph after the correction. It now says "the same 81 sixteen-bit pixels", removing the transfer-unit ambiguity. The previous wording finding is closed. No remaining instructional gap is identified within the checked public material. This follow-up does not establish runtime or print acceptance.

Root compared the reader's three reconstructed files with the final cartridge
and manifest: all are **byte-identical**, not merely technically equivalent.
The same two Lua files were built and executed above. Four chapter fences
therefore reconstruct all 140 literal program lines, with no hidden producer
module, guessed helper or implicit command-list representation. Three ordinary
keep-together groups added after initial print inspection do not change code or
technical instructions. A final hardware-voice wording change retains the same
status-sampling and separate-PCRTC-publication limits.

## Limits and continuation

This closes the finite raw-image DMA roundtrip task, not every transfer shape,
all native/accelerated backends, physical bandwidth, all graphics illustrations,
or the full manual. Fresh bounded GTE/PCRTC audits found existing technical
specifications rather than stub chapters. Their specific remaining depth-cue,
lighting/clipping and source/window/PMODE capture assignments remain in
`docs/manual/technical-follow-up.md`; PCRTC sample-progression extraction remains
a separate sourced paragraph task. No reference-console fact or architecture
prose was used as BMSX authority.
