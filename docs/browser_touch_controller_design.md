# Browser touch-controller ownership

Date: 2026-10-10. Baseline: `master`, `7a5914025`.

**Status: architecture decision and implementation gates, not an implemented
player change.** Establish the input owners before replacing the visible
controls. The working whole-player zoom policy is retained. This document does
not claim that the remaining iPhone A+B failure has been causally identified or
fixed. Unrelated packaging/hosting work in the checkout is outside this slice.

## Findings against the live owners

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
Only browser owners change. No TS/C++ machine behavior, BIOS, cartlib, game
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
