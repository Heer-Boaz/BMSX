# Workbench action controls — audit A01

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
This slice changes IDE controls only; machine state, guest ABI, cartlib and the
mirrored TS/C++ runtime representations are unchanged.

Physical focus and command context are distinct. Each `InputFocusTarget` names
its command context explicitly (itself by default). A toolbar names its content
control; command enablement, keybindings, the palette and execution resolve that
same context. This is **not** parent-command inheritance: a text field with empty
Undo history never falls through to document Undo. Pointer presses on toolbar
buttons preserve the focused field, including pending-value admission.

Each contribution programs a retained focus order: content/toolbar for Lens,
outline/editable fields/toolbar for Scene, tests/results/toolbar for Scenario
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

## Evidence gate

Independent control tests cover pointer and keyboard cancellation, disable during
press, context isolation, reentrant navigation, input replacement and retained
storage. Actual Studio workflows exercise the shared control in Lens, Scene,
Scenario Lab and source review, on software, WebGL2 and WebGPU. Compilation alone
does not close A01. Evidence and any untested limits are recorded below after
validation. The remaining audit points retain their own gates and are not closed
by this slice.

## Validated implementation — 2026-09-10

The four title-action consumers use the shared control; the old hover-only
pointer helper and feature-owned down-time dispatch have been removed. Focus
context remains explicit, including when the command palette originates in a
toolbar. Empty/read-only Scene inspectors skip their fields, not their toolbar.
Scenario tests/results participate in actual focus traversal rather than a
parallel feature-local Tab command.

- `tests/lua/workbench_action_bar.test.ts`: 13 independent control/render tests.
  Combined focus/action-registry/review/scenario selection run: 34 passed.
- Full `tests/lua/*.test.ts`: 1249 passed, one pre-existing skip.
- Actual Studio `--studio`: software, WebGL2, WebGPU passed. In particular,
  Source and Remove cannot execute on down; canceling a Scene toolbar press
  keeps its draft; a toolbar-origin palette retains graph command availability;
  Scenario Run/Cancel and document Undo use their existing owners.
- Actual Studio `--studio-fsm-retarget`: all three renderers passed, including
  canceled Apply, keyboard-only Apply, impact Source, Discard, source history
  and live Hot Resume on the retained guest actors.
- Screenshots at logical 384x288 were inspected: tiny font, focus underline in
  button padding, no overlapping labels. Hover, pressed, disabled and focus
  produce distinct retained overlay commands; unchanged renders reuse storage.
- IDE typecheck, browser Studio debug build, strict architecture boundaries
  (zero issues), core parity and `git diff --check` passed. The broader tests
  typecheck retains its 51 existing diagnostics, with no new diagnostics.

Reproduction (Playwright module location is host-specific):

```sh
npx tsx --tsconfig tsconfig.base.json --test --import ./tests/lua/test_setup.ts tests/lua/*.test.ts
BMSX_PLAYWRIGHT_MODULE=/tmp/bmsx-browser-tools/node_modules/playwright/index.mjs \
  node tests/conformance/runtime_replay/browser.mjs --studio \
  dist/bmsx-bios.debug.rom dist/nemesis_s.debug.rom /tmp/bmsx-a01/final-studio.png
BMSX_PLAYWRIGHT_MODULE=/tmp/bmsx-browser-tools/node_modules/playwright/index.mjs \
  node tests/conformance/runtime_replay/browser.mjs --studio-fsm-retarget \
  dist/bmsx-bios.debug.rom dist/nemesis_s.debug.rom /tmp/bmsx-a01/final-review.png
```

Logs/screenshots: `/tmp/bmsx-a01/`. These runs include expected source-fetch 404s
and deliberate compile/guest-fault cases; they are not claimed as a console
without error messages. The harness gates unexpected host/guest failures.

The existing independent FSM review benchmark retained rows, measurement results
and quad storage. Review rendering plus quad submission measured about 22.9/23.1
microseconds for fixtures with 32/1024 registrations. This is **not** a baseline
comparison, heap/GC measurement, GPU raster measurement or complete Studio-frame
budget; audit A08 remains open. The action-control hot path adds no item arrays,
per-frame subscriptions/closures or source/layout work. Gesture subscriptions
are created and removed only for actual pointer attempts.
