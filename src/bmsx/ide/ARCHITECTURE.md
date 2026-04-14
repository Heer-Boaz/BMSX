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
