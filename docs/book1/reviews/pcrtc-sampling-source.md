# PCRTC unequal-sampling example acceptance

## Scope and authority

Finite Section6 addition only: exact integer source progression, one GX16 strip,
a complete91-line real BLua cartridge, ordinary execution, and independent
source/image/public-reader checks. Current paired software is authority; no
architecture document or historical-console PDF supplied facts. No runtime,
BIOS, compiler, renderer, publisher, CSS, schema, helper or framework changed.
This is not whole-book, native/accelerated-backend or physical-hardware acceptance.

Root freshly built the ordinary headless-tooling product, installed BIOS and
cartridge, then ran the ordinary integration case and separate ordinary-ROM
capture. The case passes all8 original packed source words, programmed settings,
fresh VBlank observation and separate GPU idle/readback-drained conditions.
Every actual captured RGB pixel matches the source-selection table. The PNG
is copied without modification; opaque presentation alpha is not sample alpha.
Logs `/tmp/bmsx-pcrtc-sampling-{product-build,bios-build,cart-build-final,guest-final,capture-final}.log`.
All85 tests across `gx_gpu.test.ts`, `gx_gpu_command_buffer_restore.test.ts` and
`gx_gpu_lua.test.ts` pass; these are additional regression evidence, not a
substitute for actual cartridge execution or image/reader checks.

| Artifact | SHA-256 |
|---|---|
| Cart build artifact | f0b4c87e2ae6b4f4ab11798fef591779f927cb71f3fe37e8083c4c433be7bfcb |
| Ordinary cartridge ROM | 59c24e1264a57f409d5bb3615cc510f46d3013d63516124d1a15066b62a0b6b8 |
| Installed BIOS ROM | 01b9f2f197e59144867d5844863aa7fd9752811e227e7a6901a1541a17b6e664 |
| Headless-tooling product | a38274f9eea37a4a4a759a3d0b11c72fe8170e525d2eaf0ffe1a41d069c43470 |
| Actual8×1 PNG | 20a7206207e07350713525497c9e402846cd0a498050a3d2e58c43451a2f6c0e |
| Entry module | a9d6eace4dda771a7b4e845efb5b3a47d43d28fc9955d6a4007259da8d235189 |
| Const/BSS module | dcd58c9dd6e0e58588fb31abd5e8cd7b3c06c2e321e023d3d947bc598fbf4230 |

## Independent actual-source and image review

# PCRTC sampling: finite independent source review

## Findings

**No unsupported or mismatched source fact found in the checked Section 6, cart, guest assertion and capture.** No remaining source-fact blocker. This review is bounded to `docs/book1/pcrtc.md:1376-1607`, the new `pcrtc_sampling_manual` cart/test, and the eight-pixel PNG. No architecture document or PDF was opened; no repository files were edited. No native or accelerated-backend execution is claimed.

## Public wording, formula, table and caption

- Section 6 definitions/formula (`docs/book1/pcrtc.md:1380-1397`) match the producer and software consumer. `s` is SMODE1_LOW bits21..24: TS `machine/ts/machine/devices/gx/gpu_pcrtc.ts:273`, C++ `machine/cpp/machine/devices/gx/gpu_pcrtc.cpp:92`. S, actual M (encoded plus1), and framebufferX match TS owner `:377-387`, C++ owner `:138-148`. Independently upward-converted boundaries, crop and phase match TS owner `:396-408,426-442`, C++ owner `:157-166,184-198`. Final wording explicitly defining framebufferX as DISPFB_HIGH source X is correct.
- Public integer quotient `framebufferX + ((A*s-S+n*s) div M)` matches the existing bounded reciprocal initialization plus exact quotient/remainder recurrence, not a new R register: TS actual GX16 RGBA consumer `machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated.ts:733-767`; C++ actual consumer `machine/cpp/render/backend/software/gx_gpu_scanout.cpp:214-269`. The prior finite refresh proved all 65,536 N=0..4095/M=1..16 cases with exact BigInt and a short bound proof (`/tmp/bmsx-pcrtc-sampling-facts-current.md`). Nothing in Section 6 claims unbounded reciprocal equivalence.
- Reset timing wording (`docs/book1/pcrtc.md:1403`) correctly names SMODE1_LOW=40806504H and SMODE2_LOW=0: TS spec `machine/ts/spec/gx/pcrtc.ts:75-98`; C++ spec `machine/cpp/spec/gx/pcrtc.h:69-92`. CSR reset restores these words: TS GPU `machine/ts/machine/devices/gx/gpu.ts:1409-1417` and PCRTC `gpu_pcrtc.ts:560-571`; C++ GPU `machine/cpp/machine/devices/gx/gpu.cpp:918-926` and PCRTC `gpu_pcrtc.cpp:305-316`.
- All five public raw display words (`docs/book1/pcrtc.md:1405-1417`) match the actual cart (`carts/pcrtc_sampling_manual/cart.lua:33-36,60`) and paired owner decoding. DISPFB1_LOW=000FA000H means base0, FBW16 -> stride1024 source pixels, PSM31 GX16; source=(32,16); signal=(682,37); M=3; width32 signal units; height1. TS owner `machine/ts/machine/devices/gx/gpu_pcrtc.ts:371-389,426-439`; C++ owner `machine/cpp/machine/devices/gx/gpu_pcrtc.cpp:132-150,184-195`. GX16 PSM=31 is defined by TS `machine/ts/machine/devices/gx/gpu_local_memory.ts:8` / C++ `machine/cpp/machine/devices/gx/gpu_local_memory.h:12`. PMODE direct raw-RGBA branch: TS owner `gpu_pcrtc.ts:492-501`; C++ owner `gpu_pcrtc.cpp:246-255`.
- Boundaries171,179, crop(682,37), output8x1 and phase2 are correct. Every table row (`docs/book1/pcrtc.md:1421-1432`) checks: N=2+4*n, offsets0,2,3,4,6,7,8,10; X=32,34,35,36,38,39,40,42 at Y16. GX16 u16 word addresses4020,4022,4023,4024,4026,4027,4028,402A follow the central address owner `base+y*width+x`: TS `machine/ts/machine/devices/gx/gpu_local_memory.ts:83-89`, C++ `machine/cpp/machine/devices/gx/gpu_local_memory.h:78-79`. The table correctly calls these word addresses, not byte offsets.
- Observed RGB and the raw sample-alpha sentence (`docs/book1/pcrtc.md:1436-1443`) match RGB555 expansion and software sampling. TS expansion `machine/ts/render/backend/software/gx_gpu_vram.ts:21-22`, palette `gx_gpu_scanout_palette.ts:3-11`, actual fetch `gx_gpu_scanout_specialized.generated.ts:92-95,756`. Raw GX16 bit15 yields sample alpha80H. This must not be confused with screenshot alphaFFH; the capture is deliberately opaque, as noted below. The public sentence says sample alpha, not PNG alpha, so it is not a mismatch.
- Figure/caption (`docs/book1/pcrtc.md:1447-1449`) accurately describe the actual eight pixels and the nonconsecutive displayed selection from consecutive source words. Capture and figure are byte-identical (SHA25620a7206207e07350713525497c9e402846cd0a498050a3d2e58c43451a2f6c0e). Existing figure styling uses width128mm and `image-rendering: pixelated` (`docs/manual/print.css:129-135`), supporting enlarged-without-smoothing wording. I viewed the original8x1 PNG and inspected its exact samples; I did not inspect rendered PDF pages.

## Complete code and guest assertion

- Independently extracted all four Lua fences from final Section 6: results block equals the complete `results.lua` byte-for-byte; concatenating the three cart blocks equals complete `cart.lua` byte-for-byte. Combined source length91 lines. The public manifest fence equals `carts/pcrtc_sampling_manual/res/manifest/manifest.rommanifest` byte-for-byte. Public paths and assembly instruction (`docs/book1/pcrtc.md:1469-1470,1497,1601-1607`) are sufficient for these exact two modules and manifest.
- Cart lines5-14 use the live mapped raw addresses: IRQ_ACK08000004, IRQ_MASK08000008, GP00801023C, GP108010240, PMODE08010354, DISPFB1_LOW/HIGH0801035C/08010360, DISPLAY1_LOW/HIGH08010364/08010368, CSR080103D4. Verified by importing actual TS spec/address function. Paired definitions: TS `machine/ts/spec/bmsx/io.ts:6-7,115-116,125-130,172-173,180-182,215-216`; C++ `machine/cpp/spec/bmsx/io.h:18-19,128-129,138-143,185-186,193-195,228-229`; PCRTC indices/address TS `machine/ts/spec/gx/pcrtc.ts:12-37,100-103`, C++ `machine/cpp/spec/gx/pcrtc.h:13-38,94-97`.
- Cart lines16-20 store exactly sixteen u16 words8000..800F. Lines41-47 upload16x1 at32,16 with A0 and eight packed32-bit payloads; lines48-55 read the same16pixels back with C0, waiting on bit27 before each of eight words. GP0 opcodes: TS `machine/ts/spec/gx/gp0.ts:19-22`, C++ `machine/cpp/spec/gx/gp0.h:26-29`; transfer size TS `gp0.ts:95-100`, C++ `gp0.h:97-102`; GP0 Y bit16 and low/high16-bit pixel ordering TS `machine/ts/render/backend/gx_gpu_render_rules.ts:218-227`, C++ `machine/cpp/render/backend/gx_gpu_render_rules.h:222-231`; actual software upload TS `machine/ts/render/backend/software/gx_gpu_commands.ts:75-99`, C++ `machine/cpp/render/backend/software/gx_gpu_commands.cpp:40-76`. DISPFB Y is independently decoded at bit11 in the cited PCRTC owners. No local ABI helper was introduced.
- Cart lines37-38 explicitly clear Y-extension and mask-bit mode via existing GP1(09)/GP0(E6), not ad hoc pixel encoding. Spec TS `machine/ts/spec/gx/gp1.ts:10,18`, `gp0.ts:6`; C++ `machine/cpp/spec/gx/gp1.h:16,24`, `gp0.h:13`. Command routes remain existing owners.
- Cart lines56-57 wait for GPU idle before enabling PMODE. Flags are TS `machine/ts/machine/devices/gx/gpu.ts:180-181`, C++ `machine/cpp/machine/devices/gx/gpu.h:55-56`. Their actual status producers require readback idle and no outstanding command/upload state: TS GPU `gpu.ts:1902-1912`, C++ GPU `gpu.cpp:1379-1389`. Actual GP0 reads consume READY readback words in TS GPU `gpu.ts:1019-1031`, C++ `gpu.cpp:536-548`.
- Cart direct IRQ lines22-27 increments only for VBlank bit2 and acknowledges that bit. Lines60-68 enable display, clear stale controller VBlank, record sequence, unmask only VBlank and wait for a fresh sequence before completion. IRQ_VBLANK bit2 is TS `machine/ts/spec/bmsx/io.ts:364`, C++ `machine/cpp/spec/bmsx/io.h:377`; acknowledge clears selected pending bits TS `machine/ts/machine/devices/irq/controller.ts:107-115`, C++ `machine/cpp/machine/devices/irq/controller.cpp:76-84`. BIOS hands execution over with IRQ_MASK0 (`machine/bios/main.lua:108-113`); cart owns its handler and unmasking. Public exclusivity/row-allocation limitations (`docs/book1/pcrtc.md:1455-1459`) accurately avoid general allocation/supervisor coexistence claims.
- Normal presentation is VBlank-edge latch: TS GPU `machine/ts/machine/devices/gx/gpu.ts:1493-1514` calls owner `gpu_pcrtc.ts:723-730`; C++ GPU `machine/cpp/machine/devices/gx/gpu.cpp:975-996` calls owner `gpu_pcrtc.cpp:446-453`. Public publication/readback caveat (`docs/book1/pcrtc.md:1461-1465`) correctly does not treat immediate register reads or raw-source readback as proof of selected output.
- `results.lua:3-14` retains completion, sequence, programmed words and eight packed source words. Guest assertion `tests/carts/pcrtc_sampling_manual/pcrtc_sampling_manual_assert.lua:7-28` checks all eight packed source words, exact programmed source/window/extent, fresh sequence, PMODE/framebuffer and idle/drained status. It does not assert output-pixel selection; its log line29 explicitly separates that proof. The separate capture inspection below provides it. No claim of output proof from register/readback assertions alone is warranted or made.

## Actual execution/capture observations and limits

The supplied build/guest/capture logs were read, not rerun in this review. `/tmp/bmsx-pcrtc-sampling-cart-build.log` records the cart build publishing artifactf0b4c87e2ae6b4f4ab11798fef591779f927cb71f3fe37e8083c4c433be7bfcb; `/tmp/bmsx-pcrtc-sampling-guest.log` records `unequal_magnification_source_row: passed`; `/tmp/bmsx-pcrtc-sampling-capture.log` records ordinary tooling launch, capture at presentation frame1 and timeline completion. These are not native or accelerated-backend execution logs.

Independently decoded `tests/carts/pcrtc_sampling_manual/screenshots/frame_00001.png` using the already installed `pngjs`, with strict dimension and pixel assertions; all passed:

```
width8 height1
RGBA: (0,0,0,255) (16,0,0,255) (24,0,0,255) (33,0,0,255)
      (49,0,0,255) (57,0,0,255) (66,0,0,255) (82,0,0,255)
```

That exact RGB sequence uniquely identifies offsets0,2,3,4,6,7,8,10 within the uploaded0..15 red5 ramp. It matches the public samples and the actual owner/consumer progression. The screenshot's alphaFF is a host-output policy, not raw sample alpha80: headless present forces opacity (`machine/ts/render/headless/backend.ts:255-267`), and screenshot encoding explicitly writes alpha255 (`hosts/node/headless/screenshot.ts:10-15`). No raw-alpha parity claim is inferred from the opaque PNG.

Limitations: no native/GPU-accelerated execution, no PDF/published-reader rendering inspection, no whole-console/language audit. Root's reported additional builds/tests/public reconstruction were not independently rerun here. No unchecked concrete Section6 source fact remains after this bounded review.

## Fresh public-only reader

A fresh-context reader saw only public Section6 and the public PNG, not the
companion source, tests, facts, implementation or reference PDFs. Root's byte
comparison confirms all three reconstructed files equal the executed originals.
No hidden producer, missing block or API was needed. The one found omission,
manifest pathname, was fixed and independently rechecked. Final formula-origin
and SMODE2_LOW clarifications were separately rechecked as well.

# Public-only Section 6 reader

## Gap

- Section 6 prints the manifest contents but does not name its pathname. I used `res/manifest/manifest.rommanifest` supplied by the review request, not by the section. Print that pathname if this section must independently specify the complete file layout.

## Bounded PASS

- `s` is the output-pixel signal step, `S` is the signal origin, `M` is the source-pixel signal width, and `n` is local to the circuit's output edge. Phase is explicitly `A*s - S`. Independent upward boundary conversion distinguishes output width from source magnification.
- The example independently yields `A=171`, phase `2`, width `179-171=8`, and selected source offsets `0,2,3,4,6,7,8,10`, not eight consecutive source pixels.
- The public PNG is actually 8 x 1. Its ordered RGB values are `(0,0,0)`, `(16,0,0)`, `(24,0,0)`, `(33,0,0)`, `(49,0,0)`, `(57,0,0)`, `(66,0,0)`, `(82,0,0)`, agreeing with the printed output strip. The PNG's alpha is 255; it is not evidence for the separately described hardware sample alpha 0x80.
- All BLua source and manifest contents are printed. Reconstructed `/tmp/bmsx-pcrtc-sampling-reader/results.lua` (290 bytes), concatenated `cart.lua` (2071 bytes), and `res/manifest/manifest.rommanifest` (70 bytes) directly from the printed code blocks, without original companion sources or private APIs.
- Scope: only the new public Section 6 and its actual PNG were read. No implementation, companion carts, tests, facts, reviews, architecture, handoffs or reference PDFs were inspected. No build, actual owner/guest behavior, PDF rendering or original-file byte comparison is claimed.

## Resolution

- Rechecked only the final manifest lead: Section 6 now explicitly says to create `res/manifest/manifest.rommanifest`. The pathname gap is resolved; no public-reader gaps remain within this bounded review.
- Root reports that all three reconstructed files byte-match the actual executed cart, results module and manifest. I did not inspect those originals or independently perform that comparison.

## Final clarity delta acceptance

- Verified only the two requested public statements: `framebufferX` is explicitly the source X field of `DISPFB_HIGH`, and the reset timing word is explicitly named `SMODE2_LOW`. Both remove naming ambiguity without changing the sampling explanation. No issue found; prior exact source reconstruction remains unchanged.

## Additional bounded cross-checks

Two secondary fresh-context checks found no concrete mismatch in their narrower
sampling/table/alpha/PNG and BIOS-style ports/GP0/READY/reset scopes. They did
not finish all requested checks and are not treated as substitute full-scope
passes: `/tmp/bmsx-pcrtc-sampling-{claim,program}-review.md`. Their uninspected
IRQ/latch/fence details are covered by the completed independent primary review
and public reconstruction above. Root additionally read the paired RGB555
expansion directly: `machine/ts/render/backend/software/gx_gpu_vram.ts:21-22`
and `machine/cpp/render/backend/software/gx_gpu_vram.h:33-35` both compute
`(channel << 3) | (channel >> 2)` for the five-bit operand. Native palette
construction at `gx_gpu_scanout_palette.cpp:9-13` also agrees on alpha80H.
Rendered enlargement is covered by the separate actual-PDF review, not inferred
from the tiny source PNG or these partial secondary checks.
