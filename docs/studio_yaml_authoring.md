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

## Next implementation boundary

1. **Source-preserving structured access.** `ide/language/yaml/structured_edits.ts`
   now uses the `yaml` parser's source tokens and ranges for scalar/collection
   edits; the AEM editor already consumes it. Reuse this language owner rather
   than introducing another parser or regex extraction inside a cart editor. A
   decoded string-cell edit still needs a language-owned source mapping. Keep incomplete
   authored text editable and show unsupported syntax as non-editable projection,
   never normalize it to a convenient schema.
2. **One end-to-end room editor.** Start with a Pietious room/object selection and
   a tile-position edit of the exact `x`/`y` scalar ranges. Share text/history/save
   with the source view. Reuse retained tree, controls and viewport owners; prove
   source/visual undo and that unrelated YAML bytes survive. No runtime heap scan.
3. **Stage-specific composition.** Nemesis needs a tile/marker view, not Pietious's
   object-list schema. A decoded cell must map back through the YAML scalar's
   quoting/escape representation; decoded indices are not source offsets. Marker
   semantics stay explicit and cart-owned, not inferred from runtime instances.
4. **Build/apply workflow.** Define data-asset rebuilding and publication at the
   existing build/media boundary before offering an apply button. Saving a file
   and rebuilding or replacing game state are distinct operations.

These are ordered architectural gates, not permission to implement a generic
plugin SDK, duplicate the runtime decoder, or expand cartlib for editor convenience.
Derive projections on source changes, never per frame. Generic UI components
know selection/geometry/property interaction, not castle, enemy or stage semantics.

### Smallest useful visual-authoring follow-up

**Not implemented.** The current Scene Editor recognizes directly authored Lua
`scene_library.register` compositions. It cannot visually edit either canonical
YAML placement source. The old `scenes/rooms/room_002.lua` and
`scenes/stage_actors.lua` migrations are not acceptance fixtures to resurrect.

- **Pietious:** choose a numbered room and an existing object, see its authored
  map and tile position, and edit the exact `objects[].x` / `y` scalar ranges.
  Labels use the written `type`; conditions, item data and source order remain
  untouched. Coordinates are authored tile coordinates, not generated scene
  member world positions. No room decoder or progression logic moves into Studio.
- **Nemesis S:** show a scrollable `map_rows` glyph grid and move an existing
  marker to an empty cell with one document-history operation. Selection is a
  source cell, not an expanded actor: `p`/`P` can create a formation. Start with
  the independent `m`/`M`/`p`/`P` markers; terrain-coupled glyphs remain visible,
  not silently interpreted as independently movable objects. The language owner
  maps decoded cells through quoting and escapes; changing two cells must not
  reserialize a row or the document. Unsupported scalar syntax stays editable
  as source and visibly unavailable for that visual operation.

Both views retain the resource's existing `EditorTextModel`. Share only the
needed grid/selection/property controls, not an authored schema or new plugin
framework. Save persists source and reports asset rebuild required. An asset
build/install action is a separate owner change, not an implicit part of moving
a marker or calling `reload_room`.

Acceptance must cover both real files independently: visible selection/edit;
exact unrelated-byte preservation (including row escapes and comments);
source/visual shared undo and redo; invalid source and intervening edits;
Save, close/reopen and fresh workspace reload. Build the saved asset through
the existing rompacker and boot it separately to verify the cart's actual room
coordinate or spawn column, without claiming live data application. Retain the
existing Lua presentation-scene workflow as separate coverage. Stationary paint
must neither reparse YAML nor read/execute the guest.

References reviewed for this follow-up: Tiled's
[object selection tool](https://github.com/mapeditor/tiled/blob/master/src/tiled/objectselectiontool.cpp)
sends transforms through document history; VS Code's
[custom text editor model](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/customEditor/browser/customTextEditorModel.ts)
shares the text-file working copy; `yaml`'s
[CST stringifier](https://github.com/eemeli/yaml/blob/main/src/parse/cst-stringify.ts)
retains token text rather than normalizing the authored document.

## Evidence and limits

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

Validation: both user-I/O scenarios pass, as do the IDE typecheck and headless
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
