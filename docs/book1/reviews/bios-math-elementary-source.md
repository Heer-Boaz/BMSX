# Elementary Math and known-call prose: independent actual-source review

Result: finite source pass; no material unsupported or mismatching claim found.

Scope: all 207 lines of the current elementary-only `docs/book1/bios-math.md`
(12 functions and 4 constants), plus ONLY the new Known-call argument diagnostics
subsection of `docs/book1/blua-programs.md` (309-311). The two fact packets were
indexes, not substitutes for opening their executable owners.

Actual-owner evidence and boundaries:

- Installation, exports, retained truncation/infinity/tointeger versus public
  type/select/error: `machine/bios/main.lua:4-12`, `machine/bios/base.lua:3-11,205-216`,
  `machine/bios/math.lua:1-90,281-314,349-379`; identifier loads and dynamic calls:
  `toolchain/ts/lua/compiler.ts:2745-2828,5628-5690`.
- All scoped formulas, branch order, fixed/variadic signatures, result counts,
  special numeric values and nonnumber outcomes match those BIOS bodies plus
  paired datapaths: `machine/ts/spec/blua32/numeric.ts:1-13`,
  `machine/cpp/spec/blua32/numeric.h:7-19`, TS `cpu.ts:2551-2586,2659-2662,2701-2735,2812-2847,3546-3608`,
  C++ `cpu_dispatch.inl:171-213,308-312,341-384`, TS `value_slots.ts:128-130,181-185`,
  TS `value.ts:8-18,44-50,149-167`, C++ `value.h:95-148,481-494`.
- String-order scope is appropriately limited: actual TS `common/utf8.ts:36-55`
  and C++ `cpu_dispatch.inl:362-363,377-378` use distinct text substrates. No
  universal malformed/raw-byte string parity is asserted or approved.
- Missing fixed parameters, surplus retention and nil/result adjustment: TS
  `cpu.ts:3272-3296,3406-3438`, C++ `cpu.cpp:3017-3042,3127-3139`.
  Protected abs dispatch and success prefix: TS `cpu.ts:3865-3929,3979-4000,4053-4078`,
  C++ `cpu.cpp:1895-1930,1962-1972,2015-2034`.
- Variadic forwarding and suffix-before-adjustment support the bounded quadratic
  work claim: TS `cpu.ts:2896-2916,3841-3861,4286-4317`; C++
  `cpu_dispatch.inl:475-487`, `cpu.cpp:1876-1892,2152-2173`; selector conversion
  `value.h:199-229`. Budget bases/increments match TS `value.ts:109-123` and C++
  `value.h:63-74` with enum indices in both `spec/blua32/builtin` owners.
  Error keeps the supplied value: TS `cpu.ts:4370-4380`, C++ `cpu.cpp:2225-2228`.
- Written-expression minimum versus reached-call nil filling is supported by
  `toolchain/ts/lua/semantic/diagnostics.ts:328-415`, `call_signature.ts:25-56`,
  `builtin_descriptors.ts:66-94`, `frontend.ts:182-213`, and compiler rejection
  `compiler.ts:6181-6185`; cart invocation `rompack/blua32_image_builder.ts:213-224`.
- The distinct cartridge floor policy is supported by
  `scripts/lint/rules/lua_cart/forbidden_math_floor_pattern.ts:5-48`, its active
  use at `scripts/rompacker/cart_lua_linter_runtime.ts:110,354-368`, and the build
  phase at `scripts/rompacker/compile.ts:162-165`. Captured initial abs/floor logs
  and elementary ordinary-output log corroborate only those source boundaries.

Paths abbreviated above: TS/C++ cpu/value owners are under
`machine/ts/machine/cpu/` and `machine/cpp/machine/cpu/`; TS common is under
`machine/ts/common/`; semantic descriptor/frontend owners are under
`toolchain/ts/lua/` with semantic files under its `semantic/` directory.

Limits: no repo edits, builds, tests, or behavior execution. Current example
sources were not inspected. No architecture/PDF/foreign-Lua contract was used.
No actual scoped numeric branch-equation disagreement was found. This does not
close CPU7, Table, BZ01 or LS01, prove whole-Math performance, cover later trig/RNG
text, or grant whole-Math/publication approval.

Reviewed checkout: `0fca01fd4bd23a4b5029f05a45e21c855085110b` plus uncommitted docs.
Reviewed SHA-256:
- bios-math.md: `0b9b2d20c738163fcd3bc67ad89eb8e57e13abc839d6cbed62883a0ffe41e958`
- blua-programs.md: `d535beab24654665532c0f7ed63e2520c8b5c29067140b56c6d2d57e33f6997c`

## Narrow canonical SetGlobal addendum

Finite pass: changed `blua-programs.md:893,899` row/example and fact A06/A07
match descriptor `toolchain/ts/lua/builtin_descriptors.ts:34`, minimum counting
`semantic/call_signature.ts:35-56`, and `semantic/diagnostics.ts:357-374,395-415`.
Reached absent-value nil writing matches TS `cpu.ts:3631-3638`, C++
`cpu.cpp:1685-1688` and `value.h:343` (same owner prefixes as above).
Explicit nil meets this minimum only; no blanket source-acceptance claim found.
No inspected implementation-owner diff, edits, builds, tests, or execution.
Addendum blua-programs.md SHA-256: `e4cc1350a40b7a4d5c491efd84cb4bf6c64702f37557ad91b45d1b0ab3b65d69`.
