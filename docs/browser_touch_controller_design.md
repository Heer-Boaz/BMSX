# Browser touch-controller ownership

Date: 2026-10-10. Baseline: `master`, `7a5914025`. Implementation: 2026-10-11.

**Status: contact owners implemented; iPhone acceptance has failed.**
The user still reports that a second face-button contact releases the first.
Desktop tests passing do not resolve that report. The initial presentation also
used unequal, undersized face targets and is superseded below.
The DOM-free contact owner replaces presentation-dependent input, while the
working whole-player zoom policy is retained. The findings below describe the
pre-change baseline, not the redesigned player. Neither local tests nor desktop
browser emulation prove the exact iPhone failure or establish the final
Safari/PWA device gate.
Unrelated packaging/hosting work in the checkout is outside this source slice.

## Findings against the pre-change live owners

- `hosts/browser/onscreen_gamepad.ts` already retains separate pointer IDs and
  per-button reference counts. Replacing these with another collection is not
  the missing architecture.
- Both controls are native HTML `<button>` elements; the action cluster is one
  button containing eight independently drawn SVG buttons. Pointer capture is
  assigned to these parent elements.
- The controller uses `document.elementFromPoint` on both acquisition and
  movement. `gamebase.css` translates a pressed action circle down by two local
  pixels. Presentation therefore changes the next input hit test.
- Native Chromium reproduction: touch A at local `(50, 120.5)` in the action
  SVG. Its circle is centered at `(50, 140)` with radius `20`. The initial hit is
  `a_knop`; after the press animation it is `action-buttons-svg`. A subsequent
  native move of `0.1` client pixel releases A without a physical up, cancel,
  capture loss or application blur. This proves a view-to-input feedback bug;
  it is not proof of the exact iPhone A+B event sequence.
- The same handler ends a contact for `pointerup`, `pointercancel` and
  `lostpointercapture`. Capture-target lifetime and contact lifetime are
  different contracts. A deliberately induced native capture transfer from
  `button-controls` to its connected `a_knop` child also releases A without
  physical up/cancel. The trace records lost capture, new capture and movement;
  both the real common snapshot and real ICU MMIO drop from `1` to `0`.
- At button centers, sequential native A then B succeeds in Chromium. There is
  no evidence that one element can capture only one pointer. WebKit's capture
  controller is keyed by pointer ID. The native baseline uses the real common
  `Input`, `InputController` and `Memory`, with a neutral supervisor test port:
  A produces snapshot/MMIO `0x0001`, then A+B produces `0x0003` in both.
- The current browser regression subscribes a test `Set` sink. Its five-contact
  case starts all contacts in one event; sequential cases cover d-pad+B and
  B+B, not the reported A-then-B case. These do not prove the real common-input
  or ICU boundary or UIKit/Safari multitouch behavior.
- `BrowserVideoOutput.layout` currently subtracts both control-group widths
  from the available landscape width. Its alternative layout mode scales
  controls against the remaining canvas margins. Neither coupling belongs to
  an overlay layout: controls must not reserve room or shrink when the game
  image grows.
- Canvas fitting deliberately rounds its scale down to a multiple of `0.5`.
  Integer and half-integer presentation scaling are retained, not treated as an
  architecture defect. Separately, available space currently comes from the
  largest of several browser dimensions rather than the visible player
  rectangle. Correcting viewport measurements must not change the scale grid.

The scratch baseline and native trace are available at
`.bmsx/hosting/ios-touch-architecture-evidence/current-svg-hit-feedback.mjs`
and the adjacent JSON result. The reproduction must become a positive
regression when the owners are implemented; the broken behavior is not a golden
contract to preserve.

## Production references and what to adopt

References were inspected before choosing the owners. They are evidence for
particular contracts, not a mandate to copy an entire framework.

| Reference | Adopt | Do not copy |
| --- | --- | --- |
| [PixiJS EventSystem](https://github.com/pixijs/pixijs/blob/f3d96db69e2ca2c1c60affc52523cef51ecae4d3/src/events/EventSystem.ts#L843-L871) | Prefer Pointer Events; begin on the owned surface and deliver ongoing movement/end through stable document/window listeners | Its compatibility branches, pooled framework events or renderer abstractions |
| [BabylonJS browser input](https://github.com/BabylonJS/Babylon.js/blob/591e3293b5388563d1ad5987dfcb32290da664c9/packages/dev/core/src/DeviceInput/webDeviceInputSystem.ts) | Distinct active pointer IDs; capture many pointers to one element; cancel by identity | User-agent-specific capture-loss workarounds |
| [Godot 4.7.2 VirtualJoystick](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/scene/gui/virtual_joystick.cpp) | One owning touch; derive the vector from positions, even outside the base; deadzone and bounded visible tip | Global action-name releases, reset-on-resize or unnecessary flick/tap features |
| [Godot touch buttons](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/scene/2d/physics/touch_screen_button.cpp) | Default button ownership lasts until that finger ends; sliding is a separate explicit policy | Its single-finger-per-button limit |
| [RetroArch overlay aggregation](https://github.com/libretro/RetroArch/blob/69a4f0ea1e8aaf442ae4858f2e7f2b31a1776576/input/input_driver.c#L3399-L3670) and [descriptor state](https://github.com/libretro/RetroArch/blob/69a4f0ea1e8aaf442ae4858f2e7f2b31a1776576/input/input_overlay.h#L206-L249) | Combine per-contact button contributions with OR; each control tracks contributing touches independently of its appearance | Poll-only edge publication, live slide hit-tests or nearest-position identity rematching imposed by the libretro pointer ABI |
| [Phaser InputManager](https://github.com/phaserjs/phaser/blob/master/src/input/InputManager.js) | Process changed contacts by stable native identity | A one-active-touch default, temporary event arrays or a transport switch based solely on this precedent |
| [RetroArch browser input](https://github.com/libretro/RetroArch/blob/69a4f0ea1e8aaf442ae4858f2e7f2b31a1776576/input/drivers/rwebinput_input.c) | Preserve native touch identity at the browser boundary | Arbitrary touch caps or lossy index/position matching where browser IDs are available |

[W3C Touch Events](https://w3c.github.io/touch-events/) now recommends Pointer
Events. [Pointer Events](https://w3c.github.io/pointerevents/) distinguishes
capture routing, contact cancellation and browser gestures. Native TouchEvent
listeners may remain gesture-policy consumers; they are not a second input
producer. [WebKit capture ownership](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/PointerCaptureController.cpp)
does not establish a one-pointer-per-element restriction.

## Selected owner graph

```text
Pointer Events              Touch Events
      |                          |
      v                          v
BrowserInputHub            player gesture policy only
  | controls      | canvas      (no input injection)
  v               v
BrowserOnscreenGamepad     existing pointer:0 state
  | numerical state
  +------------------> BrowserOnscreenGamepadView --> SVG/CSS
  |
  v
existing InputEventSink / GamepadDevice
  -> common Input -> pad snapshot -> raw ICU latch -> cart input
```

| Owner | Responsibility |
| --- | --- |
| Existing `hosts/browser/input.ts` | Sole native Pointer Events producer and routing owner; normalize native protocol edges, capture the stable player surface, manage application lifecycle and gesture policy |
| Existing `hosts/browser/onscreen_gamepad.ts` | DOM-free virtual-device model: fixed contact/control assignment, one stick owner, button contributions, aggregate raw button word and immediate existing-sink edge publication |
| New `hosts/browser/onscreen_gamepad_view.ts` | Control presentation and overlay layout; consume viewport/safe-area measurements, produce numeric hit geometry/transforms from the authored layout, retain DOM references, render model state |
| Existing `hosts/browser/video_output.ts` | Player viewport measurements and canvas fitting; pass numeric viewport/safe-area measurements to the control view instead of accessing public DOM fields on a gamepad device; controls do not influence canvas fitting |
| Existing `hosts/browser/boot.ts` | Compose these owners, initialize geometry before activating controls, and establish the ordinary common-input subscription |

No extra touch service, generic event bus, facade or separate state wrapper is
needed. The gamepad model is itself the state owner and is testable without DOM.
Native IDs retained by that model are not duplicated in a second controller
registry in the hub. Canvas contacts remain in the existing pointer-device
owner; each acquired ID belongs to exactly one input route.

The view is not the source of pressed state. The model never reads a DOM target,
CSS class, animated shape, pressure or browser focus to reconstruct a press.

## Contact and routing contract

1. A native down on the player is classified once against numeric control hit
   geometry. A hit is acquired by the virtual controller; a non-control down
   enters the canvas route only when its native target belongs to the canvas
   surface. Blank player space does not become pointer input. Missed contacts
   cannot acquire a control later merely by moving over it.
2. Each acquired contact retains its native `pointerId`, control assignment,
   current contribution and, for the stick, the last numerical stick sample.
   Movement of one ID cannot modify another ID's assignment or contribution.
3. Action assignment is retained until contact end. The ordinary layout gives
   one action bit. If authored action hit shapes overlap, acquisition ORs their
   bits deterministically; the retained mask is not re-hit-tested on movement.
4. A single first lease owns the stick for its lifetime, even if a mouse/pen
   secondary-first lease initially contributes no input. A second contact
   beginning in an occupied stick region is consumed without a contribution;
   it is not silently promoted when the first contact ends. A new down is a new
   acquisition.
5. `pointerup` or actual `pointercancel` ends that ID. Application deactivation
   or explicit controller teardown ends all owned contacts. `pointerleave`,
   compatibility mouse events, focus gain and capture-target changes do not.
6. The root down listener runs in capture phase, before canvas target handlers
   that currently stop propagation. Acquired contacts are consumed before the
   canvas can publish them as pointer input.
7. There is one fixed window capture-phase consumer for ongoing move/up/cancel,
   not handlers on each SVG/control. It routes acquired virtual contacts first,
   then canvas contacts. This replaces the existing canvas-target ongoing
   handlers; leaving them installed would produce duplicate input. Unknown IDs
   cannot produce a controller move or release. Mouse/pen hover above the canvas
   still publishes its ordinary pointer position without acquiring a contact.
   An owned event is processed once and stopped before the other route;
   unrelated events pass through.
8. Acquired IDs capture to the stable, connected `#player-surface`, not to a
   visual button or SVG child. Capture preserves delivery outside the control's
   hit region; it does not promise delivery after the OS deactivates the app.
   `lostpointercapture` is routing information, not a release. There are no
   recapture loops, retries, timeout releases or capture-loss-driven listener
   changes. Genuine cancel is never ignored.

Do not preserve the existing canvas clear-all cancel handler inside that new
route. Canvas contribution aggregation also belongs to the native source:
ending one canvas ID removes only its native button contributions, and a shared
pointer button stays down while another canvas contact contributes it. Publish
only aggregate edges to the same `pointer:0` device. Its single pointer position
is the latest routed canvas event/hover position; the machine gains no multitouch
coordinate ABI. Controller IDs never contribute to that device.

A true canvas `pointercancel` is not an ordinary up: the existing IDE pointer
capture owner commits a drop on a release edge and cancels it on lost logical
input. The host contract therefore has explicit
`cancelPointerButtons(deviceId, buttons, timestamp)` with the existing canonical
pointer-bit mask. The source removes only the canceled ID's contributions and
cancels only aggregate bits that reach zero. `PointerInput` clears those bits
and their pending edges without resetting position, other buttons or keyboard
input. Ordinary up still publishes a release edge. Its routed ICU snapshot
changes at the unchanged frame poll; no guest/MMIO representation is added.
Headless event routing consumes the same explicit cancellation operation.

The shared native HTML action-cluster button role is removed when the view is
replaced. A multi-control surface is not one HTML activation button. This is a
semantic correction, not an asserted explanation of the iPhone failure.

### Mouse and pen are native protocol, not touch-pressure heuristics

Pointer Events remain the only contact-producing API for all pointer types.
Mouse/pen primary-button changes during chording can be delivered as
`pointermove` rather than `pointerdown`/`pointerup`. The native source normalizes
those actual button edges, not just DOM event names.

A down over a control reserves that control's route even when it begins with a
secondary button. Only primary activation contributes to the virtual pad. Thus
secondary-first then primary-down works on the originally assigned control;
primary-up releases its contribution, but the non-contributing route remains
until final pointerup/cancel. Primary re-press during that same contact
reactivates the same control. It cannot leak a secondary event into the canvas
or change owner midstream. A pointer that began on the canvas remains there.

Touch activity, by contrast, follows its down/up/cancel lifecycle. Zero pressure
or a transient touch `buttons` value is not a release. Native protocol
normalization belongs in the hub, not in the gamepad model or a cart.

## Geometry, stick and layout

- The view owns the authored control geometry and emits retained numeric
  client-to-control transforms plus local hit shapes. Position, scale and SVG
  coordinate conversion are resolved once during layout, not by DOM queries
  for every input event. Button press animations never alter hit geometry.
- Acquisition uses the stable nominal button circles, not filtered pixels,
  text targets or the pressed circle's visual transform.
- In an authored overlap between an action activation region and the stick,
  action acquisition wins. Overlapping action shapes OR their contributions.
  The ordinary layout keeps these groups separate; no event-target order or
  fallback hit test decides ownership.
- The first stick is fixed-base and digital: relative position selects neutral
  or one of eight directions, including diagonals. Its deadzone is an explicit
  control-profile parameter. Analog-axis publication, floating/following bases,
  sensitivity filters, flicks and repeat generation are not part of this slice.
- Neutral includes squared distance equal to squared deadzone radius. Eight-way
  sectors use multiplication-based slope comparisons at 22.5-degree boundaries,
  with boundary equality assigned to diagonals. No `atan2`, division by a
  component, rounding or fixed-point encoder is needed for direction bits.
  The multiplication-based direction datapath is also used by
  [current RetroArch](https://github.com/libretro/RetroArch/blob/11858630dd2c64b9b3cd9d62fa4a94bb958ff962/input/input_driver.c#L5605-L5682);
  this optimization is not attributed to its older v1.22.2 release.
- The visible tip is radius-clamped. The input vector is not clipped to the hit
  area: moving beyond the base continues to select direction. Returning to the
  deadzone is neutral while the contact remains owned; ending it returns the
  tip and direction to neutral.
- A complete layout update produces geometry for both controls before input
  observes it. Keep contact identities and button assignments on toolbar,
  visual-viewport and orientation changes. Retain the stick's last normalized,
  radius-clamped tip pose and its independently retained direction bits during
  layout alone, redraw its tip against the new geometry, and evaluate the next
  native movement using the new transform. Repainting the tip never recomputes
  button contributions.
  Layout is not a manufactured movement or a device reset. This is an explicit
  BMSX sampling policy, not Godot's reset-on-resize policy. Actual native cancel
  still ends the contact.
- The view renders the retained word and stick position. It may coalesce visual
  work to one animation frame, but input edges and direction changes are never
  delayed until that frame. Keyboard/controller mappings stay in existing
  owners, not in the view.
- The view owns one explicit model-change subscription, installed during
  composition and removed on view teardown. The model notifies only numerical
  state changes; the view schedules its own dirty render. No DOM reference,
  renderer, animation-frame handle or generic event bus enters the model, and
  unchanged input does not schedule another render.

### Overlay layout and independent scaling

Controls overlay the game image; they do not occupy a reserved side panel or
reduce the canvas fitting rectangle. This is now a required presentation
contract, not an optional layout mode. [RetroArch overlays](https://docs.libretro.com/development/retroarch/input/overlay/#full-screen-vs-full-viewport-overlays)
also distinguish screen-relative control placement from placement relative to
the game viewport. BMSX chooses the player viewport for control placement.

- The browser output measures the actually visible player rectangle, including
  visual-viewport offsets and system safe-area insets. Browser toolbars and
  hardware-obscured regions are not additional usable space just because the
  screen or layout viewport reports a larger dimension. For an embedded player,
  the rectangle is bounded by that player's own surface, not the whole window.
- The canvas uses the largest fitting scale on the existing `0.5` grid:
  integer and half-integer scales, not arbitrary fractional fitting. Retain
  the canonical BMSX presentation aspect ratio, scale-selection rule and
  existing CSS dimension publication. Removing reserved control space changes
  the available rectangle, not the permitted scale steps. Remaining slack and
  letterbox space are legitimate; they are not reasons to stretch or crop the
  image or add a freely scaled mode. Controls may occupy that space or overlap
  the image.
- Canvas CSS fitting does not change the framebuffer, GPU render target,
  authored game coordinates, canonical display-aspect constants or the ordinary
  `VideoOutput.setDisplaySize` / `measureDisplay` contract. GPU scanout and
  filtering are unchanged; CSS pixel-art presentation remains the browser
  output's responsibility, separate from control layout.
- The control view consumes the same measured player viewport and safe area,
  but computes its own size and anchors from an explicit orientation profile in
  CSS-client units. Its scale never comes from canvas scale, framebuffer width,
  device-pixel ratio or a letterbox margin. Changing display resolution alone
  must not change the controls' CSS size or positions.
- Each control group scales uniformly; circles stay circular, spacing scales
  with that group and its numeric hit geometry uses exactly the same retained
  transform. Profile sizing is bounded by usable viewport space and specifies
  usable target sizes; artwork tuning must not invent a second hit-test scale.
  Safe-area insets and authored thumb margins are distinct inputs.
- Place the stick and action controls in opposing lower-side thumb zones,
  inside the safe area. Orientation profiles may rearrange the action cluster
  when needed; they do not squeeze the controls into spare canvas margins or
  shrink the game to make room. Final profile dimensions are measured during
  the presentation step, not inferred from framebuffer pixels.
- Passive control decoration may be translucent over the game. Opacity,
  filtering, stacking and pressed-tip movement never define the hit region.
  Transparent space between activation shapes passes through to the underlying
  canvas; there is no full-player overlay element that consumes all pointer
  input. Genuine control hits take the existing controller route once, never
  also the canvas route.
- Layout publishes the view transforms and numeric input geometry together.
  Safari toolbar changes, rotation and PWA layout use the same owner path;
  existing contact assignments and independently retained direction bits obey
  the preservation policy above. No movement-handler DOM measurements or
  per-frame layout polling are introduced.

Use the platform's CSS safe-area values and an ordinary edge-to-edge viewport
configuration rather than device-model offsets. [WebKit's safe-area guidance](https://webkit.org/blog/7929/designing-websites-for-iphone-x/#respecting-the-safe-areas)
explains why `viewport-fit=cover` and safe-area handling belong together. This
does not add a viewport zoom lock or change the existing whole-player gesture
policy.

## Representations and unchanged machine boundary

| Boundary | Representation |
| --- | --- |
| Browser -> hub | Native numeric pointer identity, CSS-client coordinates, native button protocol and event lifecycle |
| Hub -> virtual model | Identity, numeric position and normalized activation/end; no event object or DOM target |
| View -> model | Retained numerical transforms, nominal hit shapes and deadzone; no runtime DTO validation |
| Virtual model | Contact contribution masks, per-bit counts and one aggregate unsigned pad-button word; numerical stick pose for presentation |
| Model -> common sink | Existing device ID, button code, down/value, host timestamp and retained press ID; direct calls, no event-object queue |
| Common -> TS ICU | `InputControllerPadSnapshot.buttons: number` as a raw uint32 word; existing `axesQ16: Uint32Array` unchanged |
| Common/native -> C++ ICU | `InputControllerPadSnapshot.buttons: u32`; existing `std::array<u32, ...> axesQ16` unchanged |

The canonical bit positions remain those in
`machine/ts/machine/devices/input/contracts.ts`, mirrored by
`machine/cpp/machine/devices/input/contracts.h` and consumed through
`hosts/common/input/gamepad_buttons.ts`. Do not invent a new controller ABI or
local word/fixed-point conversion. The digital stick publishes up/down/left/right
bits, not additional left-stick axis events that could trigger a second mapping.

The existing common-input/machine path remains:
`Input.inputButton -> GamepadInput.ingestButton -> Input.pollInput ->
GamepadInput.writeInputControllerPadSnapshot ->
Input.sampleInputControllerSnapshot -> InputController.onVblankEdge ->
InputControllerRegisterFile.latchSnapshot/mirror`.
The controller redesign stays in browser owners. Common host pointer input also
gains the explicit partial-cancellation operation described above; it does not
change the gamepad sampling path. No TS/C++ machine behavior, BIOS, cartlib, game
action mapping, ICU FIFO, tap stretching or sampling-frequency change is needed.

Button references aggregate contributions. Only zero-to-nonzero and
nonzero-to-zero transitions publish edges; one aggregate press ID belongs to
that continuous press. A down/up pair between polls still reaches the host sink.
The physical ICU continues to latch held words on armed VBlank: it does not
promise to observe a complete tap that happened between samples.

## Lifecycle and performance gates

- Initialize authored geometry and the sink before activating the event route.
  `BrowserInputHub.subscribe` attaches its fixed native listeners; its returned
  unsubscribe detaches them, ends ownership while the sink is still live, and
  then disconnects the sink. This is the callback already invoked by
  `Input.dispose`. The existing null-sink/live-listener behavior is removed,
  not wrapped with a fallback. The view independently removes its model-change
  subscription and pending render on teardown.
- Window blur, `pagehide` and hidden-document transition cancel model ownership
  and clear common input once through the native source. Visible transitions,
  element focus and browser-toolbar layout are not device resets.
- Keep whole-player `touch-action: none` and the verified non-passive native
  touch default cancellation, including blank space. Those listeners remain
  gesture-only. No viewport zoom locks, global document gesture blockers,
  user-agent exceptions or diagnostic player variants.
- Retain contact storage and reuse slots. Growth may follow the concurrent
  contact high-water mark at acquisition; there is no arbitrary finger cap,
  eviction or position-based ID rematching. No temporary contact objects,
  mapped/filtered arrays, maps or event DTOs per move.
- Unchanged action-contact movement does no geometry lookup, mask/refcount
  update, edge publication or DOM work. Stick movement uses one retained
  transform and numerical direction computation. Unchanged masks do not rescan
  counts or rewrite button styles. Presentation updates only dirty elements.
- Warm movement has no `elementFromPoint`, `getBoundingClientRect`,
  `getScreenCTM`, selector query, shape construction or subscription work.
  DOM measurements and matrix preparation belong to the layout path. Reuse
  existing owner utilities; introduce no cosmetic conversion helpers.
- Measure model movement, native routing and DOM reads/writes separately.
  Report allocations after storage warmup and native event-burst rendering;
  typechecks or synthetic reducer tests are not performance evidence.

## Implementation sequence and acceptance

1. **Owner foundation before new artwork.** Implement the DOM-free gamepad,
   central native routing and view-owned stable geometry together. Do not move
   the old SVG re-hit-test or capture-loss release into a renamed class. Existing
   visuals can prove the foundation, but they must consume the new model.
2. **Contract and boundary gate.** Use the real common `Input`, not only a test
   set. At successive held states, verify A `0x0001`, A+B `0x0003` and
   Left+A+B `0x4003`. Arm the real ICU and read the matching pad MMIO word after
   VBlank. No machine change is needed to add this integration test.
3. **New control presentation.** Only after the ownership gate passes, replace
   the sector-image pad with the visible fixed-base draggable tip and finalize
   the control-group markup and independent overlay layout. No new input path
   is introduced for the new view.
4. **Package and device validation.** Build ordinary players using existing
   host/package owners and the same immutable ROM artifacts. Publish only the
   normal game URLs; no more diagnosis versions or URI parameters. Real iPhone
   Safari and PWA multitouch remain the final device gate.

Required tests cover:

- Sequential A-then-B and B-then-A; release either first, then the other. Both
  visuals and raw words must retain the remaining button. Also add X/Y and a
  stick contact sequentially, not only in one multi-touch start event.
- The native A-edge/press-animation reproduction above: holding and small
  movement must not release A. Text, filter and visual transforms are irrelevant.
- Two contacts on one button; release/cancel either first. Ending a non-owning
  contact must not affect any other contribution.
- Stick beyond its area, across the canvas and action panel, then back to
  neutral; its owner remains the same and never turns into an action contact.
- A contact starting in empty space or a busy stick region cannot later steal a
  control. Non-control canvas input and controller input do not duplicate edges.
- Canvas mouse/pen hover still publishes position without a press. Two canvas
  contacts sharing a button retain it when one releases/cancels; a controller
  release never resets the pointer device. Blank player space injects neither.
- Capture transfer to a connected child/other target while held, ordinary
  implicit capture release after up, pointerleave and compatibility mouseout;
  only actual contact/lifecycle end releases input.
- Secondary-first and primary-first mouse/pen chording; primary release and
  re-press cannot leak or retarget the retained contact. Touch pressure/buttons
  anomalies do not copy that mouse/pen policy.
- Focus gain and visible-document/layout events preserve ownership; actual
  blur/hide/pagehide and explicit teardown clear it without stuck controls.
  After source unsubscribe, native events call no detached sink; repeated
  attach/detach does not accumulate listeners.
- Fast repeated native taps publish each source edge without a frame poll;
  held state reaches ordinary ICU sampling without a guest timing workaround.
- Resize/orientation/visual-viewport updates refresh geometry without button
  retargeting; zero repeated layout reads during warm input movement.
- Canvas bounds with controls shown and hidden are identical at the same
  viewport, and match the largest fitting permitted half-step scale. Test
  immediately below, at and above integer/half-integer scale thresholds: unused
  room must not produce an arbitrary fractional scale. Also test portrait,
  landscape, browser toolbars shown/hidden, PWA, safe-area insets and embedded
  player bounds. No crop, stretched aspect ratio or stale viewport offset.
- Change framebuffer/display resolution at a fixed viewport: control positions,
  CSS sizes and hit targets stay unchanged. At every tested scale, native
  center/edge presses match the retained geometry and control overlap never
  duplicates canvas input. Verify the actual DOM bounds and screenshots, not
  only a mathematical layout result.
- Whole-player miss-taps and two-finger movement do not zoom; interactions
  outside a separately embedded player remain ordinary browser interactions.

Use pure model tests for deterministic ownership/geometry and native browser
events for delivery/routing. Chromium native multitouch and Linux WebKit smoke
tests must be labeled as such. They do not establish UIKit/Safari multitouch or
prove the exact cause of the reported iPhone sequence. No release claim is made
until the redesigned player is confirmed on the actual device.

## Implementation and validation, 2026-10-11

- `onscreen_gamepad.ts` owns numerical contact assignments and reference-counted
  button contributions. The native hub owns acquisition, delivery and source
  lifetime. `onscreen_gamepad_view.ts` owns passive SVG presentation and its
  retained CSS-client geometry; `video_output.ts` owns visible safe bounds and
  canvas fitting. Controls never reserve canvas width or derive their scale
  from the framebuffer. The obsolete nine directional image inputs are gone.
- The controller suite passes 27 checks, including 16 native Chromium cases:
  sequential A+B in either order, five contacts, independent releases,
  outside-area stick movement, capture transfer, cancellation, native mouse/pen
  chords, gestures, short taps and source teardown. These use the real common
  input snapshot and armed ICU registers, not a button-Set substitute. Native
  floating-point tip coordinates allow transport precision; raw words remain
  exact. The pure suite also checks 300 contributors to one button.
- Layout tests exercise portrait/landscape, viewport offsets, safe-area and
  embedded bounds, half-step thresholds, and odd framebuffer widths 321/257.
  Framebuffer-only changes leave control geometry and presentation untouched.
- Five partial-pointer-cancel tests and three editor pointer-edge regressions
  pass. Native graph viewport/pane tests pass on software, WebGL2 and WebGPU,
  including actual capture loss retaining pan and explicitly injected physical
  cancellation not committing an editor drop.
- Browser, Node and scripts typechecks, GPU capability/pipeline tests, existing
  media/package tests and the browser-player product build pass. WebGPU remains
  capability-selected first; this slice adds no renderer retry or override.
- Both paired ordinary game packages boot in mobile Chromium with native touch
  startup, WebGPU, running AudioWorklets and observed nonzero PCM. Trusted A+B
  plus stick, outside-area dragging, independent A release and portrait resize
  pass without zoom or console errors. Screenshots show the actual game, not a
  layout-only dummy canvas. The system/game ROM artifacts remain unchanged.
- Linux WPE WebKit 2359 also boots both ordinary packages, renders the actual
  game, delivers trusted single-touch startup/control taps and fits both
  orientations without errors or zoom. Its absent WebGPU capability naturally
  selects WebGL2. This is not native WebKit multitouch or iOS Safari/PWA proof.
- Warm native action-move tests observe no hit tests, layout reads, selectors or
  presentation writes. A separate 2,000-trusted-move profile through the hub,
  model and real common input averages 14.3 microseconds per handler on this
  desktop Chromium setup. This excludes game execution; its CDP/IPC wall time
  is not handler latency, and whole-browser heap deltas are not a proof of zero
  allocations. No mobile performance claim follows from the model benchmarks.

Local evidence is under `.bmsx/hosting/contact-owned-controls-evidence/`:
`local-player-smoke.json`, `live-player-smoke.json`, WebKit smoke evidence,
actual-game screenshots, `native-route-profile.json`, model benchmark JSON and
`graph-final/`. These are local test artifacts, not
another public diagnostics URL. Real iPhone Safari/PWA confirmation remains
the outstanding acceptance check.

The ordinary `/nemesis_s/` and `/2025/` packages were published to the existing
managed site. Public responses match the packaged HTML/engine digests and retain
COOP/COEP; the mobile Chromium native-touch/WebGPU/audio smoke passes against
the public pages as well. The library and historical `/ios/` diagnostics remain
byte-identical. No new test URL or query parameter is required. The shared
published engine SHA-256 is
`24fd46a01dbf37b44a51dfb6cc1993e2a2610b523441ce5ad4beebf12075e877`.

## Polished default presentation, 2026-10-11

This follow-up is a passive layout/artwork slice, not another input architecture
rewrite. The user chose a finished default before a layout editor. All eight
physical controls stay available. Per-game visibility, editable layouts and a
Studio-specific arrangement remain separate future work; this slice adds no
preferences, persistence, guest mappings or settings UI.

### References inspected before implementation

- [Apple's touch-control guidance](https://developer.apple.com/design/human-interface-guidelines/game-controls#Touch-controls)
  separates frequent thumb actions from upper secondary/menu controls, respects
  safe areas and calls for visible feedback beyond the covering finger. Its
  native 44-point target guidance informs our explicit 44-CSS-pixel browser
  baseline; these units are not a universal physical-size equivalence.
- [RetroArch's production RetroPad overlay](https://github.com/libretro/common-overlays/blob/42c21b99889468a8e77fd7f002229ec16e2f9fa2/gamepads/flat/retropad.cfg#L92-L140)
  separates the movement region, action diamond and auxiliary controls.
  [Neo-retropad](https://github.com/libretro/common-overlays/blob/42c21b99889468a8e77fd7f002229ec16e2f9fa2/gamepads/neo-retropad/neo-retropad-clear.cfg#L133-L177)
  also provides orientation-aware authored layouts. Its automatic combination
  zones are not adopted: one contact must not unexpectedly acquire two buttons.
- Historical official Roblox production code,
  [TouchJump](https://github.com/Roblox/Core-Scripts/blob/425d2d641bdc4b6c1104a9d5f6c53c9ea758c5cb/PlayerScripts/StarterPlayerScripts_NewStructure/RobloxPlayerScript/ControlScript/TouchJump.lua#L147-L185)
  and [DynamicThumbstick](https://github.com/Roblox/Core-Scripts/blob/425d2d641bdc4b6c1104a9d5f6c53c9ea758c5cb/PlayerScripts/StarterPlayerScripts_NewStructure/RobloxPlayerScript/ControlScript/DynamicThumbstick.lua#L234-L295),
  informs distinct phone/tablet sizing, lower thumb zones and clear active
  feedback. It is archived 2018 code, not a claim about today's Roblox controls.
  Floating-stick acquisition and framework input loops are not copied.

### Authored default and ownership

- ABXY alone occupy the right thumb diamond. Nominal A/B diameters are 60,
  X/Y diameters 52; diagonal center spacing is `52 * sqrt(2)`. Start/Select and
  LS/RS are independent 44-pixel utility surfaces at the safe upper corners,
  with a 12-pixel target gap within each pair.
- The fixed stick remains at the lower left, with a bounded visible tip and
  subtle direction marks. Its technical deadzone is not painted. Dark outer
  edges, light inner rings and translucent discs remain distinct on light or
  dark scenes. Pressed fill/ring changes do not translate or scale hit targets;
  generic guest button labels remain unchanged rather than inventing cart
  action icons.
- Scale follows the CSS safe player rectangle, clamped between `44 / 52` and
  `1.15` for ordinary supported phone/tablet sizes. Compact portrait widths
  below 360, and landscape widths below 640 or usable heights below 280,
  use 16-pixel margins/bottom clearance and a nominal 128-pixel stick. Other
  portraits use margin 24/bottom 32 and landscapes margin 32/bottom 32, both
  with a nominal 144-pixel stick. Utility targets are not shrunk with the face
  diamond. Available-space fitting still governs smaller rectangles.
- `BrowserOnscreenGamepadView` owns each surface's retained numeric CSS-client
  transform. The same transform publishes its SVG circle centers/radii to the
  existing contact model, including nonzero player offsets. Artwork never
  becomes an event target. No new input producer, per-move DOM measurement or
  settings facade is introduced.
- Contact leases, raw physical bits, source edges and ordinary frame sampling
  are unchanged. The existing Select host-modifier policy is unchanged too.
  Canvas fitting remains the largest permitted half-step with exact 4:3 aspect;
  controls reserve no canvas area and do not follow ROM resolution or DPR.

### Validation gates

The ergonomics integration test uses the actual template/CSS/view/video owner,
trusted Chromium contacts and real common input. It measures the circles, not
only sparse SVG wrapper rectangles. Supported profiles include compact
320x568/568x320 phones, 390x844/844x390 with simulated safe insets, 393x852 and
430x932 in both orientations, reduced-height landscape, wide 640x240/852x239,
the 279/280 profile boundary, a tablet and an offset embedded player.
Insets are fixture inputs, not measurements of a specific iPhone/Safari version.

The gate requires circular targets at least 44 CSS pixels, at least 8 pixels
between every contact region and at least 12 pixels of painted safe-edge
clearance. Labels must fit inside their targets. All eight centers must publish
only their own physical bit; native A+B+stick must retain independent releases
and outside-area movement. Press feedback cannot move targets. Framebuffer
widths 320/256/321/257 must leave every control transform unchanged.

A wide/short layout audit found Y overlapping Start at 640x240 before the height
profile criterion was added. The owner layout, not the contact classifier, was
corrected; those shapes now have separate acquisitions. No overlap exceptions
or input remapping were added.

Visual evidence is under `.bmsx/hosting/touch-controller-ergonomics-evidence/`
(bright/dark, resting/paired, DPR2 layout fixtures) and
`.bmsx/hosting/ergonomic-controls-evidence/` (actual ordinary game packages).
Desktop geometry, native delivery and screenshot review are evidence for these
surfaces; final two-thumb comfort and Safari/PWA multitouch still require the
actual iPhone. No perfect NTE equivalence or physical-device validation is
claimed from desktop emulation.

The final combined browser/controller, pointer-cancel, editor-edge, GPU and
existing media/package bundle passes 59 tests. Browser, Node, scripts and tests
typechecks and the browser-player product build pass. The final 15-profile
matrix measures minimum targets of 44 pixels, minimum contact gap about 9.93
pixels and minimum painted safe clearance about 13.29 pixels. Both actual
ordinary packages pass mobile Chromium WebGPU/audio/native A+B+stick checks and
Linux WPE WebKit WebGL2/audio/trusted single-touch checks. Those WebKit checks
still do not exercise native multi-contact delivery on iOS.

The polished ordinary `/nemesis_s/` and `/2025/` packages are published on the
existing managed site. Public HTML and engine bytes match their package receipts,
retain COOP/COEP, and pass the native mobile Chromium/WebGPU/audio smoke against
the live pages. The library, `/ios/` and historical diagnostics are unchanged;
there is no new test URL or query parameter. Shared published engine SHA-256:
`e27a46cd72310e8140b1b8429d26a58b2d81e7d8d2bce0bee8fd5909d006dab2`.

## Generic gamepad targets, 2026-10-11

The preceding presentation is not an accepted ergonomic baseline. A generic
gamepad cannot infer that A/B are primary game actions and X/Y are secondary.
NTE screenshots can inform translucent overlays and stick feedback, but their
game-specific action hierarchy is not the button model for this emulator.
Accessibility minimum target sizes do not establish gameplay comfort.

Before this correction, [PPSSPP's production gamepad](https://github.com/hrydgard/ppsspp/blob/dcbfa7d3ee293b370de0b14487686ffc91ab2ee9/UI/GamepadEmu.cpp#L988-L995)
was inspected: all four face controls share one round artwork, scale and center
configuration, with diamond offsets. Its [portrait layout](https://github.com/hrydgard/ppsspp/blob/dcbfa7d3ee293b370de0b14487686ffc91ab2ee9/UI/GamepadEmu.cpp#L842-L890)
lifts the action cluster instead of making those controls smaller. These are
ownership/layout precedents, not prescribed browser CSS dimensions.

- All four face targets now have the same 80-CSS-pixel nominal diameter and
  identical idle/pressed treatment. The stick acquisition diameter is 180 and
  menu/stick-click utility targets are 52. The CSS-client scale is 1 to 1.1;
  supported small phones no longer reduce these controls to a 44-pixel floor.
  These are explicit authored defaults following the size feedback, not a
  claim of measured two-thumb comfort.
- In portrait the view computes the vertical lift required to separate the
  full-size stick from every face circle by 12 pixels. It does not shrink the
  stick/diamond or reserve space by shrinking the game image.
- In landscape below 320 usable CSS pixels high, the four utilities form a
  two-row bank in the corridor between the stick and face group. This permits
  239-pixel-high browser players to retain full-size targets without overlapping
  acquisitions. Safe-area and embedded-player offsets remain owner inputs.
- Smaller embedded players (landscape narrower than 568 or shorter than 239,
  portrait shorter than 568) use an explicit compact layout: the stick and four
  faces share one reduced scale, with 44-pixel utilities. This is not the
  full-size phone profile or a claim of comfortable gameplay in a 320x240 pane.
  Compact acquisition shapes must still remain separate; layout cannot map the
  stick center to an overlapping action just to preserve large nominal sizes.
- The existing native-contact routing, frame polling, raw guest button bits,
  whole-player gesture policy, WebGPU selection and half-step 4:3 canvas fitting
  are unchanged by this presentation correction. A transport rewrite is not a
  substitute for identifying the reported iPhone release event.

The revised geometry test explicitly requires equal 80-88-pixel face targets,
180-198-pixel stick acquisition and 52-pixel utilities, alongside the existing
circle separation, painted safe-edge clearance, stable framebuffer-independent
layout and native Chromium delivery checks. It includes 568x239, both sides
of the utility-layout threshold and 320x240/319x239/430x430 small-player cases.
Compact-player gaps scale with the face group; ordinary phones retain at least
8 pixels between circles. Test names no longer claim full gameplay
usability. Current visual evidence is under
`.bmsx/hosting/gamepad-target-geometry-evidence/`.

### Validation and unresolved iPhone input

The final combined bundle passes 66 tests, including 22 geometry profiles and
native stick-center acquisition in every profile. Browser, Node, scripts and
tests typechecks and the browser-player product build pass. Both ordinary
packages pass actual mobile Chromium WebGPU/audio/A+B+stick and Linux WPE
WebKit WebGL2/audio-state/trusted single-touch checks. Screenshots of actual
games were reviewed in both orientations. Local package evidence is under
`.bmsx/hosting/equal-gamepad-controls-evidence/`.

The input audit did not identify a justified model, polling or transport fix:
native up/cancel, application deactivation and teardown are the only current
release paths for held action leases. Chromium's sequential A then B test emits
only B's new down; there is no incidental movement of A keeping it alive.
The installed WPE backend does expose native touch injection, contrary to the
earlier transport assumption, but [its implementation](https://github.com/microsoft/playwright/blob/d9f2fd3e2232ace8e317a84eda6cb86e25bcf49c/browser_patches/webkit/patches/bootstrap.diff)
assigns the same state to all supplied points and cannot represent stationary
held touches alongside a changed contact. Changed-contact injection exercises
trusted pointer leases through the real common input and armed ICU successfully;
it is not faithful UIKit secondary-pointer/touch-snapshot evidence. Native
traces are under `.bmsx/hosting/webkit-native-multitouch-investigation/`.

Actual iPhone A+B release remains unresolved. A useful device trace must include
TouchEvent identifiers/full and changed contact sets, PointerEvent identifiers,
primary flags/up/cancel, application lifecycle events and button state around
the second down. Neither a transport switch based on production precedent nor
another passing desktop suite establishes the missing cause. No such speculative
input change is included in this slice.

The ordinary `/nemesis_s/` and `/2025/` packages are published to the existing
site; public HTML/engine digests match their exact package receipts and retain
COOP/COEP. The library and historical `/ios/` diagnostics remain unchanged, not
another version of the new contact owners; a future native device trace must
run the current player owners, not silently use that older diagnostics engine.
Shared published engine SHA-256:
`02783ca1d14bcac0a8014c8acef956ecf11a73b6d5f12f7ea9a70b177a861de3`.

## Hand-relative gamepad groups and current-owner trace, 2026-10-11

The previous top-edge utilities and short-landscape center bank are superseded.
Circle separation alone was an insufficient acceptance criterion: controls also
need to belong to the hand operating them. The d-pad's contact ownership and
artwork are retained; there is no guest-input or video-fitting redesign.

### Production reference and ownership

The reference is the complete [Lemuroid PSX layout](https://github.com/Swordfish90/Lemuroid/blob/93e321d08f3dc0776bb0545da975d2cd7cd1f78f/lemuroid-touchinput/src/main/java/com/swordfish/touchinput/radial/layouts/PSX.kt),
not a game-specific NTE action hierarchy. Its left and right primary controls
own their [secondary controls](https://github.com/Swordfish90/Lemuroid/blob/93e321d08f3dc0776bb0545da975d2cd7cd1f78f/lemuroid-touchinput/src/main/java/com/swordfish/touchinput/radial/layouts/shared/Controls.kt)
and [bottom-relative group layout](https://github.com/Swordfish90/Lemuroid/blob/93e321d08f3dc0776bb0545da975d2cd7cd1f78f/lemuroid-touchinput/src/main/java/com/swordfish/touchinput/radial/layouts/BaseLayout.kt).
Its matched PadKit dependency computes one size for the [four face anchors](https://github.com/Swordfish90/PadKit/blob/708908b28e31a2bda3db275fe964daa7a697816b/lib/src/commonMain/kotlin/gg/padkit/anchors/PrimaryAnchors.kt)
and positions [secondary dials around their primary group](https://github.com/Swordfish90/PadKit/blob/708908b28e31a2bda3db275fe964daa7a697816b/lib/src/commonMain/kotlin/gg/padkit/layouts/radial/secondarydials/LayoutRadialSecondaryDialGeometry.kt).
These principles are adopted with BMSX's own SVG artwork, dimensions and bit
assignments, not copied GPL implementation code or a claim of physical comfort.

- `BrowserOnscreenGamepadView` owns the authored CSS-client layout and publishes
  the same circle geometry to acquisition. LS/Select belong to the stick group;
  RS/Start belong to the four-face group. Utilities are hand-relative, never an
  independent viewport-top row or central bank. Landscape secondary controls
  sit inward alongside their own primary, including short browser viewports.
- A/B/X/Y retain the same nominal size and diamond. LS and RS still mean the
  existing LeftStick/RightStick bits, not newly invented shoulder-button bits.
- Normal phone profiles retain the 180px stick, 80px face targets and 52px
  utilities. Portrait uses an authored stagger: the face-group center is 144px
  above the stick center, or 208px for widths below 380px. Utilities sit just
  above their own group. Embedded players below phone dimensions scale the
  whole group together; their smaller targets are not a phone-ergonomics claim.
- `BrowserVideoOutput` still owns safe-area/visual-viewport measurements and
  maximum fitting 4:3 presentation on the half-step scale grid. Controls overlay
  the independently fitted game image; no control strip reduces the canvas.
- `BrowserInputHub`, the contact model and common frame polling retain their
  input behavior. A layout change is not evidence of an iPhone transport fix.

### Native trace is observation, not another input path

The previously published `/ios/` contained an older engine and only GPU
instrumentation. It never implemented the native touch trace described in the
preceding section. The replacement package uses the exact same current engine
and paired media as its ordinary game page, with an explicitly selected early
`input-trace.js`. The panel exists before engine initialization and lies outside
`#player-surface`; it can be operated without the controller consuming its taps.

`input_trace.ts` owns native observation, `input_trace_buffer.ts` the bounded
record store, and `input_trace_view.ts` presentation/export. Native listeners are
installed before the hub's capture listeners. Diagnostic-only hub callbacks
bracket the real handlers, including exceptions, and record model/common raw
words, route and completion. Normal subscriptions select the original handlers
without per-event trace branches; the common poll path is untouched.

This follows [WebKit's dispatch bracketing](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/inspector/agents/InspectorTimelineAgent.cpp#L278-L292)
and [Perfetto's explicit bounded-buffer policy](https://perfetto.dev/docs/concepts/buffers):
2048 reused rows and contact arrays, an explicit overwrite count, freeze/resume,
and error text retained independently of the rotating event window. Formatting
is on 500ms diagnostic UI refresh or export, not native input delivery. TouchEvent full
and changed identifiers are observational only. Pointer IDs, primary flags,
capture, up/cancel, blur/pagehide/visibility resets and early errors/rejections
are visible or downloadable without URL parameters or clipboard permissions.

The iPhone A+B release remains an open device-specific diagnosis. Neither the
malformed WPE full-snapshot injection nor passing Chromium A+B justifies
changing pointer leases, ignoring cancellation or switching input transports.
The new trace removes the missing-observability/publication problem; it does not
pretend to identify an event sequence that has not yet been observed on iOS.

### Validation and publication

The focused suite passes 71 tests, including 26 geometry profiles, held-input
viewport transitions, native Chromium A+B+stick delivery, independent releases,
all reset reasons, trace freezing/export and partial routing exceptions. Browser,
node-host, scripts and tests typechecks and the release player build pass.
Reviewed screenshots cover actual games in both orientations, bright/dark
fixtures, narrow portrait and short Safari-sized landscape viewports. Geometry
checks cover own-hand offsets and separation, not merely on-screen bounds.

The ordinary `/nemesis_s/` and `/2025/` and the current-owner `/ios/` and
`/ios/piet/` are published. All four share engine SHA-256
`0076b39ae33016a844712ad8a8e7b663e29dbea5a34dec288d7178d39783fd98`.
Public bytes match package receipts; paired immutable ROMs, CORS and COOP/COEP
are verified. The library index and historical `/ios-diagnostics/` are retained;
old `/ios/` renderer subpaths redirect to the corresponding current trace page.
Actual public Chromium checks show WebGPU, running non-silent AudioWorklets,
trusted A+B+stick with independent releases, no browser errors and the visible
trace observing the same model/common owners. Local evidence is under
`.bmsx/hosting/hand-group-controls-evidence/` and
`.bmsx/hosting/hand-group-gamepad-evidence/`.

Actual local Linux WPE WebKit checks also pass on all four current packages in
both orientations: trusted changed-contact A+B injection, independent releases,
visible trace/export UI, WebGL2, running audio, 4:3, viewport scale 1, no errors
or failed requests. Diagnostic model/common words follow `0 -> 1 -> 3 -> 2 -> 0`.
A separate real-HTTP-origin WPE exception probe confirms that an unsuccessful
native route retains partial words, `completed=false` and the original error's
source/line/stack. Its earlier `about:blank`/evaluation fixture produced the
browser-sanitized `Script error.` instead; that is not proof of trace failure.
The WPE injector's changed-contact/primary semantics are not faithful UIKit
held-contact snapshots. This evidence remains explicitly Linux-only.

These results do not establish iPhone A+B correctness or physical thumb comfort.
The remaining device-specific release needs the actual iPhone event sequence;
there is deliberately no cancellation suppression or transport workaround.
