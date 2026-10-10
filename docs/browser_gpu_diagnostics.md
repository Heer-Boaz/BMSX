# Isolated browser GPU diagnosis

The diagnostic player is separate from the ordinary published games:

- [Nemesis S](https://bmsx.boazpatel.com/ios/)
- [Pietsona 2025](https://bmsx.boazpatel.com/ios/piet/)

The short game links select WebGL2 directly. The panel's links select Auto or
WebGPU through dedicated subpages, without URL parameters or redirects. Each
page supplies its fixed renderer through the canvas's `data-renderer` attribute
to the browser backend owner. Auto keeps ordinary capability selection. An explicit
WebGPU request fails visibly if its API/adapter is unavailable; it never silently
switches the requested renderer. No user-agent policy changes machine behavior.

`scripts/render/diagnostics/browser_gpu.mjs` runs before the player **only on
these pages**. It displays the actual canvas renderer, shader compilation errors,
pipeline validation errors, uncaptured GPU errors, device loss, WebGL context
loss, and JavaScript/boot errors. Native arguments and returned objects are
unchanged. Pipeline error scopes and compilation queries run at creation, not
per frame. Queue submits only increment a retained counter; the panel updates
once per second. There is no frame readback or rendering fallback. Zero reported
API errors do not establish pixel correctness.

## Build without changing ordinary pages

Use an exact snapshot of the current deployed site, including its configuration
and immutable media URLs. The output must be a new directory:

```sh
npx tsx scripts/render/diagnostics/build_browser_gpu.ts \
  --site .bmsx/hosting/ios-diagnostics-v2 \
  --out .bmsx/hosting/ios-diagnostics-v3-short
diff -r .bmsx/hosting/ios-diagnostics-v2 .bmsx/hosting/ios-diagnostics-v3-short
```

The only difference should be the added `ios` subtree. The builder
uses the ordinary browser-player build and its bundle-boundary assertion; it
does not rebuild games or their paired BIOS. Deploy the complete output using
the existing secret-safe Azure deployment procedure in `browser_hosting.md`.
After deployment, compare the ordinary HTML and engine bytes with the snapshot
and verify the diagnostic response's COOP/COEP headers.

## Findings and verification (2026-10-10)

- The old onscreen controller reset **every** contact on a bubbling compatibility
  `mouseout`. This was reproduced in the real published player with native
  touch contacts. Each pointer now remains owned until its own end/cancel/lost
  capture; only page focus/visibility loss clears all contacts. Retained contacts
  also move when touch pressure/buttons are zero, and can start in a control gap.
- The regression test fails against the old owner at the `mouseout` assertion
  and passes against the fix. Tests cover combined d-pad/actions, overlapping
  action contacts, per-pointer cancellation, hover exclusion, empty-surface
  starts, and page lifecycle cancellation.
- Native GPU tests cover explicit renderer selection and actual shader/pipeline
  errors reaching the visible panel.
- Published diagnostic Nemesis S renders its Konami intro in Chromium WebGPU
  and WebGL2. Linux WebKit WebGL2 also renders it. **None of these establishes
  iPhone/Metal correctness.** The subsequent real-iPhone screenshots show
  readable Nemesis S and Pietsona output with WebGL2, but seven failed WebGPU
  vertex pipelines followed by `encoder state is not valid`.
- The reported startup delay was the game's hidden Konami intro, not an
  established startup performance defect; startup optimization is out of scope.
- The user clarified that the noise and screen proportions do change. The
  symptom is incorrect changing output, not an established frozen canvas.

### Diagnostic version 2

After the iPhone reported only `Script error. at :0:0`, the diagnostic page's
scripts were changed to ordered modules. WebKit's
[exception dispatcher](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/ScriptExecutionContext.cpp)
explicitly leaves module-script errors unmuted. The ordinary player pages and
the diagnostic engine bytes are unchanged.

The panel now starts updating **before** native API observers are installed,
retains the setup stage, and includes exception locations/stacks. Previously, a
setup exception could prevent its deferred error display from ever starting.
An explicit WebGL2 page does not initialize GPU-only observers. A regression
test exercises an actual setup exception and verifies its visible report; the
same unsupported observer surface does not affect the explicit WebGL2 path.
This improves diagnosis, not proof of an iPhone rendering fix.

### Diagnostic version 3

The iPhone user must type test URLs manually, so the temporary player now uses
`/ios/` directly for Nemesis S with WebGL2. Tapping WebGPU opens `/ios/webgpu/`;
Auto opens `/ios/auto/`. Pietsona uses the equivalent `/ios/piet/` subpages.
All renderer links and manifest start URLs are query-free. Existing ordinary
and version-2 diagnostic pages remain byte-identical to the published snapshot.
Native tests cover page-selected renderers, their clean links, and precedence
over any URL override. This is only a diagnostic usability change.

## WebGPU stage specialization

The iPhone reports `Vertex library failed creation` for exactly the seven
primitive/transfer pipelines. Before the fix, their shared `createPipeline`
supplied all three VRAM overrides to both entry points. Vertex entry points use
only the X/Y address periods; fragment entry points use only the X period and
physical row mask. Scanout and readback already supply constants only to their fragment stage
and do not produce these errors.

WebKit's [unused-override regression and fix](https://github.com/WebKit/WebKit/commit/8acb03441a23a4a938d81df76ebc630d7e66013f)
identify this exact failure mechanism: its library preparation rejected a
module override unused by the selected entry point, although WebGPU permits it.
WebKit's [render-pipeline owner](https://github.com/WebKit/WebKit/blob/main/Source/WebGPU/WebGPU/RenderPipeline.mm)
reports the observed vertex-library error when that preparation returns an
invalid library. This is not an optional WebGPU feature: the browser owner calls
`requestDevice()` without required features or limits. The upstream fix does
not establish which Safari releases contain it.

### Representation audit before the renderer edit

| Data | TypeScript / WebGPU | C++ / GLES2 / software | Change |
| --- | --- | --- | --- |
| Logical X/Y address periods | Central `spec/gx/vram` constants, both 1024; WGSL `u32` overrides | Mirrored constants; GLES2 shader defines | None; vertex stage receives X/Y, fragment stage receives X only |
| Installed VRAM row mask | Backend-owned `gxGpuVramTextureRows - 1`; WGSL `i32` or `u32` override | Backend-owned installed rows; GLES2 defines and integer addressing | None; supplied only to fragment addressing |
| VRAM contents | Raw 16-bit words; byte pairs in RG of retained `rgba8unorm`, CPU upload `rg8unorm` | Software raw `u16`; GLES2 retained RGBA4 nibble packing | None |
| GP0 command payload | `Uint32Array` words and shared `Uint8Array` byte view | Raw `u32` command buffer | None |
| Submitted vertices and attribute planes | `Float32Array` positions; shared `Uint32Array` color/UV planes | Float positions and raw integer attributes | None |

C++ has no WebGPU backend. GLES2 supplies shared preprocessor definitions to
its shader compiler, which ignores unused definitions rather than specializing
a WebGPU entry point. Software has no shader specialization. Neither requires a
mirrored change; no hardware register, word encoding, or datapath changes.

Only the cold `bootstrapGxGpuPass -> createPipeline` calls change:
`gx_gpu_solid`, `gx_gpu_fixed_solid`, `gx_gpu_line`, `gx_gpu_textured`,
`gx_gpu_fixed_textured`, `gx_gpu_transfer`, and `gx_gpu_cpu_upload`.
Their producer now emits two stage-specific constant dictionaries once, shared
by the seven creation calls.
There is no shader-source scanning, runtime filtering, new feature probe,
user-agent policy, or renderer fallback.

The affected pipelines' hot-path consumers remain unchanged:

- `executeGxGpuVramCommands -> executeNewGxGpuCommands`;
- `uploadCpuToVram -> uploadCpuToVramPayload / renderTransferCommands`;
- `copyVramToVram -> copyVramToVramArea / renderTransferCommands`;
- `renderVramVertices -> drawVramVertices`, `renderReadVramSolidQuad`,
  `renderLineVertices`, `renderTexturedVertices`, and `renderTexturedCommand`;
- `uploadGxGpuVramSnapshot`, `serviceGxGpuReadback`, and `scanoutGxGpuVram ->
  scanoutProgressiveGxGpuVram / scanoutInterlacedGxGpuVram`.

### Verification of the stage split

The native-browser regression fails against the old owner because a vertex
descriptor contains the fragment-only row mask. It passes with the stage split
for both 1 MiB and 2 MiB installed VRAM, checking all seven vertex/fragment
constant sets and native compilation of the real render-pass library. The five
GPU/input regressions, browser/scripts typechecks and browser-player build pass.

Local and published Chromium WebGPU and WebGL2 render Nemesis S's Konami intro
and Pietsona's intro with zero reported GPU or JavaScript errors. Captured
native descriptors contain the expected constants; the WebGPU request has no
optional features.
This is render smoke evidence, not full pixel parity or iPhone/Metal proof.
The existing temporary pages retain their URLs and UI. Updating them replaces
only `/ios/engine.js`; the ordinary game HTML and engines remain byte-identical.
Real-iPhone confirmation of the corrected WebGPU path is still required.

Run the browser regressions and host typecheck:

```sh
node --import tsx --test tests/platform/browser_gpu.test.ts \
  tests/platform/browser_onscreen_gamepad.test.ts
npx tsc -p hosts/browser/tsconfig.json --noEmit
git diff --check
```

Reference implementations studied before editing:
[RetroArch contact ownership](https://github.com/libretro/RetroArch/blob/master/input/drivers/rwebinput_input.c),
[Three.js backend selection](https://github.com/mrdoob/three.js/blob/dev/src/renderers/webgpu/WebGPURenderer.js),
and [Three.js shader/pipeline diagnostics](https://github.com/mrdoob/three.js/blob/dev/src/renderers/webgpu/utils/WebGPUPipelineUtils.js).
