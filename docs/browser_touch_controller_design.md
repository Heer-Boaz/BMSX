# Browser touch-control ownership

This is internal host-software guidance, not the console's input specification.
The cartridge-visible interface is in [Input controller](book1/input.md).

## Owners

| Owner | Responsibility |
|---|---|
| `hosts/browser/input.ts` — `BrowserInputHub` | Native Pointer Events, contact lifetimes, route acquisition, canvas-pointer aggregation and host lifecycle cancellation |
| `onscreen_gamepad.ts` — `BrowserOnscreenGamepad` | Retained contact contributions, action-bank selection, directional/stick capture and virtual-pad publication |
| `onscreen_gamepad_layout.ts` | Numerical phone, wide-portrait, landscape and compact-overlay composition |
| `onscreen_gamepad_view.ts` | Passive SVG artwork, client-space geometry publication and changed visual state |
| `touch_geometry.ts`, `onscreen_control_shapes.ts` | Contact/shape intersection and authored shoulder outlines |
| `onscreen_keyboard.ts`, `onscreen_keyboard_layout.ts` | Browser keyboard presentation, contact leases and key geometry |
| `hosts/common/input/on_screen_keyboard.ts` | Keyboard state and source-owned key contributions shared by host presentations |
| `input_trace*.ts` | Optional observation and display; never another input producer |

Paths in the table are relative to `hosts/browser` unless stated otherwise.
Controller artwork, layout and browser contact policy do not become machine
registers or cartridge action maps.

## Contact and geometry boundaries

Pointer Events are the native contact source. The hub acquires a route at down
and retains it until up or cancellation. A contact acquired by a host control
or virtual controller does not become a canvas pointer because it moves outside
its original shape. Mouse/pen primary-button changes are normalized from actual
button edges, including edges delivered on move. Touch follows its native
contact lifetime rather than treating zero pressure as a release.

The hub owns client-coordinate normalization and contact dimensions. Gamepad
queries consume the supplied contact footprint; they do not query DOM bounds or
infer another footprint from pressure. Geometry and action-query storage are
prepared at the layout boundary, not allocated on each move. The view publishes
stable hit geometry independently of press animation.

Each controller contact owns its contribution. Independent contacts combine
without one release clearing another finger's buttons. Digital directional
input can combine with eligible neighboring shoulder contact; analog-stick
capture remains exclusive. Action-bank selection, overlap rules and directional
regions belong to the gamepad model, not event-target order or SVG painting.
The exact authored dimensions and thresholds live with those owners and their
geometry tests, not in duplicated historical layout tables.

Replacing the directional mode suppresses the held directional contact until a
fresh down. Layout changes resample retained contributions against the current
geometry. Blur, hidden-document and teardown cancellation release owned contact
contributions; cancellation is distinct from an ordinary up. Keyboard page and
presentation changes likewise retain inert leases until the corresponding
native contact ends, rather than reinterpreting a held finger as a new key.

## Layout and presentation

The retained layout owner selects an independently composed phone/wide portrait,
landscape or compact overlay. The game view consumes its measured controller
deck boundary. Artwork does not independently scale or reposition a second hit
map. Video sizing and sampling remain with the
[host presentation owner](host_presentation_sizing.md), not the input model.

Production reference points are PPSSPP's
[touch-control model](https://github.com/hrydgard/ppsspp/blob/master/UI/GamepadEmu.cpp)
and RetroArch's [overlay input owner](https://github.com/libretro/RetroArch/blob/master/input/input_overlay.c).
Their ownership separation is useful; their dimensions, artwork and platform
policies are not BMSX requirements.

## Maintenance and observation

Focused coverage lives in `tests/platform/browser_pointer_contact.test.ts`,
`browser_onscreen_gamepad_ownership.test.ts`, `browser_touch_gamepad_adversarial.test.ts`,
the gamepad layout/directional/shoulder tests and the keyboard/shape tests.
Change those tests with their owning boundary rather than retaining a dated
pass count or screenshot inventory here.

[Browser hosting](browser_hosting.md#native-input-tracing-per-game) documents the
optional per-game trace package. It observes native delivery, acquired routes
and published state without changing the ordinary input path. Browser/WPE
results are not evidence of physical iPhone ergonomics; device comfort and
actual touch-footprint delivery require a real-device check.
