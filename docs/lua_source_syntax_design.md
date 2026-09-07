# Lua source syntax ownership

## Scope

Lua remains the authored document for scenes, BTs, FSMs and ordinary code.
The existing number/sign-token edits remain valid. Structural edits must use
parser-owned field boundaries and lexical punctuation, not a contribution
scanning source text for commas or comments.

The lexical slice removes the formatter's second comment recognizer. The field-
range slice adds one conservative language-owned deletion primitive. Neither
claims a full-fidelity syntax tree. The Scene Editor Remove action remains
**unshipped**: its product trial exposed a separate closure-layout dependency
in ordinary Hot Resume, documented below.

## Production references and decisions

- TypeScript's [scanner](https://github.com/microsoft/TypeScript/blob/c63de15a992d37f0d6cec03ac7631872838602cb/src/compiler/scanner.ts#L1891-L1964)
  selects whether to skip trivia. Its
  [formatting scanner](https://github.com/microsoft/TypeScript/blob/c63de15a992d37f0d6cec03ac7631872838602cb/src/services/formatting/formattingScanner.ts#L24-L35)
  uses that same lexical owner with trivia enabled. BMSX adopts this boundary:
  the default compiler/analysis scan still skips trivia, while formatting
  explicitly requests it. No second lexer, comment regex or compiler-wide
  allocation of editor-only trivia.
- Roslyn's [lexer](https://github.com/dotnet/roslyn/blob/ca7d6c1a040cda9fecd1ffe3720fb971251ace67/src/Compilers/CSharp/Portable/Parser/Lexer.cs#L1872-L1980)
  gives trivia an explicit token attachment, with trailing trivia ending at a
  line break. Lua's Full Moon has the corresponding
  [leading/trailing ownership](https://github.com/Kampfkarren/full-moon/blob/60f02d5dc2236b57355557e4c306046081fc2fdd/full-moon/src/tokenizer/lexer.rs#L130-L176)
  and [newline rule](https://github.com/Kampfkarren/full-moon/blob/60f02d5dc2236b57355557e4c306046081fc2fdd/full-moon/src/tokenizer/lexer.rs#L213-L258).
  A future BMSX structural syntax owner must make this attachment explicit;
  the formatter does not invent it.
- Full Moon's [punctuated lists](https://github.com/Kampfkarren/full-moon/blob/60f02d5dc2236b57355557e4c306046081fc2fdd/full-moon/src/ast/punctuated.rs#L1-L38)
  retain values **and** separators. Roslyn's separated syntax lists make the
  same distinction. Live BMSX already retains separators in `ParsedLuaChunk.tokens`;
  completing the parser-owned field ranges makes those tokens navigable for a
  bounded deletion. Copying an entire native tree model into every compiler
  parse is not justified by this first consumer.

## Live owners and consumers

| Owner / consumers | Current representation and consequence |
| --- | --- |
| `toolchain/ts/lua/syntax/lexer.ts`, `token.ts` | One scanner for BLua lexical grammar, decoded literals, raw lexemes and source positions. Default tokens exclude trivia. Opt-in tokens include horizontal whitespace, LF line breaks, line comments and long-bracket comments. |
| `syntax/parser.ts`, `syntax/ast/index.ts` | Significant-token recursive descent. Each field range now covers its complete consumed syntax, including `[...]` and grouping. The child expression keeps its semantic range. No punctuation/trivia fields are added to the AST; separators remain in the parse token array. |
| `analysis/parse.ts`, `analysis/cache.ts` | `ParsedLuaChunk` already retains the significant tokens. The cache owns the source plus parse by path/source equality. Recovery stops lexical scanning at the first lexical error, while statement recovery can skip significant tokens. Neither is a full-fidelity error tree. |
| `semantic/model.ts`, `semantic/frontend.ts`; IDE diagnostics, workspace project and intellisense | Consume that shared parse and immutable binder facts. The intellisense engine also reads significant tokens directly. No new trivia allocations or token indices are imposed on these consumers in this slice. |
| `toolchain/ts/lua/compiler.ts`, `compiler/compile_value_flow.ts`, compiler `passes/{const_module_exports,expression_paths,module_shape,static_functions}.ts` | Consume the semantic AST, not an editor syntax tree. Compiler output and table evaluation order must stay unchanged. Source locations also serve diagnostics/debugging; they must not be repurposed as mutable punctuation metadata. |
| `scripts/rompacker/rombuilder.ts` | Direct lexer/parser for AST encoding and module closure. No AST properties are added. Corrected field ranges change encoded source metadata; executable-image equality is checked separately from whole-ROM equality. |
| `scripts/rompacker/cart_lua_linter_runtime.ts`, `scripts/lint/rules/lua_cart/`, `scripts/audit_core_parity.ts` | Significant-token and AST readers. They continue to consume the default scan. |
| `ide/runtime/source_registry.ts`, `ide/language/lua/interpreter/interpreter.ts` | Runtime-source/debugger metadata and host interpreter use parsed chunks. No guest/runtime syntax representation is added. |
| `ide/language/lua/formatter.ts` | Requests trivia from the lexer. Indentation uses only significant tokens; string/comment extents determine which line prefixes/suffixes are actual token content. |
| `ide/language/lua/source_edits.ts`, Scene Editor and Behavior Lens adapters | The language owner provides literal edits and complete-field deletion. The shipped adapters still expose literal edits only. No structural text scan, second model, runtime execution or scene-specific syntax token. |

No machine or C++ runtime representation changes. The edited paths run on
source analysis or an explicit language edit/Format Document command, not a guest worldtick,
scanout or idle IDE render.

## Lexical contract

`new LuaLexer(source, path)` remains the significant-token producer.
`new LuaLexer(source, path, /*skipTrivia*/ false)` uses the identical grammar
and emits trivia into the same ordered token array. There is no separately
retained trivia tree or per-token leading/trailing array.

For every accepted source:

1. Concatenating all raw `lexeme` values, including the empty EOF token,
   reconstructs the exact source.
2. Removing trivia from that scan yields the default scan, including literal
   values and existing source positions.
3. Comment markers inside a string are string content. Long-bracket levels
   are recognized only by the existing lexer.
4. Existing BLua newline semantics remain unchanged: LF advances the source
   line, CR is retained as source text. This scanner does not normalize a
   source.

Recovery still returns its diagnosed prefix. Full-source reconstruction is
not promised for malformed input. A later structural edit cannot use that
prefix as if it were the complete document.

The formatter may change whitespace **outside** tokens. It preserves all
string/comment content, including opening-line suffixes, closing-line prefixes,
short-string `\z` continuations and whitespace. It does not merely
protect the interior lines of `[[...]]`. No comment-looking substring can
protect unrelated code from indentation.

## Complete-field deletion primitive

### Syntax ownership

The earlier gate grouped removal with insertion/movement too broadly. Live
`ParsedLuaChunk.tokens` already retains separators. What is missing for a
bounded removal is the **complete parser-owned field range**, not a second
lexer, trivia tree or per-node side table.

TypeScript's [list deletion](https://github.com/microsoft/TypeScript/blob/c63de15a992d37f0d6cec03ac7631872838602cb/src/services/textChanges.ts#L1851-L1869)
uses the syntactic list and its following comma. Its
[next-comma lookup](https://github.com/microsoft/TypeScript/blob/c63de15a992d37f0d6cec03ac7631872838602cb/src/services/textChanges.ts#L608-L617)
queries tokens rather than searching text. Roslyn's
[`KeepExteriorTrivia`](https://github.com/dotnet/roslyn/blob/ca7d6c1a040cda9fecd1ffe3720fb971251ace67/src/Compilers/Core/Portable/Syntax/SyntaxRemoveOptions.cs#L17-L34)
distinguishes outside comments from content inside the removed node. BMSX's
first operation takes that explicit, conservative policy:

- The parser produces a field range from its first consumed token through its
  last consumed token, including expression-key brackets and value grouping,
  but excluding the separator and exterior trivia. Child expression ranges
  retain their existing semantic meaning. Identical immutable ranges/endpoints
  are shared with the value node, rather than allocating duplicate positions
  for the ordinary ungrouped fields.
- `syntax/table_fields.ts` finds the following separator by binary search in
  the retained significant tokens. This is token navigation over a
  parser-proven boundary, not reconstruction of Lua syntax by text scanning.
- The Lua edit owner returns the field deletion and, if present, a separate
  deletion of its following comma/semicolon. The trivia between them and all
  other exterior trivia stay byte-for-byte. Comments **inside** the field are
  removed with the field. Remaining indentation/blank lines are not tidied as
  a hidden formatting operation. A previous separator may become a legal Lua
  trailing separator; no synthetic comma is needed for last-member removal.
- The primitive consumes the field and token array from one complete parse of
  the current buffer version. The caller owns source-version/syntax-error
  admission; the primitive does not reparse, validate internal DTOs or scan
  text. It returns one ordered edit batch; it does not own application/history.
- The future Scene Editor action must share the language cache's parsed result,
  not build a second contribution parser. It must accept pending property
  text before selecting syntax, return focus to document history after
  deletion and clear a deleted selection. Dynamic entries, recovered source
  and read-only documents do not admit that action.
- Source removal is not actor disposal. Registration/Hot Resume still affects
  future instantiations only; there is no heap walk, cartlib hook or automatic
  reboot. The attempted product integration hit the closure gate below and
  was withdrawn rather than delivered with a broken Save & Resume workflow.

There are no new AST properties, serialized syntax records or default trivia
arrays. Corrected field source ranges can change encoded AST resource bytes;
compiled instructions, literals and child-expression/debugger locations must
be compared separately rather than promising identical whole ROMs.

### Remaining insertion/movement and error-tree work

Before adding insertion, movement or edits on recovered syntax:

- Complete field bounds and token-owned separators now exist. Insertion and
  movement still need an explicit list-boundary and travelling-trivia policy;
  retokenizing a semantic child expression cannot supply that ownership.
- Trivia attachment belongs to the syntax owner. Initial/EOF trivia,
  same-line comments, standalone comment lines and blank lines require tests;
  a move must state what travels with the member versus stays with its list.
  The deletion primitive above deliberately keeps all exterior trivia; it
  does not decide what comments should travel with a moved member.
- A source-version-owned syntax result must be shared with semantic analysis
  rather than reparsing in each contribution. No duplicate token stream per
  scene, and no new editor-only syntax properties in encoded AST output.
- Compare retained source-token references against a full concrete tree on
  actual workspace files before choosing storage. Default compilation should
  not pay for editor-only token/trivia arrays. This is an ownership decision,
  not a request for a speculative CST facade.
- Current document changes reparse a file; they do not incrementally relex it.
  Editing a quote or long-bracket delimiter can change the entire suffix.
  Do not claim token/tree reuse without lexical-state convergence and measured
  benefit. The existing retained workspace invalidation remains the owner.
- Error/missing-token representation must be designed before edits can operate
  on recovered tables. No successful rewrite of incomplete syntax, guessed
  delimiters or discarded error suffix.

The deletion primitive proves syntax edits, not an end-to-end scene product.

## Hot Resume dependency discovered by the product trial

On the actual debug Nemesis ROM, delete only the third `objects` field in
`scenes/root.lua` (the `title_screen` entry) and use ordinary Save & Hot Resume.
No grouping/comment fixture is needed. The current revision builder rejects:

```text
Hot resume cannot change closure identity for
'module:scenes/root/module/decl:root_scene.register'.
```

Recompiling the 179 actual program/generated modules confirms the exact change
at O3; the original rebuild reproduces the installed layout:

| Capture slot | Installed / unchanged rebuild | After deleting the title member |
| ---: | --- | --- |
| 0 | `scene_library`, parent register 0 | unchanged |
| 1 | `root_scene`, parent register 5 | unchanged |
| 2 | `intro`, parent register 2 | unchanged |
| 3 | `story`, parent register 3 | unchanged |
| 4 | `title_screen`, parent register 4 | `director`, parent register 1 |
| 5 | `director`, parent register 1 | absent |

All descriptors are `inStack=true`; `staticClosure=false` before and after.
The compiler allocates captures by use and compacts unused slots. The linker
keeps function-record identity across revisions but does not preserve capture
layout. An old live closure still has six cells: installing the new code
without mapping them would read the title cell as `director`. The guard in
`blua32_revision.ts` is therefore necessary, not a UI inconvenience.

The reference is Roslyn's actual
[`EncVariableSlotAllocator.TryGetPreviousClosure` / `TryGetPreviousLambda`](https://github.com/dotnet/roslyn/blob/ca7d6c1a040cda9fecd1ffe3720fb971251ace67/src/Compilers/Core/Portable/Emit/EditAndContinue/EncVariableSlotAllocator.cs#L302-L354):
it maps prior syntax and checks closure compatibility rather than equating
a method's name with its captured environment. Its
[closure lowering](https://github.com/dotnet/roslyn/blob/ca7d6c1a040cda9fecd1ffe3720fb971251ace67/src/Compilers/CSharp/Portable/Lowering/ClosureConversion/ClosureConversion.cs#L350-L418)
separates environment identity from captured fields. This is an ownership
reference, not a request to copy CLR display classes into BLua32 or defer an
unsupported edit to a runtime exception.

The next compiler/linker slice must establish lexical capture correspondence
across revisions before choosing stable capture slots or explicit cell
relocation. The current debug names and numeric parent descriptors are not a
sufficient general identity for shadowed/reordered declarations. Required
proof includes capture contraction/permutation, parent-register movement,
nested captures, shared open/closed cells, repeated remove/undo/reapply and
static/dynamic closure transitions. New captures whose original value no
longer exists require an explicit supported/unsupported contract, not invented
values. No blanket de-optimization, scene-specific dummy capture, guessed
name match, skipped guard or rebuild/restart fallback. Any runtime changes
require the TS/C++ representation/callsite table first.

The attempted software-browser trial passed actual pointer Remove, pending
valid/invalid property acceptance, grouped field/comment preservation and
separate field/document Undo/Redo. It then failed the installed-source check
after the error above. That is **failed product evidence**, not a pass or a
skipped acceptance requirement. No Remove command, menu entry or half-enabled
contribution is included in this slice. Existing numeric Scene Editor
workflows remain the shipped surface.

## Lexical-slice evidence

Measured against `899f36690`, Node 22.23.1, on the 312 tracked Lua sources under
`cartlib`, `machine/bios` and `carts` (2,147,679 UTF-8 bytes). All 312 parse;
there is no excluded-error subset. Separately bundled baseline/current owners
ran in one process, with eight warmups and 31 alternating sample pairs per
operation, explicit GC before each timed sample and no concurrent test/build.
Times below are medians for the **entire corpus**, not a frame budget:

| Operation | Baseline | This slice |
| --- | ---: | ---: |
| Significant-token scan | 33.34 ms | 34.03 ms |
| Scan + parse | 66.32 ms | 67.47 ms |
| Format Document | 53.05 ms | 51.25 ms |

The opt-in branch is not claimed to be free: token-only scanning was about 2%
slower in this run. Formatting replaces the old token buckets, comment regex,
line-start lookup and preserved-line set with one token pass. There is no
guest-frame or idle-render callsite. The existing
`scripts/dev/profile_lua_semantics.ts carts/nemesis_s/scenes/root.lua cartlib carts/nemesis_s`
profile (191 files) measured the root's per-edit parse median at 0.103 ms before
and 0.101 ms after. These are measurements, not a global speed guarantee.

Keeping every corpus token array alive across GC measured 37.33 MiB with the
default scan in both versions (365,464 tokens). Opt-in trivia measured 60.23
MiB (624,837 tokens). Seven retained-heap samples per variant were taken. This
is an artificial all-files-retained measurement: the actual formatter scans
one document per command. It is concrete evidence **against** imposing the
extra trivia objects on every retained semantic/compiler parse by default;
future syntax-storage work must measure its own representation.

Correctness and product evidence:

- Every corpus source reconstructs exactly from trivia-scan lexemes; projecting
  significant tokens and the resulting AST matches the baseline exactly.
- Formatting is idempotent and preserves all non-whitespace token lexemes and
  decoded literals across the corpus. Its existing formatted output is also
  unchanged on those files; adversarial comment-looking strings and multiline
  boundary whitespace are covered by explicit regressions.
- `test:lua`: 887 pass, one existing skip; `test:rompacker`: 119 pass.
- The actual Studio Format Document chord, repeat-without-mutation, Undo and
  Redo run before the existing scene/edit/Hot Resume/reboot workflows on
  software, WebGL2 and WebGPU. All three product runs pass, and their final
  scene screenshots have identical decoded pixels.
- Forced debug BIOS/Nemesis rebuilds are SHA-256-identical to the baseline.
- IDE typecheck, strict architecture boundaries, core parity, indentation and
  `git diff --check` pass. The broad tests typecheck has exactly the same 52
  pre-existing diagnostics, not a clean-tests-typecheck claim.

## Complete-field slice evidence

Measured against `bbf772bc1`, Node 22.23.1, on the same 312 tracked Lua files
(2,147,679 source bytes). The complete default token arrays match exactly.
Of 14,077 fields, 1,020 acquire corrected ranges; every other AST property and
all child-expression ranges match. All files participate, including compiler,
BIOS and game sources; no error cases are excluded.

Separately bundled owners, eight warmups, 31 alternating timing pairs with GC
before each sample, and seven retained-heap samples per version. No concurrent
build/browser/test during measurement:

| Operation, whole corpus | Baseline | Complete fields |
| --- | ---: | ---: |
| Scan + parse median | 73.25 ms | 74.84 ms |
| Retained complete parses after GC, median | 95.92 MiB | 95.97 MiB |

This run was about 2% slower; it does not establish a speedup or a frame-budget
guarantee. The observed retained-heap difference is about 51 KiB and is small
relative to heap-measurement variance. The first implementation allocated
every field range/endpoint afresh and measured about 0.86 MiB extra; sharing
unchanged immutable ranges/endpoints removes that unnecessary representation
duplication. No AST properties, punctuation records or default trivia arrays
were added. The existing 191-file semantic profile measured the Nemesis-root
per-edit parse median at 0.124 ms before and 0.128 ms after.

Validation of the landed language slice:

- Six new regressions cover complete key/grouping spans, nested syntax,
  comment-looking strings, CRLF/exterior comments, first/middle/last/sole
  removal, reparse, repeated edits, one content event and one document
  Undo/Redo batch. Changed sources also execute on the actual BLua32 CPU.
- `test:lua`: **893 pass**, one existing skip; `test:rompacker`: **119 pass**.
  No new skipped/todo test substitutes for the failed Remove product trial.
- Forced BIOS/Nemesis debug rebuilds preserve the complete decoded executable
  layouts/bytes (294,780 and 634,580 bytes respectively) and debug symbols
  exactly. Whole ROMs differ because encoded AST ranges are corrected;
  Nemesis has the same byte count and BIOS is four bytes smaller.
- The **existing shipped** Studio workflows pass on software, WebGL2 and
  WebGPU, including Format Document, source/property editing, concrete focus
  and history, Save, ordinary Hot Resume and explicit cold instantiation.
  Final Scene Editor captures have identical decoded pixels across backends.
  This is regression evidence, not a claim that the withheld Remove action
  or changed closure layouts work.
- Lua-toolchain/IDE typechecks, strict architecture boundaries, core parity,
  indentation and `git diff --check` pass. The tests-project typecheck output
  is byte-for-byte identical to the 52-diagnostic baseline.
