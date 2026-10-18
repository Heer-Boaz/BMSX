# Runtime compilation: retained publication and source questions

2026-10-18, baseline `5b264d38a`. Current software is authority; no inferred
runtime/compiler/BIOS repair. These are separate from finite example results.

## RL01 — general unary string-id lowering

The parser accepts `&` followed by any unary operand:
`machine/bios/compiler/parser.lua:246-269`. Semantic binding folds the direct
String-literal case and otherwise binds the operand:
`machine/bios/compiler/semantic.lua:18-35,251-264`.
The dynamic unary opcode table contains negate/not/length only, while the
nonconstant emitter indexes that table:
`machine/bios/compiler/compiler.lua:33-37,869-883`.

The chapter describes the established literal construction and its unchanged
String value. General `&expr` successful lowering, a guaranteed public
rejection message, or a replacement encoding is not established. No dynamic
case is claimed executed and no compiler fix is included. Record the precise
parser/lowering hole rather than importing linked-compiler behavior.

## Common maintained Table-length dependency

Both runtime routes consume guest sequence lengths. Examples of actual reads:
`machine/bios/compiler/semantic.lua:86,246,309,316,377-379`,
`compiler.lua:65,649,1136,1644,1740-1741,1866-1873`,
`linker.lua:9-12,41`, and `syntax_factory.lua:122`.
The text parser also appends to fresh lists using their length:
`parser.lua:226,416,435,444,541,562`; the lexer retains String helpers and
`table.concat` (`lexer.lua:1-5`) and reads source length (`:288`).

Those are reached consumers of the existing common Table producer contract,
not a reproduction of the distinct fill/delete/refill mirror fixture. The
new ordinary program's monotonic lists and finite successful results do not
waive that producer question or establish differing compiler output. A String
source's initial length is codepoint length, not Table length; a supplied
Table mode consumes its maintained length (`load.lua:13`).

## Runtime-code reset lifecycle — bounded reference now supplied

The original lifetime packet did not establish boot/reset/module order. The
separate [reset packet](../facts/bios-loader-reset.md), facts-only subsection and
[actual-source follow-up](bios-loader-lifetime-source.md) now establish the
ordinary system BSS/module/entry order, consumed hardware SYSTEM-reset/reboot,
CPU-only restart and normal cartridge-entry distinctions. A fresh public-only
delta also passes. The earlier reset-reference publication gap is closed for
these explicitly bounded conditions, not by promising every reset clears RAM
or universally preserves/invalidates runtime closures.

All-caller replacement choreography, interrupted startup, cache reuse,
complete snapshot roundtrip and every device-reset memory side effect remain
outside this extracted scope. No guarantee about those is added to public
prose, and no runtime/compiler repair or execution experiment is inferred.

## Descriptive signature omission — not a reached-call limit

`toolchain/ts/lua/builtin_descriptors.ts:36-37` omits `external_scope` from the
source signatures. Actual API/load owners have five/four fixed parameters:
`machine/bios/compiler/api.lua:9`, `load.lua:27`.
The minimum-written-expression check is not a maximum argument check:
`toolchain/ts/lua/semantic/call_signature.ts:35-56`,
`semantic/diagnostics.ts:357-375,395-415`.

The genuine example compiles and invokes a five-argument call with a self-owned
binding descriptor and read/write callbacks. That proves this finite route,
not metadata completeness or all-source acceptance. Keep the discrepancy for
separate owning metadata work; do not silently trim the real signature or infer
an implementation repair from the documentation task.
