# YAML-backed Studio editing

## Source ownership

Status: 2026-10-07. This contract supersedes the old actor-to-Lua migration
direction. No cart source format changes are required for Studio editing.

| Cart | Authored representation | Runtime consumer |
| --- | --- | --- |
| Pietious | `res/data/castle_map.yaml`: numbered rooms, object lists, tile coordinates, maps | `castle/map.lua` decodes room templates and derives scene registrations |
| Nemesis S | `res/data/nemesis_s_stage.yaml`: `map_rows` glyphs, stage parameters and cues | `stage.lua` decodes terrain/collision and scroll-triggered actor spawns |

Some Nemesis glyphs expand into multiple objects. Editing a reflected runtime
actor cannot identify its authored source uniquely. Pietious scene members are
also derived, not replacement documents. Both YAML files remain canonical;
Lua owns their gameplay interpretation. Existing directly authored Lua scenes
remain supported by their own source editor.

## Delivered foundation

Ordinary YAML data resources open as authored text through the existing resource
resolver and workspace provider. Code views retain the existing resource-owned
`EditorTextModel`; no second text buffer, parsed-object working copy or history.
Both `.yaml` and `.yml` are supported. AEM keeps its specific editor behavior;
other data formats retain the ordinary resource preview.

- Edit, undo/redo, source save and dirty-session recovery use the existing owners.
- YAML highlighting reuses the line-highlighter/cache; Lua semantic work is excluded.
- Indentation and comment commands consume language-owned syntax, including AEM
  YAML versus JSON. YAML Tab inserts spaces, Ctrl+/ uses `#`.
- Save writes the authored text, not a serialization of cooked data. Missing source
  fails to open; there is no reverse conversion from loaded ROM data.
- Save reports **asset rebuild required**. No data hot-reload or installed-source
  equality is claimed. YAML formatting is explicitly unavailable rather than
  rewriting comments, scalar spelling, ordering or map layout.

The production references examined before implementation are Tiled's
[document manager](https://github.com/mapeditor/tiled/blob/master/src/tiled/documentmanager.cpp)
and [map document](https://github.com/mapeditor/tiled/blob/master/src/tiled/mapdocument.cpp),
and VS Code's [text-file model tests](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/textfile/test/browser/textFileEditorModel.test.ts).
The applicable principle is document-owned change history and persistence with
specialized views, not adoption of Tiled's map format or a second scene database.

## Canonical map views

The **Map Editor: Open** command opens a second view of the existing YAML
working copy. Ordinary YAML resource opening stays a text editor. Map resource
associations are explicit: castle-map and Nemesis-stage sources have different
projections; no schema is inferred from a runtime actor.

- **Pietious:** choose a numbered room and an existing object, inspect its map
  and authored tile coordinates, and move it with the X/Y controls or grid
  arrow keys. Only the corresponding numeric source scalars change. Object
  types, conditions, item data, comments and authored order stay in the YAML.
- **Nemesis S:** the scrollable map shows the authored glyph rows. Existing
  independent `m`/`M`/`p`/`P` markers can move to empty cells. A formation
  marker remains one authored marker, not its expanded runtime actors.
  Terrain-coupled glyphs are visible but are not independently movable.
- Select in the outline or grid; clicking empty grid space or pressing Escape
  in the grid clears selection without losing the active map or viewport.
  The outline supports tree keyboard navigation and a scrollbar. Source opens
  the same document at the selected source range.
- One visual move is one versioned document-history operation. Source and map
  views share undo/redo, dirty state, Save and workspace recovery. Stale proposals
  are rejected by the history owner. Explicit moves carry the selected source
  range before/after the edit, so Undo/Redo retains the moved member. Unrelated
  source replacement/deletion clears selection rather than attaching it to a
  same-name object. Collapsing the outline does not hide grid hit targets;
  selecting a grid marker reveals its outline row.
- Parse and projection work happens on source revisions, not stationary frames.
  Painting visits visible grid cells and retained markers. It neither reads
  nor executes the guest. No machine/runtime representation changes are involved.

`ide/workbench/contrib/cart_maps/` owns the two domain projections and their
map presentation. `ide/language/yaml/` owns source-token edits and decoded
string-to-source mapping. Single-line plain, single-quoted and double-quoted
row scalars retain their quoting and unrelated escape spelling. Unsupported
source forms remain text-editable, with their visual operation unavailable;
the editor never falls back to serializing a row or document.
Grid columns count Unicode code points, like the guest string reader. Source
edits use the YAML owner's UTF-16 token boundaries, not display columns.

The current boundary is existing-object/marker placement, not room creation,
tile painting, a sprite preview or a generalized plugin SDK. The directly
authored Lua Scene Editor remains independent. No cart source format, gameplay
decoder, or generated scene source is replaced for the editor's convenience.

### Build/application boundary

**Save persists source and reports asset rebuild required.** It does not
rebuild, publish or install a cart, reload a room, or mutate loaded game data.
The existing build/media owners remain responsible for those operations.
An asset build/install action is separate work, not an implicit part of moving
a marker.

References reviewed for this follow-up: Tiled's
[object selection tool](https://github.com/mapeditor/tiled/blob/master/src/tiled/objectselectiontool.cpp)
sends transforms through document history; VS Code's
[custom text editor model](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/customEditor/common/customTextEditorModel.ts)
shares the text-file working copy, and its
[edit stack](https://github.com/microsoft/vscode/blob/main/src/vs/editor/common/model/editStack.ts)
retains before/after selection with document edits; `yaml`'s
[CST stringifier](https://github.com/eemeli/yaml/blob/main/src/parse/cst-stringify.ts)
retains token text rather than normalizing the authored document.

## Evidence and limits

### Map Editor: 2026-10-07

`tests/conformance/runtime_replay/studio_cart_maps.ts` exercises both real cart
sources through the normal host-input dispatcher in a real Chromium page, on
software, WebGL2 and WebGPU. It opens the source and Map Editor, selects in the
outline/grid, edits coordinates, moves with arrow keys, deselects, shares Undo/Redo
with the source view, saves through the product workspace API, closes/reopens,
and reloads the actual browser page to check session recovery. Every unrelated
source byte is compared. Test sources live in isolated workspace copies.

The input fixture uses `HeadlessInputHub`; this proves browser rendering and
host-input dispatch, not native browser/OS input or mobile interaction. Captures
of the actual panes are inspected separately; test assertions do not prescribe
their labels or prose.
Retained screenshots show the edited [Pietious room](evidence/cart_map_editor_2026-10-07/pietious.png)
and [Nemesis stage](evidence/cart_map_editor_2026-10-07/nemesis_s.png).

The separate `studio_cart_map_assets.ts` build consumes the saved YAML through
the actual data cooker and ROM builder, and checks the complete packed value
and debug-source bytes. This is **not** a boot of a complete modified cart or
proof of live asset installation. The editor flow additionally checks that
editing/Save does not execute guest cycles or replace installed media.

Validation: six cart/backend workflows passed; Lua tests **2,994 passed, one
existing skip**; rompacker tests **208 passed**; IDE/tests typechecks, browser
Studio product build, architecture audit (**0 issues**) and diff check passed.
The projection tests also exercise stationary source reuse, source identity,
escaped-marker selection through history and negative authored coordinates.
Independent review found and fixed collapsed-outline grid selection, repeated
label measurement on selection, and room identity in navigation history.

Repeatable browser commands, after building the debug BIOS and both carts:

```sh
node tests/conformance/runtime_replay/browser.mjs --studio-cart-maps pietious \
  dist/system/bmsx-bios.debug.rom dist/pietious.debug.rom
node tests/conformance/runtime_replay/browser.mjs --studio-cart-maps nemesis_s \
  dist/system/bmsx-bios.debug.rom dist/nemesis_s.debug.rom
```

### YAML text-editor foundation: 2026-09-20

`tests/ide/yaml_source_editing.mjs` runs both carts in the headless tooling host,
with isolated workspace copies of their real YAML. It uses keyboard events and
the host clipboard, without IDE-command or model injection. It checks exact
source opening, scalar editing, undo/redo, comments, indentation, save to the
filesystem, and retained-model reopening. Every unrelated source byte is compared;
the repository fixtures are unchanged. Saved-editor captures were visually inspected.
The saved-source views are retained for [Pietious](evidence/yaml_source_editing_2026-09-20/pietious_saved.png)
and [Nemesis S](evidence/yaml_source_editing_2026-09-20/nemesis_s_saved.png).
This is automated user-I/O evidence, not browser/native-host coverage or proof
of fresh-process reload, data-asset application, or a graphical level editor.

`tests/lua/workspace_storage.test.ts` covers source admission/coalescing,
no cooked-data reconstruction, shared history, YAML exclusion from Lua source
capture/semantic updates, and dirty-session recovery. Language configuration and
resource selector tests cover language syntax and asset-type/suffix conjunction.

Historical validation: both user-I/O scenarios passed, as did the IDE typecheck and headless
tooling build. The full Lua suite reports 2,233 passes, one skip and the known
`named workbench menu materializes one retained generic action bar` failure.
Independent review found the inherited hardcoded Lua comment prefix before
delivery; the language-owned fix was reviewed again with no remaining blockers.

The repeatable user-I/O command builds its debug host, BIOS and cart prerequisites:

```sh
npm run test:ide-yaml
npx tsc --noEmit -p ide/tsconfig.json
npm run test:lua
```
