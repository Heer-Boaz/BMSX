# ActionEffect authored property editing

2026-09-12, live baseline `ceb675ace`. B06 follows the written-source consumer;
it does not invent cartlib metadata, evaluate expressions or close B04's broader
API/call-context work.

## Reference and owner contract before implementation

- [VS Code settingsTree](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/src/vs/workbench/contrib/preferences/browser/settingsTree.ts)
  separates typed value controls from complex values' source-editor route.
  Element lifetimes dispose editors; setting updates are not user changes.
- [Godot EditorPropertyText](https://github.com/godotengine/godot/blob/c24bf5d933c53d9477d5e82c51403856a9e7da62/editor/inspector/editor_properties.cpp)
  likewise separates the line edit, programmatic property refresh and emitted
  property edits. BMSX must use its text-model Undo rather than Object mutation.
- The existing IntegerInput already owns draft history, InputEdit commit before
  Save, blur, Escape and the actual TextField. Generalize that control for the
  second real consumer, retaining the integer parser at its value boundary.
  Reuse SingleLineFieldViewport/render for long expressions and pointer offsets;
  no new text buffer, invisible draft-success stubs or per-frame parsing.

## Product boundary

An explicit **Edit Property** action edits an existing authored value expression
or requirement entry. Selection, Details and Source never write. Single-line
expressions in the input's actual working copy use an in-place value cell;
multiline expressions and foreign write resources open their real source editor.
That source route is an explicit capability, not editing a provider's bytes while
Undo still targets the registration's file. No missing defaults/fields are
fabricated. Aliases remain references unless the user explicitly replaces them.

The language layer parses a submitted expression with an end-of-input contract
and checks its lexical field boundary. A trailing line comment must not swallow
the original separator or neighbouring fields. This validates human text, not
cartlib-produced values. It does not prove a callback's type or expression purity.
The field's existing expression range owns one lossless replacement; surrounding
trivia and referenced initializers stay unchanged.

The contribution retains the exact field and source generation for the draft.
Invalidation/detach cancels it; accepted edits use ordinary working-copy Undo.
Escape discards; invalid Enter keeps the draft; valid blur or Save commits once.
Focus-local Undo edits the draft until it is accepted. Code Undo then restores
the authored source and the property selection. Imported read-only source stays
read-only through its normal editor input.

## Required evidence

Independent fixtures for expressions, booleans, strings/tags, aliases, partial
tables, multiline/foreign source routes, syntax errors/trailing comments,
invalidation, read-only, exact trivia and one source Undo/Redo. Physical Studio
cell edit/cancel/draft Undo/Save/Source on all three renderers; existing Scene
integer controls must retain their focus and Save behavior. Measure retained
draw separately from user-triggered parsing. No machine/C++/cartlib changes.

## Implementation and measured proof

- `ValueInput` now supplies the shared typed draft lifecycle; the old integer
  control implementation is replaced, not wrapped. Its integer format remains
  a small human decimal-input boundary. Long cells reuse the existing retained
  single-line glyph viewport; multiline pastes are rejected whole rather than
  silently changing Lua text. Acceptance resets the draft before publishing the
  value so that source invalidation/blur cannot apply it twice.
- Effect projection publishes actual field/value write anchors. Named property
  fields and list-value occurrences retain their different syntax identities.
  The edit returns new field **and** expression ranges, not a guessed range
  covering all inserted trivia. Edit-associated bookmarks restore the selected
  occurrence on acceptance, Undo and Redo, even when a referenced list becomes
  an inline constructor. Ordinary typing markers still collapse on replacement.
- As a follow-up review, [Roslyn's ParseExpression](https://github.com/dotnet/roslyn/blob/main/src/Compilers/CSharp/Portable/Syntax/SyntaxFactory.cs)
  confirms the separate expression-entry/end-of-input contract. BMSX uses the
  existing Lua grammar, not a fabricated `return` prefix or local mini-parser.
  No API binding, callback execution or expression purity is inferred here.
- 1,691 Lua tests pass, one existing skip (1,692 total). Toolchain/IDE typechecks
  pass. The tests project retains exactly its 51 pre-existing diagnostics.
  Strict boundaries (zero issues), core parity, indentation and diff checks pass.
- Full Studio workflows and Pietious navigation pass on software, WebGL2 and
  WebGPU. The independent authoring fixture uses physical Edit, typing/paste,
  draft Undo/Redo, Escape, invalid Enter/Save, held buttons, ordinary Save,
  source Undo/Redo, a tag with mixed case, replacement of a list reference,
  multiline Source, source invalidation and restoration of saved original text.
  Machine time and installed media remain unchanged by authoring/Save. Scene
  integer editing and existing Hot Resume flows remain part of the full gate;
  this is not a claim of a dedicated live-effect execution oracle for every edit.
- The imported-source navigation probe also invokes Edit on a foreign effect
  property, physically edits its provider expression, then performs provider Undo
  and Back. It passes on all three renderers without changing the registration
  working copy. No hidden write-through occurs in the visual input.
- Real tiny-font WebGL2 captures of expression entry and horizontal scrolling
  were inspected. The compact property list, source roles and full-width tag
  values remain; no new modal shell, hard-coded help-key row or guest UI.

### Performance boundary

Node 22.23.1, four isolated process pairs against `ceb675ace`, identical esbuild
bundles, ten warmups and median-of-25 samples, 1,000 operations per sample.
Median three-integer-cell paint plus quad construction changes from **0.585 µs**
to **0.867 µs**. The shared scroll-capable control is not a claimed speedup;
the additional cost is about 0.28 µs for all three cells in this workload.
Quad storage is retained. No whole-frame, GPU, heap or GC guarantee is implied.

User-triggered Lua field-edit parsing/range construction takes a median
**0.690 µs** for a 51-character call/arithmetic expression with a block comment,
and **7.170 µs** when its comment makes it 4,123 characters long. These are
fragment costs with an already parsed source field, not workspace queries,
large statement bodies or compilation/execution times. Stable property drawing
does not run the parser. Logs, captures and profiling bundles are under
`/tmp/bmsx-effect-authoring/`.
