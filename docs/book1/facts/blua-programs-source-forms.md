# Cartridge source forms — finite fact sheet

Scope: current cartridge-source lexer/parser and direct compiler lowering, inspected at `fce16b952bbbe4c55f3fa076dacdb49275f69fef`. This is author input, not public prose. No `docs/architecture.md`, reference PDF, stock-Lua specification, build or runtime was used. No repository edits. This sheet does not claim whole-language completeness, SDK quality-lint acceptance, execution results, or resolution of the existing Table-length, CPU7 or BZ01 questions.

## Ownership and evidence boundary

**O01.** The inspected source compiler is `toolchain/ts/lua/compiler.ts`; its parser/lexer are `toolchain/ts/lua/syntax/{parser,lexer}.ts`. There is no independently inspected C++ source compiler here. Syntax/compile rejection facts below therefore cite the actual compiler owner, not invented runtime parity. Lowered instruction execution and guest value behavior remain the CPU reference's paired-runtime subject.
- Sources: `toolchain/ts/lua/compiler.ts:6151–6165` (source compiler public entry); `toolchain/ts/lua/syntax/parser.ts:182–199`; `toolchain/ts/lua/syntax/lexer.ts:39–43`.

**O02.** For lexical binding facts only, the compiler directly constructs and consumes the shared bound frontend. The few binder ranges below are compiler dependencies, not IDE completion/hover/type-inference authority. No source form below is a promise that every SDK quality rule permits every syntactically legal program.
- Sources: `toolchain/ts/lua/compiler.ts:104–104,5916–5934,5937–5965`; `toolchain/ts/lua/semantic/frontend.ts:157–169,599–613`.

## Names, keywords, comments and separators

**L01.** A cartridge identifier starts with lowercase ASCII `a`–`z`, `_` or `$`; subsequent characters may additionally be decimal digits. Any uppercase ASCII letter anywhere in the scanned identifier is rejected. The underlying scanner's start/part predicates include uppercase, but `scanIdentifier` then explicitly rejects it. Non-ASCII letters are not in these predicates. Uppercase digits `A`–`F` inside a hexadecimal numeric token are not identifiers and remain accepted by the numeric scanner.
- Sources: `toolchain/ts/lua/syntax/lexer.ts:263–285,602–629`.

**L02.** Reserved keyword spellings are exactly: `and break do else elseif end false for function goto halt_until_irq if in local nil not or repeat return then true until while`. Do not present `const`, `entry`, `init`, `struct`, `bss`, `data`, `rodata`, `sizeof` or `offsetof` as members of this lexical keyword list: some are context-sensitive parser forms, handled separately.
- Source: `toolchain/ts/lua/syntax/token.ts:99–175`.

**L03.** Spaces, horizontal tabs, CR, vertical tabs and LF are recognized outside tokens. Do not claim every whitespace code point is accepted: form feed is in the `\z` whitespace predicate but not the main token switch. Significant-token parsing skips whitespace/newline/comment trivia.
- Sources: `toolchain/ts/lua/syntax/lexer.ts:219–238,597–600`; `toolchain/ts/lua/syntax/parser.ts:1585–1594`.

**L04.** `--` starts a line comment, ending before LF or at end of source. `--[[...]]`, `--[=[...]=]` and any matching number of `=` between brackets are long comments. The matching close delimiter ends the comment; an unmatched long comment is rejected. There is no nesting counter: a matching close delimiter is decisive even if another opener appears inside.
- Source: `toolchain/ts/lua/syntax/lexer.ts:145–148,242–261,458–469,498–518`.

**L05.** Statements do not generally require a semicolon; standalone semicolons in a block are ignored. Do not write that newlines are always insignificant: the parser deliberately stops treating `*` as a binary operator when that operator begins a new line, allowing a dereference statement to begin there. Keep a continuation arithmetic `*` on the existing expression line; grouping does not remove this explicit newline test. Do not invent an all-operator newline rule.
- Sources: `toolchain/ts/lua/syntax/parser.ts:267–308,1107–1117,1585–1594`.

**L06.** `mem`, `mem8`, `mem16le`, `mem32le`, `memf32le`, `memf64le`, `blua32` and `cop0` are not lexical keywords, but cannot be declared as locals or parameters. Memory maps and intrinsics are compiler-owned syntax rather than ordinary replaceable variables. Detailed mapped-access forms belong to Memory/CPU, not this sheet.
- Sources: `toolchain/ts/lua/compiler.ts:2117–2123`; `toolchain/ts/lua/memory_access_syntax.ts:3–19`; `toolchain/ts/lua/semantic/common.ts:5–7,30–32` (the exact constants directly imported by the compiler).

## Literal source forms

**N01.** Decimal numeric tokens start with digits, or with `.` followed by a digit. A decimal fractional dot following integer digits is included only when followed by a digit. Accepted spellings include `12`, `12.5`, `.5`, `1e3`, `1E-3`, `1.5e+2`. An `e`/`E` exponent optionally takes one sign and must contain decimal digits. A numeric token whose parsed value is not finite is rejected. Unary minus is a separate operator, not part of the numeric token. Do not advertise `1.` as a decimal literal or digit separators, binary/octal prefixes or numeric suffixes.
- Source: `toolchain/ts/lua/syntax/lexer.ts:154–154,204–207,230–232,287–312,391–404`; unary form `toolchain/ts/lua/syntax/parser.ts:1063–1066`.

**N02.** Hexadecimal numeric tokens start with `0x` or `0X`, use `0`–`9`, `a`–`f`, `A`–`F`, and may contain a fractional dot. At least one hexadecimal digit is required across the integer and fractional parts. Optional `p`/`P` introduces a binary exponent with optional sign followed by decimal digits; its multiplier is two raised to that exponent. Accepted examples include `0xff`, `0XFF`, `0x1.8`, `0x1.8p+2`, `0x.8p-1`. A non-finite parsed value is rejected. These are Number literals, not a distinct address/word literal class.
- Sources: `toolchain/ts/lua/syntax/lexer.ts:287–292,406–438,538–559,607–610`; `toolchain/ts/lua/compiler.ts:4707–4710`.

**S01.** Short String literals use matching `'` or `"`. The other quote may appear unescaped. A literal LF before the closing quote or end of source without the closing quote is rejected. Do not expand this to a claim that all raw control characters or raw CR are rejected: the explicit in-loop newline rejection tests LF only.
- Source: `toolchain/ts/lua/syntax/lexer.ts:215–218,314–336`.

**S02.** Supported short-string escapes: `\a` alert, `\b` backspace, `\f` form feed, `\n` LF, `\r` CR, `\t` horizontal tab, `\v` vertical tab, `\\` backslash, `\"` double quote, `\'` single quote. `\xHH` consumes exactly two hexadecimal digits. A decimal escape consumes one to three decimal digits and rejects values above 255. Any unsupported escape is rejected; do not advertise `\u{...}`, a backslash-newline continuation, or `\0` as a special escape distinct from decimal zero. Escape spellings here describe decoded source characters, not an assertion that every non-ASCII escape writes one byte into a byte-oriented ROM/String representation.
- Source: `toolchain/ts/lua/syntax/lexer.ts:338–383,446–455`.

**S03.** `\z` in a short String removes the following contiguous whitespace sequence: space, tab, CR, LF, vertical tab or form feed. It contributes no character itself.
- Source: `toolchain/ts/lua/syntax/lexer.ts:361–363,440–444,597–600`.

**S04.** Long String literals use `[[...]]`, `[=[...]=]` or the same general matching-`=` delimiter rule as long comments. A single initial CR, CRLF or LF immediately after the opening delimiter is skipped. Remaining source content is copied literally until the matching close delimiter: short-string escapes are not translated. Unterminated long strings are rejected. Do not assert normalization of every subsequent newline or nested delimiters; neither is implemented in this loop.
- Source: `toolchain/ts/lua/syntax/lexer.ts:122–131,458–495,510–531`.

**S05.** Primary literal expressions include `nil`, `true`, `false`, Number and String. Source parentheses group an expression; the parser returns the enclosed expression directly rather than retaining a special parenthesized-expression node. Do not import stock Lua's special parenthesized call-result truncation into this chapter. Exact Number/String value representation and operation semantics remain canonical CPU/Memory/String reference material.
- Sources: `toolchain/ts/lua/syntax/parser.ts:1318–1353`; `toolchain/ts/lua/compiler.ts:4707–4719`.

## Variables, assignments and functions

**D01.** Ordinary local declarations have `local name`, `local a, b`, or an initializer expression list such as `local a, b = expression, expression`. Each name can individually carry `<const>` immediately after the name, e.g. `local count<const> = 4` or `local left<const>, right<const> = 1, 2`. Local type annotation, where present, follows the attribute and is a typed-pointer form `:*type`; its full storage/type contract is Memory's subject.
- Source: `toolchain/ts/lua/syntax/parser.ts:545–551,613–645,648–675`.

**D02.** A `<const>` local requires an initializer position according to the compiler's expression-list rules. Ordinary uninitialized locals are emitted as nil. Later rebinding of a const local, including a captured const binding, is rejected. This is constness of the binding, not a promise of recursively immutable objects: member/index assignment is a different target category. `<close>` is explicitly unsupported; all other local attribute names are rejected.
- Sources: `toolchain/ts/lua/compiler.ts:3944–3952,3979–4019,4090–4135`; `toolchain/ts/lua/syntax/parser.ts:648–667`.

**D03.** Ordinary local initializers are compiled before the new locals are published. The shared binder used by the compiler activates ordinary local names after the declaration's expressions. Thus a preceding visible binding remains the initializer's binding in `local value = value`; do not teach an uninitialized newly declared local as that right-hand name. Two recursion-specific forms are separately bound before their function bodies: `local function name(...) ... end`, and a lone `local name<const> = function(...) ... end` with exactly one name, one value and the const attribute. Do not generalize that exception to every initializer or multi-name declaration.
- Sources: `toolchain/ts/lua/compiler.ts:3821–3841,3841–3943,3979–4019,4629–4636`; directly consumed binding owner `toolchain/ts/lua/semantic/model.ts:700–760`; syntax predicate `toolchain/ts/lua/syntax/ast/index.ts:470–476`.

**D04.** Assignment without `local` is `target, target = expression, expression`. For a bare name it updates its resolved visible binding; when no lexical binding exists, the compiler's binder declares a global for a write. This is not a separate `global` declaration keyword. Detailed global namespace/storage/lifetime policy stays in CPU/module material; do not infer that every identifier read is implicitly nil or that a misspelling is accepted. The compiler explicitly rejects unresolved reference stores.
- Sources: `toolchain/ts/lua/syntax/parser.ts:906–963`; compiler binding dependency `toolchain/ts/lua/semantic/model.ts:1570–1579,1769–1782`; lowering `toolchain/ts/lua/compiler.ts:4090–4127,4207–4217`.

**D05.** Assignable syntax comprises an identifier, named member, indexed expression, or unary dereference. A call or numeric expression is not an assignable target. Actual typed storage/dereference restrictions are additionally enforced during lowering; bare untyped dereference assignment is rejected. Ordinary expression-list assignment is not a statement form for an arbitrary expression: a non-assignment statement must be a call (or another dedicated statement form).
- Sources: `toolchain/ts/lua/syntax/parser.ts:906–925,965–967,1553–1563`; `toolchain/ts/lua/compiler.ts:4081–4087`.

**D06.** Augmented assignment source spellings are `+=`, `-=`, `*=`, `/=`, `%=`, `^=`. Exactly one target and one expression are required. Do not add `//=`, `&=`, `|=`, shift assignments, `..=`, `++` or `--` increment/decrement syntax. `--` starts a comment. Numerical meaning remains CPU's operator contract.
- Sources: `toolchain/ts/lua/syntax/parser.ts:927–952,977–1009`; `toolchain/ts/lua/syntax/lexer.ts:142–171`.

**F01.** Function forms: `local function name(parameters) block end`; `function name(parameters) block end`; `function namespace.name(parameters) block end` (further dotted path segments allowed); `function namespace:method(parameters) block end`; and the anonymous expression `function(parameters) block end`. Dotted/colon declaration forms store the closure in the named target; they do not construct a missing namespace table automatically. Local-function syntax has one bare name, not the dotted/colon path form.
- Sources: `toolchain/ts/lua/syntax/parser.ts:545–567,677–747,1341–1342`; `toolchain/ts/lua/compiler.ts:4629–4675`.

**F02.** A parameter list has comma-separated identifiers and optional final `...`; `...` may be the only parameter. Anything after the vararg parameter is rejected. A colon method declaration gains an implicit first `self` parameter before its written parameters. Detailed captures, frame state, argument adjustment, vararg results and call/return counts are canonical CPU material, not newly specified by this syntax sheet.
- Sources: `toolchain/ts/lua/syntax/parser.ts:716–746`; `toolchain/ts/lua/compiler.ts:1486–1495,4657–4657,5992–5999`.

**F03.** Call syntax includes `callee()`, `callee(expression, expression)`, `callee { fields }` and `callee 'string'` / `callee "string"` / a long String token. The last two shorthand forms supply one literal argument. Method calls use `receiver:method(arguments)` and corresponding table/String shorthand. A colon member followed by no call arguments is rejected; it is not a standalone colon property expression. Calls/index/member accesses may be chained by the parser. Method receiver and actual call semantics stay canonical CPU material.
- Source: `toolchain/ts/lua/syntax/parser.ts:1120–1151,1154–1188,1200–1205,1231–1300`.

**F04.** `return expression, expression` is the source expression-list form. An expressionless `return` is parsed only when the next significant token is `end`, `else`, `elseif`, `until` or end of source. Newline alone is not that terminator. A semicolon may follow a return expression list, but `return;` is NOT an accepted empty-return spelling in this parser: semicolon is not in `isReturnTerminator`. Do not promise zero results for empty return: current lowering explicitly emits one nil, and result-count details stay canonical CPU. Parentheses are not a new result-count operator (S05).
- Sources: `toolchain/ts/lua/syntax/parser.ts:749–769,1565–1570`; `toolchain/ts/lua/compiler.ts:4372–4408`.

## Expression syntax and precedence

**E01.** Binary precedence, from lowest to highest, is: `or`; `and`; comparisons `== ~= < <= > >=`; `|`; binary `~`; `&`; shifts `<< >>`; concatenation `..`; `+ -`; `* / // %`; unary forms; exponentiation `^`. Binary groups are left-associative except `..` and `^`, which recurse to the right. Exponentiation accepts a unary expression on its right and binds more tightly than a leading unary minus (`-2 ^ 2` parses as unary minus around the power, whereas `2 ^ -2` is accepted). This is grouping syntax only, not a new numerical/short-circuit specification.
- Source: `toolchain/ts/lua/syntax/parser.ts:105–131,1013–1105`.

**E02.** Unary syntax is `not`, `-`, `#`, `~`, unary `&` and unary `*`. `&` and `*` have compiler-specific string-id/address-view meanings and must not be presented as universal C address-of/dereference operators. Index/member syntax includes `base[index]`, `base.name`, and `base->name`; typed interpretations and direct memory forms must use the Memory reference rather than invent an ordinary-Lua explanation. Do not use the `#` spelling as justification to restate the still-open Table stored-length producer contract.
- Sources: `toolchain/ts/lua/syntax/parser.ts:1053–1083,1120–1138`; detailed semantics intentionally not extracted here.

**E03.** Table constructor field syntax allows `{}`, list-value fields, `name = value`, and `[expression] = value`, mixed in the same constructor. Fields are separated by commas or semicolons and may have one trailing separator. These are source forms only; no Table stored-length or inherited-read semantics are added by this fact.
- Source: `toolchain/ts/lua/syntax/parser.ts:1445–1499`; direct lowering route `toolchain/ts/lua/compiler.ts:4723–4725`.

## Control-structure source forms and compile rejections

**C01.** Conditional source form: `if expression then block { elseif expression then block } [ else block ] end`. Each branch is a distinct compiled lexical scope. While syntax: `while expression do block end`. Repeat syntax: `repeat block until expression`. Detailed truth/condition evaluation belongs to CPU, not host-language boolean assumptions.
- Sources: `toolchain/ts/lua/syntax/parser.ts:779–841`; `toolchain/ts/lua/compiler.ts:4411–4484`.

**C02.** Numeric loop syntax: `for name = start, limit [, step] do block end`. Generic loop syntax: `for name [, name ...] in expression [, expression ...] do block end`. The numeric compiler initializes the start, limit and step before the loop and loads step 1 when omitted. The generic form is implemented as the iterator/state/control protocol, not a direct declaration of arbitrary host iteration. Runtime termination/arithmetic/results stay canonical CPU/BIOS iteration material; no new guarantee about zero step or modifying the loop variable is made here.
- Sources: `toolchain/ts/lua/syntax/parser.ts:843–891`; `toolchain/ts/lua/compiler.ts:4486–4585`.

**C03.** `do block end` creates a compiled nested scope. `break` has no argument, exits the innermost current loop via that loop's pending break jump, and is rejected outside a loop. A following semicolon is optional for the break statement. There is no lexical keyword `continue`; do not invent a continue statement.
- Sources: `toolchain/ts/lua/syntax/parser.ts:416–417,603–610,894–903`; `toolchain/ts/lua/compiler.ts:3657–3664,4621–4627`; keyword inventory `toolchain/ts/lua/syntax/token.ts:151–175`.

**C04.** Label syntax is `::name::`; branch syntax is `goto name`. Forward references are patched once a matching label is compiled; unresolved labels at function finalization are rejected, as are duplicate label names within the same compiler function label map. Do not import stock Lua's exact restrictions on jumping into/out of local scopes: this finite inspection proves the label-map checks, not an exhaustive scope-legality specification.
- Sources: `toolchain/ts/lua/syntax/parser.ts:582–600`; `toolchain/ts/lua/compiler.ts:2093–2099,4588–4619`.

**C05.** `halt_until_irq` is a reserved statement, without parentheses or arguments, with optional following semicolon. It lowers directly to HALT. This fact does not define interrupt enable, mask, pending, wakeup or synchronous exception behavior; link CPU/IRQ for those contracts. It is not a BIOS function call.
- Sources: `toolchain/ts/lua/syntax/token.ts:121–122`; `toolchain/ts/lua/syntax/parser.ts:428–429,603–610`; `toolchain/ts/lua/compiler.ts:3665–3667`.

## Boundaries for the chapter author

- Module headers `<const>` / `<entry>`, `require`, exports, module initialization, `<init>` function attribute and entry lifecycle are assigned to the separate module facts task. This sheet notes only that `local function name<init>(...)` has a context-specific parser slot; do not explain lifecycle from this source-only syntax observation. Parser owner: `toolchain/ts/lua/syntax/parser.ts:553–579`.
- Static `struct`, `bss`, `data`, `rodata`, typed pointers, `sizeof`, `offsetof`, memory maps and address-size/access contracts belong to `docs/book1/memory.md`, particularly “Typed byte storage and address views” and “Memory transfers”. Source syntax is routed in parser `437–463,465–542,669–675,1331–1337,1356–1386,1429–1442` but this task has NOT re-audited their full type/layout lowering.
- Numerical/value representation, overflow/rounding, truth, equality/ordering, String byte/codepoint representation, captured-variable lifecycle, complete call/return adjustment and runtime faults belong to `docs/book1/cpu.md` / Memory / existing BIOS chapters. Syntax acceptance is not a proof of those semantics.
- In particular do not claim standard Lua semantics by analogy for parentheses, empty return, Table `#`, globals, pointer syntax, power or varargs. The source facts above intentionally distinguish grammar from runtime contracts.

## Precise remaining gaps (not falsely closed)

1. No exhaustive grammar proof for every token adjacency or malformed suffix. Avoid claims that an unsupported numeric spelling always causes the lexer itself to fail: some spellings split into multiple tokens and fail later, depending on context.
2. No complete String encoding/ROM interning proof. `\xHH`/decimal escapes above are lexer character results; their ultimate UTF-8/byte representation must use existing paired-owner String/CPU evidence.
3. No new runtime-only syntax legality assertion for `...` outside a vararg function, unusual goto scope crossings, repeat-body locals in the until expression, mutating numeric loop variables, or zero step. The inspected compiler paths do not by themselves establish a complete intended contract.
4. No full reserved identifier catalogue for every BIOS name/project quality rule. L06 is the finite direct compiler prohibition on local/parameter names, not all SDK policy.
5. No claim that the chapter's eventual examples compile, satisfy SDK quality lint or execute. They still need their own real cartridge route and checks.
6. Existing Table-length, CPU7 and BZ01 questions remain OPEN; neither a source-form explanation nor a passing example resolves them.
