# Source choices on shared Quick Input (A06)

Status: implemented and validated (2026-09-11). This slice replaces the old
symbol/reference/definition popup. Fuzzy symbol matching remains separate A06
work; match presentation follows `quick_input_highlights.md`. Neither changes
semantic resolution or graph edits.

## Production references

VS Code, pinned at `7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca`:

- [Document symbol Quick Access](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/editor/contrib/quickAccess/browser/gotoSymbolQuickAccess.ts#L141-L228)
  retains one symbol request per invocation, filters that result while typing,
  and keeps source ranges and initial selection in the provider. Navigation
  consumes the chosen location, not the row number as a semantic identifier.
- [References controller](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/editor/contrib/gotoSymbol/browser/peek/referencesController.ts#L80-L178)
  ties results to editor/model lifetime and selects by source URI and position.
  Its Peek editor is a distinct preview surface. BMSX's current reference chooser
  is not a Peek editor and does not acquire a second editor or preview runtime.

## Live owner corrections

The old chooser uses one global `symbolSearchState`, its own field, keyboard,
pointer, hover, inline layout and renderer. Its reference and definition rows
invent `LuaSymbolEntry` values for locations which are not symbol declarations.
Its initial reference index belongs to sorted **current-file highlights**, but
is applied to a **workspace-wide, declarations-first** catalog. Those indices
are not interchangeable. Moving these representations would preserve a bug.

## Contract

- The existing `QuickInputController` owns popup, focus, capture, keyboard,
  scrollbar, release activation and rendering. No old parallel widget remains.
- Symbol choices retain the actual `LuaSymbolEntry`; definition choices retain
  `LuaDefinitionTarget`. Reference choices retain actual source ranges and line
  text from the same immutable semantic snapshot, not a live buffer from a
  different generation. No synthetic symbol, name-only dedup or range fallback.
  Descriptions retain the source path, not just its basename: equal filenames
  in different directories must remain distinguishable after the old status-bar
  source display is removed. For document symbols the file is shown once in
  the title; rows show symbol kind and position instead of repeating that path.
- Each invocation captures its actual resource domain. The existing navigation
  owner resolves the selected source in that domain, never a subsequently
  active tab's domain. Accept hides/disposes the picker before navigation.
- Source catalogs are admitted once. Query changes do not repeat workspace
  analysis. Lua model additions, changes or removals in that domain or SYSTEM
  retire the admitted results; the next invocation queries the new generation.
  Unrelated-domain edits and non-Lua resources do not retire these choices.
- Reference initial selection comes from path plus cursor containment in the
  workspace choices. A file-local highlight index is never a catalog identity.
- Literal text matching is explicit for this migration. An empty query retains
  source order and the provider's initial item. A nonempty query selects its
  best match. This is not a claim of VS Code fuzzy matching parity.
- Command admission remains the active Lua code context. No hidden last-code
  tab or guessed cartridge domain enables workspace symbols from other panes.

## Required evidence

Independent fixtures: multi-file declarations/references, uppercase and repeated
names, initial selection differing from the local highlight index, snapshot
source text, no results, source-generation retirement and listener disposal.
Physical keyboard/pointer Studio probes must cover shared focus/scrolling,
source navigation without dirtying text, Back and Undo. Retain the full Studio
and navigation gates on software, WebGL2 and WebGPU. Measure catalog/query and
idle work separately; a typecheck is neither UI nor performance evidence.

## Evidence

Six independent Lua tests cover the contracts above. The source fixture is not
derived from a game's declarations: it includes two files, shadowed parameters,
and a factory returning two possible member definitions. The physical Studio
probe saves those sources through the real file API, invokes the document,
workspace, reference and definition choices, and navigates to the original
locations. Back, query Undo, source Undo, read-only navigation, background source
changes and disposal of an old session are exercised separately.

Two real-machine baseline probes fail with the IDE owners from `f1ae09edc`:
document symbols do not open the shared picker, and reference initial selection
lands at `cart.lua:7` instead of `title_screen.lua:6`. The latter probe uses the
old public UI directly, not the new provider API. Those filenames are fixture
transport resources, not dependencies on game-authored declarations.

The full Studio workflows and Pietious navigation/graph/Undo gate pass on
software, WebGL2 and WebGPU. The tiny-font software source-picker screenshot
was inspected: document context is in the caption, not repeated in every row.
Lua: 1555 tests, 1554 pass, one existing skip. IDE typecheck, strict architecture
(zero issues), core parity, indentation and browserproductbuild pass. The
tests-typecheck retains the same 51 existing diagnostics; no new diagnostic is
hidden by excluding these tests. `git diff --check` passes.

### Targeted costs

`profile_source_choices.ts` separates an already-resolved semantic query from
source projection, picker admission and query/frame work. Three quiet processes,
ten warmups and 25 samples per median; no concurrent browser/build/typecheck:

| Actual reference choices | Source projection | Full picker admission/layout | Presented rows |
| --- | --- | --- | --- |
| 9 | 0.0076–0.0083 ms | 0.0309–0.0323 ms | 9 |
| 129 | 0.0258–0.0269 ms | 0.0503–0.0513 ms | 10 |
| 1025 | 0.1018–0.1036 ms | 0.2121–0.2186 ms | 10 |

For 1025 choices, `getPicks` takes 5.9–6.2 microseconds for the empty query,
153–159 for an all-matching/ranked query, 12.7–13.4 for a path query and 30–32
for an absent term. Warm updates take 0.017–0.025 microsecond per frame; they do
not revisit the semantic workspace or provider.

An interleaved three-process-pair comparison with the previous text-provider
owner measures generic admission at 1024 choices as 0.213–0.228 ms before and
0.190–0.215 ms now; at 8192 choices, 0.716–0.824 ms before and 0.763–0.845 ms
now. The old constructor was verified to be loaded in the baseline process.
These overlapping measurements do not establish a speedup or justify a new
cache/fast path. Earlier cross-session numbers were lower at 1024 choices and
are not used as an isolated regression baseline.

These are source-projection/control costs, not cold-workspace, whole-host, GC or
SNES-mini evidence. Fuzzy ranking, visible match ranges, full Peek preview and
the broader A08 evidence remain unclaimed.
