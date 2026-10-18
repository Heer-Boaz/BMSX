# GTE depth-cue output: frozen facts and observed program

# Finite current GTE cue facts — owner-verified and TS MMIO-replayed

Checkout: `/home/boaz/BMSX`, HEAD `816899c12`, 2026-10-18. Scope is only the four already-selected samples Z=256,384,512,768. No repo edits, architecture document, reference PDFs, compiler audit, native execution, or rendering/backend matrix. The old `/tmp/bmsx-gte-depth-cue-facts-current.md` was a hypothesis, not authority. The input constants below remain the frozen experiment inputs; their register decoding, arithmetic use, and the four results are now checked against live owners and a bounded execution. Chapter prose is not the authority for any result below.

## Source key

- TS owner: `machine/ts/machine/devices/gx/gte.ts`.
- C++ owner: `machine/cpp/machine/devices/gx/gte.cpp`; storage/header: `machine/cpp/machine/devices/gx/gte.h`.
- TS IO spec: `machine/ts/spec/bmsx/io.ts`; C++ IO spec: `machine/cpp/spec/bmsx/io.h`.
- TS memory-map spec: `machine/ts/spec/bmsx/memory_map.ts`; C++ memory-map spec: `machine/cpp/spec/bmsx/memory_map.h`.
- Actual execution artifact: `/tmp/bmsx-gte-cue-owner-replay.json` (produced in this refresh).

## Register representation and addresses

The owners store raw 32-bit data/control words: TS owner:183–185; C++ header:143–145. Signed-halfword decoding is central: `machine/ts/machine/common/numeric.ts:18–26`, `machine/cpp/machine/common/numeric.h:20–28`. Spatial/normal components are signed low/high halfwords, not IEEE floats: TS owner:1161–1181; C++ owner:1033–1053.

IO words stride 4 bytes, IO_BASE=0x08000000: TS memory-map spec:6,23–33; C++ memory-map spec:12,29–39. GTE base/count definitions: TS IO spec:117–122,174–177; C++ IO spec:130–135,187–190. Both define:

- D[n] = `0x08010244 + 4*n`.
- C[n] = `0x080102c4 + 4*n`.
- COMMAND = `0x08010344`.
- D[8] IR0 = `0x08010264`; D[22] RGB2 = `0x0801029c`; C[31] FLAG = `0x08010340`.

The mapped command write synchronously invokes the actual GTE execute path: TS owner:205–214,328–346; C++ owner:68–77,190–212. Replay uses `Memory.writeMappedU32LE`/`readMappedU32LE`, not a duplicated arithmetic implementation. TS dispatch ownership: `machine/ts/machine/memory/memory.ts:366–376,627–642`.

## Frozen inputs — exact words and owning interpretation

All four samples share the same normal, lighting, material, far color, transform, translation, screen offsets, H, DQA, and DQB. The only depth-dependent write is position Z before RTPS. V0 is then replaced with the same normal before NCDS. No coefficients are manually fabricated.

| Input | Exact register words | Decoded meaning | Source anchors |
|---|---|---|---|
| Normal V0 for NCDS | D[0]=`0x0000099a`, D[1]=`0x00000ccd` | N=(2458,0,3277); approximately Q12 (0.6,0,0.8), no normalization stage | TS owner:1161–1181,820–825,852–856; C++ owner:1033–1053,683–689,715–719 |
| Material / CODE | D[6]=`0x34c060a0` | RGB=(160,96,192), CODE=0x34 | TS owner:1263–1285,835–836,1133–1140; C++ owner:1135–1157,698–699,1004–1014 |
| Light matrix L | C[8..12]=[`0x00000c00`,`0xf8000800`,`0x0c000000`,`0x00000000`,`0xfffff000`] | rows [[3072,0,2048],[-2048,0,3072],[0,0,-4096]] | TS owner:1184–1207,820–821,783–817; C++ owner:1056–1079,646–685 |
| Color matrix K | C[16..20]=[`0x04001000`,`0x08000000`,`0x00001000`,`0x08000400`,`0x00001000`] | rows [[4096,1024,0],[2048,4096,0],[1024,2048,4096]] | TS owner:1184–1207,824–825,783–817; C++ owner:1056–1079,646–689 |
| Ambient | C[13..15]=[`0x00000100`,`0x00000200`,`0x00000080`] | signed control vector (256,512,128); accumulator adds each component*4096 before SF shift | TS owner:1210–1215,783–817,824–825; C++ owner:1082–1086,646–689 |
| Far color | C[21..23]=[`0x00000500`,`0x00000600`,`0x00000a00`] | far controls (1280,1536,2560) = RGB bytes (80,96,160)*16; these raw controls enter cue difference*4096 | TS owner:939–947,1287–1297; C++ owner:813–821,1159–1169 |
| Projection matrix | C[0..4]=[`0x00001000`,`0x00000000`,`0x00001000`,`0x00000000`,`0x00001000`] | Q12 identity | TS owner:1217–1228,950–995; C++ owner:1089–1099,824–869 |
| Translation and screen offsets | C[5..7]=[0,0,0]; C[24..25]=[0,0] | zero translation, OFX=OFY=0; positions (0,0,Z) therefore give SXY2=(0,0) | TS owner:1231–1233,1247–1253,950–995; C++ owner:1103–1104,1119–1125,824–869 |
| H | C[26]=`0x00000080` | unsigned low16=128 | TS owner:505–515,1235–1236,984; C++ owner:366–377,1107–1108,857 |
| DQA | C[27]=`0xfffffd00` | signed low16=-768 | TS owner:505–515,1239–1240,993; C++ owner:366–377,1111–1112,867 |
| DQB | C[28]=`0x01800100` | signed32=25166080; not `0x01800000` | TS owner:505–521,1243–1244,993; C++ owner:366–387,1115–1116,867 |

Control-write sign extension applies to C[4],C[12],C[20],C[26],C[27] (among others), not to packed matrix halves generally: TS owner:505–521; C++ owner:366–387. The replay's readback retains exactly the listed frozen words. D[1] and D[8] writes likewise sign-extend their low halfword: TS owner:459–469; C++ owner:324–338.

## Actual command order and coefficient law

For each Z in [256,384,512,768], in that order:

1. Write D[0]=`0x00000000`, D[1]=Z (`0x00000100`, `0x00000180`, `0x00000200`, `0x00000300`).
2. Write COMMAND=`0x00080001`: RTPS, SF=1, LM=0. Immediately retain D[8] IR0 and C[31] FLAG. Replay additionally reads D[24] MAC0, D[19] SZ3, D[14] SXY2.
3. Replace only V0 with D[0]=`0x0000099a`, D[1]=`0x00000ccd`. Do not write D[8].
4. Write COMMAND=`0x00080413`: NCDS, SF=1, LM=1. Immediately retain D[22] RGB2 and new C[31] FLAG. Read D[8] again to confirm unchanged.

SF/LM/function decode and reset-per-command FLAG: TS owner:525–533,559–563; C++ owner:390–398,424–428. NCDS order is light transform, color matrix, material-scaled depth cue, then RGB FIFO push: TS owner:820–836,852–856; C++ owner:683–699,715–719.

RTPS computes q using its actual reciprocal table/refinement/rounded-product path, not exact rational H/Z: TS owner:1071–1093; C++ owner:945–966. q is **not** a separately exposed readable register. Then A=DQB+DQA*q is written to MAC0, and IR0=clamp(A ASR 12,0,4096), with that IR0 shift fixed independently of command SF: TS owner:992–995,1021–1029,1108–1118; C++ owner:866–869,891–900,981–989. This replay reconstructs q exactly from the immediately read MAC0 A and the frozen read-back DQA/DQB; no overflowing A occurs in these four rows.

IR0 is **one D[8] coefficient**, not a per-vertex FIFO. NCDS reads it once and does not overwrite it: TS owner:939–947; C++ owner:813–821. RTPT only produces IR0 for its last vertex; NCDT runs all three normals against that one retained IR0: TS owner:623–627,569–574; C++ owner:488–492,434–439. Do not substitute RTPT→NCDT for the per-sample RTPS→NCDS order.

## Exact executed rows

Source of the numerical observations in this table: current actual-owner replay `/tmp/bmsx-gte-cue-owner-replay.json`; all expected row tuples were also asserted against readback in the replay. Algorithm source ranges are immediately above, not the chapter. Every RTPS had SXY2=`0x00000000`, SZ3=Z.

| Z | actual q, reconstructed from MAC0 | A / read MAC0 | read D[8] IR0 | RTPS FLAG | emitted RGB bytes | read D[22] RGB2 | NCDS FLAG |
|---:|---:|---:|---|---|---|---|---|
|256|32768|256|`0x00000000` (0)|`0x00000000`|(158,81,75)|`0x344b519e`|`0x00400000`|
|384|21845|8389120|`0x00000800` (2048)|`0x00000000`|(118,88,117)|`0x34755876`|`0x00400000`|
|512|16384|12583168|`0x00000c00` (3072)|`0x00000000`|(99,92,138)|`0x348a5c63`|`0x00400000`|
|768|10923|16777216|`0x00001000` (4096)|`0x00000000`|(79,95,160)|`0x34a05f4f`|`0x00400000`|

All four post-NCDS IR0 readbacks exactly equal their pre-NCDS IR0. Half coefficient is at Z384, not Z512. Output CODE stays 0x34: TS owner:1133–1140,1283–1285; C++ owner:1004–1014,1155–1157.

NCDS FLAG `0x00400000` is IR3 saturation, not ERROR bit31. The fixed light matrix produces negative third light component (-3277) that LM=1 clamps to zero. Saturation stays latched for that command. Flag constants/mask and limit owner: TS owner:102–124,747–760,652–677; C++ header:98–120; C++ owner:520–544,617–631. RTPS FLAG is reset before each RTPS; NCDS resets it again, so retain both separately.

Full IR0=4096 does not promise exact far bytes. Ordered SF-shifted cue differences produce the measured (79,95,160), not (80,96,160). Material inputs before cue are (10355200,5346816,4952064); the shifted differences are (-1249,230,1351). NCDS's final read MAC triplets in the four rows are (2528,1305,1209), (1903,1420,1884), (1591,1477,2222), (1279,1535,2560), followed by output ASR4. Owning precision/order: TS owner:680–718,835–836,939–947,1133–1140; C++ owner:546–584,698–699,813–821,1004–1014.

## Evidence boundary / stop gate

No scoped paired spec/owner disagreement found. This is bounded TS owner/MMIO execution plus read-only C++ source comparison. It is **not** execution of a cartridge ROM, BIOS helper acceptance, a PNG capture, or proof of the eventual display bytes. Later equal-shape/equal-screen-size flat swatches must use these retained RGB outputs without compensating light/material/camera changes; that is a visualization choice, not a GTE equal-world-size projection claim. Stop if actual new-ROM MMIO readback differs from this table or the selected display path changes intended bytes; name the exact conflicting source/readback locations rather than adjusting frozen inputs.

Independent scoped C++ source check completed: `machine/cpp/machine/devices/gx/gte.cpp:646–689,698–719` gives intermediate light IR=(3482,1228,0) and color IR=(4045,3481,1612); manual application of `gte.cpp:813–821,945–966` agrees with the four TS-executed rows. Exact negative-light saturation owner is `gte.cpp:610–624`; flag definitions `machine/cpp/machine/devices/gx/gte.h:96–110`, summary ERROR rule `gte.cpp:521–530`. No native execution claimed.

# Finite BLua GTE cue and GX16 route

Read-only source packet; no BIOS/runtime/compiler change implied. Scope is the actual typed operand + raw whole-word MMIO route. `machine/bios/` has no GTE programming module; the reusable public module is `cartlib/gx/gte.lua`.

## Typed GTE interface and existing pattern

- `cartlib/gx/gte.lua:4-27`: imported fixed layouts: `gte_matrix { rows: i16[3][3]; pad: i16 }` (20 bytes), `gte_vector { x,y,z,pad: i16 }` (8), `gte_transform { rotation: gte_matrix; translation: word[3] }` (32), `gte_projection { offset_x,offset_y,h,cue_gain,cue_offset: word }` (20).
- `cartlib/gx/gte.lua:29-33,39-49`: `gte.data: *word[32] = 0x08010244`, `gte.control: *word[32] = 0x080102c4`, `gte.command: *word = 0x08010344`; `command_sf_shift_12=0x00080000`, `command_lm_positive=0x00000400`.
- Existing executed structural precedent: `carts/gte_manual/cart.lua:19-59` declares Q12 identity `rodata model_to_view: gte_transform`, `gte_projection`, two `gte_matrix` records, `word[3]` ambient and `gte_vector` arrays. `:73-89` uses typed `*word` views and fixed-size scalar whole-word transfer loops; no runtime Lua control-array construction, local ABI encoder or imaginary BIOS setter.
- Example setup values now authored in `carts/gte_cue_manual/cart.lua:22-53`: identity rotation diagonal 4096 and translation `{0,0,0}`; projection H=128, DQA/cue_gain=-768, DQB/cue_offset=0x01800100, offsets 0; lighting matrix rows `{3072,0,2048}`, `{-2048,0,3072}`, `{0,0,-4096}`; color matrix rows `{4096,1024,0}`, `{2048,4096,0}`, `{1024,2048,4096}`; ambient `{256,512,128}`; far color `{80<<4,96<<4,160<<4}`; normal `{2458,0,3277,0}`. Material RGB/CODE word is `0x34c060a0` (`:91`). Static records are ROM data, not tables.
- Actual control destinations are exported names: rotation starts `control_r11r12=0`, translation `control_trx=5` through `control_trz=7`, light matrix `control_l11l12=8`, ambient `control_rbk=13` through `control_bbk=15`, color matrix `control_lr1lr2=16`, far RGB `control_rfc=21` through `control_bfc=23`, projection `control_ofx=24` through `control_dqb=28`, `control_flag=31` (`cartlib/gx/gte.lua:140-171`). Projection record is copied sequentially at `control_ofx`, so its `h/cue_gain/cue_offset` program H/DQA/DQB directly.

## Result lifetime (no imagined functions)

- `cartlib/gx/gte.lua:62,68,107-129`: RTPS opcode `0x01`, NCDS opcode `0x13`; V0 words are `data_vxy0=0`, `data_vz0=1`; `data_rgb=6`, `data_ir0=8`, `data_sxy2=14`, `data_sz3=19`, `data_rgb2=22`.
- Exact current route: `carts/gte_cue_manual/cart.lua:106-123`. Write position's two ROM words into V0; issue `*command = gte.opcode_rtps | gte.command_sf_shift_12`; retain SXY2, SZ3, IR0 and FLAG separately; restore the original supplied normal's two ROM words into V0 (not the transformed position); issue `*command = gte.opcode_ncds | gte.command_sf_shift_12 | gte.command_lm_positive`; retain RGB2 and the NEW FLAG separately. NCDS consumes retained IR0; merely restoring V0 must not overwrite IR0.
- Existing executed result-lifetime precedent: `carts/gte_manual/cart.lua:110-128` retains projected screen pairs before replacing V0..V2 with normals, then issues NCCT and draws using RGB0..2.

## Ordinary opaque rectangle -> GX16 -> PCRTC (not CT32)

- Existing packet precedent: `carts/gpu_manual/cart.lua:48-57` opaque `0x60BBGGRR, XY, WH` rectangles; explicit draw state `:80-86`; GX16 display setup `:72-78`. `carts/gte_manual/cart.lua:132-141` waits for GPU idle, publishes a framebuffer and waits a later VBlank.
- Current authored presentation route: `carts/gte_cue_manual/cart.lua:62-71,95-104,125-150`. Own raw region (0,0)..(255,191), GP0/GP1, circuit 1 and VBlank handler. `framebuffer=0x000fa000`, source=0, window=0x018252a8, extent=0x000bf3ff, `GP1=0x09000000`; draw state `E1000400` (dither disabled), E2=0, area 256x192, offset 0, `E6000001` (force stored bit15, no mask check). Draw black background as ordinary rectangle, then four equal 44x96 rectangles at X=16,76,136,196 / Y=48.
- The packet must be `0x60000000 | (RGB2 & 0x00ffffff)` then `X | (48<<16)`, then `44 | (96<<16)`. CODE=0x34 is retained GTE data, NOT the GP0 opcode.
- One-pixel C0 probes are at X+22,Y96, size `0x00010001`; GPUREAD high half is zero for this odd one-pixel transfer (`carts/gte_cue_manual/cart.lua:130-136`; odd-tail precedent `carts/gpu_manual/cart.lua:116-125`). Do not repeat the 16-bit sample into the high half.
- Actual paired opaque rectangle owners: TS `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:174-205` (`drawGxGpuSoftwareRectangle`), C++ `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:173-204` (`drawGxGpuSoftwareRectangle`). Both call the pixel writer with dither=false for this rectangle path.
- Actual RGB8->RGB555 conversion and mask storage: TS `machine/ts/render/backend/software/gx_gpu_vram.ts:115-139` (`gxGpuSoftwareWriteRenderVramPixel5`, `gxGpuSoftwareWriteRenderVramPixel`), C++ `machine/cpp/render/backend/software/gx_gpu_vram.h:99-122,162-197` (same functions). Each byte truncates by >>3; color=R5|(G5<<5)|(B5<<10); force-mask adds 0x8000. Central conversion helpers also exist at TS `:15-23` / C++ `:27-35` (`gxGpuSoftwareRgb888WordToRgb555`, `gxGpuSoftwareRgb555ChannelTo8`). These are owner evidence, not helpers to duplicate in the cart.
- GX16 scanout expansion: TS `machine/ts/render/backend/software/gx_gpu_scanout_palette.ts:1-11`, C++ `machine/cpp/render/backend/software/gx_gpu_scanout_palette.cpp:7-13` build `GX_GPU_SOFTWARE_RGB555_RGBA` with channel `(c5<<3)|(c5>>2)`; stored bit15 supplies sample alpha 0x80. Actual table consumers include TS `machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated.ts:72-78`, C++ `machine/cpp/render/backend/software/gx_gpu_scanout.cpp:68-73`. PNG alpha is not evidence of sample alpha.

## Exact four-row lossy-display table

GTE-owner/MMIO RGB2 values supplied by the sibling fact replay, not independently ROM-accepted here. RGB555 and expanded RGB columns are exact arithmetic from the paired owners above. Current ordinary guest/capture acceptance belongs to the parent agent.

| Z | retained RGB2 (CODE+BBGGRR) | GTE raw RGB8 | truncated RGB5 | stored RGB555+bit15 | one-pixel C0 word | PCRTC expanded RGB8 |
|---|---|---|---|---|---|---|
| 256 | 0x344b519e | (158,81,75) | (19,10,9) | 0xa553 | 0x0000a553 | (156,82,74) |
| 384 | 0x34755876 | (118,88,117) | (14,11,14) | 0xb96e | 0x0000b96e | (115,90,115) |
| 512 | 0x348a5c63 | (99,92,138) | (12,11,17) | 0xc56c | 0x0000c56c | (99,90,140) |
| 768 | 0x34a05f4f | (79,95,160) | (9,11,20) | 0xd169 | 0x0000d169 | (74,90,165) |

Raw RGB2 must remain in retained results. Displayed RGB differs by the intentional ordinary GPU datapath; do not claim PNG pixels equal raw GTE channels. This finite packet supplies no CT32 route, swizzle encoder, cart-side conversion helper, BIOS GTE function or runtime patch.

Parent validation update (reported after this source packet was written): fresh ordinary guest and capture pass; all 49,152 image pixels match the four-rectangle layout and black background; raw GX16 probes A553/B96E/C56C/D169 and expanded RGB match this table. This subagent did not independently run the cart.

# Actual GTE cue cartridge/output observations

These are bounded actual observations from current carts/gte_cue_manual/{cart,results}.lua and tests/carts/gte_cue_manual/gte_cue_manual_assert.lua, not new hardware rules. Exact paired hardware arithmetic/format facts are in the separate refreshed GTE and BLua-route packets.

- Program: 153-line BLua entry +22-line const/BSS module. Fixed typed ROM records, whole-word transfers to existing GTE windows; no local packing helper, heap control table or fabricated BIOS setter. positions=(0,0,Z) for Z256,384,512,768; same normal/material/light/color/far/transform/projection controls for every row. Every position projects to (0,0) and SZ3=Z; the program deliberately draws equal screen-space swatches, not their projected world geometry.
- Actual fresh ordinary product, installed BIOS and cart build pass. Ordinary guest case depth_cue_and_display_words passes all four IR0/RGB2 tuples, SXY2=0, SZ3=Z, per-command flags, post-NCDS IR0 unchanged, center raw GX16 samples and display words, plus fresh VBlank sequence. Logs /tmp/bmsx-gte-cue-{product-build,bios-build,cart-build-final,guest-final,capture-final}.log. No native or accelerated-backend execution claimed.
- Program owns GTE, GPU ports/display configuration, direct VBlank handler and raw rectangle(0,0)..(255,191), pitch1024. It records the actual BIOS gpu/system_vram_region result; current reported firmware bounding rectangle is outside this chosen image (top>=192; actual query/source already published in Memory). This is not a general allocator or a grant that all other coordinates are free; assumes no concurrent reader/writer or supervisor takeover.
- PMODE0000FF21; DISPFB1_LOW000FA000; source0; DISPLAY1_LOW018252A8; DISPLAY1_HIGH000BF3FF; reset timing, GX16 base0/pitch1024, output256x192. GP1(09)/GP0(E1/E6) state belongs to program: 09000000 clears Y extension; E1000400 disables dither; E6000001 forces stored bit15, mask check off. GP060000000 is opaque untextured rectangle; RGB2 CODE34 is removed before OR with opcode60.
- Four rectangles are identical44x96 at X16,76,136,196 / Y48, black256x192 background. Each rectangle uses the retained corresponding RGB2, not a manually fabricated color. One-pixel C0 readback center at X+22,Y96 returns A553,B96E,C56C,D169 in low16, high16 zero. READYbit27 before each GPUREAD, separate idlebit26 before display enable.
- Programmed display reads and raw probes are not output acceptance. After last PMODE write it acknowledges stale controller VBlankbit2, records callback sequence, unmasksbit2 and waits for a fresh sequence. Exact hardware latch/IRQ facts are the existing PCRTC facts/source owner boundaries; no atomic multiword or latency guarantee is claimed.
- Actual ordinary ROM playback capture frame1 exists at tests/carts/gte_cue_manual/screenshots/frame_00001.png. Frame1 is the chosen capture point, not a guaranteed hardware latency. Native256x192 RGBA PNG SHA256 975a115d75f1bd4fe87684c5c48e8c6eee2cd015ae8acbb655ef7d7abd244b9c. Root opened the original image and separately compared ALL49,152 RGBA pixels against exact rectangular bounds and palette; all match. Result /tmp/bmsx-gte-cue-image-pixels.json.
- Left to right displayed RGB: (156,82,74),(115,90,115),(99,90,140),(74,90,165). Every other pixel RGB0,0,0. Stored sample bit15 yields alpha80 by source; PNG alphaFF is opaque presentation policy and NOT proof of hardware sample alpha. Use RGB claims for this picture only. No labels, arrows, synthetic pixels, resampling or other image edits are applied; public figure will be byte-identical copy.
- GTE raw RGB8 values remain (158,81,75),(118,88,117),(99,92,138),(79,95,160), so screenshot RGB is NOT claimed to equal GTE raw result bytes. The ordinary GX16 drawing/scanout path truncates then expands channels as the paired source packet describes.
