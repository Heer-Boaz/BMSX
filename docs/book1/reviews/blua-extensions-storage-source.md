# Finite actual-source audit: storage subsection

Audited `/tmp/bmsx-blua-extensions-storage-prose.md` at HEAD `866396a64`. Read-only source review; no builds, compiler invocation, architecture document or PDF. Findings only; this is not a universal language/compiler proof.

## Unsupported unconditional result type for `string` access

Offending table cell, prose line 46:

> `string` | 4 | 4 | Image constant-pool reference, resolved to a String when read.

The constant-pool-reference representation is supported, but the unconditional promise of a String result is stronger than the actual typed-load datapath. A `string`-typed access loads a U32 index and performs generic `LOADKR`; neither TS nor C++ forces the selected constant to have a String tag. Compiler-produced `.rodata` string initializers do select string constants, but the type also exists in BSS and in explicitly annotated address views, where no initialized-string/provenance guarantee exists.

Exact source:

- `toolchain/ts/lua/compiler/struct_types.ts:55`: `string` has size 4, alignment 4 and `access: { kind: 'const_pool' }`.
- `toolchain/ts/lua/compiler.ts:5187-5189`: the string scalar load is `U32LE` followed by `LOADKR`.
- `machine/ts/machine/cpu/cpu.ts:2802-2809`: `LOADKR` calls `setRegisterConstantFast` with the numeric index; `cpu.ts:3524-3528` copies `image.constTags[constantIndex]` and `image.constScalars[constantIndex]`, not an enforced String tag.
- `machine/cpp/machine/cpu/cpu_dispatch.inl:719-721`: `LOADKR` directly returns `IMAGE.constPool[index]`, likewise without a String conversion/tag guarantee.
- `toolchain/ts/lua/compiler.ts:3788-3797`: it is the `.rodata` initializer producer that requires a compile-time string and places that string's constant index into storage.
- `toolchain/ts/lua/compiler.ts:3705-3707` and `toolchain/ts/lua/compiler/struct_types.ts:83-104,107-122`: BSS resolves/records the same primitive type without restricting `string` to initialized rodata; `compiler.ts:3996-4000` likewise admits it as a local view type.

## Scoped correction acceptance

Rechecked only `docs/book1/blua-programs.md:78,85-88` and the corresponding corrected fact table at `docs/book1/facts/blua-extensions-storage.md:37`. The table now says "reads the selected constant value"; the following paragraph correctly assigns the String-reference guarantee to the RODATA initializer and explicitly disclaims conversion by the view's `string` type name. These changes match the exact compiler/TS/C++ source paths cited above. The sole finding is resolved; no further finding in this correction delta. No build or wider re-audit performed.
