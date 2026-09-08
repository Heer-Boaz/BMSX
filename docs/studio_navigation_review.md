# Studio navigation and command admission

## Reported defects and pre-change owners (2026-09-08)

- Code context menus blacklist builtin *names*, including source-defined globals.
  Identifier spelling does not determine whether navigation is available.
- Scene Editor and Behavior Lens commands require a code pane and use its file.
  Opening either from the entry point therefore creates an empty `cart.lua` view.
  The Scene Source action does point back to that document; it does not discover
  scene definitions elsewhere. The missing boundary is source-view admission.
- Behavior Lens retains a code-tab id instead of the resource-owned text model.
- File Quick Pick displays both the resource path and its often-identical asset id.

## Contract before implementation

1. Context menus offer the existing source commands for identifiers; the language
   service owns definition/reference/rename results, not a UI builtin-name list.
2. Source views consume `EditorTextModel`, independently of code-pane lifetime.
   From a supported active source, View opens its projection. Otherwise View
   explicitly offers matching Lua documents in the workbench Quick Pick, using
   the existing recognizers and current unsaved text. No guessed entry file,
   runtime object walk, source execution or extra authored database.
3. Tab titles name the tools: Scene Editor and Behavior Lens. The view header
   identifies the actual source. Both have a visible Source action that opens
   the selected syntax location. Other view commands remain available.
4. Command Palette projects the existing command metadata and enablement, not
   a second execution registry. It returns focus before executing the chosen
   command. Ctrl/Cmd+Shift+P is scoped to the IDE, never gameplay.
5. File selection displays its path once, plus resource kind/socket. Files,
   source-view selection and commands share Quick Input. Symbol navigation is
   also a candidate for this surface, but its source-range preview, cancellation
   and semantic query lifecycle must remain provider-owned; Find/Replace and
   reference/call-hierarchy inspection are not interchangeable choice dialogs.
6. Scenario completion and user cancellation are separate work. Reproduce the
   actual cinematic scenario before changing clocks, timeouts or cancellation.

## Production references studied

VS Code commit `a47dab6a0a5258924b2454f64fc373fc7e657677`:

- [Editor context menu](https://github.com/microsoft/vscode/blob/a47dab6a0a5258924b2454f64fc373fc7e657677/src/vs/editor/contrib/contextmenu/browser/contextmenu.ts):
  text context and contributed actions, not identifier spelling.
- [Command Palette](https://github.com/microsoft/vscode/blob/a47dab6a0a5258924b2454f64fc373fc7e657677/src/vs/workbench/contrib/quickaccess/browser/commandsQuickAccess.ts):
  enabled registered actions, categories, ordinary command dispatch.
- [Anything Quick Access](https://github.com/microsoft/vscode/blob/a47dab6a0a5258924b2454f64fc373fc7e657677/src/vs/workbench/contrib/search/browser/anythingQuickAccess.ts):
  resource label/description and typed resource acceptance.
- [Symbol Quick Access](https://github.com/microsoft/vscode/blob/a47dab6a0a5258924b2454f64fc373fc7e657677/src/vs/editor/contrib/quickAccess/browser/gotoSymbolQuickAccess.ts):
  shared picker mechanics, provider-owned semantic ranges and preview lifecycle.

No mirrored machine representation or hot-path changes belong to this UI slice.
Proof must include actual pointer/key routes from non-code panes, source identity
and positions, dirty models, focus return, and the three browser renderers.

## Landed navigation proof

- Actual BIOS `main.lua`: secondary pointer on `os` opens its source context menu.
- Actual Nemesis: entry-file View command offers scene-registration sources;
  `scenes/root.lua` opens the retained scene model and Source reveals its selected
  syntax row. Scene → Lens offers behavior-registration files, including the
  real `title_screen.lua` FSM. Lens Source reveals its selected syntax range.
- Scenario Lab → Scene/Lens works without a code pane. Closing the text tab does
  not detach the lens model. Ordinary source edit/undo/save/Hot Resume workflows
  still run on the same mutable working copy.
- Three browser renderer projects passed the full Studio workflow. File-picker
  screenshots were inspected at native 384×288 presentation; no repeated path.
- Lua tests: 962 passed, one existing skip. IDE typecheck passed. The broad tests
  project retains the same 52 pre-existing diagnostics, with no added diagnostic.
- Architecture-boundary strict audit: zero issues. Core parity, indentation and
  `git diff --check` passed. This slice changes no machine/guest representation.
- Artifacts: `/tmp/bmsx-studio-review/`.

## Concrete Palette admission contract (fixed before the second diff)

The production [QuickPick owner](https://github.com/microsoft/vscode/blob/a47dab6a0a5258924b2454f64fc373fc7e657677/src/vs/platform/quickinput/browser/quickInput.ts)
separates showing/focusing the UI from providing its items. VS Code's command
provider enumerates enabled commands in the invoking editor's scoped context,
not the quick-input textbox's edit context.

BMSX needs this ordering at its existing synchronous picker boundary, not a new
command registry or a speculative asynchronous provider framework:

1. End a replaced picker and restore its actual invoking control.
2. Capture that control, then transfer focus to Quick Input. Ordinary control
   blur completes before provider enumeration (including property acceptance).
3. Invoke the typed item provider once with the captured focus target. The
   command controller evaluates focus-dependent commands against that explicit
   target; default menu/key queries continue to use current focus without a
   context-object allocation per frame.
4. Filtering and query history remain picker-owned. Acceptance closes/restores
   focus before command admission/execution. Availability is checked again at
   this user-input boundary: e.g. an asynchronous run can finish during choice.
   If it did, report unavailability rather than dereferencing a missing run.
5. Titles/categories and optional short toolbar titles live in the existing
   command catalog. The Palette derives every item from that catalog and the
   existing keybinding table. It has no independent execute map or allowlist.

Gates: replaced pickers cannot make Palette Undo target the old query; code
Undo targets code, a scene-property draft cannot become document Undo after
blur; Save/Hot Resume capture accepted source values; empty results do nothing;
Escape restores origin; actual View, Save, Hot Resume and Reboot commands work
from the Palette. Ctrl/Cmd+Shift+P is offered only while the IDE owns input.

## Landed Palette proof

- The complete Studio browser workflow passes on software, WebGL2 and WebGPU,
  including actual Ctrl+Shift+P and View-menu admission. Query history stays
  separate from code and property history; replaced pickers return the real
  non-code control. A busy runtime queue prevents a stale Resume selection.
- Actual Palette commands open Scenario Lab and source-backed views, save
  accepted scene properties, undo the source edit, and perform dirty-source
  Save & Hot Resume and Save & Reboot. The browser driver checks the resulting
  workspace files, including the additional WebGPU readback-test FSM revision.
- `tests/ide/command_palette_scenario.idetest.js` runs the shipped cinematic
  scenario through the Palette, reopens Studio with the physical host chord,
  and cancels through the Palette. Ten assertions include suspended machine
  cycles, cancelled result state and canonical media restoration on the same
  Runtime. This proves cancellation, not successful cinematic completion.
- Inspected 384×288 Palette output uses the IDE tiny font. All three renderer
  screenshots have SHA-256
  `e65e9e25d0f89a9e52281d9e646d615a4cd552c86bc9415a0a2be549ed9124b7`.
- Lua tests: 963 passed, one existing skip. IDE typecheck passed; broad test
  typechecking retains the same 52 baseline diagnostics. Browser Studio and
  Node headless-tooling products were rebuilt. Artifacts remain under
  `/tmp/bmsx-studio-review/`.
- Strict architecture audit: zero issues. Core-parity audit, indentation and
  `git diff --check` passed; no mirrored runtime or cartlib code changed.

## Remaining slices, not claimed as implemented

### Shared symbol Quick Access

The shared surface is appropriate for choosing a symbol, but migrating only
its drawing would relocate ownership problems. Keep the existing symbol
widgets until a provider owns the semantic query lifetime, typed source ranges,
selection preview and cancellation/focus return. Reference lists, call
hierarchies and Find/Replace retain their separate inspection/edit semantics.

### Cinematic scenario guest-call admission

The run's eventual timeout is not cinematic completion. Actual packaged code
reaches `gameplay ready`; its setup completion call then remains pending. A
350-frame stack capture shows:

```text
entry → vblank.wait → irq
  → __bmsx_host_test.setup [completion latch]
  → story event / FSM transitions → title_screen.enter_idle
  → atlas.load → imgdec.upload → dma.wait0_idle [HALT_UNTIL_IRQ]
```

The CPU is in IRQ mode. `dma.wait0_idle` waits for the completion sequence
advanced by the cart IRQ handler, underneath which setup was injected. The
live owner defect is therefore guest-call admission into an interrupted
continuation, not a slow cinematic or a need for a longer timeout. The
temporary stack probe is `/tmp/bmsx-studio-review/cinematic_stack.idetest.js`;
the committed Palette scenario test reproduces entry into setup and proves
that host cancellation still works. Physical IDE chord plus Shift+F5 also
passed the canonical-media restoration probe.

Before changing this owner, study production debugger inferior-call execution
and map Runtime completion calls, CPU IRQ/return latches, scheduler boundaries,
Hot Resume and their C++ mirrors. Merely skipping a call at an IRQ-mode frame
boundary can starve it forever; forcing user mode, polling DMA from the host,
or rewriting the scenario to avoid its ordinary asset loads is not a fix.
No CPU/runtime/cartlib patch or timeout change is part of these UI slices.
