# YAML-backed Studio editing

## Source ownership

| Cart | Authored representation | Runtime consumer |
| --- | --- | --- |
| Pietious | `res/data/castle_map.yaml`: numbered rooms, object lists, tile coordinates, maps | `castle/map.lua` decodes room templates and derives scene registrations |
| Nemesis S | `res/data/nemesis_s_stage.yaml`: `map_rows` glyphs, stage parameters and cues | `stage.lua` decodes terrain/collision and scroll-triggered actor spawns |

Some Nemesis glyphs expand into multiple objects. Editing a reflected runtime
actor cannot identify its authored source uniquely. Pietious scene members are
also derived, not replacement documents. Both YAML files remain canonical;
Lua owns their gameplay interpretation. Existing directly authored Lua scenes
remain supported by their own source editor.

## Text document ownership

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
- Save reports persistence separately from asset status. Packaged source metadata
  establishes the installed asset baseline; differing text needs a rebuild and
  absent metadata is unknown. This is not data hot-reload or live-object equality.
  YAML formatting is explicitly unavailable rather than
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
  The first row defines the game's tape width. Longer rows retain their source
  glyphs, but cells beyond that width are source-only, not spawn markers or move
  destinations. A short diagnostic identifies such rows; shorter rows are never
  padded by the editor.
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
  selecting a grid marker reveals its outline row. Accepted moves and focused
  Undo/Redo reveal the member in both outline and map, while ordinary updates
  preserve manual scrolling. Reselecting the active tab finishes the focused
  coordinate draft without reactivating the document. Session snapshots project
  pending source changes before capturing selection and collapse state; inactive
  restored tabs retain their saved viewport until their first layout.
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
The structured-source parser uses the cooker's YAML core schema even when an
authored `%YAML 1.1` directive is present. That directive must not make the editor
interpret `012` as octal or `y` as a boolean key while the cooker does not.
Unsupported explicit tags fail at this source boundary; they are not silently
interpreted as strings. Comments, directives and token spelling remain authored.
Shared structured insertion emits JSON keys and strings with the YAML library's
JSON quoting mode for `.aem.json`, including control characters and long strings;
it never introduces YAML-only escapes or folded JSON strings. Existing document
tokens remain untouched. Removing the first block entry accounts for its
parent-owned indentation, keeping later entries, comments and nested values at
their authored columns; compact sequence indicators stay with their parent.
Collection edit offsets start at the first source token, including any first-key
properties before the AST range, rather than shifting edits past anchors or tags.

The current boundary is existing-object/marker placement, not room creation,
tile painting, a sprite preview or a generalized plugin SDK. The directly
authored Lua Scene Editor remains independent. No cart source format, gameplay
decoder, or generated scene source is replaced for the editor's convenience.

### Build/application boundary

**Save persists source; changed asset source needs a rebuild.** It does not
rebuild, publish or install a cart, reload a room, or mutate loaded game data.
The existing build/media owners remain responsible for those operations.
Studio's existing **Build Cartridge** command builds saved files; completed
Build Jobs can open the published artifact in a new Studio session. Building
does not install it into the current session. Neither action is implicit in
moving a marker or saving source.

The map footer shows a short asset-source status; Save feedback is a brief
result, not a tutorial. Source equality is cached by model revision and installed
source identity, so stationary frames do not snapshot or compare the document.

References reviewed for this follow-up: Tiled's
[object selection tool](https://github.com/mapeditor/tiled/blob/master/src/tiled/objectselectiontool.cpp)
sends transforms through document history; VS Code's
[custom text editor model](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/customEditor/common/customTextEditorModel.ts)
shares the text-file working copy, and its
[edit stack](https://github.com/microsoft/vscode/blob/main/src/vs/editor/common/model/editStack.ts)
retains before/after selection with document edits; `yaml`'s
[CST stringifier](https://github.com/eemeli/yaml/blob/main/src/parse/cst-stringify.ts)
retains token text rather than normalizing the authored document.
