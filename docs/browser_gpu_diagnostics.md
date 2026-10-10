# Isolated browser GPU diagnosis

The diagnostic player is separate from the ordinary published games:

- [Nemesis S](https://bmsx.boazpatel.com/ios-diagnostics/nemesis_s/?renderer=auto)
- [Pietsona 2025](https://bmsx.boazpatel.com/ios-diagnostics/2025/?renderer=auto)

The panel selects `auto`, `webgpu`, or `webgl2` through the browser host's
`renderer` URL parameter. Auto keeps ordinary capability selection. An explicit
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
  --site .bmsx/hosting/azure-nemesis-name \
  --out .bmsx/hosting/ios-diagnostics-v2
diff -r .bmsx/hosting/azure-nemesis-name .bmsx/hosting/ios-diagnostics-v2
```

The only difference should be the added `ios-diagnostics` subtree. The builder
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
  iPhone/Metal correctness.** The iPhone's persistent power-on VRAM picture is
  not yet reproduced locally, and no speculative machine/GPU patch was applied.
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
