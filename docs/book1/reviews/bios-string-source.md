# BIOS String operations: independent bounded contract-source review

2026-10-18. Nonauthor review. Only this report was written; no chapter,
runtime, BIOS, compiler, publisher or example source was edited. Neither the
architecture document nor a historical/reference PDF was opened. No execution
or build commands were run by this reviewer.

## Scope and findings

Reviewed the opening and every API/reference section before **Complete
program: codepoints and mapped UTF-8**, including the inline examples, result
counts, conversion and error statements, accepted Table branches, captured
helpers, transitive globals, work descriptions and mapped-input cautions.
The added decoder-capture paragraph is included. The complete-program section
and its execution/artifact evidence belong to the separate program audit.

**No concrete false or unsupported sentence was found in this bounded
contract scope.** There is consequently no quoted failure or requested prose
rewrite. This is a factual-scope result, not publication approval, print/reader
acceptance, an exhaustive runtime audit or completion of the whole manual.

Chapter inspected: 628 lines, contract heading through line359; SHA256
`b5e1dd12a60dc47a8693ab95a0b92f8e0c21341720f2564e00f89f811dd97363`.

## Actual source boundary inspected

Factsheets were indexes, not source proof. Actual leaves inspected:

- Installation, shared String-index Table and captures: `machine/bios/main.lua:4-12,105-113,136-143`,
  `machine/bios/string.lua:1-22`, `machine/bios/string/base.lua:1-123`,
  `machine/bios/string/utf8.lua:1-58`, `machine/bios/table.lua:1-98`;
  TS CPU `cpu.ts:629-637,3684-3689`, native `cpu.cpp:1727-1732,3243-3257`.
- Primitive argument order, conversion, scalar validity, single results and
  traversal: TS `machine/ts/machine/cpu/cpu.ts:4320-4368`, native
  `machine/cpp/machine/cpu/cpu.cpp:2176-2223`, native central word conversion
  `value.h:199-229` and missing-argument view `:326-345`.
- LEN, numeric/non-Number arithmetic, floor division, comparison and ordinary
  concatenation: TS CPU `cpu.ts:2607-2657,2672-2685,2701-2736`,
  `value_slots.ts:128-131`, `value.ts:182-205`,
  `machine/ts/spec/blua32/numeric.ts:1-13`; native CPU
  `cpu_dispatch.inl:171-218,271-305,319-330,356-368`, `value.h:125-148`,
  `value.cpp:9-29`, `machine/cpp/spec/blua32/numeric.h:7-19`.
- Exact argument/length error Strings and protected original-error transfer:
  TS CPU `cpu.ts:496-505,1962-1966,4094-4131`; native
  `cpu.cpp:371-380,1980-1990,2654-2658`.
- Incremental two-cycle primitive charges: paired `spec/blua32/builtin`
  StringByte/StringChar IDs7/8; TS CPU `value.ts:109-122,cpu.ts:3841-3842`,
  native `value.h:63-73,cpu.cpp:1876-1877`.
- String value/codepoint construction, constant-index fields and literal
  escapes: paired CPU string pools and common UTF-8 counters/append leaves;
  `toolchain/ts/lua/compiler.ts:3788-3798,5181-5189`,
  `toolchain/ts/lua/syntax/lexer.ts:338-381`. Direct-call minima were checked
  against `builtin_descriptors.ts:93-108` and
  `semantic/diagnostics.ts:357-375,395-415`; the explicit-nil `sub` form is
  distinguished from the body default, not presented as a runtime validator.
- Typed mapped-byte read and machine-fault boundary:
  `toolchain/ts/lua/compiler.ts:5308-5318`; TS CPU
  `cpu.ts:2992-3009,3051-3084`, native `cpu_dispatch.inl:554-576`;
  TS Memory `memory.ts:442-451`, native `memory.cpp:332-341`.

The named public CPU, Memory, BIOS base, protected-call/coroutine, table-library
and SYSTEM crossreferences exist. Their connected representation, conversion,
length, storage, protected-error and mapped-fault sections were inspected;
their own publication dispositions are not changed by this review.

## Existing publication stop remains open

The common Table-length producer difference is still present in the actual
owners: TS `machine/ts/machine/cpu/table.ts:801-812,1426-1440` crosses the
array/hash boundary when updating length. Native SETT reaches
`machine/cpp/machine/cpu/cpu_dispatch.inl:152-161` and
`table.h:36-43,172-184`, whose refill scan stops at array capacity. The
different native integer path at `table.h:186-195` cannot close that difference.

The String chapter's accepted Table-dependent branches must retain that stop.
The current facts and review JSON do so: datapath/programming coverage remains
open independently of the bounded factual-scope pass. Naming captured L or
passing ordinary String examples does not establish a universal common
Table-length contract.
No owner repair is inferred or authorized by this review.

No contract section in the stated nine-API scope remains unreviewed. Pattern,
format, pack, arbitrary corrupt image strings, all pointer/word combinations,
exhaustive Unicode/resource/GC/optimizer behavior, complete-program acceptance
and the other open CPU/BIOS questions remain outside this bounded review.
