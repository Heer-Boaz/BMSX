# iPhone browser rendering and touch input

## Normal player

The fixes belong to the ordinary players:

- [Nemesis S](https://bmsx.boazpatel.com/nemesis_s/)
- [Pietsona 2025](https://bmsx.boazpatel.com/2025/)

`hosts/browser/backend.ts` selects WebGPU whenever the browser supplies its API
and an adapter. WebGL2 is selected only when that capability is absent, before
initializing a device. A WebGPU device/context error propagates; it does not
trigger a renderer retry. There are no user-agent exceptions, URL parameters,
page attributes, diagnostic observers, or browser-specific machine semantics
in this path. The temporary diagnosis scripts have been retired. Previously
published temporary pages are historical snapshots, not a production dependency.

## Verified causes and owner fixes

- **Rendering:** The iPhone reported `Vertex library failed creation` for all
  seven primitive/upload pipelines, while CPU/audio continued and scanout still
  displayed power-on VRAM. Their producer supplied fragment-only overrides to
  the vertex entry point and a vertex-only override to the fragment entry point.
  The producer now emits the exact constant sets used by each stage once at
  resource bootstrap. It neither scans/filters shader source nor probes browser
  identity. Raw VRAM, register words, command execution and timing are unchanged.
- **Multitouch:** A bubbling compatibility `mouseout` cleared every contact.
  `BrowserOnscreenGamepad` now retains each `pointerId` until its own end/cancel
  or lost capture, retaining reference counts for shared buttons. Only actual
  page blur/hide/hidden transitions clear all contacts. Pressure/buttons zero
  does not terminate an existing contact; hovering pointers cannot create one.
  This was reproduced with native browser touches against the old published
  player, and the corrected owner is covered by native-contact regressions.
- **Startup:** The reported delay was the game's unseen Konami intro. There is
  no established startup performance defect and no speculative startup patch.

References studied before implementation:
[WebKit unused-override regression and fix](https://github.com/WebKit/WebKit/commit/8acb03441a23a4a938d81df76ebc630d7e66013f),
[Three.js WebGPU-first capability selection](https://github.com/mrdoob/three.js/blob/dev/src/renderers/webgpu/WebGPURenderer.js),
and [RetroArch per-contact browser input](https://github.com/libretro/RetroArch/blob/master/input/drivers/rwebinput_input.c).
WebGPU allows declared overrides unused by an entry point; the WebKit bug
rejected them. Stage-specific descriptors avoid that ambiguity without a
fallback, reflection layer, hardware change, or platform exception. No optional
WebGPU features or limits are requested.

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

## Verification and publication

The stage-contract test checks all seven pipelines and the native render-pass
bootstrap with 1 MiB and 2 MiB installed VRAM. The ordinary backend regression
rejects the former diagnostic URL/page override policy. Native device failure
is tested as a propagated error with no attempt to create WebGL2. Separate
capability tests cover an absent WebGPU API and an unavailable adapter.

The iPhone user confirmed that the stage-specific WebGPU fix works. Chromium
WebGPU/WebGL2 render smoke tests do not establish full pixel parity, iPhone
performance, or a separate Home Screen lifecycle test. Native touch tests cover
combined d-pad/actions, overlapping contacts, independent release/cancellation,
compatibility mouse events, pressure-zero movement, control gaps and page loss.

On 2026-10-10 the ordinary `/nemesis_s/` and `/2025/` players were repackaged and
published. Local and public native-browser checks selected WebGPU automatically
and WebGL2 when the test removed the WebGPU capability. Both games rendered
without JavaScript/GPU errors and retained d-pad/B contacts independently.
Public bytes match the new package receipts and isolation headers are retained.
Only each ordinary engine and its receipt changed: HTML, manifests, icons,
immutable media URLs and historical temporary pages stayed byte-identical.
Evidence is in `.bmsx/hosting/ios-owner-fix-evidence/` (ignored local output).

Build the browser-player product and repackage the **same** published immutable
cart/BIOS artifacts through `scripts/products/deploy_builder.ts`. That owner
writes the matching host-byte receipt; do not overwrite an engine while leaving
its package receipt stale. Media URLs, ROM bytes, manifests and app identity do
not need to change. Deploy using the existing secret-safe Azure procedure.

```sh
node --import tsx --test tests/platform/browser_gpu.test.ts \
  tests/platform/browser_onscreen_gamepad.test.ts
npx tsc -p hosts/browser/tsconfig.json --noEmit
npx tsc -p scripts/tsconfig.json --noEmit
npm run build:product:browser-player -- --force
git diff --check
```
