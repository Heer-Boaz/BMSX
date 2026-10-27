# Studio windows and transient surfaces

## Purpose and design boundary

This specifies the workbench-wide window model and its ownership boundaries.
It covers ordinary workbench content, floating tool
windows, contained subwindows, anchored popups and modal surfaces in one Studio
canvas. Actor Lab Details is the first new window, not the limit of the model.
Existing menus, Quick Input, prompts and local overlays are concrete design
cases, not future extensions to ignore until Details works.

The [main workspace and document-editor architecture](studio_workspace_design.md)
defines the persistent project area, editor parts/groups and shared document
ownership. Window chrome supplies presentation; it does not create independent
editor or workspace ownership.

The design separates window structure, layout, input, focus, rendering and
feature state. It does not introduce a universal widget superclass or another
renderer. Existing retained controls remain controls. Floating is a placement
and presentation choice, not an inspector capability.

Native/browser auxiliary windows are a different host boundary: they have their
own display, document, input and close lifetime. They are not represented by a
flag on a canvas subwindow. Docking and tab-group rearrangement are separate
layout features; neither is required for floating Details, and Details cannot
be dragged back into a split. Supported font choices and their capitalisation
policy remain intact; shared icon geometry and single-glyph truncation are UI
presentation primitives rather than text-font substitutes.

This is internal Studio architecture. It adds no console hardware, BIOS,
cartridge, guest-value, compiler or machine-snapshot contract. The architectural
boundary remains [Studio ownership](architecture.md#studio-ownership).

## Production references and what they establish

These production implementations establish the ownership patterns below. BMSX's
decisions are design inferences, not claims that a reference implements this
exact UI. Source links pin the relevant revisions.

| Reference | Actual ownership pattern | BMSX consequence |
| --- | --- | --- |
| VS Code [workbench layout](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/browser/layout.ts#L1644-L1685) | Workbench parts are composed by a layout/grid owner. | Split geometry remains layout, not window chrome. |
| VS Code [modal editor part](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/browser/parts/editor/modalEditorPart.ts#L154-L221), [drag](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/browser/parts/editor/modalEditorPart.ts#L477-L568) and [layering](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/browser/parts/editor/media/modalEditorPart.css#L7-L17) | An in-workbench shell composes existing editor content, scoped context, resizing and a shared pointer monitor. Its modality is explicit. | Reuse content and input infrastructure; do not copy modal behaviour into a modeless Details window. |
| VS Code [auxiliary window service](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/services/auxiliaryWindow/browser/auxiliaryWindowService.ts) | A real host window has separate container and unload/resize lifetime. | Keep multi-host-window support outside the canvas window model. |
| Epic [tab roles](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Slate/ETabRole) and [window arguments](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/SlateCore/SWindow/FArguments) | Major/document/panel roles and window minimize/maximize capabilities are distinct declarations. | Give document and owned utility windows their actual capabilities; a minus button must not mean titlebar-only collapse. |
| KWin [quick-tile restore and outline](https://github.com/KDE/kwin/blob/v6.5.0/src/window.cpp#L3284-L3360), [pointer reanchoring](https://github.com/KDE/kwin/blob/v6.5.0/src/window.cpp#L3566-L3603) and [snap/maximize integration](https://github.com/KDE/kwin/blob/v6.5.0/autotests/integration/quick_tiling_test.cpp#L966-L1055) | Normal restore geometry, tiling mode and prospective feedback have separate lifetimes; restoring after maximize need not reinstate a former tile. | Preserve normal intent, derive live half geometry and stage drag placement before committing a drop. |
| Qt [MDI title double-click](https://github.com/qt/qtbase/blob/v6.8.3/src/widgets/widgets/qmdisubwindow.cpp#L2977-L3013) | The subwindow owns title gestures and maximize/restore, excluding its action controls. | Recognize title clicks/drag in shared window chrome rather than each document pane. |
| VS Code [context view](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/base/browser/ui/contextview/contextview.ts#L322-L352) and [container selection](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/platform/contextview/browser/contextViewService.ts#L19-L61) | A transient surface receives an anchor and content delegate with an attachment lifetime. | Popup placement and dismissal belong to presentation; menu/provider meaning remains in its controller. |
| VS Code [action presentation](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/base/browser/ui/actionbar/actionViewItems.ts) and [Variables view](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/contrib/debug/browser/variablesView.ts) | Icon actions retain semantic labels/hints; a value tree requests explicit children rather than using its rendered preview as data. | Compact chrome and structured inspection keep their meaning independently of font size, clipped text or expanded presentation. |
| Eclipse Theia [application shell](https://github.com/eclipse-theia/theia/blob/7c024f642855549f254e022d26526f4ee0ba8ba5/packages/core/src/browser/shell/application-shell.ts#L175-L300) | The shell owns areas and activation; panels/layouts own their child geometry. | One surface owner coordinates placement without replacing every existing control. |
| Lumino [focus tracker](https://github.com/jupyterlab/lumino/blob/44aea979d5d2c77665d651383d27179a63596957/packages/widgets/src/focustracker.ts#L75-L106) | Actual focused widget and last current widget are different states. | Keyboard focus, active window and semantic command subject must not be conflated. |
| Theia [dialogs](https://github.com/eclipse-theia/theia/blob/7c024f642855549f254e022d26526f4ee0ba8ba5/packages/core/src/browser/dialogs.ts#L75-L140) and [attachment/close](https://github.com/eclipse-theia/theia/blob/7c024f642855549f254e022d26526f4ee0ba8ba5/packages/core/src/browser/dialogs.ts#L235-L323) | Dialog stack, outside-input restriction and focus return have explicit owners. | A modal is an admission boundary, not a window with a large z value. |
| Godot [embedded-window ordering](https://github.com/godotengine/godot/blob/5d1cd20f9117e4721fce626454e2323eb9462d0a/scene/main/viewport.cpp#L292-L358), [focus/removal](https://github.com/godotengine/godot/blob/5d1cd20f9117e4721fce626454e2323eb9462d0a/scene/main/viewport.cpp#L426-L550) and [Control gesture ownership](https://github.com/godotengine/godot/blob/5d1cd20f9117e4721fce626454e2323eb9462d0a/scene/main/viewport.cpp#L1939-L2059) | Central ordering drives embedded drawing; Control mouse focus retains a button mask. | Share ordered structure and whole-gesture routing. Godot's embedded-window input itself is focus-driven, not BMSX's proposed hover policy. |
| Lumino [close](https://github.com/jupyterlab/lumino/blob/44aea979d5d2c77665d651383d27179a63596957/packages/widgets/src/widget.ts#L632-L648) versus [dispose](https://github.com/jupyterlab/lumino/blob/44aea979d5d2c77665d651383d27179a63596957/packages/widgets/src/widget.ts#L45-L86), and Godot [layout persistence](https://github.com/godotengine/godot/blob/5d1cd20f9117e4721fce626454e2323eb9462d0a/editor/docks/editor_dock_manager.cpp#L431-L480) | Detachment, destruction and saved placement are separate from content state. | Hiding a retained tool does not destroy its subject; geometry storage does not serialize live runtime references. |

VS Code, Theia and Lumino rely on DOM/CSS for much of their paint ordering,
clipping and event targeting. BMSX must supply those relationships explicitly
for its canvas. Copying their service names without this structural owner
would not reproduce their architecture.

## Integration owners

Composition and admission belong to the existing owners below; content,
rendering and physical input retain their own domain responsibilities.

| Concern | Live owner | Responsibility |
| --- | --- | --- |
| UI composition | [`RuntimeCartEditor`](../ide/cart_editor.ts), [`RuntimeIdeState`](../ide/workbench/state.ts) | Compose the frontend surface owner, separately from the viewless `StudioWorkbench`. |
| Root geometry | [`common/layout.ts`](../ide/workbench/common/layout.ts), [`EditorPanes`](../ide/workbench/services/editor/editor_panes.ts) | Publish layout-owned split/pane bounds and retained content-root surfaces. |
| Paint order | `RuntimeCartEditor.draw` | Traverse the retained surface order. |
| Pointer and wheel order | [`dispatch.ts`](../ide/input/pointer/dispatch.ts), [`wheel.ts`](../ide/input/pointer/wheel.ts) | Route through the same ordered structure. |
| Focus and command origin | [`InputFocusService`](../ide/input/focus.ts) | Own explicit surface membership and focus scopes. Its `parent` is a focus-return relationship, not a visual tree. |
| Gesture continuation | [`PointerCaptureService`](../ide/input/pointer/capture.ts) | Own the routed physical gesture, scoped continuation and cancellation. |
| Hover | [`PointerHoverService`](../ide/input/pointer/hover.ts) | Revoke covered/retired hover immediately, including cached Actor preview picking. |
| Rendering | [`OverlayRenderer`](../ide/runtime/overlay_renderer.ts), [`overlay_api`](../ide/runtime/overlay_api.ts) | Reuse pooled commands, clip/transform stacks and publication. No second display list or rasterizer. |
| Physical input | [`Input`](../hosts/common/input/manager.ts), [`PointerInput`](../hosts/common/input/pointer.ts), [`InputChannel`](../hosts/common/input/channel.ts) | Own separate focus-derived keyboard/controller and routed guest-pointer contributions. |
| Platform delivery | [`BrowserInput`](../hosts/browser/input.ts), [`RemoteInput`](../hosts/common/input/remote.ts) | Keep event production/native contact capture; share the admission result at the common input owner. |
| Feature content | Existing pane/controllers, [`WorkbenchPropertyInspector`](../ide/workbench/ui/property_inspector/control.ts) | Own content data, actions, layout and control input; retirement stays scoped to the owning surface. |
| Scoped resources | [`DisposableStore`](../ide/common/lifecycle.ts) | Reuse attachment lifetimes rather than inventing a second disposal framework. |

The surface structure composes paint, pointer, wheel and focus admission;
feature owners retain their actual content-specific operations. A floating
control consumes those relationships instead of building another input stack.

## Model: surfaces, windows and relationships

A **surface** is an independently ordered paint/input root. Register root
workbench parts, windows and transients, not every row, glyph or property.
Controls keep their own retained child geometry and hit tests.

A **window family** is an ordered presentation context with a client area and
focus scope. The permanent main frontend supplies fixed workbench chrome; the
floating-window control supplies title/actions, move/resize and close for
independently placed windows. It does not know what its content inspects or edits.

The model distinguishes the following roles and their planned implementation
scope. A planned slice is a dependency, not an implementation-status claim.

| Role | Placement and input behaviour | Product consumer | Planned scope |
| --- | --- | --- | --- |
| Layout content | Bounds supplied by the existing workbench or pane layout. | Editor group, resource panel, game panel, timeline. | A: publish the existing layout roots. |
| Modeless window | The main family has layout-owned placement; floating windows own requested placement. Their opaque rectangles exclude surfaces behind them in the same ordered context. | Main/document editors; Actor Lab Details; GPU operation and GTE command Details. | C: shared floating chrome; main/document composition uses the same ordered family boundary. |
| Contained subwindow | Independently ordered inside a window's client area, bounded by that client's effective clip. | No concrete product consumer yet. | Designed, provisional and not validated by a product consumer; no nested arrangement implementation in A–C. |
| Anchored transient | Owner-relative anchor, explicit dismissal and input policy; may escape the owner's content clip. | Context menu, submenu, completion popup, interactive hover. | A: migrate existing transients. |
| Modal surface | Blocks a named scope and confines focus/commands within it until resolved. | Root action prompt/Quick Input; pane-local image lightbox. | A: root and existing owner-local blocking. |
| Passive feedback | Paint-only; excluded from hit targeting and focus. | Selection outline, noninteractive tooltip, drag feedback. | A: retain its producing context. |

The contained-subwindow contract preserves an architectural distinction, not a
framework extension point to implement speculatively. Its first real consumer
must validate placement, clipping and retirement together and may refine this
provisional contract. Overlapping window test instances in C test ordinary
windows, not a promise of multiple Details windows or nested product content.

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

One ordered surface structure makes the visible frontmost content the admitted
input target, with modality enforcing an explicit scope boundary.

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

The blocked scope and presentation parent are explicit, independent references.
The permanent main presentation family and document windows share the window
band. A main-part chooser escapes its content clip within that main family,
without becoming a workspace modal. Foreground invocation raises its family;
another window can subsequently rise above it. Raising the opaque main family
covers document windows without changing their visibility or lifetime state.
Owned modeless inspectors likewise present in their nearest real window or
modal family, so raising an editor does not strand its inspectors behind it.
Promotion never transfers command authority or a popup's lifetime.
Applicable modal admission is derived from the published surface order, not a
second independently mutable stack. Visibility and arrangement are published
after the outgoing control's blur publishes its draft, before the incoming
control acquires focus. Dismissal publishes its admission change before returning
focus to a previously blocked control.

Modality is enforced for pointer, wheel, keyboard, gamepad, text, clipboard and
command dispatch within the blocked scope. It does not merely intercept a
pointer rectangle. A root modal requires explicit admission for root-global
commands. An owner-local modal excludes commands targeting its blocked underlying
content, not commands admitted by the modal or an unrelated active window;
workbench window navigation remains available.
Existing pause/execution policy remains in the transport/execution owners, not
in this modal stack.

The image-preview lightbox is an owner-local modal covering its pane's client
area. Its backdrop admits the dismissing primary gesture and consumes that
whole gesture, including the later release; Escape or Enter dismisses it from
its own focus target. Pointer, wheel, selection, text, clipboard and commands
for the underlying pane remain blocked until dismissal. An unrelated pane or
window stays usable. Dismissal restores focus only while the lightbox family
still owns it. A confirmation action is not a requirement for modality.

Conversation and assistant panes consume that same lightbox boundary. It
excludes wheel and underlying-pane commands in both consumers; neither
contribution implements a separate visibility guard. The same image-overlay
interaction remains consistent regardless of the pane that opened it.

The routed result is a surface and then a control within that surface. If no
control handles a hit on an opaque window, the event still belongs to the
window. It never falls through to another window or the game. Transparent
paint-only feedback is deliberately excluded from targeting. Interactive hover
content is an anchored transient, not secretly hit-testable feedback.

## Geometry and layout

The layout owner publishes one set of arranged rectangles for window painting,
targeting and preview exclusion.

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

Window chrome measures a compact caption against the space left by its actual
icon actions. The full qualified subject is separate hint/status content, not
a path forced into every titlebar. Changing the active font remeasures text,
header height and content constraints while preserving requested placement.
Both fonts supply the same single ellipsis character; truncation is owned by
the common measured-text path. Pin, close, minimize/restore and disclosure icons
use shared pixel geometry, not punctuation strings in the chosen text font.

Window surfaces have shared semantic theme colours for content, active/inactive
header text and background, border and shadow. Menus, windows and passive hints
reuse the same shadow primitive. A shadow contributes paint only: it neither
extends opaque hit bounds nor excludes additional preview input.

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

### Maximized window presentation

Maximize selects the published work area as the expanded arranged bounds while
retaining normal requested placement unchanged. Restore arranges those same
normal bounds against the current work area and font; it never restores a
captured rectangle from another layout generation. The shared title actions and
window commands expose the mode with maximize/restore icons. Resize and the
resize grip are unavailable while maximized; a real title drag presents the
retained normal size under the pointer. Switching mode cancels only an
active chrome gesture, not an unrelated client or sibling capture.

The normal request remains unchanged during the drag; only a free release
commits its new placement. Cancellation discards the pending arrangement.

Double-clicking the draggable title region toggles maximize/restore. Action
buttons and resize edges do not participate. A completed title click must stay
within the shared drag threshold; an interrupted or real drag cannot count as
one half of a double-click.

### Minimized document windows

Minimize removes the entire document window family from paint and input while
retaining its groups, inputs, views, working copies and local decision/picker
sessions. It is not titlebar-only presentation: window roll-up is not supported.
Owned utility inspectors expose their close/pin/maximize capabilities, not a
minus action without an independent restore destination. The permanent main
workspace cannot be minimized or closed through document-window commands.

The concrete document-part owner admits minimization and chooses the next
non-minimized part in activation order, with the main part as the final
candidate. Minimizing a background part leaves unrelated focus and drafts
alone. The surface/input owners revoke only the hidden family's hover, native
input and held pointer route; remaining physical buttons drain normally. A
sibling's capture survives. Visibility changes do not retire attachment context
or suspend the retained client. Explicit later reveal wins over an earlier
minimize, including a reveal issued by a focus-change callback.

The existing global status row exposes an icon and count for minimized document
parts; it opens a chooser of those actual owners. The Window menu and complete
window picker also restore them. No permanent taskbar row reduces client space.
Explicit restore arranges and raises the family, then focuses its retained
local dialog or client. Passive restacking never restores a minimized part.
A close decision for a minimized dirty document reveals its local prompt only
when the close owner actually requires a decision; clean close need not reveal.

Session placement records normal requested bounds, the normal/snapped/maximized
placement and independently minimized visibility. It does not persist arranged pixels, focus authorization or a
live capture. Owned utility close retains input-owned placement/subject intent;
accepted document close disposes the actual document part through close
admission. Neither operation is window collapse.

### Snapped placement contract

Snapping is a placement operation on an existing floating window, distinct from
docking, splitting an editor group or creating another document view. The
placement model distinguishes normal, maximized, left-half and right-half
placement; minimized visibility is independent. Normal requested bounds remain
the restore intent. A snapped rectangle is derived from the current owning work
area, not stored over that intent or copied from a rendered frame. Maximizing,
restoring, resizing the work area and minimizing/restoring therefore cannot lose
the user's normal placement.

The shared title-drag owner proposes left/right half placement at the side
edges and maximize at the top edge, with passive prospective-bounds feedback.
Only a real drag past the common activation threshold proposes a destination.
The held gesture owns an uncommitted normal arrangement: its visible frame can
move or resize without publishing source/session placement or autosaving each
motion. Release resolves the final pointer occurrence before committing either
that free placement or the offered snap. Cancellation, Escape, modal takeover
or owner retirement discards the pending arrangement and proposal; no previous
state is written back. Leaving a maximized/snapped title region for a real drag
presents normal size with the pointer anchored at the same horizontal title
fraction and title-local vertical offset. A free resize leaves snapped
placement and commits its new normal request. Snapping or maximizing instead
retains the previous normal request. Maximize/restore returns to normal, not a
remembered preceding half; minimized visibility does not change placement. Minimum
content requirements govern which halves are offered: an unavailable half is
not silently enlarged over its neighbor or accepted without room for chrome.

Keyboard, menu and pointer actions invoke the same placement transition on the
nearest actual window. Main workspace commands are not redirected to an
arbitrary document. Retired origins remain invalid. Commands and shortcuts are
discoverable through the existing Window menu, command palette and centralized
keybinding resolution. OS window shortcuts remain with the OS; ordinary guest
input bypasses Studio bindings. VS Code's [editor-group split](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/browser/parts/editor/editorActions.ts#L74-L85),
[focus](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/browser/parts/editor/editorActions.ts#L324-L334) and
[move](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/browser/parts/editor/editorActions.ts#L899-L911) shortcuts
are not evidence for intercepting OS Snap shortcuts or mutating groups when a
canvas window is snapped.

The frontend's central keybinding controller owns a two-stroke chord and its
actual invocation target. Ctrl/Cmd+K followed by an unmodified Left or Right
snaps that window; Up toggles maximize/restore and Down restores normal
placement. The common binding metadata supplies command-palette/menu labels.
The prefix hint occupies the existing status context slot: waiting for a second
key must not add a status row, change the work area or invalidate half admission.
Escape, focus/admission loss, owner retirement, frontend suspension or a
five-second host-clock deadline ends the pending chord. A completed chord is
resolved against the retained live target and current command admission.
Unrelated modified arrow navigation and guest input retain their own owners.

Persist the placement mode and normal request at the document part's storage
boundary; never persist a pending gesture or proposal. Workspace layout,
editor-view mementos and source-recovery manifests use the current unversioned
shape, without schema gates or migrations. Acceptance exercises
work-area shrink/growth, snap/maximize/restore/minimize round trips, pointer
cancellation/coalesced release, stale command origins and unchanged
source/group/runtime ownership.

## One pointer gesture owner

One retained physical gesture keeps its surface route from first press through
the final release, even across other windows.

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
ends the gesture. `insideViewport` becoming false is not cancellation;
platform adapters continue to own native capture.

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

Focus admits gameplay keys and pads; the independently resolved pointer route
admits pointer occurrences into the appropriate guest image.

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

The common `Input` owner retains separate focus-derived keyboard/controller and
routed-pointer recipients. Each recipient has a host-owned admitted pointer contribution:
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

UI targeting and guest image projection are separate steps. The browser's
canvas coordinates are the correct input for Studio's existing logical-viewport
projection and surface hit testing. They are not already guest-raster
coordinates. Remote occurrences enter that same UI projection before routing.

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
not a new coordinate ABI. Browser physical-canvas attachment mapping and remote
coordinate passthrough are separate producer paths; that difference alone does
not establish a numerical parity failure. Slice D owns the shared
embedded-preview projection and browser/remote parity tests, separately from B's
gesture/admission work. Its investigation follows both UI targeting and guest
publication, including image letterboxing, presentation dimensions and wheel
units. UI wheel units and guest attachment wheel units remain explicit at their
producer boundary rather than being confused at a window callsite.

For Studio's routed guest publication, B needs D's presented-image projection at
integration: the physical-canvas attachment coordinates cannot be used as the
embedded image contribution. D is therefore a dependency of that part of B,
not an automatic final cleanup step. UI-only surface routing can be developed
independently. Standalone-player mapping remains the host presentation owner's
responsibility; it is not migrated onto Studio admission.

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

The native C++ player has no Studio surface counterpart. This model changes
host admission, not the TS/C++ machine ABI. An implementation that instead
changes snapshot or device semantics must stop for a separate mirrored
representation/callsite review.

## Focus, activation and commands

Each surface family has explicit keyboard focus, activation and command origin,
so window navigation never changes a feature's semantic target accidentally.

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

Keybindings resolve against the admitted control's input context, not its surface
role. A control's own command wins, including when disabled; otherwise its focus
scope reaches the actual application command runner through explicit command
ancestry. Ordinary modeless tools inherit their owner's command scope. Menu,
Quick Input and prompt controls use isolated scopes, so their temporary keyboard
focus cannot dispatch underlying document commands. Their invoking
`commandContext` remains an action origin, not keyboard inheritance. A control
can explicitly own an admitted command: the local image lightbox owns editor
close/cycle commands and dismisses before invoking them. Surface ordering and
modal admission govern which control receives input, not command classification.

Tab traverses the active window's eligible controls, including its chrome
actions. A root modal contains traversal globally; an owner-local modal contains
it only while focus is within its blocked group. Unrelated active windows keep
their own traversal. Window discovery/activation is also exposed
through the existing command-palette/Quick Input owner; a floating window cannot
be pointer-only. Region/window traversal uses stable layout/attachment order,
not the paint order that changes whenever a window is raised. No new global
gameplay shortcut is assigned by this design. Escape is handled once: first by
an active local UI interaction, then the top applicable transient/modal. If
neither consumes it, a modeless tool can return focus through its declared
owner relationship while remaining open. Details returns to the Actor Lab tree,
without changing its subject, lock or scroll. An Escape that
dismissed a property menu does not also move focus to the tree. The rule applies
inside Studio scopes; a gameplay Escape remains gameplay input.

Concrete region activation commands name their owner. **Actor Lab: Inspect
Instance** activates the retained Details instance, including a hidden or
unavailable locked subject. **View: Show Runtime Timeline** reveals and enters the shared
transport controls. Its local Tab order returns to the owning content and
skips an unavailable range; it does not splice or restore a pane's internal
focus ring. Neither command introduces a global gameplay key reservation.

Command origin remains explicit through `InputFocusTarget.commandContext`.
There is no global "current inspector". Tree commands name tree selection;
Details commands name its subject/property; transport commands name its
existing physical runtime transport. Opening a menu or palette does not merge
those targets. Keyboard shortcuts remain scoped: ordinary gameplay keys are
not newly reserved for windows. Layer changes do not imply pause, seek, rebuild
or guest execution.

## Attachment, close and disposal

Attachment gives a surface its paint/input lifetime; content state can outlive
that attachment without retaining active input resources.

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

Concrete responsibilities move to these target owners as each slice supplies
their actual producer and consumer.

| Location | Responsibility |
| --- | --- |
| `ide/workbench/services/windows/model.ts` | Retained surface roles, ownership/presentation relationships, order and requested/arranged geometry. |
| `ide/workbench/services/windows/service.ts` | Attach/detach, raise, admission/modal contexts and scoped retirement, composed by `RuntimeCartEditor`. No feature semantics or second input state. |
| `ide/workbench/ui/window/control.ts` | Generic floating-window chrome, client layout, move/resize continuation and close affordance. `WorkbenchFloatingPanel` can be this concrete control; it is not the entire window system. |
| `ide/workbench/render/window.ts` | Window chrome drawing through existing overlay commands and theme/font owners. |
| `ide/workbench/ui/icon.ts`, `render/icon.ts`, `render/surface.ts` | Shared icon geometry and floating-surface shadow drawing; no text-glyph or hit-bound substitution. |
| `ide/workbench/ui/tooltip.ts` | Retained, wrapped hover/keyboard feedback with explicit lifetime ownership, work-area placement and modal admission; no input targeting. |
| Existing `ide/input/*` | Surface-driven targeting, canonical gesture state, focus scopes, hover and command origin. Replace independent overlay priority/scope branches. |
| Existing host input owners | Device-class recipient selection and admitted pointer production shared by browser/remote input. No window classes in host adapters. |
| Contribution modules | Content models, subject/selection, actions, provider results, invalidation and optional content persistence. |

The surface owner provides actual structure to input/render consumers; it is
not a facade forwarding every application operation. The viewless workbench,
tool APIs, source models, runtime inspection and execution services do not
depend on window visibility or existence.

## Retained work and persistence

Retained structure and geometry make unchanged frames cheap; workspace placement
persists separately from runtime-bound content and input state.

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

Actor Lab gets one reusable, lockable modeless Details window, using the
[feature UX contract](studio_actor_tools.md#floating-details-ux).

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
property actions, including explicit child disclosure and scalar-text
expansion. Clipped hovered or keyboard-selected names and values use shared
passive feedback attached to the actual client surface, without further guest
reads. The runtime property owner supplies compact typed summaries and child
requests; raw stored fields remain an explicit inspection scope rather than an
eager object dump.
The inspector no longer supplies the window's title, close lifetime,
global focus return or root capture cancellation. Chrome supplies title/close;
Actor Details contributes the lock action and explicit subject context. Avoid
duplicating inspector/window titlebars and close actions. Any inspector-specific
presentation separation must be made at the shared inspector owner, not by
painting over its existing shell.

Details is a modeless owned floating surface, not a contained child of the
preview. A new hit cannot reach the preview through Details; an existing
captured guest gesture continues according to the central gesture rule.
Its attachment follows the active Actor Lab input; changing editors hides that
attachment while retaining the Details instance. The close X icon, labelled
**Close Window** in its hint, requests the admitted close path, clearing open
intent but retaining subject, lock and property-view state. It is not the
presentation-only detach used for
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

## GPU operation Details

GPU Details is another modeless client of the same window container, not a
replacement for the operation list or diagram. It follows the GPU input's owned
selected snapshot; the existing Follow/selection policy owns freezing that
observation. It introduces neither an independent Details pin nor another
history borrow, decoder or raw-word copy. The caption identifies the actual
operation sequence and type; expired observations remain explicitly historical.
Clear leaves an open, explicitly empty Details window rather than resolving a
replacement ring slot.

The input retains placement and open intent and property-view bookmarks.
The pane owns surfaces and controls. Initial placement is lower-left above the
shared runtime transport; user movement is permitted throughout the root work
area. Default geometry preserves useful diagram context in both fonts, while
minimum-sized clients scroll their full field/annotation document. Escape
returns focus to the operation list without closing Details. Editor detachment
retains open intent; Close clears it without discarding placement.

A changed observation or raw-word page replaces the inspector document in its
existing attachment, ending old keyboard/controller activations, scroll drags
and feedback before the new fields receive input. Unchanged documents retain
their measured rows; hidden clients perform no field formatting.
The shared inspector bookmark retains selection, top row and its intra-row offset,
not an absolute scroll pixel. Restoration resolves that row at the actual reflow
boundary, preserving a visible selection across changed font or annotation metrics
without pulling deliberately offscreen selections into view or restarting long
property text. It finishes before another input occurrence. Editable source
inspectors have different subject and mutation lifetimes and require their own
integrations.

## GTE command Details

GTE Details composes the same modeless window and property document beside the
command list and diagram. Its subject is the input's selected owned observation,
including the normal register banks or the distinct PLUS acceptance/publication
banks. Follow owns changing that subject; Details adds neither another pin nor
another capture. Placement, close, focus return, empty selection and
expired-observation behavior follow the GPU window contract.

The Source icon and actionable source row refer only to the instruction observed
in the selected capture's installed image. PLUS publication refers to its observed
acceptance source, never a later synchronization instruction. An unobserved or
unmapped source remains explicitly unavailable. The captured source's own resource
domain and written path determine navigation, not the issuing CPU domain or the
latest installed image.

Source admission compares captured source bytes with the current resource-owned
working copy, including unsaved edits, or its workspace source when no text model
is retained. Changed or unavailable authored source disables navigation; Undo can
restore the original byte correspondence. Model identity/version and registry
publication drive this comparison, not paint or repeated full-text reads. Source
status refreshes only the provenance row, preserving the captured register rows
and reading position.

A new observation retires old property activations and pending Source-icon
attempts. Provenance changes also retire Source attempts without interrupting
Close or Collapse during Follow. Popup actions remain bound to the observation
and source generation that opened the popup. Source navigation detaches the
pane's surfaces, not the input's window intent, selected snapshot or observation
lease.

## Anchored property editing

Animation, AEM, Program and Behavior Lens properties share one source-bound value
editor. Its active draft is an anchored transient with its own surface and focus
scope, not property-cell overpaint. The field keeps at least 24 active-font cells
where the root work area permits, independently of a narrow owning pane; its
measured label identifies the edited property. The existing line viewport scrolls
longer expressions without replacing authored text. Generic surface ordering, clipping,
shadow, pointer routing and retirement apply to this editor as to other popups.

This transient does not block unrelated UI. Ordinary focus departure accepts a
valid draft once; Escape or source/attachment retirement cancels it. Source
syntax, canonical text models, generation invalidation and document history
remain with the contribution. Publication completes the owning projection before
another source command captures its target. The popup retains local draft Undo;
ending it returns focus to the containing property view, not a detached field.
Its focused text control owns physical Undo/Redo; Tab follows its declared focus
links. Normal Save and command-palette actions remain available because this is
a non-modal editor, and source-consuming commands first accept a valid draft.
Behavior Lens retains its written-field selection bookmarks with that source
history; the shared editor owns no effect syntax, imported-model lookup or
selection reconstruction. Multiline authored code opens in the source editor.

## Implementation order and acceptance

The slices below separate reviewable owner changes and define their own
acceptance. They describe planned scope, not a progress register. A establishes
the surface structure; B and the required portion of D establish guest routing;
C uses those contracts for the first product window. D remains independently
reviewable even where its integration is a prerequisite for B.

### A — Surface order and existing overlay admission

Publish the existing layout roots, menus, Quick Input, prompts and image
lightboxes through one retained surface order. Rendering, pointer and wheel
routing consume that order, including root/local modal admission and scoped
attachment/focus return. Existing content controls keep their own geometry.
Remove the independent overlay precedence lists as their consumers migrate.

Acceptance:

- Paint and hit testing agree front-to-back, including passive feedback and
  opaque empty areas. Raising or removing a surface revokes covered stationary
  hover without synthesising motion or scanning obscured actor data.
- Existing root prompts/Quick Input and menu families preserve command origin,
  nested submenu order, same-editor nonexclusive dismissal and consumed
  outside-press behaviour. A dismissal dispatches once, without replay.
- The same image lightbox blocks wheel, underlying selection and commands in
  both conversation and assistant panes. Its local scope leaves unrelated
  content usable; root modal admission blocks all lower surface families.
- Detaching one owner retires its transients, hover and focus-return links without
  cancelling an unrelated owner's interaction. Existing input controls remain
  attached directly rather than through forwarding-only wrappers.

### B — Whole-gesture routing and guest pointer admission

Use one routed gesture record in `PointerCaptureService`. Separate
focus-derived keyboard/controller admission from admitted pointer contributions
at the common host input owner. Replace global pane/inspector capture
cancellation with scoped retirement. Integrate D's image projection where a
routed preview contribution is published; retain raw physical history at its
producer.

Acceptance:

- Primary/secondary/auxiliary combinations keep their first surface route until
  all buttons are up, including when the initiating control finishes early and
  when a complete click occurs between host polls.
- Game-to-tool and tool-to-game drags never change recipients mid-gesture.
  Leaving the canvas preserves native-captured continuation; actual native loss,
  Shift+F1, owner retirement and newly blocking modality cancel and drain held
  buttons without a successful drop or newly exposed press.
- A fresh focus click reaches the visible preview and gameplay once. Hover does
  not focus. Covered preview hover/wheel cannot publish guest input or trigger
  actor picking; keyboard/pad focus can remain with the game independently.
- Recipient snapshot reads preserve the last admitted position, current button
  contribution and host-update wheel consistently across `Input`/`InputChannel`.
  Raw sampling cannot leak a held UI press into a newly focused guest.
- Standalone player input retains its own presentation path. Existing machine
  snapshot words and TS/C++ device semantics remain unchanged.

### C — Window chrome and floating Actor Lab Details

Add shared move/resize/close chrome and attach the existing property
content to one independently subject-bound, lockable Details instance. Remove
the embedded Details split and its preview-height subtraction, paint/input
branches and split focus links. A single product instance exercises general
window ownership without a multi-Details creation command.

Acceptance:

- Two overlapping test windows prove independent subjects, raising, empty-area
  exclusion, owned popup ordering, focus return and teardown isolation. They
  are fixtures for a general container, not new product commands.
- Move/resize observes shared root work-area bounds and font metrics. Close
  retires inspector input/paint and owned continuations/transients while the
  input retains its subject and placement for explicit reopening. Small
  viewports constrain arrangement without discarding requested placement.
- Chrome uses pin/unpin, maximize/restore and close icons with semantic
  hover/keyboard hints, a compact subject caption, a wrapped full-identity hint
  and shared themed depth cues. The title budget excludes the measured action
  targets. Truncation consumes one supported ellipsis glyph in either font.
- Keyboard-only activation, local Tab traversal, titlebar actions,
  text/clipboard and command origin work without new global gameplay shortcuts.
  Escape consumes one local interaction first, otherwise returns Details focus
  to the tree while leaving Details open and locked as applicable.
- Lock/unlock preserves the typed subject across tree navigation, playback and
  settled history; missing/retired subjects stay unavailable rather than
  resolving by name. Hidden Details retains identity retirement but
  performs no hidden property layout, formatting or preview picking.
- Semantic caption/full identity, checked subject-pin action, unavailable
  presentation and active/inactive chrome follow the
  [Details UX](studio_actor_tools.md#floating-details-ux).
  Reopening keeps placement and view state within the same Actor Lab input;
  workspace persistence never resurrects a runtime handle.
- Default Details uses compact measured name/value rows. Explicit disclosure
  exposes actual typed children or full text, not a larger recursively formatted
  preview. Actor Lab reclaims the redundant playback/preview heading strips;
  the shared transport uses one icon/range row without a live-endpoint filler
  label. Review readback cannot shift a captured slider's geometry.

Contained-subwindow arrangement remains designed and provisional until a
concrete contribution needs it. Its eventual implementation validates nested
clipping and client-relative placement at that boundary. Other inspectors,
docking and native windows are separate product changes, each with its own
consumer and acceptance rather than extra work hidden in C.

### D — Presented-image pointer projection and producer parity

Trace browser and remote pointer occurrences from physical source through UI
projection and guest publication. Keep canvas/Studio targeting distinct from
mapping into the actual displayed preview image. Supply one presentation-bound
image projection and explicit wheel-unit boundary at the common input owner.
The result is consumed by B's guest contribution, not a second admission router.

Acceptance:

- Equivalent browser/remote occurrences hit the same Studio logical point and
  publish the same guest image point/button/wheel contribution after admission.
  Tests include letterboxing, offset/resized previews, native raster dimensions,
  held image presentation and captured motion outside the image.
- Current arranged image placement determines projection; the displayed image's
  dimensions, not the Studio viewport or latest device registers, determine
  raster scale. The attachment producer enforces the existing image-extent
  constraint and `PointerInput` owns device-word encoding.
- UI wheel units and guest attachment wheel units remain separate explicit
  producer values. Projection/allocation counters verify one required mapping
  per occurrence, with no duplicate conversion in window/content controls.
- The dependency on B is checked at guest publication, not inferred from the
  browser supplying canvas coordinates. The shared preview projection is in
  place before B is accepted as correct embedded-game routing.

### E — Remaining Studio contribution UX

After the shared UI primitives and Actor Lab, review the remaining Studio
features against the same contracts: both fonts and themes, constrained
work areas, meaningful names and information hierarchy, icon/hint semantics,
keyboard entry/exit, structured values and transport context. A shared-owner
correction propagates through its real consumers; contribution-specific
behaviour remains with that contribution. Each concrete issue needs its own
implemented change and matching visual/interaction acceptance. This is a
Studio-wide review scope, not a claim that every contribution is already
covered by the Actor Lab design.

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
contracts, not performance or visible usability. Live Studio validation uses the native
session/context workflow required by the repository instructions and observes
actual input, frame/history and visible window behaviour.

Visual layout acceptance can also render the ordinary Workbench offscreen
through the existing headless IDE workflow. Exercise fonts, themes, minimum
sizes, compact captions, value disclosure and input transitions in that actual
frontend; a native headless game capture before IDE overlays is not window-UX
evidence. The headless IDE driver's authored control input uses the ordinary
ordered producer, separately from raw guest/gamepad/supervisor input.
