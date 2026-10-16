# Deferred PCRTC WebGPU constant-blend discrepancy

Status: **confirmed source discrepancy; deferred; no runtime fix made**.
The user explicitly selected matching TS/C++ software composition as the manual's
authority. This note is separate runtime follow-up, not alternate hardware
behavior or a blocker on that authorized chapter work.

## Conflicting paths

- PMODE selects constant RGB blending for enabled circuit 1 with MMOD=1 and
  ALP=1–254; AMOD chooses whether output alpha is selected from circuit 1 or
  preserved. Sources: [TS selector](../../../machine/ts/machine/devices/gx/gpu_pcrtc.ts#L479-L510),
  [C++ selector](../../../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp#L233-L265).
- Both software paths use ALP as the RGB coefficient:
  `integer_quotient(source * ALP + destination * (255 - ALP) + 127, 255)`.
  Sources: [TS equation](../../../machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated.ts#L38-L43),
  [TS constant calls](../../../machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated.ts#L238-L297),
  [C++ equation](../../../machine/cpp/render/backend/software/gx_gpu_scanout.cpp#L99-L104),
  [C++ constant calls](../../../machine/cpp/render/backend/software/gx_gpu_scanout.cpp#L253-L258).
- WebGL/GLES2 use ALP/255 with CONSTANT_ALPHA/ONE_MINUS_CONSTANT_ALPHA.
  Sources: [WebGL coefficient](../../../machine/ts/render/backend/webgl/gx_gpu.ts#L2931-L2938),
  [WebGL factors](../../../machine/ts/render/backend/webgl/gx_gpu.ts#L2995-L3004),
  [GLES2 coefficient](../../../machine/cpp/render/backend/gles2/gx_gpu.cpp#L3545-L3551),
  [GLES2 factors](../../../machine/cpp/render/backend/gles2/gx_gpu.cpp#L3617-L3626).
- WebGPU's color factors are `constant`/`one-minus-constant`, but the retained
  blend constant starts with all four channels zero and only alpha is updated
  from ALP. Its RGB channels remain zero when submitted with `setBlendConstant`.
  Sources: [initial value](../../../machine/ts/render/backend/webgpu/gx_gpu.ts#L471-L472),
  [pipeline factors](../../../machine/ts/render/backend/webgpu/gx_gpu.ts#L587-L590),
  [alpha-only update](../../../machine/ts/render/backend/webgpu/gx_gpu.ts#L2728-L2735),
  [submission](../../../machine/ts/render/backend/webgpu/gx_gpu.ts#L2745-L2752).
  WebGPU's constant factor uses each constant color component, not replicated
  constant alpha. Source: [GPUBlendFactor specification](https://www.w3.org/TR/webgpu/#enumdef-gpublendfactor).

## Source-derived witness, not GPU-tested

For source red=255, destination red=0, MMOD=1, ALP=128:

| Path | Source-derived red |
|---|---:|
| TS/C++ software | `(255*128 + 0*127 + 127) div 255 = 128` |
| Current WebGPU constant factors | `255*0 + 0*(1-0) = 0` |

This witness evaluates the source and API rules; it is **not** evidence from a
GPU execution or parity test. No backend rounding equivalence is asserted here.
A later runtime change should reproduce this case on the real WebGPU path and
compare both AMOD settings against software; this documentation task neither
implements nor validates such a fix.
