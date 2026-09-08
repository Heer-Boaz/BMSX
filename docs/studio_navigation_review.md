# Studio navigation and command admission

## Live defects (2026-09-08)

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

## Next slices, not claimed as implemented

### Command context before Command Palette

The existing picker currently admits a static typed item array. Menus preserve
control focus; a palette must acquire its own text focus. `Undo`, `Save`, source
commands and scenario cancellation therefore cannot derive their target from
whichever field happens to have focus while the palette is visible.

Verify VS Code's Quick Input session/provider lifecycle and scoped command
context before extending this owner. Gates: opening/replacing/cancelling a
palette preserves the invoking editor identity; query Undo stays local;
executing a selected command restores the originating context first; pending
property edits follow their concrete owner; an asynchronously completed run
cannot leave an executable stale Cancel item. No duplicate palette command
registry, command-specific shortcuts, synthetic success or silent rescue path.

Only after those gates: Command Palette metadata over the real command catalog,
IDE-scoped Ctrl/Cmd+Shift+P, categories and keybinding labels, then actual
Hot Resume/Reboot/view/run/cancel workflows. Sharing symbol pickers is a separate
migration that must preserve query and preview semantics, not a cosmetic move.

### Cinematic scenario diagnosis

User confirmed that the run eventually ends. The earlier 180-second headless
failure and the interactive logical-tick timeout are not completion proof.
Separate readiness/guest-call progress from input/cancel admission and verify
both on the shipped scenario. Do not raise limits, skip checks, or call the
incident fixed because a timeout terminates it. No scenario changes landed in
this navigation slice.
