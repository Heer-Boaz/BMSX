# GTE material contrast and two-surface display facts

## Extraction snapshot

The initial operand-producer line references below identify the pre-extension
`e1d9c4f8a` snapshot; paired device owners are unchanged. Current producer and
execution observations are recorded in the final section.

Verified 2026-10-18 at HEAD `e1d9c4f8a36644f1b7c72d87b6ad421b4430fb9f`. The older `/tmp/bmsx-gte-material-contrast-facts.md` was treated only as a hypothesis. This refresh uses the paired live owners/spec and the existing `gte_cue_manual` typed ROM operands. No architecture document or PDF was opened; public chapter search hits were not numerical authority. No repository files were edited.

### Source key

- **TS** = `machine/ts/machine/devices/gx/gte.ts`.
- **C++** = `machine/cpp/machine/devices/gx/gte.cpp`.
- **C++ constants** = `machine/cpp/machine/devices/gx/gte.h`.

Each source fact below has one contiguous range in each paired owner, rather than a pile of unrelated ranges.

## Existing operand ownership and representation

| Atomic fact | Current source range |
|---|---|
| Existing typed light directions are rows `(3072,0,2048)`, `(-2048,0,3072)`, `(0,0,-4096)` | `carts/gte_cue_manual/cart.lua:36–39` |
| Existing typed light colors are rows `(4096,1024,0)`, `(2048,4096,0)`, `(1024,2048,4096)` | `carts/gte_cue_manual/cart.lua:40–43` |
| Existing ambient is `(256,512,128)` | `carts/gte_cue_manual/cart.lua:44–44` |
| Existing supplied normal is `(2458,0,3277)` with zero pad | `carts/gte_cue_manual/cart.lua:46–46` |
| Current cart already copies the two typed matrices' ROM words to C[8..12] and C[16..20] | `carts/gte_cue_manual/cart.lua:81–86` |
| Current cart already copies ambient to C[13..15] | `carts/gte_cue_manual/cart.lua:87–90` |
| Current cart's material A word is `0x34c060a0` | `carts/gte_cue_manual/cart.lua:91–91` |
| V0 components are decoded as signed low/high halfwords; no normalization occurs in vector decoding | TS:1161–1181; C++:1033–1053 |
| Ordinary matrix cells are decoded as signed packed halfwords from the selected matrix bank | TS:1196–1207; C++:1068–1079 |
| Light stage selects matrix bank 1 with zero control vector; color stage selects bank 2 and ambient vector | TS:820–825; C++:683–689 |
| Matrix-vector accumulation adds control-vector components multiplied by 4096, then writes IR1–IR3 from the resulting MACs | TS:783–818; C++:646–681 |
| D[6] is low-to-high bytes R,G,B,CODE | TS:1263–1285; C++:1135–1157 |

The exact packed words replayed and retained unchanged are:

- D[0..1] = `0000099a 00000ccd`.
- C[8..12] = `00000c00 f8000800 0c000000 00000000 fffff000`.
- C[13..15] = `00000100 00000200 00000080`.
- C[16..20] = `04001000 08000000 00001000 08000400 00001000`.

The typed declarations above are the producer; signed-halfword decoding above is the datapath interpretation. Replay checked the exact raw normal/control readbacks after every command.

## Selected command facts and consumed inputs

| Atomic fact | TS source range | C++ source range |
|---|---|---|
| NCS function is `0x1e`; NCCS function is `0x1b` | TS:56–58 | C++ constants:52–54 |
| SF is command bit19; LM is bit10 | TS:525–528 | C++:390–393 |
| NCS on V0 runs light transform, color matrix plus ambient, RGB push; no material RGB modulation stage | TS:839–843 | C++:702–706 |
| NCCS on V0 runs the same lighting stages, then colorApply, then RGB push | TS:845–850 | C++:708–713 |
| colorApply multiplies each signed IR channel by the respective `(material byte << 4)` and applies the selected SF through the MAC path | TS:828–832 | C++:691–695 |
| RGB push uses arithmetic MAC right-shift4, byte limiting, shifts the old FIFO, and appends the D[6] CODE byte | TS:1133–1140 | C++:1006–1014 |
| Each selected command clears FLAG independently before its stage sequence | TS:576–590 | C++:441–455 |
| LM=1 gives IR1–IR3 minimum zero; limiting channel3 sets IR3 saturation | TS:747–760 | C++:610–624 |
| IR3 saturation is `0x00400000`, distinct from RGB saturation flags | TS:100–105 | C++ constants:96–101 |
| Summary ERROR is only added when `FLAG & ERROR_MASK` is nonzero | TS:656–665 | C++:521–530 |
| ERROR_MASK is `0x7f87e000`, which does not include IR3 saturation | TS:113–114 | C++ constants:109–110 |

**Consumption conclusion:** Both rows consume the supplied V0 normal, L, K, ambient and D[6] CODE. NCS ignores the R/G/B bytes of D[6]; NCCS consumes them. Initial IR1–IR3 are not retained lighting inputs: the light transform overwrites them before color-matrix use. Old FIFO entries shift but do not enter the new RGB2 arithmetic.

**IR0 conclusion:** Neither complete selected stage sequence invokes depthCue or RTPS, and neither ordinary lighting path reads IR0. IR0 is not a material-contrast input. The fresh replay also seeded D[8]=`0x00000800` once and verified that all three commands left it unchanged; this observation is not being mistaken for a general proof of nonconsumption. No projection or IR0 endpoint comparison belongs to these three rows.

## Current actual-owner mapped replay

Command run from `/home/boaz/BMSX`:

```sh
node --import tsx /tmp/bmsx-gte-material-current-replay.ts
```

Result: `GTE-MATERIAL-CURRENT:PASS (3 exact actual-owner mapped-MMIO rows)`.

Evidence: `/tmp/bmsx-gte-material-current-replay.ts` and `/tmp/bmsx-gte-material-current-replay.json`. This uses actual Memory, CPU, ExecutionAddressSpace, IrqController, DeviceScheduler, and GxGte instances; no stubs or copied GTE arithmetic. All operands, commands and results pass through `Memory.writeMappedU32LE` / `readMappedU32LE`.

| Atomic mapping fact | Current source range |
|---|---|
| Owner maps data/control handlers and COMMAND | TS:205–214; C++:68–77 |
| COMMAND handler invokes execute on the raw word | TS:344–346; C++:206–210 |
| Mapped-memory aligned write dispatch reaches the IO slot | `machine/ts/machine/memory/memory.ts:627–642` |
| IO slot dispatch invokes the registered device write handler | `machine/ts/machine/memory/memory.ts:371–376` |
| Paired spec defines 32 data and 32 control words followed by COMMAND | `machine/ts/spec/bmsx/io.ts:117–122`; `machine/cpp/spec/bmsx/io.h:130–135` |
| Paired spec derives D/C/COMMAND addresses from IO base and word stride | `machine/ts/spec/bmsx/io.ts:174–177`; `machine/cpp/spec/bmsx/io.h:187–190` |

Actual addresses from the current imported spec: D=`0x08010244`, C=`0x080102c4`, COMMAND=`0x08010344`; D[22]=`0x0801029c`, C[31]=`0x08010340`.

All three commands use SF=1, LM=1 and the same frozen normal/L/K/ambient. Set D[6], issue COMMAND, retain RGB2 and FLAG immediately before the next command:

| Row | COMMAND | D[6] | Emitted RGB | D[22] RGB2 | C[31] FLAG | Final MAC1–3 |
|---|---|---|---|---|---|---|
| NCS unmodulated lighting | `0x0008041e` | `0x34c060a0` (RGB bytes ignored) | `(252,217,100)` | `0x3464d9fc` | `0x00400000` | `(4045,3481,1612)` |
| NCCS material A | `0x0008041b` | `0x34c060a0` = RGB `(160,96,192)`, CODE `0x34` | `(158,81,75)` | `0x344b519e` | `0x00400000` | `(2528,1305,1209)` |
| NCCS material B | `0x0008041b` | `0x34a0c040` = RGB `(64,192,160)`, CODE `0x34` | `(63,163,62)` | `0x343ea33f` | `0x00400000` | `(1011,2610,1007)` |

The fixed light transform's third component is -3277; LM=1 limits it to zero and records IR3 saturation. The light-stage limited IR is `(3482,1228,0)`; the shared color/ambient result is `(4045,3481,1612)`. The later material stage changes only the material rows. Thus `0x00400000` is retained negative-light IR3 clipping, **not** material RGB-byte clipping and **not** summary ERROR bit31. Source arithmetic agrees in the scoped paired paths; all exact final words above were asserted by the live TS mapped replay.

## Acceptance boundary

No discrepancy found. This packet establishes only these finite inputs, command consumption, paired-owner arithmetic and three actual TS mapped readbacks. It is **not** new-ROM, guest, rendered-swatch, GP0 packet, framebuffer, PNG, capture, chapter-placement or native/backend acceptance. No native/backend matrix or compiler audit was run. Reuse the existing typed ROM operands and owning setup; do not duplicate the existing cart merely to obtain these three rows.

# GTE cue material stage: finite display facts

Read-only source audit of paired GPU/PCRTC/software owners and existing BIOS/cart precedents. No native execution, architectural document/PDF inspection, framework or CT32 route. Source-derived calculations below are not runtime/display-image proof. Existing unrelated checkout edits were preserved.

## Representation and raw addressing

| Domain | TypeScript owner | C++ owner | Representation / result |
|---|---|---|---|
| PCRTC DISPFB decode | `machine/ts/machine/devices/gx/gpu_pcrtc.ts:361-389` | `machine/cpp/machine/devices/gx/gpu_pcrtc.cpp:123-147` | raw LOW word; FBP=(LOW&511), base **16-bit words**=FBP<<12; FBW=(LOW>>9&63)*64; PSM=(LOW>>15&31) |
| GX16 addressing | `machine/ts/machine/devices/gx/gpu_local_memory.ts:83-90` | `machine/cpp/machine/devices/gx/gpu_local_memory.h:78-80` | baseWord+y*framebufferWidth+x, physical word mask |
| Raw raster storage | `machine/ts/render/backend/software/gx_gpu_vram.ts:11-23,115-139` | `machine/cpp/render/backend/software/gx_gpu_vram.h:16-35,100-123,162-197` | 1024 words/row, RGB555 raw16 with independent stored bit15 |
| Rectangle position | `machine/ts/render/backend/software/gx_gpu_commands.ts:212-227` | `machine/cpp/render/backend/software/gx_gpu_commands.cpp:214-232` | signed11 packet XY + signed11 E5 offset; post-sum signed11 |
| Ordered C0 source/word | `machine/ts/machine/devices/gx/gpu_command_buffer.ts:119-130,147-184,205-207` | `machine/cpp/machine/devices/gx/gpu_command_buffer.h:107-141,185-188` | absolute raw XY, retained command fence, no E5; one pixel returned in low16 and high16=0 |

`000FA000` = FBP0, FBW16 (=1024 words), PSM31 (GX16). `000FA040` changes only FBP to64: 64*4096=262144 (`00040000`) **words**, and 262144/1024=raw row256. It is not a 64-word displacement, byte address, page-swizzled CT16/CT32 allocation, or source-Y change.

Keeping source HIGH=0 gives sourceX/Y=0. Thus A scans raw (0,0)..(255,191); B scans (0,256)..(255,447). SourceX/Y and base are added, not alternatives. Do not set sourceY256 as well as FBP64: that would add the displacement twice.

`018252A8` decodes display signal X680/Y37, magnificationX4/Y1; `000BF3FF` has DW1023/DH191. With the unchanged existing reset timing signalStepX4, the sole circuit crops to output256x192 with one source pixel per output pixel. Width/height/cropping owner: TS `gpu_pcrtc.ts:379-446,461-462`; C++ `gpu_pcrtc.cpp:140-210`. Linear GX16 software source walk is explicit in TS `gx_gpu_scanout_specialized.generated.ts:92-148` and C++ `gx_gpu_scanout.cpp:125-155`.

## Stage B commands and footprint

The exact B draw-state words are E3=`E3040000` (left0/top256), E4=`E406FCFF` (right255/bottom447 inclusive), E5=`E5080000` (offsetX0/Y256), E6=`E6000001` (force stored bit15, do not reject already-masked destinations). E3/E4 clip in **raw VRAM coordinates**, while E5 shifts drawing primitives. BIOS precedent directly matches this boundary: `machine/bios/gpu/gpu.lua:59-76`.

Use the same opaque untextured 60H rectangle path for a black256x192 clear with packet XY(0,0), then56x96 rectangles at relative (20,48), (100,48), (180,48). Actual raw clear rows256..447, rectangle rows304..399, X ranges20..75,100..155,180..235. These ranges cannot touch stage A rows0..191. Raster clip and exclusive ends: TS `gx_gpu_rasterizer.ts:174-205`; C++ `gx_gpu_rasterizer.cpp:165-205`; central clip decode TS `machine/ts/spec/gx/gp0.ts:71-92`, C++ `machine/cpp/spec/gx/gp0.h:73-94`.

A 02H fill is **not** interchangeable with the proposed relative 60H clear: TS `gx_gpu_commands.ts:53-70` uses absolute transfer XY, bypasses E5/E3/E4, and writes converted color without E6. The opaque60H path uses the relative offset, clipping and stored-mask setting as required.

C0 center probes must use **absolute raw** positions (48,352),(128,352),(208,352), packet position words `01600030`, `01600080`, `016000D0`, size `00010001`. Relative Y96 would read A, not B. GP1 `09000000` sets extension0: TS `gpu.ts:1381-1382`, C++ `gpu.cpp:890-891`; normal Y address mask=511: TS `machine/ts/spec/gx/vram.ts:1-12`, C++ `machine/cpp/spec/gx/vram.h:9-21`. RawY352 is therefore valid without enabling the upper-half extension; all B rows remain below512.

## Material RGB2 to GX16, one-pixel C0, and displayed RGB

CODE34 must not become a GP0 opcode: use `60000000 | (rgb2 & 00FFFFFF)`. RGB byte order is R=bits0..7, G=8..15, B=16..23. For opaque untextured rectangles, each channel truncates to5bits (`>>3`), packs R|(G<<5)|(B<<10), and E6 adds8000. Display expansion is `(c5<<3)|(c5>>2)`, not `c5*8` and not a copy of GTE8bit channels. Exact paired arithmetic: TS `gx_gpu_vram.ts:15-23,115-139`; C++ `gx_gpu_vram.h:27-35,100-123,162-197`; RGB555 scanout palette TS `gx_gpu_scanout_palette.ts:5-11`, C++ `gx_gpu_scanout_palette.cpp:7-15`.

| GTE RGB2 | Input R,G,B | RGB555 before bit15 | Stored GX16 | C0 one-pixel word | Expanded displayed R,G,B |
|---|---|---|---|---|---|
|3464D9FC|252,217,100|337F|B37F|0000B37F|255,222,99|
|344B519E|158,81,75|2553|A553|0000A553|156,82,74|
|343EA33F|63,163,62|1E87|9E87|00009E87|57,165,57|
|black clear|0,0,0|0000|8000|00008000|0,0,0|

PMODE stays`0000FF21`: circuit1 enabled, constant alphaFF makes the RGB path raw rather than weighted. Stored bit15 gives PCRTC sample alpha80; a PNG capture alphaFF is not evidence of that sample alpha. TS `gpu_pcrtc.ts:479-528`, C++ `gpu_pcrtc.cpp:233-282`. No CT32 route is needed.

## Publication, source lifetime, and IRQ hazards

Wait for each C0 readiness bit08000000, drain the returned word, then separately wait GPU-idle bit04000000 before publication. Those bits mean different things: TS `gpu.ts:1902-1912`, C++ `gpu.cpp:1379-1389`. Ordered C0 carries its own command fence and materializes raw source readback; idle is not host-display completion or a surface-release notification.

For B, keep PMODE unchanged; mask IRQ delivery, store only DISPFB1_LOW=`000FA040`, ACK stale VBlank4 **after the final display write**, sample callback sequence while masked, unmask4, wait for a changed sequence. `carts/display_manual/cart.lua:62-98` is the established A/B precedent. Its later A-reuse is intentionally **not** part of this extension.

The owners separate live register words from presentation words: TS `gpu_pcrtc.ts:587-598,723-730`, C++ `gpu_pcrtc.cpp:330-343,446-453`. At VBlank, GPU latches presentation words and seals present commands: TS `gpu.ts:1493-1514`, C++ `gpu.cpp:975-996`. Runtime performs this latch **before** raising ordinary VBlankIRQ4: TS `machine/runtime/vblank.ts:44-64`, C++ `machine/runtime/vblank.cpp:31-47`. Direct register reads alone therefore do not prove a displayed image.

Masking IRQ delivery does not erase an already-pending flag or stop the beam. IRQ raise ORs pending bits; ACK clears selected bits; mask stores separately: TS `machine/devices/irq/controller.ts:76-125`, C++ `machine/devices/irq/controller.h` raise plus `controller.cpp:62-92`. An edge between final store and ACK may be discarded; the next fresh callback still proves a later publication opportunity. This is not an atomic multiword swap or an exact-frame timing promise. Not reusing either A or B after B avoids needing any false surface-release inference.

## Firmware exclusion and concrete contradictions

BIOS `gpu/system_vram_region` reports a **bounding rectangle** of terminal+system texture, derived from owned layout/upload words: `machine/bios/gpu/system_vram_region.lua:5-28`. It is not a VRAM allocator. Current terminal layout is raw(704,720),320x240 (`machine/bios/tty/layout.lua:3-13`); existing `tests/carts/display_manual/display_manual_assert.lua:30-31` records origin`02D002C0`, size`00FC0140`, i.e. X704..1023/Y720..971 for the current firmware asset set. Chosen raw X0..255/Y0..447 excludes this region. Test the reported region against the chosen footprint; do not infer universal free-memory ownership. A top>=448 check is sufficient for the current chosen bounding footprint and firmware layout, but not the only valid rectangle-disjointness test.

Concrete pre-extension assertion mismatch: original `tests/carts/gte_cue_manual/gte_cue_manual_assert.lua:33` only establishes firmware top>=192, sufficient for A alone, **not** for the expanded chosen rows0..447. Its original final framebuffer assertion expectsA (`...:36`); an extension ending on B must expect`000FA040`. These are retained test updates, not contradictions in the proposed display contract.

No contradiction found in the proposed non-reusing A-then-B framebuffer/source contract. This audit does not certify actual B execution, screenshots, arbitrary concurrent readers/writers, restoration after takeover, native/backend runtime parity, or a generic allocator/frame loop.

# Current two-stage GTE cartridge: actual observations

- Current producer carts/gte_cue_manual/cart.lua is 221 lines; results.lua is 29 lines, total 250. Same typed ROM transform/projection/light/color/normal setup supplies existing depth stageA then new material stageB; no duplicate setup/cartridge/helper. Existing public gte_depth-cue section's literal source must be updated to current complete program. Four original depth IR0/RGB2/flags/probes remain in BSS, separate new three material RGB2/flags/probes and preserved-depth probes.
- Actual ordinary product+cart build and guest depth_cue_and_display_words PASS; final logs /tmp/bmsx-gte-material-final-{product,cart,guest,capture}.log. First stage completed=1 after freshVBlank; hold two further callback increments only for viewing; then mask delivery while preparing B. Final completed=2 after new framebuffer write and a fresh callback. These chosen callback/capture points are program sequencing, not physical latency guarantees.
- StageA raw GX16 surface(0,0)..(255,191), pitch1024/base0. StageB raw surface(0,256)..(255,447), same pitch/baseword40000H, DISPFB1_LOW000FA040 (FBP64). During B preparation PMODE remains0000FF21 and the first framebuffer remains selected. Source/window/extent remain0/018252A8/000BF3FF. After B commands and C0 probes, GPUidle is observed, framebuffer changes to000FA040, stale controllerVBlankbit2 acknowledged, sequence recorded while masked, bit2 unmasked, then new callback observed. No timing restart or general atomic update/release guarantee.
- All normal/L/K/ambient controls are unchanged. B restores the same normal intoV0, then NCS with materialA word34C060A0 for unmodulated light/color reference (RGBbytesignored, CODE34used); NCCS withA; NCCS withB34A0C040. Commands0008041E/0008041B/0008041B; outputs3464D9FC/344B519E/343EA33F; flags00400000. IR0 left4096 by depth stageA remains4096, but neither NCS norNCCS consumes it. Every result/FLAG retained before next command.
- The three B rectangles are equal56x96 screen-space swatches at relativeX20,100,180/Y48. Black256x192 background and swatches are opcode60 opaque/untextured rectangles, using E3 top256/E4 bottom447/E5 offsetY256; no newGPUreset or draw state that would destroy A. E1000400/E6000001 from common setup stay in force. CODEremoved beforeGP0opcode. Do not use02Hfill instead of60Hclear: source packet establishes02HdoesnotfollowE5/E6.
- Relative drawingY48 is rawY304; center probes use C0 absoluteY352 (offset does not affect transfers), X48,128,208. Raw stored wordsB37F/A553/9E87 return low16/highzero; expanded visibleRGB(255,222,99)/(156,82,74)/(57,165,57), not rawGTEbytes252,217,100/158,81,75/63,163,62.
- Additional C0 reads of originalA centers atX38,98,158,218/Y96 remainA553/B96E/C56C/D169 after B is drawn. These are four raw probes, not all-frame identity proof by themselves. All B writers are constrained to raw rows256..447 by their sourced area/offset/setup and no competing reader/writer/supervisor is assumed. The program never reuses/rewrites either surface after B. Firmware query excludes both surfaces: currentassertion uses reportedtop>=448 and currentquerysize00FC0140, not a universal allocation ABI/free-memory promise.
- Ordinary playback timeline requests frame1(A) and frame4(B). Actual A PNG is byte-identical to the accepted earlier depth plate SHA975a115d75f1bd4fe87684c5c48e8c6eee2cd015ae8acbb655ef7d7abd244b9c. Actual B tests/carts/gte_cue_manual/screenshots/frame_00004.png is native256x192, SHAc744a0241d8e51204c0cdb95122461284949915e58d19ee65f362766d824c645. Root viewed B directly and checked every49,152RGBApixels against exact three-rectangle layout + blackbackground, zero mismatches. Check /tmp/bmsx-gte-material-image-check.json. No labels, annotations, synthetic pixels or image edits. PNGalphaFF is presentation policy, not evidence for samplealpha80.
- These observations prove this ordinary TS/headless program and its two captures in currentcheckout, not native/acceleratedbackend/physicaldisplay parity, everyOS/freshSDK install, all-address allocation or a universal frame-release protocol. Hardware math/field definitions are sourced separately in current GTE and display fact sheets.
