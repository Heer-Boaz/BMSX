# Firmware VRAM reservation: bounded fact extraction

## Scope, status and limits

Extraction only. No repository edits or public chapter prose. No `architecture.md`, PDF, other device sweep or runtime fix. Existing BM36 and `technical-follow-up.md` were used only to identify the requested source route.

The audited contract is the named BIOS function `gpu/system_vram_region`, its system-texture and terminal-layout producers, its actual cartridge-library consumer, and the BIOS boot/monitor callsites that use the storage. The relevant TypeScript/C++ VRAM and GP0/GP1 constants were compared. Producer replay below is **not** execution of a BIOS image, a live terminal capture, proof of a GPU transfer's completion, or a complete ownership/permission contract.

Initial checkout: `master`, no tracked changes shown. While extraction ran, other work created untracked `carts/memory_fault_manual/` and `tests/ide/memory_fault_manual.idetest.js`; neither was opened or modified for this task. Only `/tmp` evidence was written.

**Result:** the current atlas actually emits **216 × 12 16-bit VRAM words**, not its configured maximum 256 × 64. The current firmware query therefore describes origin **(704, 720)**, extent **(320, 252)**, not the maximum-derived 320 × 304 used in synthetic tests. This is a current-source/current-resource derivation; cartridge code should consume the function's returned words rather than freeze these dimensions.

No contradiction was found in the paired constants or in the audited query/producer/terminal consumers. A claim that the cartridge may release/reuse this area after handoff, clearing terminal state, or resetting graphics remains **blocked by missing ownership authority**, not established by these sources. Stop that claim rather than infer a release rule.

## Source-backed facts

| ID | Fact | Source paths and ranges |
|---|---|---|
| MVR01 | `gpu/system_vram_region` is explicitly included among system BIOS function exports with an empty export-path key. It is a named callable function export, not a published numerical CPU address or an asset ID. | `toolchain/ts/rompack/system.ts:9-21` |
| MVR02 | The function takes no arguments and reads upload words 1 and 2 from the system texture asset's address. Those are the retained destination and size header words. It combines their rectangle with the **full terminal layout** rectangle using min left/top and max right/bottom. | `machine/bios/gpu/system_vram_region.lua:1-29` |
| MVR03 | Return word 1 is `(left & 0xffff) \| ((top & 0xffff) << 16)`. Return word 2 is `((right-left) & 0xffff) \| (((bottom-top) & 0xffff) << 16)`. Thus low/high halves are x/y origin and width/height, respectively, not CPU byte addresses or an exclusive-end word. | `machine/bios/gpu/system_vram_region.lua:14-28` |
| MVR04 | The query contains no write, allocation, GPU command, wait or terminal-state change. It derives a layout rectangle from the linked asset header/layout; it does not inspect live VRAM pixels or test whether the upload has run. No terminal visibility, status, active viewport, cartridge handoff or GPU-reset state enters its calculation. | Entire function: `machine/bios/gpu/system_vram_region.lua:10-29`; dependencies at `:2-3` |
| MVR05 | Terminal layout uses cells 4 × 6, 80 columns and 40 rows, with VRAM origin x=704, y=720. Exported full dimensions are columns×cell width and rows×cell height. | `machine/bios/tty/layout.lua:3-11,13-25` |
| MVR06 | Paired VRAM leaves agree on x/y address periods 1024 each, two bytes per x-coordinate storage word, 2048 bytes per row, and 1024×1024 addressable VRAM words. Y addressing uses all 10 low bits with a nonzero extension word and nine low bits otherwise. | `machine/ts/spec/gx/vram.ts:1-12`; `machine/cpp/spec/gx/vram.h:9-21` |
| MVR07 | The system-texture producer configures maxima width=256, height=64. Its destination is derived from those maxima and VRAM periods, i.e. x=1024−256=768 and y=1024−64=960. These configured values do **not** directly specify the emitted atlas width/height. | `toolchain/ts/rompack/system_texture.ts:1-7`; periods MVR06 |
| MVR08 | Resources inside system resource roots target the `$system` atlas. The system build's default resource root is `machine/bios/res`. The normal build captures that root, scans/loads resources, builds the atlas and emits system ROM assets. | `scripts/rompacker/texture_atlas_contract.ts:1-4`; `scripts/rompacker/atlasbuilder.ts:68-83`; `scripts/rompacker/build_inputs.ts:9-10,41-49,53-72`; `scripts/rompacker/build.ts:24-33`; `scripts/rompacker/compile.ts:42-57` |
| MVR09 | The atlas packer measures actual placements, selects among candidate widths by page count/area/height/width criteria, and creates its canvas at the selected actual packed width/height. The system's maximum bounds are passed in, but the output canvas is not automatically padded to 256×64. | `scripts/rompacker/atlasbuilder.ts:249-259,262-301,304-326`; system bounds at `scripts/rompacker/rombuilder.ts:1232-1246` |
| MVR10 | System atlases always take the direct16 encoder path using the actual canvas width/height. In that encoder, `wordWidth` equals input pixel width; height equals input height. It packs each pair of 16-bit texels into a little-endian 32-bit payload word. | `scripts/rompacker/rombuilder.ts:1247-1256`; `toolchain/ts/rompack/gx_texture_codec.ts:66-96` |
| MVR11 | Emitted system binary asset `gx_system_texture` is `encodeDirect16GxUpload(actualTexture, systemX, systemY)`. Its 12-byte LE header is command `CPU_TO_VRAM_FIRST << 24`, destination `x \| (y << 16)`, then actual `texture.wordWidth \| (texture.height << 16)`, followed by payload. | `scripts/rompacker/rombuilder.ts:819-833`; `toolchain/ts/rompack/gp0_encode.ts:1-12` |
| MVR12 | Paired GP0 leaves agree on CPU-to-VRAM first opcode 0xA0 and transfer limits 1024×512. Width and height helper decoding preserves the nonzero, within-limit emitted dimensions 216 and 12. | `machine/ts/spec/gx/gp0.ts:19-20,57-60,95-100`; `machine/cpp/spec/gx/gp0.h:26-27,59-62,97-102` |
| MVR13 | System image metadata for each atlas image and the BIOS glyph table add the fixed system texture destination to that image's actual packed U/V. The glyph-table producer requires printable ASCII glyphs 0x20–0x7e at 4×6 and stores packed physical source x/y words for them. | `scripts/rompacker/rombuilder.ts:365-382`; `scripts/rompacker/bios_terminal_font.ts:6-11,13-41` |
| MVR14 | The production cartridge-library syntax is `local system_vram_region<const> = require('gpu/system_vram_region')`, then `local system_origin<const>, system_size<const> = system_vram_region()`. It extracts low16/high16 of both words and feeds that complete rectangle to its own reservation allocator before allocating framebuffers. | `cartlib/gx/vram.lua:1-2,99-119`; allocator reservation operation `:77-96` |
| MVR15 | The system image builder roots explicit BIOS exports. Cartridge compilation receives BIOS function imports and links against that system import set. The source-backed call syntax in MVR14 is thus not a requirement to inline BIOS source into a cartridge or call a guessed function address. | `toolchain/ts/rompack/blua32_image_builder.ts:207-230`; export identity MVR01. Import records contain path, export-path key and function address: `toolchain/ts/rompack/blua32_bios_imports.ts:7-20` |
| MVR16 | A separate executable test-source example uses the same direct `require('gpu/system_vram_region')` and no-argument/two-return call, but compiles it as system code with a synthetic asset header. It is additional syntax evidence, **not** an observed cartridge-to-real-BIOS integration result. | `tests/lua/gx_gpu_lua.test.ts:115-130,144-148,170-184,196-201` |
| MVR17 | `terminal.open` selects active dimensions up to the full layout, resets terminal CPU-side state and marks the screen dirty; `terminal.clear` also resets and marks dirty. Neither changes the immutable layout or the system texture header queried by MVR02. `clear_status` only changes the status-visible word and marks the last row dirty when needed. | `machine/bios/tty/terminal.lua:225-277,434-438`; query MVR02/MVR04 |
| MVR18 | A dirty terminal flush can clear the terminal surface, perform in-surface scroll copying and filling, draw backgrounds/cursor, and sample glyphs from the system atlas using direct16 textured rectangles. Final submission waits for the GPU IRQ-request marker via the BIOS command-list path. Thus the atlas is a glyph **source** and the terminal rectangle is a drawing **destination**; clearing logical text is not releasing either. | `machine/bios/tty/terminal.lua:478-504,523-535,548-607,611-613`; `machine/bios/gpu/gpu.lua:52-67,160-197`; `machine/bios/gpu/commandlist.lua:9-16` |
| MVR19 | Initial boot graphics setup resets the GPU mode, selects terminal display/drawing origin, uploads the system texture, opens/writes boot terminal content, and flushes it. The boot loop keeps flushing terminal updates. | `machine/bios/main.lua:76-83,86-103,105-123,126-143` |
| MVR20 | Cartridge handoff specifically clears terminal status, flushes terminal output, writes zero to the IRQ mask, then writes startup to EXEC. That path contains no terminal close, VRAM allocator release, layout change or replacement texture header. It must not be described as a blanket release of the reservation. | `machine/bios/main.lua:105-113`; status operation MVR17 and query MVR04 |
| MVR21 | The BIOS exception function calls `monitor.enter`. Monitor entry prepares the terminal origin/max dimensions, opens the terminal, **uploads the same system atlas again**, writes monitor output and flushes. The monitor loop subsequently flushes text/cursor updates. Therefore the audited firmware has a later consumer of the same coordinates beyond initial boot. Exact delivery/eligibility of every exception/NMI is outside this extraction. | `machine/bios/main.lua:54-56`; `machine/bios/shell/monitor.lua:415-449,455-487,494-507` |
| MVR22 | Boot `reset_320x240` and monitor `prepare_supervisor` each explicitly write the generated enabled-Y-extension command before operating at the high terminal/texture Y coordinates. The generated command derives from opcode 0x09 and enabled payload 1 in paired GP1 leaves. | `machine/bios/gpu/gpu.lua:79-83,109-143`; `toolchain/ts/rompack/gx_register_module.ts:11-16,37`; `machine/ts/spec/gx/gp1.ts:10,18`; `machine/cpp/spec/gx/gp1.h:16,24` |

## Current producer replay and derived facts

Evidence files:

- `/tmp/bmsx-memory-vram-producer-replay.ts`: invokes the actual input/resource loader, atlas builder and upload encoder on current `machine/bios/res`; calculates rectangle results using the audited API formula.
- `/tmp/bmsx-memory-vram-producer-replay.json`: input identity, actual dimensions, upload digest/header, all image dimensions/placements and derived rectangle.
- Command: `./node_modules/.bin/tsx /tmp/bmsx-memory-vram-producer-replay.ts` from repository root; completed with exit 0.

No existing `dist/system/*.rom` was used as current evidence: its timestamp preceded this extraction and a producer replay is cheap. This avoided assuming that a cached ROM represents today's assets.

| ID | Observed producer output or explicit derivation | Evidence / derivation |
|---|---|---|
| MVRD01 | Current resource replay captured 108 images: 107 at 4×6 and one `whitepixel` at 1×1. Actual atlas is 216×12. Configured maxima remain 256×64. | Replay JSON `sourceFileCount`, `imageCount`, `actualAtlas`, `imageSizes`; actual-source packer and dimension path MVR08–MVR10. Input identity `df6c8ac17482cc7d69cff9936748bb77d9f71b7748d3906cfbb45ff2d1bb126c`. |
| MVRD02 | Direct16 payload is 216×12×2 = **5184 bytes**, 2592 16-bit VRAM words / 1296 32-bit transport words. Upload including header is **5196 bytes**, 1299 transport words. | MVRD01, MVR10/MVR11; exact lengths also in replay JSON. Upload SHA256 `2e564f3a8d67a8c51dee4b3510d58192390a04f7a69d225f407ebef2089c5a02`. |
| MVRD03 | Upload header words are **0xA0000000, 0x03C00300, 0x000C00D8**. Decoded origin=(768,960), extent=(216,12); actual texture rectangle is `[768,984) × [960,972)`. | Exact encoded words in replay JSON; encoding MVR11 and opcode MVR12. Destination derives from configured maxima MVR07, while extent derives from actual packing MVRD01. |
| MVRD04 | Full terminal rectangle is `[704,1024) × [720,960)` with extent 320×240. | 80×4=320; 40×6=240; 704+320=1024; 720+240=960. MVR05. |
| MVRD05 | Bounding both current rectangles yields `[704,1024) × [720,972)` with origin=(704,720), extent=(320,252). API word 1 is **0x02D002C0** and word 2 **0x00FC0140**. | MVR02/MVR03 applied to MVRD03/MVRD04: left=min(704,768)=704; top=min(720,960)=720; right=max(1024,984)=1024; bottom=max(960,972)=972; width=320; height=252. Packing `(720<<16)\|704`, `(252<<16)\|320`. Replay JSON repeats this calculation; it does not execute the BIOS function. |
| MVRD06 | The returned bounding rectangle covers **80640 16-bit VRAM words = 161280 bytes** of storage footprint, but it is a two-dimensional rectangle with 1024-word row stride, **not** a contiguous CPU byte-address allocation. Its area is larger than the exact terminal-plus-texture union. | 320×252=80640 and ×2=161280; row stride MVR06; bounding behavior MVR02. Exact union=320×240+216×12=79392 words since the rectangles do not overlap in Y. The API nevertheless returns the whole bounding rectangle, not a list of reusable internal holes. |
| MVRD07 | A query result must not be hardcoded from the maximum 256×64 packing bounds. Current source assets can change the packed extent without changing those bounds or the fixed texture origin. | MVR07–MVR11 and current output MVRD01–MVRD05. The API deliberately reads actual emitted extent words. |

## What the cart-facing call demonstrates

This is a transcription of the production consumer's existing calling convention, not a newly invented API:

```lua
local system_vram_region<const> = require('gpu/system_vram_region')
local system_origin<const>, system_size<const> = system_vram_region()
local x<const> = system_origin & 0x0000ffff
local y<const> = system_origin >> 16
local width<const> = system_size & 0x0000ffff
local height<const> = system_size >> 16
```

Source: `cartlib/gx/vram.lua:1-2,99-107`. The production allocator reserves exactly those coordinates before allocating framebuffers (`:99-119`). It does not expose the resulting reservation handle through `configure`'s return; the general `vram.release` operation at `:129-136` is not evidence of an authorized system-reservation release protocol. This extraction supplies existing syntax and representation, **not** a fully packaged cart project or observed cross-image execution.

## Synthetic test rectangles are not a source disagreement

- `tests/lua/gx_gpu_lua.test.ts:352-362` explicitly writes a synthetic **256×64** upload extent into its fake asset header. For that input, the actual BIOS query correctly yields **320×304**.
- `tests/lua/gx_vram.test.ts:18-20` and `tests/rompacker/gx_texture_contract.test.ts:307-309` stub a function returning 320×304. They test consumers under that chosen reservation.
- Those values are **not** measurements of the current system atlas, and none of these sources establishes that actual packing must fill the maxima. They therefore do not conflict with the present 216×12 / 320×252 producer result. Do not copy their synthetic rectangle into public numerical reservation prose.

## Ownership conclusions and explicitly withheld claims

### Supported bounded conclusions

1. The exported function publishes the standard firmware **bounding rectangle** derived from its terminal layout and actual packed system texture header. It is a coordinate/extent query, not mapped CPU-RAM storage or an allocation service.
2. Current boot terminal drawing and later BIOS monitor drawing use the terminal surface and font atlas source. Monitor entry reuploads the atlas rather than treating handoff as the final lifetime event.
3. The actual production cartridge allocator respects the full query result before placing framebuffers. Neither clearing terminal text/status nor changing the active terminal viewport makes the query shrink or disappear.
4. For today's assets the numeric result is MVRD05; the programmer-facing stable operation is the query and word decoding, not an eternal hardcoded size.

### Withheld / blocked ownership claims

| Gap | Why it is not established here; stop affected claim |
|---|---|
| MVRO01 — Blanket cartridge ownership after handoff | Handoff only clears status/flushes/masks/EXECs (MVR20). It does not express a release. Later monitor use exists (MVR21). Do not claim the whole 2 MiB, the entire system rectangle, or the atlas maximum region is free for cartridge ownership after EXEC. |
| MVRO02 — Authorized release, overwrite, disable or reacquire protocol | No such public API/authority rule was identified in this narrow route. A pure rectangle query and a software allocator's ordinary release function do not establish it. Do not invent `terminal.close`, a handoff ownership transfer, or a system-reservation release handle. |
| MVRO03 — Protection/enforcement | The query itself does not reject writes or program a hardware reservation. The audited allocator checks only its own rectangle list. This is not an audit of all hardware access policy; do not claim globally enforced read-only/protected VRAM, or infer permission merely because raw writes are representable. |
| MVRO04 — Cartesian complement equals allocatable/free VRAM | The query identifies one firmware reservation. It does not account for every active framebuffer, texture, display mode, concurrent producer, format/stride constraint or operation lifetime. Do not label all other coordinates available for arbitrary use. |
| MVRO05 — Shared-buffer completion and restoration | The inspected terminal submission uses its own DMA/IRQ sequence, but that does not specify arbitrary cartridge shared-buffer admission, race freedom, upload/readback completion, device ownership, or pixel preservation/restoration after supervisor entry/exit. The full supervisor storage/context model was deliberately not audited. |
| MVRO06 — Reset implies release or guaranteed contents | Boot resets a GPU mode then uploads/draws; terminal logical resets mark work dirty. Neither proves a physical VRAM clear, persistence guarantee, release edge or permission transfer on CPU/GPU reset. Those hardware/reset contracts need their named owner if claimed. |
| MVRO07 — Exhaustive execution/BIOS call contract | Existing export and production caller establish this named no-argument/two-word operation. Complete call permissions, every exception/NMI delivery condition, all cross-image argument/return conventions and a project build/launch recipe remain outside scope. |

**Ownership blocker classification:** sufficient evidence exists to document this function's representation, current coordinates and concrete firmware consumers. There is **not** sufficient ownership authority to add a blanket cart-release/reuse guarantee. Treat that missing policy as a genuine blocker for those sentences only; do not repair runtime code, relabel mapped access as permission, or expand this slice into unrelated devices.

## Subsequent actual BIOS-call evidence

Root independently built the current `memory_manual` debug cart, then ran
`headless:test` with `tests/carts/memory_manual/memory_vram_assert.lua`.
The `firmware_vram_query` unit case passed the actual imported no-argument,
two-return BIOS call with words `02d002c0`/`00fc0140`. The original
`memory_manual_assert.lua` integration case was then rerun and also passed.
Log: `/tmp/bmsx-memory-vram-bios-call.log`; artifact
`2b7326ddef694d5a4958e44823690d6e2f675fef052a114749d7adf51dc2bbc1`.
This supplements, rather than relabels, the source/atlas producer replay above.
The literals are current-firmware expectations, not a permanent hardware
reservation size, release test, preservation guarantee or native parity claim.
