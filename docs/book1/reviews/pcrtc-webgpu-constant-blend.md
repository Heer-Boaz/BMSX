# PCRTC WebGPU constant-blend correction

Status: **fixed; reproduced before the fix and GPU-tested after it**.
The user explicitly selected matching TS/C++ software composition as the manual's
authority. This runtime follow-up restores WebGPU to that same contract; it does
not introduce alternate hardware behavior or change the manual's authority.

## Original discrepancy and comparison paths

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
- WebGPU's color factors are `constant`/`one-minus-constant`. Before the fix,
  the retained blend constant started with all four channels zero and only alpha
  was updated from ALP. Its RGB channels therefore remained zero when submitted
  with `setBlendConstant`.
  Sources: [initial value](../../../machine/ts/render/backend/webgpu/gx_gpu.ts#L471-L472),
  [pipeline factors](../../../machine/ts/render/backend/webgpu/gx_gpu.ts#L587-L590),
  [corrected retained state](../../../machine/ts/render/backend/webgpu/gx_gpu.ts#L2728-L2740),
  [submission](../../../machine/ts/render/backend/webgpu/gx_gpu.ts#L2749-L2756).
  WebGPU's constant factor uses each constant color component, not replicated
  constant alpha. Source: [GPUBlendFactor specification](https://www.w3.org/TR/webgpu/#enumdef-gpublendfactor).

## Fix

`prepareGxGpuScanoutState` now retains `ALP/255` in all four blend-constant
components inside its existing PCRTC-revision cache. No per-pixel work, shader,
pipeline factors, AMOD write mask, software path or C++ path changes are needed.

## GPU reproduction and regression

The regression programs raw PCRTC words through `Machine` MMIO, uploads raw
`PSMCT32` VRAM through the GPU snapshot owner, executes the real built-in WebGPU
GX pass and reads its rendered texture through the backend's GPU readback path.
The same device output is rendered by the production software implementation.
There is no fake GPU API or replacement blend shader.

For source RGBA `(255, 0, 0, 64)`, destination RGBA `(0, 0, 0, 200)`,
MMOD=1 and ALP=128, Chromium WebGPU produced these measured pixels:

| AMOD | Software RGBA | WebGPU before | WebGPU after |
|---|---|---|---|
| 0 | `(128, 0, 0, 64)` | `(0, 0, 0, 64)` | `(128, 0, 0, 64)` |
| 1 | `(128, 0, 0, 200)` | `(0, 0, 0, 200)` | `(128, 0, 0, 200)` |

The test fails before the fix and passes after it. Its 48 rendered cases cover
both AMOD settings, progressive output and both interlaced source modes, ALP
values 0, 1, 64, 128, 192, 254 and 255, and a repeated ALP=128 after ALP=255.
Every 2x2 RGBA pixel is compared exactly, including an asymmetric RGB sample and
different circuit alphas. No WebGPU validation or uncaptured errors occurred.

Reproduce with:

```sh
node --import tsx --test --test-name-pattern='WebGPU PCRTC constant' tests/platform/browser_gpu.test.ts
```

Sources: [browser regression](../../../tests/platform/browser_gpu.test.ts),
[raw-device/software/GPU fixture](../../../tests/helpers/pcrtc_scanout_fixture.ts).
The tested adapter is Chromium's SwiftShader Vulkan adapter (`vendor=google`,
`architecture=swiftshader`). This exercises the actual WebGPU render and
readback path, but is not a physical-GPU test or a claim of universal backend
rounding equivalence.
