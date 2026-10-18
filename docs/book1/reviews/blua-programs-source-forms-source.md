# Cartridge source forms — independent actual-source review

Status: complete. Actual-source fact audit and full prose sentence/table/snippet comparison completed. One wording finding was corrected and rechecked; no material findings remain in the reviewed final artifact.

Checkout inspected: `fce16b952bbbe4c55f3fa076dacdb49275f69fef`.

## Method and boundaries

- Read the repository `AGENTS.md` and `/tmp/bmsx-language-source-forms-facts.md` as a finite index, then inspected the actual source ranges below. The fact sheet was not treated as independent evidence.
- No implementation, repository edits, builds, tests, runtime execution, `docs/architecture.md`, historical PDFs, or external-language specification were used.
- The source compiler is TypeScript tooling. No C++ source-compiler parity is asserted.
- The initial source/fact audit was completed before the prose artifact existed. The prose was reviewed only after the parent signaled that the complete file was present. Each claim/table/snippet was then compared with the actual owners, not merely with the fact sheet.

## Source/fact audit

No material mismatch found between the finite fact claims and the inspected actual owners. In particular, actual source confirms the important non-stock-Lua boundaries:

- Identifier scanning rejects uppercase ASCII anywhere, while hexadecimal numeric scanning accepts uppercase hexadecimal digits.
- The `*` binary-operator match is suppressed after trivia containing LF; grouping does not bypass this check. Other operators are not subject to that particular rule.
- Short strings reject literal LF, not all raw control characters; long strings skip one immediate initial CR/CRLF/LF and otherwise copy their content.
- `return;` does not parse as an expressionless return. Only `end`, `else`, `elseif`, `until`, and EOF terminate an expressionless return; current empty-return lowering emits one nil.
- Ordinary locals become active after initializer expressions, unlike local-function declarations and the exact one-name/one-value const-closure recursion special case.
- Assignment-target syntax and typed lowering restrictions are distinct. Supported augmented assignment is exactly `+= -= *= /= %= ^=` with one target and one expression.
- Colon access requires call arguments; colon method declaration inserts an implicit `self` before written parameters.
- Precedence and associativity follow the parser's actual recursive-descent chain, including right-associative `..` and `^`, leading unary minus below power, and a unary expression accepted to the right of power.
- Compiler label maps establish missing/duplicate-label checks but are not proof of stock Lua goto scope rules. `halt_until_irq` is a statement lowering directly to HALT, not a callable BIOS function.
- Source-form acceptance is not SDK quality-policy approval or runtime-semantic validation. No Table-length, CPU7, or BZ01 issue is closed.

## Actual inspected ranges

Paths are relative to `/home/boaz/BMSX`.

| Source owner | Inspected lines | Purpose |
| --- | --- | --- |
| `toolchain/ts/lua/syntax/lexer.ts` | 1–640 | Actual token dispatch, identifier predicates/rejection, decimal/hex tokens and exponents, quoted/long strings, every supported escape, comments, trivia, delimiter matching and LF tracking |
| `toolchain/ts/lua/syntax/token.ts` | 90–180 | Actual keyword resolver and keyword set |
| `toolchain/ts/lua/syntax/parser.ts` | 100–315 | Precedence token groups, real chunk entry, statement separators |
| `toolchain/ts/lua/syntax/parser.ts` | 380–1011 (545–603 reread separately after output truncation) | Statement routing; contextual declarations; local, const and local-function syntax; parameters; return; all control structures; assignment targets and augmented operators |
| `toolchain/ts/lua/syntax/parser.ts` | 1013–1606 | Recursive-descent precedence, newline-leading star rule, member/index/call chaining, colon argument requirement, literal/grouping forms, constructors, target admissibility, return terminators and trivia advancement |
| `toolchain/ts/lua/compiler.ts` | 90–112 | Direct compiler import of shared bound frontend |
| `toolchain/ts/lua/compiler.ts` | 1472–1505 | Implicit self, written parameters, body scope and function finalization |
| `toolchain/ts/lua/compiler.ts` | 2080–2135 | Scope removal, missing labels, reserved local/parameter names |
| `toolchain/ts/lua/compiler.ts` | 3638–3678 | Statement lowering, nested do scope, HALT |
| `toolchain/ts/lua/compiler.ts` | 3808–4030 | Ordinary local initializer-before-publication ordering, exact const-closure early binding, const-initializer requirement, nil initialization |
| `toolchain/ts/lua/compiler.ts` | 4075–4140 | Typed dereference assignment rejection, local/captured const write rejection, unresolved/reserved stores and table targets |
| `toolchain/ts/lua/compiler.ts` | 4197–4225 | Local/upvalue/global/table store lowering |
| `toolchain/ts/lua/compiler.ts` | 4368–4733 | Empty return lowering; if/while/repeat/for; iterator-state-control setup; goto/label/break checks; local and named function lowering; literal and constructor lowering |
| `toolchain/ts/lua/compiler.ts` | 5910–5968 | Source compiler construction/use of shared frontend and diagnostic consumption |
| `toolchain/ts/lua/compiler.ts` | 5986–6006 | Written/implicit parameter count and vararg prototype fields |
| `toolchain/ts/lua/compiler.ts` | 6148–6171 | Public source compiler entry |
| `toolchain/ts/lua/semantic/frontend.ts` | 150–175, 594–618 | Shared frontend construction and resolved lexical/global classification |
| `toolchain/ts/lua/semantic/model.ts` | 696–766 | Local initializer binding activation, exact const-closure exception and local-function binding |
| `toolchain/ts/lua/semantic/model.ts` | 1560–1585, 1764–1789 | Name writes creating globals only without a resolved binding |
| `toolchain/ts/lua/syntax/ast/index.ts` | 466–480 | Exact recursive const-closure predicate and call/vararg multi-result categorization |
| `toolchain/ts/lua/memory_access_syntax.ts` | 1–45 | Exact memory-map name classification |
| `toolchain/ts/lua/semantic/common.ts` | 1–38 | Exact reserved intrinsic names directly consumed by the compiler |

## Final prose review

Artifact: `/tmp/bmsx-language-source-forms-prose.md`, 473 lines, 18,267 bytes.

Final reviewed SHA-256: `624f1132774735e365dc5030fa7ab6123c85b12e83489f00b085d451757ea5b0`.

Initial full-pass SHA-256: `20ee4870151d066a65a1e243b01bd23f65c9721eb50c91064f8018a916013045`.

### Finding corrected during review

**SF-R01 — misleading non-local classification in named function prose.** Original line 222 said a function could be declared through a “non-local name”. Bare `function name(...) ... end` can instead write an already visible local/upvalue. This follows the actual binder (`semantic/model.ts:763–769,1570–1578`), target classifier (`compiler/target_semantics.ts:100–116`) and store lowering (`compiler.ts:4651–4662,2847–2874`). The parent replaced the sentence with:

> A named function declaration can also use `function name(...) ... end` or a dotted target:

The replacement was read and rechecked in the final hash above. It accurately names the source spelling without implying global-only binding. No fact-sheet correction was needed; F01 already listed the source forms without the non-local claim.

The parent also changed the generic-iteration and IRQ descriptive links. These remain boundary links, not new runtime claims in this prose. This review does not assert that the linked chapters resolve any open runtime issue.

### Complete claim/table/snippet coverage

The following coverage maps the complete prose, including each fenced snippet and each operator/escape/form table, to actual source inspection. “Matches” means static source-form or direct-lowering evidence only; it is not a claim of test, build, SDK lint or execution success.

| Prose lines | Concrete content checked | Actual source evidence | Result |
| --- | --- | --- | --- |
| 1–5 | Compiler source-form scope; grammar versus SDK policy; runtime/storage boundaries | `compiler.ts:5913–5965,6151–6165`; `parser.ts:182–199` | Matches; runtime semantics remain delegated |
| 7–30 | Lowercase ASCII identifiers, `_`/`$`/digit rules, identifier examples, exact keyword block, contextual spellings, reserved local/parameter names | `lexer.ts:263–285,602–629`; `token.ts:99–175`; `parser.ts:437–463,569–579,648–675,1331–1337`; `compiler.ts:2117–2123`; `memory_access_syntax.ts:3–19`; `semantic/common.ts:5–7,30–32` | Matches |
| 32–61 | Whitespace, all three comment snippets, matching-`=`/non-nesting/unterminated comments, semicolon snippet, newline-leading binary-star exception and grouping caveat | `lexer.ts:145–148,219–261,458–469,498–518`; `parser.ts:267–308,1107–1117,1345–1349,1585–1594` | Matches; no blanket newline-insignificance claim |
| 63–84 | Literal kinds, all decimal/hex table examples, decimal dot/exponent, hex digits/fraction/exponent, non-finite rejection, unary minus, unsupported literal families, no distinct word/address literal type | `lexer.ts:154,204–207,230–232,287–312,391–438,538–559,607–610`; `parser.ts:1063–1066,1318–1330`; `compiler.ts:4707–4719` | Matches; no malformed-suffix lexical-rejection overclaim |
| 86–121 | Quote examples, literal LF rejection, every escape-table row, exact hex/decimal lengths and limit, multiline `\z` example and whitespace set, unsupported escapes, decimal zero, encoding boundary | `lexer.ts:215–218,314–383,440–455,597–600` | Matches; no byte-encoding or all-control-character claim |
| 123–136 | Long-string snippets, matching delimiter level, one initial CR/CRLF/LF, subsequent literal copying, no escape translation, non-nesting and unterminated rejection | `lexer.ts:122–131,458–495,510–531` | Matches |
| 138–161 | Ordinary local snippets, nil initialization, per-name const snippets, initializer-position requirement, local/captured rebinding rejection versus member/index target category, unsupported attributes, pointer annotation order | `parser.ts:545–551,613–675`; `compiler.ts:3944–3952,3979–4019,4090–4135` | Matches; typed layout/storage and result adjustment remain delegated |
| 163–178 | Shadowing/initializer snippet and exact two early-bound recursion forms, not generalized to multi-name locals | `compiler.ts:3821–3943,3979–4019,4629–4636`; `semantic/model.ts:700–760`; `ast/index.ts:470–476` | Matches |
| 180–208 | Assignment snippet forms, lexical/global write distinction, unresolved-read caveat, target admissibility, typed dereference rejection, all six augmented rows, forbidden augmented/increment families, calls-only ordinary expression statements | `parser.ts:906–1009,1553–1563`; `lexer.ts:142–171`; `semantic/model.ts:1570–1579,1769–1782`; `compiler.ts:4081–4135,4207–4217` | Matches |
| 210–232 | Local function and dotted declaration snippets, corrected bare named spelling, longer dotted paths, no automatic table construction, no dotted/colon local-function target | `parser.ts:545–567,677–747`; `compiler.ts:4629–4675`; `compiler/target_semantics.ts:100–132`; `semantic/model.ts:763–769`; `compiler.ts:2847–2887` | Matches after SF-R01 correction |
| 234–254 | Colon declaration/call snippet, implicit first self, anonymous function snippet, parameter/vararg grammar | `parser.ts:690–746,1341–1342`; `compiler.ts:1486–1495,4657,5992–5999` | Matches; frames/captures/results remain delegated |
| 256–270 | Every call table row, long-string and table shorthand, method shorthand, suffix chaining, colon-without-arguments rejection | `parser.ts:1120–1188,1200–1205,1231–1315`; `lexer.ts:122–131` | Matches |
| 272–301 | Return-list snippets with and without semicolon, multiline return-expression snippet, exact expressionless-return terminators, rejected `return;`, empty-return function snippet, no zero-result inference | `parser.ts:749–769,1565–1570,1585–1594`; `compiler.ts:4372–4408` | Matches; current empty-return lowering is one nil, not falsely advertised as zero results |
| 303–330 | Grouping/result-count warning, index/dot/arrow form table, mixed table-constructor snippet, empty constructor, separators/trailing separator, no length/inherited-read specification | `parser.ts:1120–1138,1345–1349,1445–1499`; `compiler.ts:4723–4725`; `ast/index.ts:466–467` | Matches |
| 332–355 | Every precedence-table row, associativity, all unary spellings, BMSX-specific meanings boundary, power/unary grouping examples, no new numeric or Table-length semantics | `parser.ts:105–131,1013–1105`; `compiler.ts:5248–5277,5289–5322` | Matches |
| 357–371 | Conditional snippet, zero-or-more elseif / optional single else, branch scopes | `parser.ts:779–812`; `compiler.ts:4411–4441` | Matches |
| 373–393 | While/repeat snippets and grammar, placement of conditions, no repeat-body local-visibility assertion | `parser.ts:814–841`; `compiler.ts:4443–4484` | Matches |
| 395–424 | Numeric-loop snippets, optional/default step and pre-loop initialization, generic schematic snippet and variable list counts, iterator/state/control boundary | `parser.ts:843–891`; `compiler.ts:4486–4585` | Matches; no zero-step/mutated-index/arbitrary-host-iteration guarantee |
| 426–450 | Nested-scope snippet, break snippet, innermost-loop/outside-loop/semicolon rules, no continue keyword | `parser.ts:416–417,603–610,894–903`; `compiler.ts:3657–3664,4621–4627`; `token.ts:151–175` | Matches |
| 452–465 | Label/goto snippet, forward references, unresolved/duplicate function-map checks, explicit local-scope legality limitation | `parser.ts:582–600`; `compiler.ts:2093–2099,4588–4619` | Matches |
| 467–473 | Halt snippet and reserved statement/no call args/optional semicolon/direct HALT lowering, no IRQ behavioral claim | `token.ts:121–122`; `parser.ts:428–429,603–610`; `compiler.ts:3665–3667` | Matches |

Additional actual source ranges inspected while resolving the prose's function-binding wording and unary boundary:

- `toolchain/ts/lua/compiler/target_semantics.ts:85–132`.
- `toolchain/ts/lua/compiler.ts:2840–2905,5240–5330`.
- `toolchain/ts/lua/semantic/model.ts:763–807`.

### Final disposition and non-claims

No remaining material source-form mismatch was found in the final reviewed artifact. No examples were executed, compiled, linted, or packaged by this review. Snippets containing schematic names are source-form illustrations, not independently validated complete cartridges. The prose does not falsely close Table-length, CPU7, BZ01, String encoding, complete goto scope legality, repeat-body local visibility, vararg context legality, zero-step behavior, numeric-loop mutation, or complete quality-policy acceptance.
