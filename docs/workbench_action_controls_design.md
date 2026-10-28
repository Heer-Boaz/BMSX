# Workbench action controls

## Production contracts studied before implementation

- [VS Code ActionBar](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/base/browser/ui/actionbar/actionbar.ts): one toolbar focus stop, roving enabled actions, Home/End, paired trigger-key down/up, blur cancellation, explicit action context.
- [VS Code ActionViewItem](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/base/browser/ui/actionbar/actionViewItems.ts): mouse-down feedback is not ordinary action execution.
- [Godot BaseButton](https://github.com/godotengine/godot/blob/4cefd60f5a3d733506cb557d6cd26263b3fbd17f/scene/gui/base_button.cpp): retained press attempt, inside/outside feedback, release activation and cancellation when interaction ownership is lost.
- [VS Code List keyboard controller](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/base/browser/ui/list/listWidget.ts): arrows traverse a composite control's items; Tab leaves the control.

These are behavioral/ownership references, not permission to import DOM controls,
their runtime guards, or a second command registry into the canvas workbench.

## Ownership

`ui/action_bar.ts` retains contributed items, labels, bounds and presentation
state. A pane-owned `WorkbenchActionBarControl` owns physical interaction and
attaches to that input-owned state. The existing `PointerCaptureService` owns
delivery outside the button; `InputFocusService` owns keyboard focus. Rendering
consumes retained state, using the existing tiny font and theme.
Controls do not own machine state, guest ABI, cartlib or mirrored TS/C++
runtime representations.

Physical focus and command context are distinct. Each `InputFocusTarget` names
its command context explicitly (itself by default). A toolbar names its content
control; command enablement, keybindings, the palette and execution resolve that
same context. This is **not** parent-command inheritance: a text field with empty
Undo history never falls through to document Undo. Pointer presses on toolbar
buttons preserve the focused field, including pending-value admission.

Each contribution programs a retained focus order: content/toolbar for Lens,
outline/scroll area/editable fields/toolbar for Scene (the scroll area is added
by the [scroll container](workbench_scroll_views_design.md) and skipped for empty content), tests/results/toolbar for Scenario
Lab, impacts/toolbar for Source Edit Review. Tab and Shift+Tab traverse controls;
toolbar Left/Right and Home/End traverse enabled actions. Escape returns to its
content control. FSM Up/Down traverse its already-retained nodes and relations;
Shift+Up/Down retains vertical viewport movement. No source operation is moved
onto a new gameplay shortcut.

## Activation and lifetime

- Primary down arms one enabled action and captures the initiating pointer;
  it does not execute. Release over that same action executes once. Moving out
  and back preserves the attempt; releasing outside cancels it.
- Disabled actions, focus/capture loss, input replacement, disposal and Escape
  revoke the attempt. Re-enabling an action does not revive a revoked press.
- Enter/NumpadEnter/Space arm on down and execute once on their matching release.
  Repeats, an unmatched release, moving focus, or losing the input do not execute.
- Clear capture/armed state **before** command execution: actions can navigate,
  close a review, replace a pane or mutate the current projection synchronously.
- The contribution owns domain enablement and execution. It never implements
  another toolbar press branch. Selection and graph-drag initiation may still
  occur on down; ordinary buttons use release activation.

Idle update/render retains items, bounds, state and handlers. No per-frame
closures, DTOs, item filtering arrays or measurement work are introduced.
Subscriptions associated with a physical pointer attempt have that lifetime,
not the lifetime of a render frame.

Behavior Lens graph, state-graph and property title bars contribute primary
actions and their existing secondary command menus to the same responsive
toolbar. The shared More icon presents secondary actions and primaries that no
longer fit; each command appears once. Header text consumes the space left by
the actual painted toolbar, including when every primary has moved to More.
The popup belongs to the invoking source generation and retires on invalidation.
It is not a separate contribution command or a second toolbar implementation.

## Contextual placement

Feature-owned immutable definitions declare `when(context)` over their actual
retained input or view. A `WorkbenchMenu` binds that context once; binding does
not evaluate predicates before the input has finished construction. Its retained
projection owns membership and separator normalization, not the command registry,
keyboard focus or a second domain-state store. Shared static menus remain
immutable named contributions.

The content/layout producer publishes its mode and source state before the menu
projection is refreshed and toolbar geometry is arranged. Layout consumes that
membership instead of inspecting command IDs. The same bound context-menu
projection supplies the primary overflow and the ordinary context popup;
placements may have different predicates without redefining the command.
Visibility is not enablement: an applicable action can remain visible and
unavailable. Command admission is still checked against the actual invocation.

The toolbar owns overflow as a retained derived menu: its laid-out primary
suffix plus the applicable secondary placements, deduplicated by command.
Its revision observes both source menus. Input admission can retract a hidden
primary immediately; only layout admits a newly visible primary's geometry.

Membership changes have a structural revision even when the final geometry is
unchanged. Each placement retains its own membership revision: an ordinary
attempt depends on its initiating entry, not an unrelated action becoming
available before layout. A hidden action's armed gesture is revoked; hiding and
showing it before key-up cannot revive the press. Layout changes revoke the
old physical geometry. More and its owned popup depend on the whole derived
membership. An owned popup retires on a membership
change without closing a newer unrelated popup or stealing its focus. Existing
source/context retirement remains independent of presentation membership.
Unchanged refreshes reuse entry and visible-item storage and do not remeasure
unchanged labels.

This separation follows VS Code's
[menu contribution visibility](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/platform/actions/common/actions.ts),
[contextual menu projection](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/platform/actions/common/menuService.ts)
and [menu-driven toolbar](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/platform/actions/browser/toolbar.ts).
Studio uses typed predicates and its existing control lifetimes, not VS Code's
context-key service or mutable extension-registration machinery.
