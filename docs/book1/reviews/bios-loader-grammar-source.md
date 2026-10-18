# Runtime-loaded source grammar: bounded source review

PASS: no factual failure found in the finite claims of `/tmp/bmsx-bios-loader-grammar-prose.md` (192 lines).

Reviewed draft SHA-256: `357b27b8a8d47f2bc587ae74478a9100b1a377a5d843571b40dcc3a72e0d3f63`.
Checkout HEAD at review: `5b264d38a8d7923a225537832ac175ba50cd07fa`.

## Actual source inspected

- `machine/bios/compiler/token.lua:1-139`: tokens, keywords, punctuation, diagnostic token names.
- `machine/bios/compiler/lexer.lua:1-374`: names, whitespace/comments, numeric scanning, quoted strings/escapes, source positions, diagnostics.
- `machine/bios/compiler/parser.lua:1-599`: primaries, suffixes, call parenthesization, unary/binary operators and precedence/associativity, statement/block/local/function/return grammar, chunk entry.
- `machine/bios/compiler/semantic.lua:1-438`: local scope, parameter duplication, captures, name resolution, external entries, path roots, literal String-ID folding, assignment/const rules, initializer scope, loops/break, final return, synthetic root function.
- `machine/bios/compiler/compiler.lua:1-94,98-168,390-455,560-710,815-922,925-1020,1080-1185,1390-1495,1600-1717,1738-1752,1865-1954`: operator maps, constant emission, global/environment access, calls and argument evaluation/result expansion, local initialization, returns/fallthrough, loop initializers/default step, statement emission, closure emission, compile/bind order, register-limit diagnostic.
- `machine/bios/compiler/load.lua:1-49`: parse then compile/link and return the root closure, without invoking the loaded block.
- `machine/bios/base.lua:40-262`: numeric-literal conversion owner, including decimal/exponent and hexadecimal conversion. No added numeric range/rounding guarantee.
- `machine/bios/string/base.lua:1-123`: source substring/index handling used by the lexer.
- `machine/ts/machine/cpu/cpu.ts:2672-2685,4320-4351`; `machine/cpp/machine/cpu/cpu.cpp:2176-2207`; `machine/cpp/machine/cpu/cpu_dispatch.inl:319-331`; `machine/ts/machine/cpu/string_pool.ts:54-60,124-126`; `machine/cpp/machine/cpu/string_pool.cpp:68-74,138-143`: paired source-index and String-length codepoint ownership.
- `toolchain/ts/lua/syntax/parser.ts:182-198,246-264,393-580,593-674,677-742,790-902,906-1005,1318-1353,1429-1460`: finite linked-parser contrasts for module directives, declarations/type references, locals/functions/attributes, control statements, assignment lists, varargs and table constructors.

Facts files were used as source-location indexes, not as replacement evidence. Neither `docs/architecture.md` nor historical PDFs were opened.

## Limits

This is source-reference accuracy for the reviewed finite prose, not an all-input compiler, optimizer, numerical-loop, performance, or full linked-compiler acceptance proof. No builds or tests ran and no repository files were edited.

The unary String-ID claim remains limited to literal `&"text"` / `&'text'` (including parenthesized literals). `semantic.lua:18-35,251-264` preserves the literal String value; `compiler.lua:61-70,151-167,919-922,1699-1715` carries it as a pool constant. General dynamic unary `&` remains an unresolved parser/lowering gap: `parser.lua:246-269` parses it, but `compiler.lua:33-37` has no corresponding unary opcode mapping for the generic emission at `869-883`. This review does not invent successful dynamic support, an exact rejection diagnostic, or a numeric pointer result for the literal form.
