# Studio windows and transient surfaces

## Purpose and design boundary

This is the proposed workbench-wide window model, not a description of an
implemented window system. It covers ordinary workbench content, floating tool
windows, contained subwindows, anchored popups and modal surfaces in one Studio
canvas. Actor Lab Details is the first new window, not the limit of the model.
Existing menus, Quick Input, prompts and local overlays are concrete design
cases, not future extensions to ignore until Details works.

The design separates window structure, layout, input, focus, rendering and
feature state. It does not introduce a universal widget superclass or another
renderer. Existing retained controls remain controls. Floating is a placement
and presentation choice, not an inspector capability.

Native/browser auxiliary windows are a different host boundary: they have their
own display, document, input and close lifetime. They are not represented by a
flag on a canvas subwindow. Docking and tab-group rearrangement are separate
layout features; neither is required for floating Details, and Details cannot
be dragged back into a split. Existing font choice, capitalisation and tree
twisties are unchanged.

This is internal Studio architecture. It adds no console hardware, BIOS,
cartridge, guest-value, compiler or machine-snapshot contract. The architectural
boundary remains [Studio ownership](architecture.md#studio-ownership).

## Production references and what they establish

Source was inspected at these revisions on 2026-10-22. The BMSX decisions below
are design inferences, not claims that any reference implements this exact UI.

| Reference | Actual ownership pattern | BMSX consequence |
| --- | --- | --- |
| VS Code [workbench layout](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/browser/layout.ts#L1644-L1685) | Workbench parts are composed by a layout/grid owner. | Split geometry remains layout, not window chrome. |
| VS Code [modal editor part](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/browser/parts/editor/modalEditorPart.ts#L154-L221), [drag](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/browser/parts/editor/modalEditorPart.ts#L477-L568) and [layering](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/browser/parts/editor/media/modalEditorPart.css#L7-L17) | An in-workbench shell composes existing editor content, scoped context, resizing and a shared pointer monitor. Its modality is explicit. | Reuse content and input infrastructure; do not copy modal behaviour into a modeless Details window. |
| VS Code [auxiliary window service](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/services/auxiliaryWindow/browser/auxiliaryWindowService.ts) | A real host window has separate container and unload/resize lifetime. | Keep multi-host-window support outside the canvas window model. |
| VS Code [context view](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/base/browser/ui/contextview/contextview.ts#L322-L352) and [container selection](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/platform/contextview/browser/contextViewService.ts#L19-L61) | A transient surface receives an anchor and content delegate with an attachment lifetime. | Popup placement and dismissal belong to presentation; menu/provider meaning remains in its controller. |
| Eclipse Theia [application shell](https://github.com/eclipse-theia/theia/blob/7c024f642855549f254e022d26526f4ee0ba8ba5/packages/core/src/browser/shell/application-shell.ts#L175-L300) | The shell owns areas and activation; panels/layouts own their child geometry. | One surface owner coordinates placement without replacing every existing control. |
| Lumino [focus tracker](https://github.com/jupyterlab/lumino/blob/44aea979d5d2c77665d651383d27179a63596957/packages/widgets/src/focustracker.ts#L75-L106) | Actual focused widget and last current widget are different states. | Keyboard focus, active window and semantic command subject must not be conflated. |
| Theia [dialogs](https://github.com/eclipse-theia/theia/blob/7c024f642855549f254e022d26526f4ee0ba8ba5/packages/core/src/browser/dialogs.ts#L75-L140) and [attachment/close](https://github.com/eclipse-theia/theia/blob/7c024f642855549f254e022d26526f4ee0ba8ba5/packages/core/src/browser/dialogs.ts#L235-L323) | Dialog stack, outside-input restriction and focus return have explicit owners. | A modal is an admission boundary, not a window with a large z value. |
| Godot [embedded-window ordering](https://github.com/godotengine/godot/blob/5d1cd20f9117e4721fce626454e2323eb9462d0a/scene/main/viewport.cpp#L292-L358), [focus/removal](https://github.com/godotengine/godot/blob/5d1cd20f9117e4721fce626454e2323eb9462d0a/scene/main/viewport.cpp#L426-L550) and [Control gesture ownership](https://github.com/godotengine/godot/blob/5d1cd20f9117e4721fce626454e2323eb9462d0a/scene/main/viewport.cpp#L1939-L2059) | Central ordering drives embedded drawing; Control mouse focus retains a button mask. | Share ordered structure and whole-gesture routing. Godot's embedded-window input itself is focus-driven, not BMSX's proposed hover policy. |
| Lumino [close](https://github.com/jupyterlab/lumino/blob/44aea979d5d2c77665d651383d27179a63596957/packages/widgets/src/widget.ts#L632-L648) versus [dispose](https://github.com/jupyterlab/lumino/blob/44aea979d5d2c77665d651383d27179a63596957/packages/widgets/src/widget.ts#L45-L86), and Godot [layout persistence](https://github.com/godotengine/godot/blob/5d1cd20f9117e4721fce626454e2323eb9462d0a/editor/docks/editor_dock_manager.cpp#L431-L480) | Detachment, destruction and saved placement are separate from content state. | Hiding a retained tool does not destroy its subject; geometry storage does not serialize live runtime references. |

VS Code, Theia and Lumino rely on DOM/CSS for much of their paint ordering,
clipping and event targeting. BMSX must supply those relationships explicitly
for its canvas. Copying their service names without this structural owner
would not reproduce their architecture.

## Current owners and architectural gaps

The inspected implementation baseline is `8888cfcea`. These are current owners,
not proposed replacements for their domain responsibilities.

| Concern | Live owner | Required change |
| --- | --- | --- |
| UI composition | [`RuntimeCartEditor`](../ide/cart_editor.ts), [`RuntimeIdeState`](../ide/workbench/state.ts) | Compose one frontend surface owner; do not add UI requirements to the viewless `StudioWorkbench`. |
| Root geometry | [`common/layout.ts`](../ide/workbench/common/layout.ts), [`EditorPanes`](../ide/workbench/services/editor/editor_panes.ts) | Keep split/pane geometry; publish retained content-root surfaces. |
| Paint order | `RuntimeCartEditor.draw` | Replace independent root overlay call ordering with the shared surface order. |
| Pointer and wheel order | [`dispatch.ts`](../ide/input/pointer/dispatch.ts), [`wheel.ts`](../ide/input/pointer/wheel.ts) | Replace independent overlay priority lists with routing over that same order. |
| Focus and command origin | [`InputFocusService`](../ide/input/focus.ts) | Retain the owner; add explicit surface membership and focus scopes. Its `parent` is a focus-return relationship, not a visual tree. |
| Gesture continuation | [`PointerCaptureService`](../ide/input/pointer/capture.ts) | Generalise its single-button/control state to one routed physical gesture with scoped continuation and cancellation. |
| Hover | [`PointerHoverService`](../ide/input/pointer/hover.ts) | Revoke covered/retired hover immediately, including cached Actor preview picking. |
| Rendering | [`OverlayRenderer`](../ide/runtime/overlay_renderer.ts), [`overlay_api`](../ide/runtime/overlay_api.ts) | Reuse pooled commands, clip/transform stacks and publication. No second display list or rasterizer. |
| Physical input | [`Input`](../hosts/common/input/manager.ts), [`PointerInput`](../hosts/common/input/pointer.ts), [`InputChannel`](../hosts/common/input/channel.ts) | Separate focus-derived keyboard/controller admission from routed guest-pointer admission. |
| Platform delivery | [`BrowserInput`](../hosts/browser/input.ts), [`RemoteInput`](../hosts/common/input/remote.ts) | Keep event production/native contact capture; share the admission result at the common input owner. |
| Feature content | Existing pane/controllers, [`WorkbenchPropertyInspector`](../ide/workbench/ui/property_inspector/control.ts) | Remain content owners; stop owning unrelated root capture/focus cancellation. |
| Scoped resources | [`DisposableStore`](../ide/common/lifecycle.ts) | Reuse attachment lifetimes rather than inventing a second disposal framework. |

Today, painting, pointer dispatch, wheel dispatch and keyboard special cases
each determine overlay precedence independently. The guest input recipient is
derived from keyboard focus and gates keys, pointer and pads together. Pane
detachment and inspector opening can cancel global capture. Those behaviours
cannot be preserved behind a new floating-panel facade: they conflict with
independent windows and must change at their owners.

## Model: surfaces, windows and relationships

A **surface** is an independently ordered paint/input root. Register root
workbench parts, windows and transients, not every row, glyph or property.
Controls keep their own retained child geometry and hit tests.

A **window** is a surface with a client area, a focus scope and window chrome.
The floating-window control supplies title/actions, move/resize and close
interaction. It does not know what its content inspects or edits.

The model has these concrete roles:

| Role | Placement and input behaviour | Existing/new case |
| --- | --- | --- |
| Layout content | Bounds supplied by the existing workbench or pane layout. | Editor group, resource panel, game panel, timeline. |
| Modeless window | Independently placed within its stacking context; its full opaque rectangle excludes surfaces behind it. | Floating Actor Lab Details. |
| Contained subwindow | Independently ordered inside a window's client area; cannot paint or receive hits outside that client's effective clip. | Nested inspection/editor surface when a contribution actually needs one. |
| Anchored transient | Owner-relative anchor, explicit dismissal and input policy; may escape the owner's content clip. | Context menu, submenu, completion popup, interactive hover. |
| Modal surface | Blocks a named scope and confines focus/commands within it until resolved. | Root action prompt/Quick Input; an owner-local image preview can block only its pane. |
| Passive feedback | Paint-only, never a hit target or focus owner. | Selection outline, noninteractive tooltip, drag feedback. |

Use role-specific retained state, not an untyped record with combinations of
`floating`, `modal`, `popup` and `visible` flags. Layout content references its
existing layout-owned bounds. A window owns its requested placement and derived
frame/client rectangles. Registering a surface does not copy pane geometry
into a second independently updated cache.

Four relationships must remain distinguishable:

1. **Lifetime owner:** the editor input, window or root that admits the surface.
   Retiring it retires its owned transients and attachments.
2. **Presentation context:** where the surface is ordered and clipped. A
   contained child stays in its parent's context; a popup can be promoted out
   of a scrolling content clip, but never out of its modal admission boundary.
3. **Placement reference:** root/client coordinates or an actual retained anchor.
   A popup's anchor is not necessarily its clip or lifetime parent.
4. **Input context:** surface membership and focus scope, with an explicit
   focus-return target and command origin. These are not inferred from drawing
   position, current row text or whichever pane was last painted.

For example, a property menu is owned by Details, anchored at a property row,
painted outside the inspector's scroll clip, and invokes the Details property
context. Closing Details retires it even though it paints in an outer context.

Content is attached by its actual controller/control, using its existing
layout/draw/input responsibilities. Do not add an adapter class per pane merely
to forward those calls, or a second retained content tree inside the window
service. A window attachment and its content model have different lifetimes.

## Ordering, clipping and modality

Each presentation context retains ordered siblings and their owned surface
groups. Paint traverses back to front; hit testing traverses the same structure
front to back. Raising a window raises its group, preserving its contained
children and owned transient order. Children cannot raise above an ancestor's
admission boundary. No contribution chooses arbitrary root z numbers.

Within a context, layout content is below modeless windows. The active popup
family is above ordinary content/windows in that context. Opening it activates
its owning interaction scope first; activating an unrelated scope dismisses that popup
family. Submenus belong to the same family. Passive feedback belongs to the
context that produced it, not an unconditional highest global layer.

Outside-press policy is explicit. A context-menu family dismisses and consumes
the whole dismissing gesture; it cannot also click the game. A nonexclusive
editor transient such as completion can dismiss and let the original occurrence
continue to its own editor before any gesture route is established. That is one
dispatch, not event replay, and cannot cross into another window or guest. An
Escape dismissal is consumed. The content controller owns the result/action,
not these cross-surface routing rules.

A root modal opens a new top admission context above the blocked workbench;
lower popup families close. Nested root modals form an explicit stack and
supersede every lower owner-local modal. An owner-local modal instead names the
pane/window surface group it blocks, independently of its lifetime ownership.
Unrelated windows remain usable, and raising one can cover that group. Nested
local modals stack inside the named group; their popups cannot promote beyond
its admission boundary. A backdrop covers exactly the blocked scope, so blocked
input cannot reach a visibly uncovered lower branch accidentally.

Modality is enforced for pointer, wheel, keyboard, gamepad, text, clipboard and
command dispatch within the blocked scope. It does not merely intercept a
pointer rectangle. A root modal requires explicit admission for root-global
commands. An owner-local modal excludes commands targeting its blocked underlying
content, not commands admitted by the modal or an unrelated active window;
workbench window navigation remains available.
Existing pause/execution policy remains in the transport/execution owners, not
in this modal stack.

The routed result is a surface and then a control within that surface. If no
control handles a hit on an opaque window, the event still belongs to the
window. It never falls through to another window or the game. Transparent
paint-only feedback is deliberately excluded from targeting. Interactive hover
content is an anchored transient, not secretly hit-testable feedback.

## Geometry and layout

All window arrangement uses the Studio overlay's logical coordinates, obtained
through the existing display-to-viewport projection. Do not hardcode the tiny
font's usual viewport dimensions or use the guest scanout size for UI geometry.
Rectangles retain the existing half-open `RectBounds` convention and central
rectangle utilities.

The root layout publishes a work area excluding its permanently reserved
chrome. Root-owned modeless windows arrange within that area, not within the
currently selected editor pane. Contained windows instead use their owning
client area. Root transients/modals have their own declared root extent.

The placement owner retains requested placement. Layout derives outer bounds,
client bounds and effective clip from it, the parent context and chrome metrics.
These derived rectangles are retained and updated only when their inputs change.
Painting, control layout, window hit tests and preview occlusion consume them
directly; they do not reconstruct geometry independently.

Contained children use client-relative placement; parent movement rearranges
their root-coordinate bounds. Promoted popups use the owner's actual arranged
anchor but the enclosing presentation context's clip. Moving, resizing or
scrolling the owner repositions its popup; losing the anchor detaches it.

Move and resize use the shared pointer continuation owner. Window chrome retains
the initiating offsets/edge and updates requested placement, not content state.
Layout keeps the title/close affordance reachable inside the available area.
If the area is smaller than the requested minimum, arrangement uses the
available area and content clips/scrolls; it does not invent another window or
discard the requested size. This is ordinary constrained layout, not recovery
from invalid internal geometry.

## One pointer gesture owner

The existing producer exposes **one logical canvas pointer**, with button masks,
occurrence edges and explicit cancellation. Browser contact IDs are platform
state and are not window identities. Do not add a per-native-pointer Studio API
without separately changing that producer contract.

Central routing follows this sequence:

1. Project the producer occurrence once into Studio coordinates. Resolve any
   pending structural layout changes before targeting it.
2. Apply an explicit cancellation or newly blocking admission boundary first.
3. If a physical gesture already has a route, continue it there, before ordinary
   hit testing. Otherwise find the top admitted hit surface/control.
4. A first down establishes the gesture's surface/guest-viewport route. Further
   button presses, movement and releases stay with that route until all physical
   buttons are up. Hover alone never establishes keyboard focus.
5. A control may capture continuation inside that route. Its initiating release
   can finish its own action while another button is still held; the surface
   route remains until the last button is up. Capture cannot jump to a control
   in an unrelated surface during the gesture.
6. Detach a completed continuation before invoking an action that can close,
   navigate or replace its owner. Do not retain the reusable event object.

This is one canonical gesture record in `PointerCaptureService`, with a routed
surface and optional control continuation, not a new window capture service
beside the existing one. Physical edges still come only from the host producer;
the route's admitted-button membership is not another press-history detector.

Cancellation is not a successful release/drop. Closing/hiding the owning
surface, blocking it, native input loss, or explicit cancellation ends its
continuation. The central route drains any remaining physical hold without
retargeting it or synthesising a new press. A held dismissal cannot become a
press in the newly exposed game/editor. A fresh gesture starts only after the
old physical buttons are up.

Leaving a window or the canvas does not itself cancel an otherwise valid
captured gesture. Native capture may continue delivering outside coordinates;
layout still constrains the window. Actual platform capture loss/cancellation
ends the gesture. This replaces the current cancellation on `insideViewport`
becoming false; it does not create another native capture implementation.

With no gesture, hover and picking visit only the top eligible content. Showing
or raising an occluding surface immediately revokes lower hover, even when the
pointer has not moved. Actor picking must stop doing runtime-tree work while
covered, not merely hide its outline.

Wheel occurrences target the top admitted surface under the pointer,
independently of keyboard focus and button capture. Unhandled scrolling can
propagate within that surface's content hierarchy, never through an opaque
window into the preview. A hit on a preview still has to pass the explicit guest
eligibility rule below; hit testing alone does not grant guest wheel input.

## Guest pointer admission is a host input boundary

Keyboard focus, pointer routing and native cursor lock are separate. A focused
preview receives ordinary gameplay keys/controller input; this neither captures
all pointer input nor prevents an upper window from receiving a new gesture.
A primary focus click in the visible preview still belongs to the game too.
Without game input-focus, preview hover/wheel and nonprimary presses remain
Studio inspection input; they do not publish guest pointer data. With game
input-focus, new pointer occurrences must also hit its visible preview. An
existing guest gesture is the exception: it continues over an ordinary tool
window even if keyboard focus subsequently changes. A gesture started in a
tool never leaks into the game.

The current single `guestInputRecipient` cannot express this. The common `Input`
owner must retain separate focus-derived keyboard/controller and routed-pointer
recipients. Each recipient also has a host-owned admitted pointer contribution:
button levels, last admitted position and the current host update's wheel.
The raw snapshot writer receives the actual recipient, gates keys/pads by focus,
and reads that recipient's contribution; `InputChannel` uses the same writer.
It does not zero a retained pointer position merely because there is no current
pointer route, or substitute another channel's position. Vibration continues
to follow the focused controller recipient. No full-snapshot/event cache or
UI-side copy of guest registers is introduced.

The central event route supplies admitted pointer occurrences/cancellation to
the common host input owner. `PointerInput` remains the physical-source history
and encoding owner; destination contributions belong to host input recipient
lifetimes. The existing host-update boundary publishes wheel contributions and
then clears pending wheel work; snapshot reads do not consume it. Selecting only
the sampling recipient is not enough: a held UI press must not appear in a
guest snapshot when focus changes.
Admission is established at the physical occurrence and persists for that
gesture, including cancellation draining. Raw device sampling must not bypass
it. Movement over an occluding window without a guest gesture does not update
the guest pointer; the last admitted position remains until another admitted
movement.

Coordinate projection is explicit, not left to a feature callsite. The
embedded-preview binding supplies its actual displayed-image rectangle and
presented raster dimensions. Central pointer projection maps an admitted
Studio point into that image, using the existing
[`mapDisplayPointToViewport`](../machine/ts/render/video_output.ts) abstraction;
the attachment producer applies the published image-extent constraint and
`PointerInput` performs existing word encoding. Captured motion outside the
preview uses the same binding and constraint. A layout change uses the current
displayed placement; a held presentation keeps its displayed raster dimensions.
The window service and inspectors neither scale guest coordinates nor encode
fixed-point values.

This implements the existing [pointer coordinate contract](book1/input.md#sec-input-pointer-words),
not a new coordinate ABI. The current full-canvas browser attachment mapping
and remote coordinate passthrough do not provide a shared embedded-preview
projection. Resolve that producer discrepancy in the common admission path for
active Studio rather than preserving it in separate adapters. Browser and remote
input must publish the same admitted image coordinates; standalone player
display mapping remains its host presentation owner's responsibility.

Shift+F1 explicitly releases game keyboard focus and cancels its routed pointer
gesture, draining held buttons before a new Studio gesture. Root modals revoke
blocked guest admission. Studio focus/modality/retirement operations do not
rewrite physical producer history. Native input loss is different: the host
producer cancels its physical state and ends the routed gesture without
pretending a UI action completed. These admission operations neither execute
the guest nor rewrite machine-history checkpoints; subsequent ordinary device
samples reflect the changed admission.

| Representation | Owner and consumer |
| --- | --- |
| Native contacts/capture | Browser/native adapter; normalized before Studio. |
| Logical occurrence coordinates, UI button masks, edges, cancellation | Existing `PointerInputEvent` / `WheelInputEvent`; synchronous routing, no retained event DTO. |
| Studio logical rectangles and clips | Surface/layout owner; render and hit testing consume the same retained values. |
| Gesture route, continuation and blocked physical remainder | Central `PointerCaptureService`; references to actual attached surfaces/controls or a guest viewport. |
| Guest eligibility and image projection | Focus/route plus the preview presentation binding, through central pointer projection; no feature-local mapping. |
| Guest pointer contribution and device data | Common host `Input` / recipient lifetime; `PointerInput` owns encoding. UI mask-to-device conversion belongs here, not in windows or carts. |
| Raw guest words/Q16 coordinates | Existing `InputControllerSnapshot` producer and machine consumer, unchanged in TypeScript and C++. |

The native C++ player has no Studio surface counterpart. This proposal changes
host admission, not the TS/C++ machine ABI. An implementation that instead
changes snapshot or device semantics must stop for a separate mirrored
representation/callsite review.

## Focus, activation and commands

`InputFocusService` remains the sole keyboard/text/clipboard focus owner.
Window activation is derived from the focused surface family, not another copy
of the focused control. The window scope retains its last focused eligible
content control for explicit reactivation. Merely hovering, painting or raising
a window programmatically does not steal keyboard focus.

A new pointer press activates its admitted interaction scope; a focusable hit
receives focus. In a window, a press on nonfocusable chrome/empty content enters
its last eligible control or scope target, rather than leaving game focus active
behind it. Layout content uses its existing content focus scope, without an
artificial window wrapper. Chrome belongs to its window's focus/command scope.
Header movement does not select another subject.
Menus and Quick Input preserve the invoking command origin separately from
their own temporary keyboard focus. Closing one restores focus only if its
family still owns focus; it cannot steal focus back from a different window.

Tab traverses the active window's eligible controls, including its chrome
actions. A root modal contains traversal globally; an owner-local modal contains
it only while focus is within its blocked group. Unrelated active windows keep
their own traversal. Window discovery/activation is also exposed
through the existing command-palette/Quick Input owner; a floating window cannot
be pointer-only. Region/window traversal uses stable layout/attachment order,
not the paint order that changes whenever a window is raised. No new global
gameplay shortcut is assigned by this design. Escape first cancels an active UI
continuation,
then dismisses the top applicable transient/modal according to its role; it
does not close arbitrary modeless windows or steal a gameplay Escape key.

Command origin remains explicit through `InputFocusTarget.commandContext`.
There is no global "current inspector". Tree commands name tree selection;
Details commands name its subject/property; transport commands name its
existing physical runtime transport. Opening a menu or palette does not merge
those targets. Keyboard shortcuts remain scoped: ordinary gameplay keys are
not newly reserved for windows. Layer changes do not imply pause, seek, rebuild
or guest execution.

## Attachment, close and disposal

The surface service owns actual attachment and subtree retirement. A feature
may retain an open window/model while its editor input is inactive; it has no
paint/input attachment until that input is shown again. Do not maintain a
second independent visible boolean that disagrees with attachment.

Showing attaches the surface and its declared relationships. Hiding detaches
its presentation and transients but retains feature state. A close request
first asks the actual content/document owner for admission, including any
existing pending-edit/review workflow. An admitted close clears the feature's
open intent and detaches it. Disposal destroys the owned window/control model
and subscriptions. None is an alias for a global focus/capture reset.

Retirement first removes the affected group from event admission, then ends
its hover/continuations and owned transients, then releases presentation
resources. Focus returns through the admitted return relationship only if the
retiring family owned it. An unrelated editor closing cannot terminate another
window's drag. Use the existing disposable lifetime for attachment resources;
do not snapshot/restore state around close or issue delayed retry operations.

## Module responsibilities

These are target owner boundaries, not instructions to create empty modules
or an API/DI framework before their concrete responsibilities move.

| Location | Responsibility |
| --- | --- |
| `ide/workbench/services/windows/model.ts` | Retained surface roles, ownership/presentation relationships, order and requested/arranged geometry. |
| `ide/workbench/services/windows/service.ts` | Attach/detach, raise, admission/modal contexts and scoped retirement, composed by `RuntimeCartEditor`. No feature semantics or second input state. |
| `ide/workbench/ui/window/control.ts` | Generic floating-window chrome, client layout, move/resize continuation and close affordance. `WorkbenchFloatingPanel` can be this concrete control; it is not the entire window system. |
| `ide/workbench/render/window.ts` | Window chrome drawing through existing overlay commands and theme/font owners. |
| Existing `ide/input/*` | Surface-driven targeting, canonical gesture state, focus scopes, hover and command origin. Replace independent overlay priority/scope branches. |
| Existing host input owners | Device-class recipient selection and admitted pointer production shared by browser/remote input. No window classes in host adapters. |
| Contribution modules | Content models, subject/selection, actions, provider results, invalidation and optional content persistence. |

The surface owner provides actual structure to input/render consumers; it is
not a facade forwarding every application operation. The viewless workbench,
tool APIs, source models, runtime inspection and execution services do not
depend on window visibility or existence.

## Retained work and persistence

Attach/detach/raise mutate retained sibling order; there is no per-frame sort,
surface registration, whole-tree rebuild or control-wrapper allocation. Hit
testing walks the existing ordered surface groups, then the chosen content's
own hit test. Layout revisions update only affected geometry/anchors. A
structure change re-evaluates stationary hover without a synthetic motion event.
Hidden content does no layout/property formatting/picking solely for a window.
Runtime identity retirement still follows its existing owner while hidden.

Reuse `RectBounds`, text measurement, clip/transform pools, overlay publication,
focus/capture/hover services and `DisposableStore`. Do not add generic event
bubbling machinery or a spatial index without evidence that this bounded
surface traversal needs it. Domain caches remain domain-owned.

Window placement and feature state are separate workspace records. The layout
owner may persist a stable feature layout key, requested bounds and open intent
through the existing workspace-session storage; the feature serializes only its
supported content state. Transient popup/modal instances, focus targets, native
contacts, hover, button holds and drag state are never restored. Runtime-bound
subjects cannot be resurrected across a new heap/session by saving an actor ID
or display name. This does not introduce a second source or machine savestate.

## Actor Lab Details as the first application

Each Actor Lab input owns one Details instance with its own subject, lock and
property-view state. The model is not a pane singleton; no multiple-window
registry or creation command is needed to make that ownership independent.
Additional instances remain a separate product change.

Unlocked Details follows explicit hierarchy selection. Lock retains the current
typed `ActorTarget`, not an `ActorNode`, guest table borrow or label. Unlocking
immediately follows current selection. A lock fixes identity, not time or
values: playback and settled history positions continue updating that subject.
The existing runtime membership/invalidation owner determines temporary
unavailability and binding retirement. A missing target remains unavailable;
it never resolves to a same-named replacement. Details actions use its subject;
tree actions continue using tree selection.

The property inspector retains property projection, scrolling, selection and
property actions. It no longer supplies the window's title, close lifetime,
global focus return or root capture cancellation. Chrome supplies title/close;
Actor Details contributes the lock action and explicit subject context. Avoid
duplicating inspector/window titlebars and close actions. Any inspector-specific
presentation separation must be made at the shared inspector owner, not by
painting over its existing shell.

Details is a modeless owned floating surface, not a contained child of the
preview. A new hit cannot reach the preview through Details; an existing
captured guest gesture continues according to the central gesture rule.
Its attachment follows the active Actor Lab input; changing editors hides that
attachment while retaining the Details instance. The UI action labelled Hide
requests the admitted close path, clearing open intent but retaining subject,
lock and property-view state. It is not the presentation-only detach used for
editor deactivation. Destroying the Actor Lab input disposes its Details
instance. Its existing transport and inspection services remain usable without
a window.

Remove the Details split, its preview-height subtraction, pane-local paint/input
branches and split-specific focus links when adopting the window. Do not retain
both layout paths as compatibility modes. The preview picker consumes the
central unobscured route; no window-rectangle scans inside Actor Lab. The
completed-frame geometry/identity requirements in
[Actor picking](studio_actor_tools.md#selection-geometry-extension-boundary)
remain unchanged.

## Implementation order and acceptance

The following is a dependency order, not an implementation claim:

1. Establish surface structure/order, modal admission and scoped attachment
   using existing root content, menus, Quick Input, prompts and a local image
   overlay. Replace their independent root priority and focus-return branches;
   do not leave a parallel legacy overlay stack behind the new service.
2. Change central pointer/focus/hover routing and common host pointer admission.
   Remove global pane/inspector cancellation and the all-devices-from-focus
   assumption. Prove cross-surface gestures before introducing floating Details.
3. Add reusable window chrome and contained-child arrangement. Exercise multiple
   overlapping window instances and owned transients at this general layer;
   shipping one Details command is not permission for singleton infrastructure.
4. Separate the Actor Details subject/lock model and attach its existing property
   content to the window. Delete the embedded Details split path. This is the
   first new product application, not a workaround for unfinished input owners.
5. Admit other inspectors or docking/native-window capabilities as their own
   concrete changes. They must reuse this model rather than introduce another
   input/lifetime stack.

Required independent contracts include:

- Front/back paint and hit agreement, empty window areas, nested clipping,
  promoted popups, stationary-hover revocation and wheel exclusion.
- Primary/secondary/auxiliary combinations, initiating release before another
  button, complete clicks between host polls, cancellation draining, and
  synchronous navigation/close during an action.
- Game-to-window and window-to-game drags, focus click delivery, Shift+F1,
  outside-canvas native capture, input loss and browser/remote producer parity.
- Owner-local versus root modality, nested dialogs/submenus, menu dismissal
  consuming its whole gesture, and nonexclusive same-editor dismissal routing
  once without replay or delivery into another window/game.
- Keyboard-only window/region activation, local Tab traversal, text/clipboard,
  command-origin preservation, and unrelated-window teardown isolation.
- Lock/unlock across tree selection and settled history, unavailable/retired
  subjects, hidden identity lifetime and absence of retained guest borrows.
- Move/resize/viewport constraints, restored placement without restored runtime
  handles, retained controls and no repeated work when unchanged/hidden.

Existing evidence owners include `tests/lua/{pointer_capture,pointer_hover,
editor_focus,editor_panes,workbench_property_inspector,workbench_context_menu,
editor_pointer_edges}.test.ts`, `tests/platform/{browser_pointer_contact,
browser_pointer_input,pointer_cancel}.test.ts` and the real-runtime Studio
game-input/capture/hover/focus/Actor workflows under
`tests/conformance/runtime_replay/`. Extend those owners and add focused surface
and window tests; do not create a substitute UI or emulator to prove the model.

Measure the actual named hot paths before/after: native pointer/wheel delivery;
coordinate projection; central pointer/wheel/key dispatch; capture/hover;
`RuntimeCartEditor.update/draw`; pane layout; overlay clip/transform submission;
`Input.writePhysicalSnapshot` and `PointerInput` snapshot writing; Actor preview
hover refresh. Report layout/hit visits, content refresh/measurement counts,
allocations and frame timings separately. Unit tests/typechecks establish
contracts, not performance or visible usability. Live Studio validation must
use the native session/context workflow required by the repository instructions;
this design review has not executed that workflow or claimed UI evidence.
