# Lua table-field transfer: syntax before reconnect

`IDE-LUA-TABLE-FIELD-TRANSFER-01` supplies the missing **syntax operation** for
moving an existing field between two constructors in one Lua document. It does
not expose BT reconnect/reparent UI. The live source projection identifies a
subtree occurrence under a corresponding parent; changing that parent needs an
explicit selection contract. Moving an expression can also change its bindings.
Neither problem is solved by a renderer changing an edge.

The following [lexical-binding slice](lua_relocation_bindings_design.md) now
compares free declaration, receiver and vararg identities at a destination.
Graph-parent correspondence, target ownership and actual transfer Hot Resume
remain separate gates; this syntax operation still has no reconnect UI.

The [edit-bookmark owner](editor_edit_bookmarks_design.md) now supplies explicit
before/after source selection through the same text history, including a chosen
new parent occurrence. It does not change this primitive's semantic admission
or supply a reconnect gesture.

## Production references and differences

- [VS Code DragAndDropCommand](https://github.com/microsoft/vscode/blob/585a254fad3a58b3d454622a9a1cf61358e5fc58/src/vs/editor/contrib/dnd/browser/dragAndDropCommand.ts#L23-L96)
  reads the selected text, emits deletion and insertion in one command and
  computes the resulting selection. It does not copy the entire intervening
  document to make old markers look stationary. This operation follows that
  bounded-payload approach, not the existing same-list rotate-around-selection
  implementation. The returned field range describes the result of this one
  edit; it is not a persistent graph identity or another history.
- [Full Moon Punctuated](https://github.com/Kampfkarren/full-moon/blob/60f02d5dc2236b57355557e4c306046081fc2fdd/full-moon/src/ast/punctuated.rs#L27-L36)
  owns value/punctuation pairs. The existing BLua token-attachment owner already
  defines their leading/trailing trivia. Transfer uses that owner, not a new
  scanner, synthetic AST or feature-local comment heuristic.
- [LimboAI task drag](https://github.com/limbonaut/limboai/blob/3f14ea4c26911e8b8e30c6bcdb575fc589a59deb/editor/limbo_ai_editor_plugin.cpp#L1048-L1095)
  commits actual parent/index changes in one document action. Those resource
  identities are not Lua expression bindings. Its global-history workaround is
  not copied.
- [Aigen reconnect](https://github.com/Heer-Boaz/aigen/blob/5248d9c9a0b3bb1cde45a9088c9427d20d8f1b91/aigen/workflow_edit_buffer.py#L319-L397)
  changes explicit document endpoints and order. BMSX must edit canonical Lua,
  not introduce an equivalent workflow database behind the lens.
- [TypeScript extraction scope analysis](https://github.com/microsoft/TypeScript/blob/c63de15a992d37f0d6cec03ac7631872838602cb/src/services/refactors/extractSymbol.ts#L2094-L2142)
  compares actual symbols at the destination before constructing a refactoring.
  This is the next semantic requirement, **not implemented by this syntax
  slice**. A same-name identifier or a syntactically valid result is not proof
  that a callback still captures the same value.

## Owning representations

| Owner | Contract |
| --- | --- |
| Caller | Complete current parse, actual source field and a distinct target constructor in the same buffer; destination is a lexical field index in `0..target.fields.length`. The target must not be inside the transferred field. Caller owns scope/binding, BT role, cycle and shared-constructor admission. |
| `getLuaTableFieldTriviaSpan` | Existing Full Moon-style attachment: leading trivia after the preceding token's first newline; trailing trivia through the first newline after the field/separator. Brace-owned header/footer trivia stays with its brace. |
| `createLuaTableFieldTransfer` | One lossless scan, two or three sorted non-overlapping edits. Delete the actual attached field span and insert that span at a target sibling's leading-trivia boundary, after the last pair, or before an empty constructor's footer. |
| Punctuation | Existing separator bytes travel. Add a grammar comma only when the transferred final field needs a following sibling, or the destination's old final field needs a successor. Commas precede inline comments. Coincident punctuation/insertion belongs to one producer-ordered edit. The source predecessor's separator remains valid trailing punctuation. |
| Layout | This is a lossless transfer, not Format Document. Travelling indentation, CRLF/LF, comments, grouping, multiline literals and callback interiors remain byte-exact. No reindentation of lines inside strings or guessed scope conversion. Source-only syntax may have unusual but valid layout after a cross-layout transfer. |
| Edit result | `fieldRange` is a half-open UTF-16 range of the complete transferred syntax in the final buffer, excluding exterior trivia/separator. It is calculated from the actual edit placements, not by searching for equal text or reparsing a duplicate occurrence. |
| `EditorTextModel` | One `pushEditOperations`, one content event, one normal Undo record; PieceTree retains deletion subtrees. Existing unrelated markers use ordinary edit mapping. Deleted source markers lose identity; Undo does not invent graph-parent correspondence. |

The ordinary field-insertion primitive accepts **new field syntax without
exterior trivia** and supplies boundary layout. Feeding it a moved field with
attached comments would violate that representation and could place punctuation
after a line comment. Transfer instead consumes the existing punctuated-span
owner directly. It does not add a second insertion-formatting implementation.

This API has no warm enablement, draw, hit, cartlib, CPU or C++ callsite. Cost is
one explicit lossless lexical scan plus the transferred span; inserted payload
does not scale with distance between the two tables. No compiler-wide retained
trivia, per-frame cache or speculative semantic repair is added.

## Gates and remaining product requirements

- Independent fixtures must cover first/middle/last/sole source fields and every
  target gap, both directions, nested constructors, duplicate keys and values,
  empty target, missing separators, comments/grouping/CRLF/Unicode and exact
  result range. The complete resulting AST must differ only in field ownership
  and order; Undo/Redo must restore exact source bytes.
- Real compiled BLua/cartlib must execute the edited composition. A separate
  shadowing example must demonstrate why syntax success is **not** semantic
  admission. Do not turn a negative example into a language restriction.
- Real Studio source/history/navigation must consume the result range without
  a mock graph command. That is an integration test of this language operation,
  not a claim that a user-facing reconnect gesture exists.
- Before reconnect: prove destination bindings (including captured locals,
  implicit `self` and varargs), source-list roles and shared-constructor effects;
  then define selection across a parent change. No same-scope shortcut, guessed
  destination index, namesake recovery or graph-history facade.
- Save/Hot Resume of transferred callbacks also needs its own live proof.
  The compiler's `LuaSourceCorrespondence` matches enclosing lexical scopes;
  `LuaCaptureLayout` retains actual corresponding capture origins, not a field's
  new screen position. This syntax operation does not extend that matcher or
  bypass its gates. See [capture ownership](lua_capture_identity_design.md).

## Implemented evidence

- Seven independent language tests cover the syntax/result/history contract;
  the full Lua suite passes **1,141 tests, one skipped**. Real BLua executes the
  new expression order and the intentional shadowing counterexample. The
  cartlib CPU oracle moves children inward and outward and verifies the actual
  compiled sequence, list lengths and retained named metadata. Its destination
  uses the lexical field list, not the visible child count.
- The corpus oracle performs **17,541 transfers across 312 Lua files**
  (2,147,702 source bytes; 4,300 nonempty constructors). It compares the complete
  AST apart from locations, the exact final field range and byte-exact Undo.
  It is neither a guest-semantic proof nor a cart-specific line-number test.
- Full Studio workflows and the separate Pietious navigation workflow pass
  on **software, WebGL2 and WebGPU**. Each includes the independent transfer
  fixture in the actual working copy, normal Source navigation, responsive
  physical input, palette Undo and keyboard Redo. Navigation neither changes
  source nor advances the paused machine. The fixture is undone before any
  source installation: these are **not** transfer Hot-Resume tests.
- Browser Studio and headless tooling builds pass; the real headless Behavior
  Lens gate passes **59 assertions**. IDE typecheck, strict architecture audit,
  core-parity audit, indentation check and `git diff --check` pass. The tests
  TypeScript project retains its **51 pre-existing diagnostics**, with identical
  file/code/message multiplicities after accounting for shifted source offsets;
  it is not a green project-wide typecheck.

### Explicit-operation cost

Isolated Node v22.23.1 run on this development host, microseconds per operation:

| Source UTF-16 / gap UTF-16 | Construct | Prebuilt PieceTree apply + Undo | Transfer entrypoint + Undo | Inserted UTF-16 |
| --- | ---: | ---: | ---: | ---: |
| 1,636 / 1,600 | 9.620 | 0.893 | 10.509 | 3 |
| 102,436 / 102,400 | 516.017 | 0.889 | 520.855 | 3 |

Construction/entrypoint use 100-operation batches; prebuilt apply/Undo uses
1,000. Each measurement has ten warmups and the median of 25 samples. The
explicit lossless scan grows with document size, while the inserted payload
does not grow with distance. No warm UI or guest work was added. These timings
exclude parsing, semantic analysis, graph layout, rendering, autosave and Hot
Resume; they are not heap-allocation or complete-frame measurements.

Reproduction commands and fixture scope:
[`tests/conformance/lua_source/README.md`](../tests/conformance/lua_source/README.md).
Logs, primary reference code and captures: `/tmp/bmsx-bt-transfer/`.
