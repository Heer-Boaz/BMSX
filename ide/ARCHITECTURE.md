IDE structure follows a simple ownership split inspired by VS Code's `editor` and `workbench` layers:

- `editor/`
  - Editor-only behavior and state.
  - Text model, editing, caret, code area rendering, editor input, and editor contributions such as intellisense, suggest, rename, references, find, symbols, and runtime-error navigation.
- `workbench/`
  - IDE shell and chrome around the editor.
  - Tabs, top bar, status bar, prompts, context menu, debugger UI, problems panel, resource browser, and workbench-owned input/rendering.
- `language/`
  - Language-specific tooling shared by editor features.
  - Lua, AEM, and YAML parsing/highlighting/formatting layers live here.
- `common/`
  - Small shared kernel only.
  - Shared types, constants, text/layout helpers, character tables, and lightweight scheduling primitives.

Rules:

- Do not put workbench panels or chrome in `editor/`.
- Do not put editor text/caret/render/input code in `workbench/`.
- Do not grow `common/` with owner-specific state.
- If a new module is mainly owned by one surface, place it with that surface even if other modules import it.
- Prefer moving code to the real owner over adding wrapper layers or generic host/facade abstractions.

## Retained lists and panes

`workbench/ui/list_view.ts` owns the common retained-list contract: row storage,
selection, scroll, hover, viewport geometry, hit testing, reveal, and scroll
clamping. A feature owns the meaning and formatting of its rows; it must not
copy these list mechanics into a panel-specific controller. A multi-pane input
retains one list state per pane. Inter-pane focus belongs to the containing
input, while each pane keeps its own rows and viewport state.

This follows VS Code's split-view contract, where each view item receives its
own layout, and its list widget, which retains items and scrolling behind one
list interface:

- <https://github.com/microsoft/vscode/blob/f6f7c31e6cd2541fdd901f045a3418a06f2c3aca/src/vs/base/browser/ui/splitview/splitview.ts#L35-L109>
- <https://github.com/microsoft/vscode/blob/f6f7c31e6cd2541fdd901f045a3418a06f2c3aca/src/vs/base/browser/ui/list/listView.ts#L230-L298>

## Commands, keybindings, and menus

Workbench actions follow the same ownership split as VS Code's `Action2` and
menu/keybinding registries:

- a typed command id identifies an operation and `IdeCommandController` owns
  execution plus enabled/active state;
- command presentation metadata owns the human label once;
- the keyboard layer contributes bindings to command ids and resolves the
  highest-weight applicable binding; a feature view does not branch on a
  command shortcut itself;
- workbench menus contribute ordered command ids to named menu locations;
  top-bar dropdowns and view-title action bars project those contributions
  through shared render and pointer owners;
- pointer, keyboard, and controller activation converge on the same command
  id before the feature controller performs the operation.

Tree/list navigation remains input owned by the focused view, just as a list
widget owns cursor movement. Operations such as run, rerun, and cancel do not:
they are commands with contextual enablement. Status text reports retained
view or operation state and never embeds manually maintained shortcut strings.
If a surface presents a shortcut, it obtains the label from the keybinding
catalog rather than duplicating it in a menu or view.

The production references are VS Code's single action registration path, which
publishes one command descriptor into command, menu, and keybinding registries,
and its weighted/contextual keybinding resolver:

- <https://github.com/microsoft/vscode/blob/f6f7c31e6cd2541fdd901f045a3418a06f2c3aca/src/vs/platform/actions/common/actions.ts#L679-L779>
- <https://github.com/microsoft/vscode/blob/f6f7c31e6cd2541fdd901f045a3418a06f2c3aca/src/vs/platform/keybinding/common/keybindingsRegistry.ts#L62-L68>
- <https://github.com/microsoft/vscode/blob/f6f7c31e6cd2541fdd901f045a3418a06f2c3aca/src/vs/platform/keybinding/common/keybindingResolver.ts#L320-L395>
