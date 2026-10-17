# GEO docking scene — frozen producer, video and observed output facts

2026-10-17; master baseline d150672fd. New cart is an ordinary BIOS-started
BLua cartridge, separate from geo_manual. Full cart validation passed and the
retained case passed; ordinary-ROM presentation timeline separately produced
six PNGs, all individually viewed by root at original256x192 detail. Final source is frozen; comment cleanup and two-line expression reflow were followed by full validation,
retained-result execution and an ordinary capture rerun with identical PNGs.
This is facts input, not public chapter prose. No architecture/PDF input.

## GS01: actual modules and starting assumptions

Three actual modules: results (typed layouts/BSS), assets (readonly artwork,
hull and record operands), cart (entry). Program is a bounded separate example:
exclusive idle GEO, exclusive GPU/PCRTC, direct ownership of central mask and
GEO_DONE/GEO_ERROR/VBlank sources, valid authored inputs. It does not preserve
other owners' mask and is not an arbitrary inherited-state initialization
routine. Existing manual's separate fault/recovery program handles that topic.
All short authored filenames below are in `carts/geo_scene_manual/`.
Source: carts/geo_scene_manual/cart.lua:1-41,201-212; results.lua:1-152;
assets.lua:1-56. It records each job's STATUS/PROCESSED/FAULT; this case expects
success, rather than routing faults into a general recovery/game loop.

## GS02: authored texture and spaces

One16x16 indexed grayscale drone; palette raw u16 words0000,8000,294A,4631,6318,
7FFF. Index0 transparent, index1 opaque black. Source: assets.lua:3-24.
Both sprites share explicit local origin(0,0), pivot(8,8), octagon
(4,0),(12,0),(16,4),(16,12),(12,16),(4,16),(0,12),(0,4). The pivot is an
illustration mark/asset convention, not a GEO register or a hidden matrix
translation. No rotation occurs here. Source: assets.lua:26-34;
cart.lua:73-99,229-245. Shape/hull is authored, not inferred from image alpha.

The entry expands every authored pixel into4x4 actual RGB555 texels in an
explicit64x64 u16 buffer,8192bytes. Typed view is*u16[64][64], not an array of
Lua-number tables. Upload uses A0, raw origin640,0 (word00000280H), size
00400040H,2048 scalar32bit payload stores to fixed GP0. Source:
cart.lua:7-9,312-325; results.lua:149-152. Adjacent u16 texels share one payload
word. This is prepared texture storage, NOT rectangle primitive scaling.

Local view: screen=(96+4*x,64+4*y), origin at(96,64), axis ends(176,64)/(96,144),
white pivot cross centred(128,96). Hull is cyan and remains above axes in draw
order. Source: cart.lua:73-99. Game world view: screen=(32+4*x,64+4*y), positiveX
right and positiveY down for this illustration. A sprite origin(32,64); B
origins(112,64),(96,64),(80,64) for bx20/16/12. Source: cart.lua:101-117.
Actual sprite rectangles64x64; one texture is modulated blue with header
64A07030H (RGB48,112,160), red with644050C0H (RGB192,80,64). Rectangle UV0,
size00400040H, page640,0. Source: cart.lua:110-117. No semitransparency request.

## GS03: complete geometry chain and buffers

Local hull Q16; identity matrices [65536,0,tx,0,65536,0]. A tx0; B tx is bx<<16.
F32 polygon is a separate96byte typed-BSS object: kind3,count8,dataOffset32,
boundsOffset16,bounds0,0,16,16. Positive authored local Q16 components are
divided by65536 and stored as typed f32 vertices once. Instances use F32
translations0/bx and layer/mask1; no reinterpretation of the Q16 pool.
Source: cart.lua:214-245; results.lua:71-86; assets.lua:26-51.

Each pose retains two matrices,16 actual world vertices,8 AABB words, one SAT
result, two instances, historical contact, summary, and3 job observations.
Source: results.lua:119-147. XFORM uses two24byte records, vertex stride8,
matrix stride24. Records are[0,0,0,0,8,0],[0,0,8,1,8,1]. Source:
assets.lua:35-40; cart.lua:246-264. Waits for separate geo_sequence before
reading results/submitting SAT. SAT pair[0,0,0,1,0],descriptors[1,8,0,0] and
[1,8,64,0] read actual pose.world via SRC2; strides20/16, count1, cmd21H.
Source: assets.lua:41-46; cart.lua:266-282. F32 candidate[0,1,44524F4EH];
strides20/12,STRIDE2=2,candidate modePARAM0=1,capacityPARAM1=1,COUNT1,CMD22H;
live output contact shared, summary perpose. Source: assets.lua:47-49;
cart.lua:284-310. Copies nine raw contactwords to a historical pose record
AFTER completion; validity remains that pose's completed summary count.

Final return repeats the candidate job with separated pose0 instances, SAME
live contact output and new summary. All other required OVERLAP registers
remain from the immediately previous geometry launch; GPU writes do not
change them. It does not erase old contact bytes. Source: cart.lua:327-341.

## GS04: numerical results, separately replayed and guest-asserted

All3 A world hulls equal local; B world hull is local+(bx,0); A bounds0,0,16,16;
B bounds bx,0,bx+16,16. Source input/datatpaths: assets.lua:26-51;
machine/ts/machine/devices/geometry/xform2.ts:51-133 / cpp equivalent:26-108.

| bx | SAT hit,nx,ny,depth,meta rawwords | OVERLAP resultCount,exact,broad,flags |
|---|---|---|
|20|0,0,0,0,0|0,0,1,0|
|16|1,00010000H,0,0,2|0,1,1,0|
|12|1,00010000H,0,00040000H,2|1,1,1,0|

For bx16, hulls touch at x16,y4..12. For bx12, SAT's winning X projection
intersection is[12,16], depth4. Metadata2 selects A edge2,(16,4)→(16,12),
unchanged by normalflip. SAT normal here(+1,0), A→B. SAT has no point field.
Primary: machine/ts/machine/devices/geometry/sat2.ts:151-205; mirror
machine/cpp/machine/devices/geometry/sat2.cpp:119-173.

F32 overlap bx12 contact(-1,+0,4,14,8,pieceA0,pieceB0,feature2,pair44524F4EH).
First five rawwords BF800000,00000000,40800000,41600000,41000000. Normal B→A,
point worldspace. Authored positive winding clip polygon cyclically
(12,12),(12,4),(14,2),(16,4),(16,12),(14,14); point is arithmetic vertex mean,
not a guaranteed area centroid/boundary point. Winding not normalized.
Primary: machine/ts/machine/devices/geometry/overlap2d.ts:410-478,510-565,585-621;
mirror machine/cpp/machine/devices/geometry/overlap2d.cpp:308-375,407-460,480-527.
A miss writes no contact; completed summary count0 leaves no valid slots.
Primary same TS:165-170,316-330 / cpp:56-61,208-222.

Independent actual paired-owner14vector replay and current156vector suite
PASS. The independent geometry review is summarized in
`docs/book1/reviews/geo-scene-source.md`, including raw observations and scope. It resets devices
between jobs but retains RAM, including real XFORM→SAT and hit→miss/touch
contact reuse. It is not paired native guest scene or intermediate native clip
scratch proof. Ordinary guest assertion separately checks all32 world words
perpose/all8 bounds, SAT/summary/contact values, all9 success observations,
return reuse, geo_sequence10/errors0 and6 fresh VBlank observations. Source:
tests/carts/geo_scene_manual/geo_scene_manual_assert.lua:1-117. Final return
summary0,0,1,0; oldcontact remains(-1,0,4,14,8,...) and no marker is submitted.

## GS05: actual overlay instructions and legend

Background stars and lane are artwork only, not GEO shapes. Source:
cart.lua:56-71. Sprites draw before hulls; A outline cyan40FFFF00H, B amber
4000BFFFH,8 finite lines each; B draws after A, so shared touching segment is
amber. Actual XFORM output coordinates become integer screen endpoints with
>>14 (Q16 division65536 combined with4pixels/unit), for this integral positive
scene. Source: cart.lua:119-136. This is not a reusable arbitrary-coordinate
rounding/decoding API.

For the winning horizontal axis only: yellow bracket at y136, from screen
x=32+4*bx to that x+4*SATdepth; ticks y133..139. Only nonzero hit/depth draws
it. bx12 bracket x80..96,16pixel endpoint separation=4worldunits. Touchdepth0
has no horizontal bracket. Source: cart.lua:138-151. Green SAT direction arrow
at screen(64,144)→(88,144), arbitrary anchor corresponding world(8,20), is24px
long=6units for visibility, NOT depth/contactpoint. Only SAT hit draws it.
Source: cart.lua:153-166. Magenta OVERLAP direction arrow starts actual point
screen(88,96) and ends(64,96),24px=6units, NOT depth. White cross centred(88,96),
±3px arms, draws last. Only completed summary result_count!=0 draws contact
arrow/cross. These arrowhead/placement choices are authored for these +X/-X
poses, not a general rotated-normal renderer. Source: cart.lua:168-199.

Finite flat line packet=command/color,P0,P1, opcode40H; command colorRGB888
Rlow,Gnext,Bnext. Pixel coords integer signed11 in halfwords, xlow, yhigh.
Primary: machine/ts/render/backend/software/gx_gpu_commands.ts:230-245;
gx_gpu_rasterizer.ts:57-67; machine/ts/spec/gx/gp0.ts:66-69; mirrored cpp
commands:235-254,rasterizer:49-59,spec:68-71. Repeated scalar GP0 fixedaddress,
not incrementing MMIO sequence destination.

## GS06: VRAM, video setup and publication

Actual chosen regions all raw VRAM word-X / row-Y, 1024halfwords perrow:
A[0,256)x[0,192), B[0,256)x[256,448), texture[640,704)x[0,64). Framebuffer
pitches1024halfwords,256x192 GX16 display. Retained BIOSquery origin02D002C0H,
size00FC0140H=(704,720),320x252; all three rectangles exclude it and each other.
These are rectangular row spans, not disjoint contiguous enclosing byte
intervals. Query is required for a different linked firmware, not a universal
reservation constant. Source: cart.lua:5,201-212,312-325,342-358; actualcase
checks query. Live BIOS function machine/bios/gpu/system_vram_region.lua:10-28;
actual firmware upload header A0000000,03C00300,000C00D8 verified independently.

PCRTC resetCSR200H; PMODE0 while settingup, DISPFB1low000FA000H(A) or000FA040H(B),
high0; DISPLAY1low01800000H/high000BF3FFH; GP1Ygate09000000H. Draw E1E100050AH
(page640,0/direct16/dither0/drawfield1/flips0),E2E2000000H,E6E6000000H.
A E3E3000000H,E4E402FCFFH,E5E5000000H; B E3E3040000H,E4E406FCFFH,E5E5080000H.
Fill02 ignores both E5 and drawbounds, so clear B uses explicit raw
XY01000000H,size00C00100H; A rawXY0. Source: cart.lua:45-54,201-212,342-358.
Live owners: TS `machine/ts/machine/devices/gx/gpu_pcrtc.ts:361-382` /
C++ `machine/cpp/machine/devices/gx/gpu_pcrtc.cpp:121-145` (FBP/pitch/storage);
TS `machine/ts/machine/devices/gx/gpu_local_memory.ts:83-90` /
C++ `machine/cpp/machine/devices/gx/gpu_local_memory.h:78-80` (GX16address);
TS `machine/ts/render/backend/software/gx_gpu_commands.ts:53-72,212-227` /
C++ `machine/cpp/render/backend/software/gx_gpu_commands.cpp:11-37,214-232`
(rawfill/rectangle); TS `machine/ts/render/backend/software/gx_gpu_rasterizer.ts:606-641` /
C++ `machine/cpp/render/backend/software/gx_gpu_rasterizer.cpp:656-686`
(page/UV/no rectangle scaling). Independent source/ROM checks found no
scoped mirror disagreement; see the scene source review.

After drawing: pollGPUSTATbit26idle. Then mask delivery0, programFBP/PMODE,
ACKstaleVBlank4, record callbackcounter whilemasked, unmask1CH and wait for
VBlankcounterchange, NOT arbitrary GEOsequence. Each phase then holds8 later
VBlankservices: authored demonstration cadence, NOT required device delay or
rendering-latency guarantee. Sources: cart.lua:342-365. GPU idle is not display
publication. VBlank GPU latch/seal before guest IRQ: machine/ts/machine/runtime/
vblank.ts:54-64 / cppvblank.cpp:39-48; programmed/presented PCRTC separate:
ts gpu_pcrtc.ts:580-598,723-730 / cpp:325-343,446-453. No pixel snapshot,
per-surface release event or electrical bandwidth inferred.

## GS07: actual ordinary captures, individually viewed

Forced tooling/BIOS builds passed; full cart validate + named suite passed;
ordinary timeline command succeeded (separate ordinaryROM, not fixturecapture):

npm run validate:toolchain:cart -- geo_scene_manual --debug
npm run headless:test -- geo_scene_manual tests/carts/geo_scene_manual/geo_scene_manual_assert.lua
npm run headless:tooling -- --debug --ttl 5 --input-timeline tests/carts/geo_scene_manual/geo_scene_manual_demo.json geo_scene_manual

Actual newcart final artifacta776b0c1807b295fc89ec85ad951a73a66d9176136cdd6dbda6ee11f09b678d7. Capture filenames under
 tests/carts/geo_scene_manual/screenshots/ (all256x192):

| frame | observed role | PNG SHA256 |
|---|---|---|
|4|local sprite,cyan hull,gray axes,white pivot|6f49068b62c00a64e08d64e561ff87b1170d7b2f219af35b59fe46d2ee9cc5d1|
|13|plain separated blue/red drones,star/lane backdrop|0a8e191d2599d82ed58b5e432045d6705aab7f78e0ee125687ca24886deb3f50|
|22|separated cyan/amber hulls,no arrows/cross/bracket|889d8e2b9f2ebb430ecc8c8f0af875b25775ab7829f346177643b575e4a43324|
|31|touching sharedamberedge,green SATarrow,no contact/bracket|68cde4243af86a3c12e7e47aa6a210a45de1e424d8cfab8697f1d3b7b8aecc2f|
|40|overlap,greenarrow,yellowbracket,magentaB→Aarrow,whitepointcross|d80d1c4dc0ee1e10610fa3403b2709850e1314b2bf840f40b9cf7477eda71ffa|
|49|separatedreturn,nooldcontactoverlay; byte-identical to22|889d8e2b9f2ebb430ecc8c8f0af875b25775ab7829f346177643b575e4a43324|

Root actual pixel probes: local(128,96)white;(112,64)cyan. Separated A(48,64)
cyan,B(128,64)amber; touchBtop(112,64)amber; overlap Btop(96,64)amber,green
(72,144)=(0,255,0),yellow(88,136)=(255,255,0),white(88,96),magenta(76,96).
Green/yellow/white/magenta contact diagnostics absent on separatedreturn, and
whole PNG22==49. Amber observedRGB255,189,0 afterRGB555 quantization, not the
unquantized command's255,191,0. These are image observations, not new hardware
rules. No cropped/scaled/recolored/overlaid PNG has been substituted.

Timeline numbers label observed presented-frame capture roles, NOT guestVBlank
counter values, a universal job-to-display frame delay or physical timing.
Timeline/capture owners: `scripts/bootrom/platforms/input_timeline.ts:125-157`,
`headless_capture.ts:91-109,140-160` in that same directory, and
`machine/ts/render/headless/backend.ts:194-219`. This
scope is actual TS ordinaryguest + software headless images and separate
paired rawowner replay, NOT native guest output or accelerated backend proof.
