# GTE depth-cue output acceptance

## Scope and execution

Bounded addition only: four RTPS/NCDS samples, 175 literal BLua source lines,
one actual ordinary-cartridge output plate, calculation-versus-GX16 distinction
and supplied-checkout build route. Extraction, two facts-only paragraph authors,
actual-source/image review and a fresh public-only reader were separate passes.
No architecture document or historical-console PDF supplied facts. No runtime,
compiler, BIOS, renderer, publisher, CSS, schema, helper or framework changed.

Fresh normal product, BIOS and cartridge builds pass. The ordinary integration
case `depth_cue_and_display_words` passes all four retained calculation/flag
rows, raw stored-pixel probes, firmware exclusion and fresh VBlank observations.
The exact four-command minimal route in the existing development companion also
passes, without a separate BIOS-build prerequisite. Separate ordinary-ROM
capture matches every pixel of the controlled four-rectangle scene. Root and
the independent source reviewer each checked all49,152 RGBA pixels; both match.
The figure is copied unmodified from the actual256×192 PNG, not synthesized.

An initial attempt had built the cart before its new assertion file existed;
test discovery failed, with no PASS. Rebuilding after the supplied files were
present resolved that attempt. No runtime/test-harness fallback or repair was
introduced. Logs `/tmp/bmsx-gte-cue-{product-build,bios-build,cart-build-final,
guest-final,capture-final}.log` and `/tmp/bmsx-gte-cue-minimal-{product,cart,guest,
capture}.log` record the successful final and minimal routes.

| Artifact | SHA-256 |
|---|---|
| Cartridge build artifact | 288650004d837d808a0a59fd81c31578c0bbb3aa355113c22259415b0911c36d |
| Ordinary cartridge ROM | 7e02876701e4e744e2fd793229c3bf430cccb93562a918b43a17d78b982929c5 |
| Installed BIOS ROM | 01b9f2f197e59144867d5844863aa7fd9752811e227e7a6901a1541a17b6e664 |
| Headless-tooling product | a38274f9eea37a4a4a759a3d0b11c72fe8170e525d2eaf0ffe1a41d069c43470 |
| Actual output PNG | 975a115d75f1bd4fe87684c5c48e8c6eee2cd015ae8acbb655ef7d7abd244b9c |
| Entry module | 0f81790b5bd77760c8af7b7757b9a5fd0788b947c9c5d78e3b0fe063a2cdcb6c |
| Const/BSS module | 20f378eaa3e9153d5a339e58b0da4ab6a874c1548ffda7161e60d8d47c424c95 |

All43 existing TS GTE tests and all19 manual-tool tests pass. They are additional
regression evidence, not substitutes for actual execution, source/image, reader
or PDF checks. No native/accelerated-backend, physical-display latency, fresh-OS
installation, all-command or whole-manual acceptance is claimed.

## Independent actual-source and image review

# Finite GTE cue program source review

Scope: only `carts/gte_cue_manual/{cart,results}.lua` and `tests/carts/gte_cue_manual/gte_cue_manual_assert.lua`, against the paired live GTE/GPU/PCRTC/IRQ owners and typed cartlib/BIOS boundary. No repository modifications, architecture.md/PDF/general compiler/all-command/backend-matrix audit. Build/guest/capture PASS and 49,152 image pixels are supplied external execution evidence, not inferred here from test green.

## Checked source

- **Typed register operands agree with the owner layout.** `cartlib/gx/gte.lua:4-27` defines 20-byte matrix, 8-byte vector, 32-byte transform and 20-byte projection layouts. `cartlib/gx/gte.lua:107-171` gives V0=0/1, RGB=6, IR0=8, SXY2=14, SZ3=19, RGB2=22; matrix/control windows start at 0,8,16 and projection at 24. Cart rodata and whole-word loads are `cart.lua:21-52,73-93`; no Lua register-image table exists. Paired owners sign-extend designated low-halfword control registers (`machine/ts/machine/devices/gx/gte.ts:505-522`, `machine/cpp/machine/devices/gx/gte.cpp:370-386`) and decode packed matrix halves (`gte.ts:1217-1227`, `gte.cpp:1089-1099`). Matrix pad high halfword is ignored for the last coefficient.
- **The per-row sequence preserves the intended cue.** Cart `106-123` writes each position, issues RTPS SF=1 (12-place shift), retains SXY2/SZ3/IR0/FLAG, then writes only V0's two words with the same normal and issues NCDS SF=1 (12-place shift), LM=positive. There is no intervening IR0 write. Both owners clear FLAG at each command (`gte.ts:529-533,559-563`, `gte.cpp:394-398,424-428`), so retaining projection FLAG before NCDS is required and done. RTPS writes the single IR0 register (`gte.ts:975-995`, `gte.cpp:849-869`); NCDS reads that single coefficient, not a depth/cue FIFO (`gte.ts:852-856,939-947`, `gte.cpp:715-719,813-821`). NCDS shifts RGB0/RGB1/RGB2 and preserves RGB.CODE (`gte.ts:1133-1140`, `gte.cpp:1006-1013`), independently of IR0.
- **Assertions retain per-command facts rather than pretending the final FLAG describes both commands.** `results.lua:3-20` separately owns projection/color FLAGS and before/after-color IR0. Assertion `22-30` independently checks depths 256/384/512/768, coefficients 0/2048/3072/4096, RGB2 344B519E/34755876/348A5C63/34A05F4F, projection FLAG 0 and color FLAG 00400000. Numeric derivation and display/IRQ ownership checks follow below.

## Completed numeric check

The source arithmetic was independently evaluated with integer shifts in stage order; it was not taken from the assertion's expected arrays. Both owners use the same projection quotient refinement (`gte.ts:1083-1093`, `gte.cpp:957-966`) and final RTPS MAC0/IR0 update (`gte.ts:992-995`, `gte.cpp:866-869`). For H=128, their quotients are respectively 32768, 21845, 16384, 10923. Thus `(0x01800100 - 768*q) >> 12` is exactly 0,2048,3072,4096, within the inclusive IR0 range, with no IR0 saturation (`gte.ts:1108-1118`, `gte.cpp:981-991`). Identity rotation, zero translation/OFX/OFY and positions (0,0,Z) leave SXY2=0 and SZ3=Z (`cart.lua:22-35,47-52`; paired RTPS owner ranges already cited above).

For the fixed normal, the ordered SF=1 light results before LM are `(3482,1228,-3277)`; positive LM clips the third to 0 and sets IR3 saturation. The color-matrix/background results are `(4045,3481,1612)`. Material multiplication produces unshifted inputs `(10355200,5346816,4952064)`. The depth-cue difference stage is `(-1249,230,1351)`. The final MACs and bytes are:

| Z | IR0 | final MAC1..3 | RGB2 | GX16 | visible RGB8 |
|---|---|---|---|---|---|
| 256 | 0 | 2528,1305,1209 | 344b519e | a553 | 156,82,74 |
| 384 | 2048 | 1903,1420,1884 | 34755876 | b96e | 115,90,115 |
| 512 | 3072 | 1591,1477,2222 | 348a5c63 | c56c | 99,90,140 |
| 768 | 4096 | 1279,1535,2560 | 34a05f4f | d169 | 74,90,165 |

Those values follow the paired matrix/IR writes, color application and depth-cue stage (`gte.ts:790-856,939-947`, `gte.cpp:654-719,813-821`); SF is the signed 12-place shift (`gte.ts:150-155,680-691`, `gte.cpp:545-547`), followed by RGB-byte extraction (`gte.ts:1133-1140`, `gte.cpp:1006-1013`). The full-cue bytes are 79,95,160, not exactly 80,96,160, because the difference stage has already shifted. IR3 saturation is 00400000 and is outside ERROR's aggregate mask (`gte.ts:93-114,747-760,658-665`, `gte.cpp:610-623,521-530`). No other supplied stage overflows/clips; the projection FLAG is 0, NCDS FLAG is 00400000 in every row. These independently match assertion `10-13,23-30`.

## GPU/PCRTC ownership and display check

- `cart.lua:95-104,125-128` supplies a black 256x192 rectangle and four opaque/untextured variable-size opcode-60 rectangles, with zero offset and drawing bounds x0..255/y0..191; CODE is explicitly removed by `&00ffffff` before ORing 60000000. The opcode and variable-size interpretation agree with both parsers (`machine/ts/spec/gx/gp0.ts:15-26`; `gpu.ts:1733-1740,1759-1762`; `gpu.cpp:1216-1223,1242-1245`) and render rules (`machine/ts/render/backend/gx_gpu_render_rules.ts:83-121`; `machine/cpp/render/backend/gx_gpu_render_rules.h:75-80,90-114`). The swatches are x=[16,60),[76,120),[136,180),[196,240), y=[48,144), hence equal screen-space 44x96 shapes; no projected SXY is fed to GP0.
- E1 payload 0400 has dither bit 9 clear; E6 payload 1 sets stored bit15, with mask checking bit1 clear (`machine/ts/spec/gx/gp0.ts:44-46`; paired mask rules `gx_gpu_render_rules.ts:337-342`, `gx_gpu_render_rules.h:341-346`). The paired software write datapaths truncate RGB8 by >>3, pack R5/G5/B5, and set 8000 (`machine/ts/render/backend/software/gx_gpu_vram.ts:115-139`; `machine/cpp/render/backend/software/gx_gpu_vram.h:100-122,163-197`). GX16 scanout expands each channel by `(c<<3)|(c>>2)` (`gx_gpu_vram.ts:21-22`, `gx_gpu_vram.h:33-34`; palette consumers `machine/ts/render/backend/software/gx_gpu_scanout_palette.ts:5-11`, `machine/cpp/render/backend/software/gx_gpu_scanout_palette.cpp:7-13`). This is a finite numeric-source check, not an all-backend audit.
- Cart `64-71` masks controller IRQ, resets PCRTC/GPU, disables composition, programs circuit1 at framebuffer base0/GX16/stride1024/source0, uses signal window 018252a8 and extent000bf3ff, and disables the GP1 Y-address extension. CSR bit9 is RESET and GP1 opcode09 is Y extension (`machine/ts/spec/gx/pcrtc.ts:58-61`; `machine/ts/spec/gx/gp1.ts:10,18`). The reset actions really clear GP0/reset GPU and PCRTC in both owners (`gpu.ts:1409-1421`, `gpu.cpp:918-930`). Framebuffer and opaque PMODE words match the named production constants (`machine/ts/spec/gx/display_presets.ts:153-155`; `machine/cpp/spec/gx/display_presets.h:161-163`). Paired scanout decodes base/stride/PSM/source/magnification and extent (`machine/ts/machine/devices/gx/gpu_pcrtc.ts:361-386,426-442`; `machine/cpp/machine/devices/gx/gpu_pcrtc.cpp:120-147,184-198`): default timing signalStepX=4, window magX=4/magY=1, DW=1023/DH=191 gives 256x192 1:1 source sampling. Default timing is explicitly reestablished by reset, not assumed inherited firmware state (`pcrtc.ts:75-97`; `gpu_pcrtc.ts:273-282`; `gpu_pcrtc.cpp:305-316,90-101`).
- The center probes (`cart.lua:130-139`) request 1x1 C0 readbacks at x+22,y96, wait GPUSTAT bit27, consume GP0, then wait GPUSTAT bit26 idle. Both readback datapaths emit a single requested GX16 word in the low half of a zero-high word for an odd 1-pixel read (`machine/ts/machine/devices/gx/gpu_command_buffer.ts:163-174`; `machine/cpp/machine/devices/gx/gpu_command_buffer.h:107-118`). Bits26/27 are GPU_IDLE/READY_TO_SEND_VRAM (`gpu.ts:180-181`), not display acknowledgements. Assertion `30,35-40` reflects this limited raw/register evidence.

## Firmware and VBlank assumptions

- The firmware reservation is queried at its actual BIOS owner, not duplicated in the cart. `machine/bios/gpu/system_vram_region.lua:5-28` returns the bounding region of the terminal and the system texture's actual retained GP0 header; terminal is x704/y720,320x240 (`machine/bios/tty/layout.lua:3-11,18-25`). Producer writes actual texture origin and extent into that header (`scripts/rompacker/rombuilder.ts:820-827`; `toolchain/ts/rompack/gp0_encode.ts:6-11`). The atlas placement maximum is x768/y960 with maximum256x64, but actual packed extent is not the maximum (`toolchain/ts/rompack/system_texture.ts:3-7`; `rombuilder.ts:1242-1255`), so do not infer a reservation size from maximum atlas dimensions. Assertion `33-34` checks the current queried region is below y192 and expects this build's 320x252 bounding size. This is a current-build fixture assertion, not a universal VRAM allocation ABI.
- The sole-ownership comment (`cart.lua:62`) is substantive: the code resets/reprograms GPU/PCRTC, overwrites GTE controls/V0/RGB and owns the global IRQ callback. It does not preserve concurrent firmware/cart users; public prose must not claim it can. Existing typed GTE and PCRTC manual precedents use these same raw transfer/reset boundaries (`carts/gte_manual/cart.lua:66-88`; `carts/pcrtc_window_manual/cart.lua:50-69`). No transaction/restore/compatibility wrapper is introduced.
- IRQ bit2 is VBlank in the paired spec (`machine/ts/spec/bmsx/io.ts:364`; `machine/cpp/spec/bmsx/io.h:377`). ACK clears the named pending bits; mask gates the asserted line rather than erasing pending flags (`machine/ts/machine/devices/irq/controller.ts:72-80,107-125`; `machine/cpp/machine/devices/irq/controller.cpp:29-34,76-92`). Cart `141-150` enables final PMODE, clears stale controller bit2, records sequence while mask remains0, enables only bit2, then waits until callback increments that sequence (`55-59`). This excludes a callback counted before the final PMODE write; it is not an elapsed-frame or physical-display latency claim.
- Publication happens at the real VBlank owner before raising controller VBlank (`machine/ts/machine/runtime/vblank.ts:44-64`; `machine/cpp/machine/runtime/vblank.cpp:31-47`); it latches PCRTC words and seals the presentation command prefix (`gpu.ts:1493-1514`, `gpu.cpp:975-996`; `gpu_pcrtc.ts:723-730`, `gpu_pcrtc.cpp:446-453`). Assertion `32` only records fresh callback progression, not physical presentation. Public prose appropriately keeps register readback, that fresh callback observation, and captured image evidence separate.

## Bounded public-section check

Read only the new `docs/book1/gte.md` section from `gte-depth-cue-output` through immediately before `appendix-reciprocal-seed-rom`; final line locations at this check are 6165-6496. The four GTE rows, full-cue precision caveat, two FLAG values/reason, and GX16 rows (6169-6209) agree with the paired owner/arithmetic checks above. The RTPT/NCDT warning also agrees with the paired owners: only the last RTPT vector writes IR0, while NCDT calls the same NCDS path three times without writing IR0 (`gte.ts:569-575,623-629`; `gte.cpp:434-440,488-494`). The single-coefficient statement is accurate.

All seven Lua fences in the final section were extracted and independently compared: the first plus final newline is byte-identical to `results.lua`; joining the next six in order plus final newline is byte-identical to `cart.lua`. The YAML fence at 6490-6494 is byte-identical to the complete 3-line manifest. There is exactly one module entry and the result is its separate const module; public transfer/storage explanations at6228-6236 match the actual typed/BSS sources, without rewriting their representation.

The figure/caption at6213-6215 agrees with the source and was independently opened visually. A fresh exhaustive RGBA comparison of `docs/book1/figures/gte-depth-cue.png` against the exact black 256x192 layout above found **0 mismatches over49,152 pixels**. Four colors/positions/extents and opaque alpha were checked at every pixel, not only centers. SHA256: `975a115d75f1bd4fe87684c5c48e8c6eee2cd015ae8acbb655ef7d7abd244b9c`. This verifies the actual published PNG asset and caption, not merely the screenshot filename or a test-green signal. Capture provenance is separately supported by the ordinary-run logs below.

The finite development-route addition is `docs/programming/getting-started.md:1031-1063`, linked from `gte.md:6225-6226`. It correctly says both cart modules, manifest and supplied test/timeline must exist before the debug build; it uses the real four commands, current dist ROM paths, actual case name and ordinary capture path. Independently checked the four `/tmp/bmsx-gte-cue-minimal-{product,cart,guest,capture}.log` files against those commands: product completes, exact cart artifact exports, guest loads the two documented ROMs and reports `depth_cue_and_display_words: passed`, ordinary playback loads those ROMs with the documented timeline and completes. Also checked fresh rebuild `/tmp/bmsx-gte-cue-cart-build-final.log`, passing case `/tmp/bmsx-gte-cue-guest-final.log`, and ordinary frame1 capture `/tmp/bmsx-gte-cue-capture-final.log`. Timeline `tests/carts/gte_cue_manual/gte_cue_manual_demo.json:1-3` requests precisely that frame1 capture. The route does not claim fresh-OS, whole-SDK or fixed-latency validation. No broad build-tooling audit was performed.

## Disposition

**No contradiction identified in this finite new program/public-section slice.** All requested calculation, raw display, ownership, VBlank, published figure, fence reconstruction and concrete build-route claims were checked at their owners or against actual supplied logs/image. No remaining unchecked claim within that finite scope. Not reviewed: the rest of the GTE chapter/manual, PDFs/print layout, all command semantics, compiler/language correctness, renderer/backend matrix, physical display timing, or fresh SDK/OS installation. No repository edits or runtime fixes were made. `git diff --check` completed without output on the current combined worktree.

## Fresh public-only reader

Root byte-compared all three reconstructed inputs with the executed originals;
all match exactly. The initial concrete onboarding gap was fixed by a direct
reference to the existing development companion and its finite exact-command
subsection. The reader rechecked that delta. The supplied-checkout source route
is accepted; this does not certify standalone PDF-link delivery (NAV01).

# GTE depth-cue public-only reader

## Verdict

**Bounded reader PASS:** the public section contains enough unambiguous source to reconstruct all three cartridge inputs and explains the arithmetic/drawing distinction accurately on its own. This is a source-reconstruction and figure-reading result, **not** independent compilation, cartridge execution, guest inspection, or publication proof.

**Concrete novice setup gap:** neither this new section nor the earlier complete-cartridge section supplies a build/run command, a project-root/starter-workflow link, or the generated ROM path. A newcomer to BMSX can copy the three exact inputs but cannot infer from these public instructions alone how to compile and launch them. Add one public getting-started reference or a short concrete invocation if end-to-end novice reproducibility is intended. This does not prevent the requested source reconstruction.

## Inputs and boundary

Read `docs/book1/gte.md` only from `gte-depth-cue-output` to immediately before the reciprocal-seed-ROM appendix; consulted earlier public chapter introductions, operand layouts, display hand-offs, and coefficient-selection discussion. Viewed `docs/book1/figures/gte-depth-cue.png` directly. Did not read the companion cartridge, tests, implementation, facts, reviews, architecture, PDFs, or handoffs; did not run a cartridge or guest acceptance.

## Reconstructed inputs

Created under `/tmp/bmsx-gte-cue-reader/`:

- `results.lua`: first public Lua fence; 390 bytes.
- `cart.lua`: next six public Lua fences concatenated in their printed order, with no source amendments; 4825 bytes.
- `res/manifest/manifest.rommanifest`: final public YAML fence; 62 bytes.

SHA-256:

```
0f81790b5bd77760c8af7b7757b9a5fd0788b947c9c5d78e3b0fe063a2cdcb6c  cart.lua
20f378eaa3e9153d5a339e58b0da4ab6a874c1548ffda7161e60d8d47c424c95  results.lua
9b2bfb54ba29afd8f9fab1025281cda5aaa732bfec7c3e8438a7baa0756ebdd1  res/manifest/manifest.rommanifest
```

The instructions clearly distinguish the standalone results module from the six-block entry module; filename, require name, manifest path and complete manifest contents are specified. No fill-in-the-blanks source or inferred helper was needed. Existing cartlib and BIOS modules are named dependencies, not hidden local companion source.

## Reader reconstruction of the contract

- Each `(0,0,Z)` is a position used by RTPS. Read its projected XY/Z, IR0, and projection FLAG before restoring V0 to the fixed Q12 normal `(2458,0,3277)` for NCDS. The normal is not derived from the position, and projection does not light anything.
- IR0 is one live register. RTPS produces this row's value; NCDS consumes it unchanged. RTPT then NCDT would incorrectly share only the final coefficient across three colors. Four independent RTPS/NCDS pairs preserve the intended association.
- The coefficient sequence is 0, 2048, 3072, 4096 at Z=256,384,512,768. This is reciprocal-depth cue, not a Z-linear fade. The full-cue output is `(79,95,160)`, not the programmed far `(80,96,160)`, due to ordered fixed-point arithmetic.
- FLAG belongs to each command. The listing captures projection FLAG before NCDS replaces it; projection flags are zero, while every color command yields `0x00400000` for negative third light-component saturation. That bit does not itself set ERROR.
- RGB2 retains CODE=0x34 and the original calculated RGB8. Rectangle drawing strips CODE and installs opcode 0x60. GX16 quantization with dithering off and mask-bit storage is a separate stage: displayed colors are not substituted for calculated results.
- The equal 44x96 rectangles at X=16,76,136,196 and Y=48 are fixed screen-space comparison shapes. Their vertices are not projected equal-world geometry; all sample positions in this demonstration project to the same screen origin.
- The sample explicitly requires exclusive GTE, GPU-port, display, VBlank-handler and image-region ownership. The firmware-region query is recorded, and the text says this chosen image lies outside its reservation; that is not a generally reusable VRAM allocator or permission to occupy arbitrary other coordinates.
- Raw stored-pixel probes, GPU-idle observation, register writes and fresh callback sequence are separated. Final PMODE publication is followed by stale VBlank acknowledgement and a later callback observation. The text does not promise exact display latency or treat register readback as a screenshot.

## Actual figure

Viewed the PNG: it is 256x192, black background, four equal unlabelled rectangular swatches progressing from muted red through purple to blue. Its caption supplies all Z values and geometry, so the lack of in-image labels is not ambiguous.

Direct read of the public PNG confirms center pixels `(156,82,74)`, `(115,90,115)`, `(99,90,140)`, `(74,90,165)` at (38,96), (98,96), (158,96), (218,96), matching the displayed-RGB8 table rather than the GTE-RGB8 table. This verifies the published figure asset, not the live renderer or the claimed provenance of that asset.

## No additional conceptual blocker found

The new section itself states the easily confused coefficient lifetime, FLAG lifetime, normal/position reuse, CODE/opcode distinction, stored/displayed quantization and screen-space-shape scope. Earlier public material adds layout and display-latch context without being needed to invent missing source. Beyond the build/run onboarding gap above, no source-copy ambiguity or figure/table mismatch was found in the bounded public reading.


## Public onboarding follow-up

**The reported novice setup gap is closed for the stated supplied-checkout scope.** Re-read only the hardware section's new development-companion link and `docs/programming/getting-started.md#build-and-inspect-gte-depth-cue`, plus its linked public prerequisite paragraph. The section supplies exact source/manifest locations, repository-root invocation, separate tooling build and cartridge build, assertion invocation, ordinary-ROM capture invocation, exported ROM and matching BIOS locations, expected PASS line, and screenshot path. It explicitly identifies supplied assertion/capture assets as a prerequisite without making earlier example cartridges prerequisites, and bounds its verification claim to the working checkout rather than all OSes or a fresh SDK installation.

The hardware chapter now links directly to the correct automatically generated heading anchor. A reader no longer needs hidden knowledge to locate or invoke the documented workflow. This follow-up did not inspect or execute the supplied tests, timeline, cartridge originals, implementation, or build tools; the root agent independently reports byte-exact equality of the three reconstructed inputs to the executed source. That reported comparison is not additional reader-run acceptance evidence.

Updated bounded verdict: **public source reconstruction, figure consistency, conceptual explanation, and supplied-checkout onboarding PASS**. Independent reader execution remains outside this task's scope; no remaining gap found in the checked public delta.
