# Lua source syntax ownership

## Scope

Lua remains the authored document for scenes, BTs, FSMs and ordinary code.
The existing number/sign-token edits remain valid. Inserting, removing or
moving a table member needs more source information than the current AST
provides; it must not be implemented by a contribution scanning for commas or
comments.

This slice establishes the lexical owner and removes the formatter's second
comment recognizer. It does **not** claim that a lossless token stream is a
full-fidelity syntax tree or enable structural Scene Editor commands.

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
  retain values **and** separators. That is the missing parser information,
  not an inferred `field.range` extension. Roslyn's separated syntax lists
  make the same distinction. Copying their entire native tree object model
  into every BMSX compiler parse is not justified by this first consumer.

## Live owners and consumers

| Owner / consumers | Current representation and consequence |
| --- | --- |
| `toolchain/ts/lua/syntax/lexer.ts`, `token.ts` | One scanner for BLua lexical grammar, decoded literals, raw lexemes and source positions. Default tokens exclude trivia. Opt-in tokens include horizontal whitespace, LF line breaks, line comments and long-bracket comments. |
| `syntax/parser.ts`, `syntax/ast/index.ts` | Significant-token recursive descent. Tables retain semantic field order, but not separator tokens. Expression-key ranges start inside `[...]`; grouping parentheses are consumed without a separate AST node. These ranges cannot describe a whole authored field. |
| `analysis/parse.ts`, `analysis/cache.ts` | `ParsedLuaChunk` already retains the significant tokens. The cache owns the source plus parse by path/source equality. Recovery stops lexical scanning at the first lexical error, while statement recovery can skip significant tokens. Neither is a full-fidelity error tree. |
| `semantic/model.ts`, `semantic/frontend.ts`; IDE diagnostics, workspace project and intellisense | Consume that shared parse and immutable binder facts. The intellisense engine also reads significant tokens directly. No new trivia allocations or token indices are imposed on these consumers in this slice. |
| `toolchain/ts/lua/compiler.ts`, `compiler/compile_value_flow.ts`, compiler `passes/{const_module_exports,expression_paths,module_shape,static_functions}.ts` | Consume the semantic AST, not an editor syntax tree. Compiler output and table evaluation order must stay unchanged. Source locations also serve diagnostics/debugging; they must not be repurposed as mutable punctuation metadata. |
| `scripts/rompacker/rombuilder.ts` | Direct lexer/parser for AST encoding and module closure. Adding editor metadata to the encoded AST would change the build representation; this slice does not do that. |
| `scripts/rompacker/cart_lua_linter_runtime.ts`, `scripts/lint/rules/lua_cart/`, `scripts/audit_core_parity.ts` | Significant-token and AST readers. They continue to consume the default scan. |
| `ide/runtime/source_registry.ts`, `ide/language/lua/interpreter/interpreter.ts` | Runtime-source/debugger metadata and host interpreter use parsed chunks. No guest/runtime syntax representation is added. |
| `ide/language/lua/formatter.ts` | Requests trivia from the lexer. Indentation uses only significant tokens; string/comment extents determine which line prefixes/suffixes are actual token content. |
| `ide/language/lua/source_edits.ts`, Scene Editor and Behavior Lens adapters | Keep their current AST-backed literal edits. No structural text scan, second model, runtime execution or scene-specific syntax token. |

No machine or C++ runtime representation changes. The edited paths run on
source analysis or an explicit Format Document command, not a guest worldtick,
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

## Structural-edit gate still open

Before adding a parser representation or Scene Editor add/remove/reorder:

- The parser must expose complete authored field bounds, enclosing braces,
  optional comma/semicolon separators and their attachment. Retokenizing an
  AST range cannot recover discarded parentheses or a bracket outside it.
- Trivia attachment belongs to the syntax owner. Initial/EOF trivia,
  same-line comments, standalone comment lines and blank lines require tests;
  a move must state what travels with the member versus stays with its list.
  Removal also needs an explicit keep-comment policy, not implicit deletion.
- A source-version-owned syntax result must be shared with semantic analysis
  rather than reparsing in each contribution. No duplicate token stream per
  scene, and no source syntax metadata in compiled/encoded AST output.
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

The lexical work below is independently useful to the shipped formatter. It
does not smuggle in a partial structural rewriter while these gates are open.

## Evidence

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
