# PCRTC finite sampling facts, current checkout

Scope: facts only; predecessor `/tmp/bmsx-pcrtc-sample-progression-facts.md` was treated as hypothesis. No architecture document/PDF opened, no repository edits, no native or backend-matrix execution. Paired spec/owner/software consumer sources below were reread. **No mismatch found in this finite scope.**

## Public formula (no invented register)

`div` means nonnegative integer quotient. For an enabled active horizontal window:

```
s = (SMODE1_LOW >> 21) & 15
S = DISPLAY_LOW & 4095
M = ((DISPLAY_LOW >> 23) & 15) + 1
A = (S + s - 1) div s
sourceX(n) = framebufferX + ((A*s - S + n*s) div M)
```

Here `n=outputX-circuit.displayX`, not an absolute output coordinate; `s` and `M` are signal units per output pixel and per source pixel respectively. `A*s-S` is the first-sample phase. There is no mapped R register: the implementation reciprocal is retained owner state, not part of the public programming model.

Sources: register indices TS `machine/ts/spec/gx/pcrtc.ts:12-33`, C++ `machine/cpp/spec/gx/pcrtc.h:13-34`; `s` TS owner `machine/ts/machine/devices/gx/gpu_pcrtc.ts:273`, C++ owner `machine/cpp/machine/devices/gx/gpu_pcrtc.cpp:92`; S/M/source origin/advance/remainder TS owner `:372-389`, C++ owner `:133-150`; crop/window/phase TS owner `:396-408,426-442`, C++ owner `:157-166,184-198`.

For emitted samples, `N=A*s-S+n*s` lies in 0..4095 because the exclusive signal span is `(DISPLAY_HIGH & 4095)+1` and the output boundaries are converted independently upward. M is 1..16. Existing retained reciprocal is `ceil(262144/M)` (owner integer formula `(262144+M-1) div M`) and unsigned shift 18. The consumer initializes the quotient once, then advances exact quotient/remainder (`s div M`, `s % M`). Sources: TS owner `:98-99,218-220,381,385-387,426-438`, C++ owner `:22-23,142,146-148,184-194`; C++ shift constant `machine/cpp/machine/devices/gx/gpu_pcrtc.h:41`; actual TS GX16 RGBA consumer `machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated.ts:733-767`; native consumer `machine/cpp/render/backend/software/gx_gpu_scanout.cpp:214-269`. An exhaustive bounded arithmetic check and one live TS owner/software replay passed; see the finite execution result below.

## Exact GX16 strip words

Start from reset timing words, whose SMODE1_LOW is `40806504H` (s=4) and SMODE2 is zero (noninterlaced): TS spec `machine/ts/spec/gx/pcrtc.ts:75-98`; paired native spec `machine/cpp/spec/gx/pcrtc.h:69-92`.

| Register | Raw word | Meaning |
|---|---|---|
| PMODE_LOW | 0000FF21H | EN1=1, EN2=0, MMOD=1, AMOD=0, ALP=255; circuit1 raw RGBA |
| DISPFB1_LOW | 000FA000H | FBP=0; FBW=16, so framebufferWidth=1024 source pixels; PSM=31 GX16 |
| DISPFB1_HIGH | 00008020H | source origin (32,16) |
| DISPLAY1_LOW | 010252AAH | signal origin (682,37); encoded MAGH=2 => actual M=3, MAGV=0 => factor1 |
| DISPLAY1_HIGH | 0000001FH | width32 signal units; height1 row |

Decode sources: TS owner `machine/ts/machine/devices/gx/gpu_pcrtc.ts:371-389,426-439,449-458,492-501`; C++ owner `machine/cpp/machine/devices/gx/gpu_pcrtc.cpp:132-150,184-212`; PSMGX16=31 TS `machine/ts/machine/devices/gx/gpu_local_memory.ts:8`, C++ `machine/cpp/machine/devices/gx/gpu_local_memory.h:12`; storage selection TS owner `:163-170`, C++ owner `:26-34`; PMODE masks TS spec `:39-47`, C++ spec `:40-48`.

Signal interval [682,714), A=171, exclusive right=179, cropSignal=(682,37), cropPixelX=171; circuit display=(0,0), right=8, bottom=1; output **8x1**; phase **2**. M=3; implementation reciprocal=87382; sourceAdvanceX=1; remainderStepX=1; linearSampling=false. Width/height derive from crop and boundaries, not MAGH division. Sources: TS owner `:396-408,426-442,461-465`, native owner `:157-166,184-198,215-219`.

| n | absolute signal X | N | source offset | source X,Y | GX16 u16 word address | uploaded raw word |
|---:|---:|---:|---:|---|---|---|
|0|684|2|0|(32,16)|4020H|8000H|
|1|688|6|2|(34,16)|4022H|8002H|
|2|692|10|3|(35,16)|4023H|8003H|
|3|696|14|4|(36,16)|4024H|8004H|
|4|700|18|6|(38,16)|4026H|8006H|
|5|704|22|7|(39,16)|4027H|8007H|
|6|708|26|8|(40,16)|4028H|8008H|
|7|712|30|10|(42,16)|402AH|800AH|

GX16 addresses are **16-bit word addresses** `baseWord+y*framebufferWidth+x` modulo VRAM word count, not byte addresses. For byte offsets multiply by2 (8040H,8044H,8046H,8048H,804CH,804EH,8050H,8054H). The 16-word upload belongs at source x32..47,y16; raw addresses 4020H..402FH. Sources: TS address owner `machine/ts/machine/devices/gx/gpu_local_memory.ts:83-89`; C++ address owner `machine/cpp/machine/devices/gx/gpu_local_memory.h:78-79`; actual software fetch TS `machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated.ts:34-35,92-95`, C++ `machine/cpp/render/backend/software/gx_gpu_scanout.cpp:35-38,83-89`; VRAM u16 backing `machine/ts/render/backend/software/gx_gpu_state.ts:104-106`.

The eight sampled raw words are **8000,8002,8003,8004,8006,8007,8008,800A** hex. In this RGB555 word pattern only the 5-bit red channel varies; alpha bit15 is set. TS palette source `machine/ts/render/backend/software/gx_gpu_scanout_palette.ts:3-11`. No claim that the raw words are RGB888 pixels.

## Bounded reciprocal equivalence proof and finite execution result

Let `K=262144`, `r=N%M`, and `e=M*((K+M-1) div M)-K`, so `0<=e<M`. Then the reciprocal expression is `(N/M)+(N*e)/(M*K)`. After removing the integer quotient, its fractional numerator is `r*K+N*e`, strictly below `M*K`: `r<=M-1` and `N*e<=4095*15=61425<K`. Thus unsigned `>>18` selects exactly `N div M` for **all emitted horizontal samples**, not for arbitrary unbounded N. Maximum product `4095*262144=1073479680` stays below 2^30. This proof uses the owner field/window bounds cited above.

Executed `node --import tsx --input-type=module` from the repository with direct owner/software imports, no repository fixture modifications. It checked the reciprocal/quotient equivalence with exact BigInt arithmetic for all **65,536 pairs** (`M=1..16`, `N=0..4095`), then initialized reset words, replaced the five raw words in the table, updated `GxGpuPcrtcTiming` and `GxGpuPcrtcScanout`, wrote 16 u16 words `8000H..800FH` through the existing GX16 address function at `(32..47,16)`, and called the real `scanoutGxGpuSoftwareVram` once. Assertions passed; exit0. This is software TS replay evidence, not a native/backend-matrix/cart-run claim.

Observed result, also persisted at `/tmp/bmsx-pcrtc-sampling-live-result.json`:

```
running=true, s=4
output=8x1, cropSignal=(682,37), sourcePhaseX=2, M=3
baseWord=0, framebufferWidth=1024, framebufferOrigin=(32,16)
displaySignalOrigin=(682,37)
retained reciprocal=87382, advance=1, remainderStep=1, linear=false
word addresses = 4020 4022 4023 4024 4026 4027 4028 402A
packed RGBA = 80000000 80000010 80000018 80000021 80000031 80000039 80000042 80000052
red8 = 0 16 24 33 49 57 66 82
```

Packed TS RGBA is low-byte red; bit15 of raw GX16 becomes alpha byte80H, not FFH. The expansion is `(channel<<3)|(channel>>2)`; source `machine/ts/render/backend/software/gx_gpu_vram.ts:21-22` and palette `machine/ts/render/backend/software/gx_gpu_scanout_palette.ts:3-11`. Consumer routing uses retained owner state directly: `machine/ts/render/backend/software/gx_gpu_scanout.ts:27-44,71-83`; this case's nonzero phase/unequal step and M choose the generic composition path (`machine/ts/machine/devices/gx/gpu_pcrtc.ts:523-534`) and GX16 raw-RGBA specialization (`machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated.ts:733-767,2169-2176`). Native PMODE equivalent direct raw-RGBA selection is at `machine/cpp/machine/devices/gx/gpu_pcrtc.cpp:246-255`.

Stop condition: a spec/owner/software-consumer disagreement would have stopped the facts task; none was found. No native execution, accelerated-backend inspection/execution, manual edits, or PDFs were needed for this finite refresh.

## Complete cartridge and ordinary execution

The actual producer is `carts/pcrtc_sampling_manual/cart.lua` (75 lines), with
`results.lua` (16 lines) retaining explicit BSS. The source row is a readonly
`u16[16]` literal, 8000H through800FH. Eight repeated scalar GP0 stores upload
it at(32,16), 16×1; eight READY-gated C0 reads recover every original packed
word before a separate GPU-idle wait. GP0 coordinates encode Y at bit16;
DISPFB_HIGH encodes sourceY at bit11. No local encoder or mutable register array
is used. The program owns the ports/handler/row and assumes reset timing and no
other reader/writer/supervisor takeover; no general allocator is inferred.

Normal fresh product/BIOS/cart builds and the ordinary integration case
`unequal_magnification_source_row` pass. All source words, programmed settings,
fresh VBlank sequence and separate idle/readback-drained state are asserted.
Separate ordinary-ROM playback captures presentation frame1; this selected
frame is not a fixed hardware latency. The native8×1 PNG is copied unmodified
to `../figures/pcrtc-sampling.png`, SHA256
`20a7206207e07350713525497c9e402846cd0a498050a3d2e58c43451a2f6c0e`.
Every RGB pixel matches the table. PNG alpha FF is presentation evidence only,
not PCRTC sample alpha80. Execution, independent source/image review and
public-reader reconstruction are separated in
[the sampling review](../reviews/pcrtc-sampling-source.md).
