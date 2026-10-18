# PCRTC window teaching-cart source review

## Verdict and scope

**Scoped acceptance: no blocking source defect found in the four submitted files.** Checked the new cart/results module, guest assertions and capture timeline against the current mirrored TypeScript/C++ PCRTC specifications/device owners, GPU rectangle/readback/software-composition paths, and actual BIOS reservation producers. This is an independent source review, not a cart execution, guest PASS, capture inspection, print/PDF review, public-prose review, or approval of the entire book. No implementation edits were made. `docs/architecture.md` and reference PDFs were not opened.

Reviewed files:
- `carts/pcrtc_window_manual/cart.lua` SHA256 `30cea9e56ac1ac1a923d49f8d530dedca37e6116cebb808f157393e8c10ee793`
- `carts/pcrtc_window_manual/results.lua` SHA256 `ca120833c512af37ef3e60f8e9708480bc0c259b0810060f566513f81ee19105`
- `tests/carts/pcrtc_window_manual/pcrtc_window_manual_assert.lua` SHA256 `5e3e49f388558a04842166de1169679f16a4cffc884a10f1eaf23e64927698a5`
- `tests/carts/pcrtc_window_manual/pcrtc_window_manual_demo.json` SHA256 `2dcebee39b64a58404d032cf285f5ccc6abc2267b57e8da6814675035378576f`

## Checked: representation and geometry

Both owners decode raw `DISPFB` and `DISPLAY` register words identically: `machine/ts/machine/devices/gx/gpu_pcrtc.ts:361-465` and `machine/cpp/machine/devices/gx/gpu_pcrtc.cpp:120-225`. Register indexing/default words agree in `machine/{ts,cpp}/spec/gx/pcrtc.{ts,h}`. CSR reset in cart line 53 resets PCRTC timing and GPU registers in TS `gpu.ts:1410-1418`, C++ `gpu.cpp:918-926`; default SMODE1 gives four signal clocks per output pixel and SMODE2 is noninterlaced.

| Raw/cart setting | Decoded meaning, both owners |
| --- | --- |
| Both framebuffer low words `0x000fa000` | Base word 0, stride 1024 words, PSMGX16 (31), not a 256-word stride |
| Circuit2 source `0` | Raw source origin (0,0) |
| Circuit2 window `0x018252a8`, extent `0x000bf3ff` | Signal origin (680,37), magnification (4,1), signal extent 1024x192, output canvas 256x192 at (0,0) after shared crop |
| Circuit1 window `0x018553a8`, extent `0x0005f1ff` | Signal origin (936,85), signal extent 512x96; output cutout 128x96 at (64,48) |
| Circuit1 source `0x00008020` | Raw source origin (32,16), independent of window geometry |
| Circuit1 window `0x01855428` | Signal X increases 128 clocks = 32 output pixels; destination (96,48), source unchanged |

Circuit2 remains unchanged after initialization (`cart.lua:59-62`); the cutout remains fully inside its 256x192 bounds in every stage. Both owners compute union bounds from the two enabled windows, not from source origin. Circuit2 therefore keeps crop and canvas dimensions stable while circuit1 moves.

## Checked: PMODE and RGB/mask semantics

Cart line 85 programs `0x0000ff23`: EN1=EN2=1, MMOD=1, AMOD=0, SLBG=0, ALP=255. This is unblended RGB composition, specifically circuit1 **RAW_RGBA** over circuit2 **RAW_RGB**, not two source-alpha blends and not literally the named direct-circuit1 full-canvas optimization. See TS `gpu_pcrtc.ts:479-501`, C++ `gpu_pcrtc.cpp:231-255` and their PMODE constants. The cutout does not cover the whole canvas, so the full-canvas direct-circuit1 path is not selected.

TS software composition draws circuit2 then circuit1 (`gx_gpu_scanout.ts:27-44`); C++ does likewise (`gx_gpu_scanout.cpp:177-200`). Raw GX16 row writers copy RGB unconditionally without zero-word transparency testing (TS generated scanout `:98-149`; C++ scanout `:125-172`). Therefore black pixels in the cutout replace the canvas rather than becoming holes.

E6=`0xe6000001` at cart line 69 enables set-mask and disables check-mask; TS/C++ `gx_gpu_render_rules` explicitly decode bit 0 as set-mask and bit 1 as check-mask. TS `gx_gpu_vram.ts:115-139` and C++ `gx_gpu_vram.h:100-122` store RGB555 OR `0x8000`. This is stored bit 15, not a reason to describe the rectangle packets as semitransparent; opcode 0x60 is opaque/untextured.

## Checked: scene and immutability

Cart `scene` has twelve 64x64 cells filling raw (0,0)..(255,191), a 4x40 plus 40x4 white L at (8,8), an opaque black 16x16 square at (96,64), and an opaque **red 8x8** square at raw **(144,96)** (`cart.lua:21-41`). GP0 24-bit command color is R in low byte, so `0x600000ff` is red. Rectangle position/size/clip and RGB555 behavior match TS `gx_gpu_commands.ts:212-227`, `gx_gpu_rasterizer.ts:174-206` and mirrored C++ `gx_gpu_commands.cpp:217-233`, `gx_gpu_rasterizer.cpp:165-205`.

All scene submissions occur once in cart lines 70-72; three C0 readback commands at lines 73-79 only read. There are no later GP0 writes, no asset redraws and no mutations of `rodata scene` or `rodata probes`. Stage B changes only source1, stage C only window1, apart from IRQ control/result publication. Thus source code establishes static image data and static VRAM content for these stages.

Predicted distinguishing red-marker positions from source (not capture evidence): the fixed circuit2 marker remains (144,96). The circuit1 source A excludes it (sample ends at raw (127,95)); source B includes it at output (176,128); source C places it at (208,128). This prediction must be compared to actual output separately.

## Checked: readback is not being treated as visibility

The three one-pixel probes are at the white L, black square and red square. C0 requests extent 1x1 and waits for GP1 readback-ready before each GP0 read. Readback owners return the single low 16-bit pixel and no second high-half pixel (TS `gpu_command_buffer.ts:163-184`, C++ `gpu_command_buffer.h:107-131`); the software paths copy raw VRAM bytes, not composed pixels (TS `software/gx_gpu.ts:18-46`, C++ `software/gx_gpu.cpp:26-64`). Therefore asserted `FFFF`, `8000`, `801F` are the correct three raw values (`pcrtc_window_manual_assert.lua:41-43`). These values alone do not establish scanout visibility.

Each phase separately clears the pending VBlank IRQ, records the guest sequence, unmasks VBlank and waits for a changed sequence before publishing `completed_phase` (`cart.lua:85-96,103-115,122-134`). IRQ 0x4 is VBlank in both IO specs. Crucially, current runtime owners call `presentReadyFrameOnVblankEdge()` **before** raising VBlank IRQ (TS `runtime/vblank.ts:54-63`, C++ `runtime/vblank.cpp:39-47`). Presentation latches dirty PCRTC register words and marks scanout-state-only changes committed even when no new GP0 work occurs (TS `gpu.ts:1493-1513`, C++ `gpu.cpp:975-999`; mirrored `pcrtc.latchPresentationWords`). The fresh-sequence waits therefore have an actual owner-backed publication meaning, not merely a readback-ready meaning.

Guest assertions check phase progression, retained source/window words, fixed circuit2 words and three increasing before/after VBlank pairs (`:14-47`). The timeline asks for stages A/B/C at frames 1/4/7. Its actual scheduling/captures are not checked by this source review.

## Checked: BIOS ownership and present reservation

The cart queries the actual BIOS `gpu/system_vram_region` boundary instead of embedding a gameplay-side layout/encoding helper (`cart.lua:4,51`). The BIOS combines terminal bounds with the **packed upload header**, not the maximum texture allocation: `machine/bios/gpu/system_vram_region.lua:10-28`. Terminal source is (704,720), 320x240 (`tty/layout.lua:3-11,18-19`). Texture upload origin producer is (768,960) (`toolchain/ts/rompack/system_texture.ts:1-7`); `scripts/rompacker/rombuilder.ts:820-827` supplies that origin to the central upload encoder, which writes actual packed width/height (`toolchain/ts/rompack/gp0_encode.ts:6-11`). BIOS GPU helpers program raw MMIO through the same ownership boundary (`machine/bios/gpu/gpu.lua:79-106`); this cart intentionally owns the two circuits/GP0 directly rather than calling helpers that reconfigure them during the exercise.

Additional finite binary inspection, **not runtime execution**: the existing `dist/system/bmsx-bios.debug.rom` contains at file offset `0x400000` the GP0 upload header `a0000000 03c00300 000c00d8`, i.e. actual packed texture 216x12 at (768,960). Its union with the terminal is (704,720)..(1024,972), hence origin `0x02d002c0`, size `0x00fc0140`, exactly the assertion at lines 44-45. This does not assert that the maximum 256x64 packing bounds are the currently occupied texture extent. Raw scene (0..255,0..191) does not intersect the reserved union.

## Limits / unchecked

- No guest suite or headless cart was run by this reviewer; any root-reported PASS is a separate execution claim.
- No screenshot was opened, measured, or accepted here; 256x192 actual output and the frame1/4/7 stage pictures require separate execution/capture evidence.
- Public prose has not yet been reviewed; in particular it must accurately distinguish circuit1 RAW_RGBA/circuit2 RAW_RGB, raw bit15, signal-clock coordinates, and readback from fresh-VBlank publication.
- No PDF/print rendering, line-wrap/page-layout, or full-book claim.
- No WebGL/WebGPU/GLES2 backend parity or performance benchmark claim. The necessary TS/C++ software rendering/readback paths were source-checked, not exercised.
- The guest assertions do not hash all VRAM after every phase or independently assert every PMODE/circuit1 extent word. The submitted cart source supplies those invariants; do not inflate the suite into exhaustive image/architecture proof.

## Completed image/public-section addendum (supersedes those initial unchecked items)

**Images: scoped acceptance.** Independently opened each of `frame_00001.png`, `frame_00004.png`, and `frame_00007.png` individually with the image viewer. They visibly show the fixed canvas, copied white L in A, source change within the stationary cutout in B, and the same cutout displaced right in C. A separate read-only `pngjs` check confirmed all three dimensions are 256x192; A RGB at (72,56) is white and at (160,112) black; B at (128,96) is black and at (176,128) red; C at (160,96) is black and at (208,128) red. The canvas L pixel (8,8) is white in all three. Every RGB pixel of B's 128x96 cutout equals C's cutout translated +32 X. PNG alpha was deliberately ignored: it is not evidence of PCRTC sample alpha. These are my own image-view/limited RGB acceptance checks, not an independent rerun of the root's whole-image expected-scene comparison or guest suite. The public figures a/b/c are byte-identical to the three independently viewed PNGs (`cmp` success).

**Public delta: scoped acceptance at the section snapshot checked.** Read only the new `pcrtc-source-and-window` final section, previously lines 1083-1360, not the preceding chapter. Both raw register tables, source/signal/output coordinate distinctions, A-to-B source-only and B-to-C window-only descriptions, fixed canvas claim, unchanged image, ownership/reservation caveat, PMODE direct RGB/sample alpha wording, and fresh-VBlank publication paragraph agree with the actual owners checked above. Figure captions identify A L(72,56)/black(160,112), B black(128,96)/red(176,128), and C black(160,96)/red(208,128), matching the independently viewed captures and RGB probes. The statement that ALP=255 does not force sample alpha=255 is correct: mirrored software GX16 palette owners map stored bit15 to alpha 0x80, not 0xff. No host PNG alpha was used to infer that.

All five public Lua fences were mechanically extracted: the first equals `results.lua` byte-for-byte, and concatenating the next four equals `cart.lua` byte-for-byte. No code edits or source-fence drift found. This checked public-section snapshot had full-file SHA256 `780f0e12eac521b80e5e6d95218caa42d3018db3489a17199924d36fb7fd348f`.

A newly added 121-word 'Read the retained source probes' paragraph/table arrived after that public snapshot. Its exact current wording remains the sole public-delta item to finish checking; no full-book, PDF, runtime, or backend discovery is needed. Root reports later full-file hash `65ceb707a557697a8cdb1d288a2b291a47ce87f605060e4db5dff81ff3f32412`; that hash has not yet been independently checked at this addendum write.

Clarification of the earlier predicted marker statement: circuit2's source marker stays at raw/base-output (144,96), but circuit1 overlays that canvas location in these stages, so it is not asserted to remain independently visible in the final composed picture. The copied red marker is visible in B/C at the positions above.

## Final probe-paragraph delta closure

**Scoped acceptance, no blocking finding.** The current `docs/book1/pcrtc.md` independently hashes to `65ceb707a557697a8cdb1d288a2b291a47ce87f605060e4db5dff81ff3f32412`. Read the newly added lines 1164-1176 verbatim. Its 1x1 C0 request/read-after-ready/zero unused high-half description matches the already inspected mirrored readback owners; white(8,8)=FFFF, black(96,64)=8000, red(144,96)=801F matches the exact submitted GP0 scene and E6 bit15 setting. It correctly limits those probes to selected raw source pixels, not composed display pixels or whole-output proof. It also correctly separates immediate programmed register readbacks from fresh callback-sequence observations and actual picture acceptance. This closes the sole previously pending public-delta item. The complete newly added final section and its three figures are source/image accepted within the finite scope above; nothing before its anchor, no PDF/print output, no independent guest execution, and no backend matrix is claimed.

## Actual ordinary cartridge and capture execution

Root built the ordinary product/BIOS/cartridge and executed the retained
integration case `source_and_window_are_independent`. A final ordinary rebuild
and repeat execution also pass. This is separate from the source review above.

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:bios -- --debug
npm run build:toolchain:cart -- pcrtc_window_manual --debug
npm run headless:test -- pcrtc_window_manual tests/carts/pcrtc_window_manual/pcrtc_window_manual_assert.lua
npm run headless:tooling -- --debug --ttl 5 --input-timeline tests/carts/pcrtc_window_manual/pcrtc_window_manual_demo.json pcrtc_window_manual
```

The ordinary integration case checks all retained source/window words and the
fixed circuit-2 settings, three fresh VBlank sequence changes after final writes,
raw probes FFFF/8000/801F and current BIOS reservation words. It does not by itself
prove every composed pixel or universal publication latency. The timeline captures
ordinary ROM presentation frames1/4/7, **not** the derived integration target.
Selected frame numbers are this program's observations, not hardware deadlines.

Final artifact: `5529e4e400ebb74f37aa05e2c7216dc2d1e2e97eceb876fa04cb5a8fad7d7db6`.
ROM SHA256: `946e81fa498d8886cca56194de36e7acaa5da5502ada48d5246ae11ecae22615`.
BIOS SHA256: `01b9f2f197e59144867d5844863aa7fd9752811e227e7a6901a1541a17b6e664`.
Logs: `/tmp/bmsx-pcrtc-window-{product-build,bios-build,cart-build-final,guest-final,capture}.log`.
The source hashes listed in the independent review are the executed/printed files.

Root independently computed the painted RGB555-expanded scene from its literal
12 cells and four marker rectangles, then composed the fixed canvas plus the
selected cutout. All49,152 RGB pixels of **each**256×192 capture matched this
finite expected scene. No renderer result was substituted for the expected
source data, and no target image was edited or generated. Raw source probes
and full RGB comparison remain different evidence. The captured PNGs' opaque
alpha is not evidence of retained PCRTC sample alpha. No physical/native/
accelerated-backend parity or sustained-rate claim follows.

| Plate | Native file | SHA256 of capture and unchanged public figure |
|---|---|---|
| A | frame_00001.png | 3ca37b9c2fd1c65d063160c1ba9a17029bc9487ea30fd342c09b47180e4246b3 |
| B | frame_00004.png | 5ce251ef83bb641abd9e2578e3f8df597f1cc7f83fd543597a82de22dcc31a1f |
| C | frame_00007.png | 2144d39f65c88b68826f908e2604b185566bd808a2c0b483bbbcaf6790a75c45 |

The public PNGs are exact unmodified copies; root and two independent actual
image reviewers each viewed all three native images individually. The second
finite actual-image review is retained below.

# PCRTC window: independent three-image review

Scope: individually opened the three exact documentation PNGs through `view_image(detail="original")`, forwarding each as an original-detail image. Read the manual cart to identify the intended scene and phases. No repository files or images were changed.

## Actual observations

All three PNGs are **256 x 192**. The original white L remains at **(8,8)** in the upper-left red canvas cell in every image. The colored canvas stays at the same output coordinates; the overlaid cutout changes instead of the whole output moving.

| Image | Visible cutout behavior | Confirmed feature coordinates (top-left) |
| --- | --- | --- |
| A | Cutout begins at (64,48). Its copied scene includes a second white L. | Copied L (72,56); black 16 x 16 square (160,112). |
| B | Cutout remains at (64,48), but the sampled scene shifts. The copied white L is gone. | Black 16 x 16 square (128,96); red 8 x 8 square (176,128). |
| C | B's cutout content moves 32 output pixels right, with no vertical move. | Black 16 x 16 square (160,96); red 8 x 8 square (208,128). |

The cart programs a 128 x 96 circuit-1 cutout, source (0,0) in A, source (32,16) in B/C, destination (64,48) in A/B and (96,48) in C; circuit 2 is unchanged. The visible feature displacement agrees with this lesson. Source origins, circuit identities, and register semantics are identified from the program, not inferred solely from the PNGs.

In addition to visual inspection, a read-only `pngjs` check confirmed the full white L arms (40 x 4 horizontal and 4 x 40 vertical) at (8,8) in all images and at (72,56) in A, the complete listed black/red rectangles using RGB only, and contrasting immediately adjacent pixels at their four edges. It did not treat PNG alpha as hardware sample alpha.

## Ordinary-capture identity

Each documentation file is byte-for-byte identical to its corresponding existing ordinary-playback capture:

- `docs/book1/figures/pcrtc-window-a.png` = `tests/carts/pcrtc_window_manual/screenshots/frame_00001.png`; SHA-256 `3ca37b9c2fd1c65d063160c1ba9a17029bc9487ea30fd342c09b47180e4246b3`.
- `docs/book1/figures/pcrtc-window-b.png` = `tests/carts/pcrtc_window_manual/screenshots/frame_00004.png`; SHA-256 `5ce251ef83bb641abd9e2578e3f8df597f1cc7f83fd543597a82de22dcc31a1f`.
- `docs/book1/figures/pcrtc-window-c.png` = `tests/carts/pcrtc_window_manual/screenshots/frame_00007.png`; SHA-256 `2144d39f65c88b68826f908e2604b185566bd808a2c0b483bbbcaf6790a75c45`.

## Limits

This was a finite check of exactly these three images and their existing paired captures. I did not run playback, reproduce the separate 49,152-pixel full-source RGB comparison, inspect PCRTC implementation owners, establish timing behavior, or prove parity across renderer backends. The images are neither edited mockups nor new captures produced by this review.

## Fresh public-only reader and literal reconstruction

# PCRTC source/window public-reader review

## Scope and outcome

Scoped instructional acceptance: no technical instructional gap found for the stated controlled cartridge. I read only the new `pcrtc-source-and-window` final section of `docs/book1/pcrtc.md` and `carts/pcrtc_window_manual/README.md`. I did not inspect implementation, owners, tests, results, figure assets, other chapters, or prior context, and did not build, run, capture, or print anything.

The two public documents provide enough information for a new BMSX programmer to:

- Create the literal const/BSS `results.lua`, concatenate the four cart fences in their stated order into the entry module, and create the README's manifest. Typed MMIO pointers, the fixed scalar GP0 port, readonly whole-word scene packets, retained result fields, and the BIOS reservation query are explicit.
- Draw the specified GX16 scene once, perform the three source readbacks, finish the initial source work, and then leave image memory unchanged for A/B/C. The rectangle, raw pitch, sole-ownership requirements, and limited meaning of the BIOS reservation rectangle are stated.
- Configure the unchanged full-canvas circuit 2 and circuit-1 cutout with exact raw words, keep circuits disabled during preparation, and enable PMODE last. Source-pixel, signal-coordinate, and output-pixel meanings are distinguished, including output crop origin and excluded cutout endpoints.
- Make A to B by changing only `DISPFB1_HIGH`, and B to C by changing only `DISPLAY1_LOW`, with exact source/window words and expected geometry. The fixed second circuit prevents moving the crop origin from obscuring the distinction.
- Retain source/window readbacks and observe a fresh VBlank callback after each final display write. The stale acknowledgement, mask/sequence/unmask/wait sequence is explicit; immediate programmed-word readback is expressly not visible-display acceptance.
- Use the ordinary repository build, test, and playback-capture commands without inventing a command or an invocation target. The README names capture frames and output paths and limits those frame numbers to this controlled program.

## Evidence limits

The captions specify intended feature positions and the README specifies expected source probes and full-image comparison. I have not checked those pixels, source values, actual capture files, runtime behavior, compilation, or printed presentation. Reading the captions is not source-image, screenshot, or display acceptance. Opaque capture alpha is explicitly separated from retained sample alpha. The example is explicitly not a general allocator, concurrent publication protocol, or restoration/takeover recipe.

## Literal reconstruction

Written under `/tmp/bmsx-pcrtc-window-reader-reconstruction/`:

- `results.lua`: first Lua fence, 314 bytes.
- `cart.lua`: four subsequent Lua fences concatenated literally in order, 4145 bytes.
- `res/manifest/manifest.rommanifest`: README YAML fence, 72 bytes.

No comparison with the actual cartridge was performed. These are ready for the parent to compare and build independently.

## Delta review: retained source probes

Public-only review of the added `Read the retained source probes` subsection: no technical instructional gap found. It now explicitly maps all three retained entries to source coordinates, colour, and expected raw low halves (`FFFF`, `8000`, `801F`). It explains the 1 x 1 C0 read, READY sequencing, zero unused high half, and why stored bit 15 remains set. The text distinguishes raw source-memory samples from composed display pixels and limits three successful probes to those three pixels rather than the whole image.

The programmed-source/window explanation also correctly scopes the instructional evidence: immediate readback records the programmed words, while fresh VBlank sequence observations and actual output pictures remain separate observations. This review accepts the clarity and completeness of the added instructions only; I did not independently verify the stated hardware facts, implementation, test results, images, or runtime behavior. No new reconstruction or implementation inspection was performed.

Root compared all three reconstructed files against the final cartridge and
manifest: **byte-identical**. The first public fence reconstructs the17-line
const module; the next four concatenate into the137-line entry module. Those
same154 literal BLua lines were built and executed above. No hidden source
file, guessed API, local ABI encoder or dynamic register array supplies the
programming route. The reader did not open owners, facts, implementation,
test code, or figure assets and makes no runtime/image/print claim.

## Extraction, authorship, revisions and limits

A separate live-source extraction checked the raw geometry and latch recipe.
Its first temporary worksheet reversed the requested B/C demonstration order;
that worksheet was corrected before being retained as future input. It was not
the public author's input: root's frozen sheet, actual cart and all published
figures consistently use source-first B, then window movement C. This was an
editorial recipe-order error, not a spec/owner disagreement or runtime defect.
The independent actual-program/source/figure review above checks the final order.

The prose author saw only the frozen finite sheet. Root corrected its signal/
output-coordinate column description and explicitly labelled the raw-value
table as stage-A settings, not write order (enable PMODE last). A second
facts-only paragraph assignment supplied raw-probe interpretation. The final
public-reader and actual-source deltas cover the complete addition. Actual
PDF print acceptance is separate in pcrtc-print.md.

MAME's production V9938 owner was read before implementation for separate
register, scanline and VBlank responsibilities. No foreign address, timing
or display rule supplied a BMSX fact. Actual typed-port/readonly-BSS BIOS
precedents and the already executed display_manual cartridge were inspected.

All78 existing TypeScript GPU tests pass. The earlier manual-tool run had17/19
passes because the PCRTC reviews were deliberately pending; it was not a runtime
or publisher failure. Its concrete reference-chapter figure-count expectation
is updated from3 to6 for the three newly embedded PNGs. No new count gate,
layout helper, stylesheet, publisher code, schema, frame-loop or test framework
was added. Final shared tests and ordinary publication must pass after actual
source/figure/print approvals are recorded. No runtime/compiler/BIOS/renderer
implementation was changed. The ordinary teaching cartridge and assertion/
capture inputs are the new functional material.

This accepts the finite source-versus-window lesson, not every PMODE coefficient/
alpha contrast, unequal-factor sampling lesson, display mode, ownership scenario
or full-manual completeness. The unequal-factor sampling packet is separate
next-task input, not an invented physical rate or accepted new public paragraph.

## Final publication and regression disposition

The completed source/figure/print records permit ordinary check/publication.
All19 shared manual-tool tests pass on the final state; the initial pending-
review failures are closed by actual reviews, not bypassed or suppressed. The
reference integration expectation now correctly counts6 figures (3 existing
SVGs plus3 actual PNGs). Renderer/publisher/schema source is unchanged. All78
existing TS GPU tests also pass. The canonical pcrtc.pdf exactly matches the
accepted29-page proof; hashes and full-pixel proof are in pcrtc-print.md.
