# Workbench scroll views (A02)

## Production references, checked before implementation

- [Godot ScrollContainer](https://github.com/godotengine/godot/blob/4cefd60f5a3d733506cb557d6cd26263b3fbd17f/scene/gui/scroll_container.cpp):
  content minimum size is independent of the available viewport; child placement
  subtracts scroll; clipping, reserved scrollbar space and focused-child reveal
  belong to the container. Scrollbar interaction does not focus the scrollbar.
- [VS Code Scrollable](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/base/common/scrollable.ts):
  dimensions and position have one range owner, including dimension changes.
  Unchanged state does not publish another update.
- [VS Code ScrollableElement](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/base/browser/ui/scrollbar/scrollableElement.ts):
  input and presentation consume that scroll model, not separate content offsets.

## Owners and scope

`Scrollbar` already owns axis range, position and retained thumb geometry. Add
interval reveal there; the graph viewport must consume the same operation rather
than retain its private equivalent. No second scroll position or clamp in Scene.

`WorkbenchScrollViewport` owns the vertical content viewport, reserved track,
content height and content-to-screen projection. It is a vertical form/list
container, not a graph, form schema, document, or inspector DTO. Its geometry
revision changes only on dimensions/content changes, not on scrolling.

`WorkbenchScrollControl` owns physical capture and scroll-area keyboard focus.
Track/drag and wheel preserve the current value draft and its focus. Background
click focuses the scroll area; arrows, Page Up/Down and Home/End then navigate it.
Capture ends on release, Escape, blocking popup, invalid pointer, geometry change,
input replacement or detach. Cancellation keeps the current scroll, not a rollback.

Scene input retains viewport and measured content. Scene layout measures wrapped
labels, section spacing, field rectangles and notes in content coordinates from
the current font and width. Only layout/source/selection changes remeasure text.
Screen field bounds are a retained projection of those content rectangles, shared
by painting and pointer hit testing. Scrolling projects geometry, not Lua syntax.

Scene pane connects field focus to reveal and re-reveals focused fields after
layout changes. Manual scrolling must not snap back on every update. The focus
order is outline, scroll area (when it has content), editable fields, title actions. Integer fields
retain their existing acceptance/escape return to the outline and their own draft
history. Scroll-area commands explicitly target the document context.

Painting clips to the editor, then to each content viewport. Field hit testing
intersects the same viewport; hidden properties cannot take a click. Wheel input
routes by the pointer's pane, not always to the outline. A fully collapsed viewport
is empty, not synthetic space outside the workbench allocation. The outline keeps
its existing row-based tree owner; its last partial row is neither drawn nor hit.

No machine, cartlib, runtime, source format, or TS/C++ representation changes.

## Evidence gate

- Independent Lua fixtures: measured extents in both fonts and multiple viewport
  sizes; zero height; source-only fields; unchanged-layout object retention.
- Shared viewport/control tests: range, reveal, clipping/projection, track and
  thumb capture, coalesced release, cancellation, wheel focus, resize, detach.
- Actual Studio: open Problems, physically resize it, multiple tab rows, both
  fonts, reveal/edit the bottom property, read the final note by scrolling,
  scroll while holding an unsubmitted draft, and verify unchanged source until
  acceptance. Inspect software/WebGL2/WebGPU screenshots.
- IDE typecheck, focused and full Lua tests, architecture/parity audits, clean
  diff; report broader pre-existing test diagnostics separately.
