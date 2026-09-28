# Scrollbar interaction ownership

## Production references

The matching VS Code owners were inspected before this revision:

- [`AbstractScrollbar`](https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/scrollbar/abstractScrollbar.ts)
  captures the initial scrollbar geometry for a gesture rather than changing its
  sensitivity whenever the content size changes.
- [`GlobalPointerMoveMonitor`](https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/globalPointerMoveMonitor.ts)
  owns pointer monitoring and its teardown separately from scroll geometry.
- [`ScrollbarState`](https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/scrollbar/scrollbarState.ts)
  owns the range and the conversion between thumb travel and content position.
- [`List`'s `MouseController`](https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/list/listWidget.ts)
  acquires keyboard focus on pointer activation, not on hover. Studio's file
  browser likewise separates hover from focus/selection; its content hit area
  excludes the scrollbar gutters.

Studio uses its existing canvas pointer capture, not DOM capture or VS Code's
platform-specific snap-back behaviour. There is no guest, hardware or C++ change.

## Owners

| Owner | Retained state and responsibility |
| --- | --- |
| `Scrollbar` | Track/thumb rectangles, signed content range, position and pointer-to-content mapping. Publishes track-bound/drag-availability changes at `layout`, after the new geometry is installed. |
| `ScrollbarPointerControl` | One admitted gesture: exact scrollbar, initial pointer/scroll/scale, last pointer coordinate and a track subscription. No retained pane input, revision polling or duplicate dragging flag. |
| `PointerCaptureService` | Exclusive physical capture, initiating button and surface scope; release versus cancellation, lost input, blocking and canvas exit. Keyboard dispatch cancels this same capture on Escape. |
| View/pane | Admits track hits and cancels its control on detach, replacement, hide or an explicit wheel/keyboard action. Model lifetimes can outlive their controls. |
| `ScrollbarController` | Code/resource axis selection, the existing extended horizontal hit area, and publication into row/column/resource-view positions. No separate drag lifetime or pointer-frame loop. |

`Scrollbar.onDidChangeTrack` reports physical bounds and availability, **not every
range change**. Only the current gesture subscribes, and every completion path
removes that subscription. Old track changes cannot cancel a subsequent grab.
There is no per-frame control `update`, `trackRevision`, or nullable view-input
validation. The existing geometry `revision` remains useful for presentation
layout; it is not a capture-lifetime mechanism.

## Transitions

- Primary press on a visible track starts capture. A track click centers the
  thumb; a thumb press retains the exact content position, not an inverse of its
  rounded display pixels. Neither takes text focus or commits a property draft.
- Virtual content-height refinement retains the initial sensitivity and current
  capture. Stationary pointer frames do not overwrite a corrected reading anchor.
- Track relocation, resizing or loss of its drag affordance cancels immediately
  from the geometry producer. No later pointer frame or pane update is required.
- Physical release detaches first, then applies the final pointer coordinate.
  Cancellation does not apply a release coordinate and never restores old scroll.
  A coalesced press/release cannot leave capture behind.
- Pane/input detach cancels locally. Opening an exclusive surface cancels the old
  capture; its own scope can then capture independently. A property inspector also
  cancels the surface gesture it replaces when shown.

## Call paths and validation surface

Code/resource/viewer gutters, tab chrome, graphs, Actor Lab outlines, Quick Input,
inline suggestions, context menus, property inspectors and scrolling workbench
panes all reach the same `ScrollbarPointerControl`. Only it calls the scrollbar's
drag datapath. Graph node dragging/panning and tab reordering remain their own
gestures; scrolling does not acquire their source-edit or selection semantics.
Behavior Lens and resource-viewer panes route gutter presses before content
focus. File-browser hover neither focuses, selects nor edge-scrolls the list.

Existing behavioural checks cover both axes, signed/fractional content positions,
stationary layout, source/view selection, popup scope, final release, replacement,
lost affordance and synchronous geometry cancellation. Browser coverage includes
the 5,000-message assistant fixture and Scene Editor viewports on software,
WebGL2 and WebGPU. An isolated real-host pointer/keyboard probe on the same
three renderers exercises code scrolling, both file-browser axes without focus
or selection changes, overflowing tabs, Escape, Quick Input query/geometry
changes, and both graph axes with action-bar focus retained. Font changes while
holding a code or graph thumb end capture before another pointer movement.
The resulting code, files, tabs, picker, graph and long-conversation screenshots
were also inspected.

These are automated host workflows, not evidence of a physical phone or a real
account/model session. Debug/release Studio builds, IDE typechecking, the targeted
261 behavioural tests and the boundary audit pass. The broad Studio workflow
stops separately in `testStudioNavigationHistory` with a null `selectionAnchor`;
the same failure was reproduced on the unchanged parent `ed2e69090`. This is not
a claim that the entire Studio regression suite is green.
