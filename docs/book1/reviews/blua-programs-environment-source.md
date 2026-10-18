# Installed program environment — independent source review

- Reviewed draft: `/tmp/bmsx-language-environment-prose.md`.
- Draft SHA-256: `f0cbb28f9fa38fc67ab95f004364bf9ebe30623b80a91dd81ab22c042b3df7f9`.
- Review date: 2026-10-18.
- Outcome: **one concrete scope overclaim** in the failure-result sentence at draft line 78. No other unsupported/mismatched sentence found in the finite installation/global-bank/dependency/lifecycle scope below.
- Read-only source audit. Only this `/tmp` review artifact was written. No implementation, repository edit, tests, builds, execution, git history, architecture document, reference PDFs, other chapter prose, or memory was used as technical authority. The facts sheet was only a source-location index. No `_ENV` lexical or uppercase source-identifier contract was inferred from installer absence.

## Finding 1 — failure tuple is the `load` wrapper contract, not the whole exported interface

Draft line 78:

> The installed runtime-compilation interface reports a failure as `nil` followed by an error value.

As written, this generalizes the failure-result contract to the installed runtime-compilation interface, which the draft itself inventories as `compile_syntax`, `syntax_factory`, and `load`. The source only establishes the tuple for the `load` wrapper. `compile_syntax` directly exports a throwing compilation path without that wrapper.

Exact paired source evidence (shared BIOS implementation, not two separate host implementations):

1. `machine/bios/compiler/api.lua:4–7` directly exports the underlying syntax compiler:

   ```lua
   local compiler_api<const> = {
       compile_syntax = load_compiler.compile_chunk,
       syntax_factory = require('compiler/syntax_factory'),
   }
   ```

   In contrast, `machine/bios/compiler/api.lua:9–21` puts only `compiler_api.load` behind protection and translates the failed protected result:

   ```lua
   function compiler_api.load(source, chunk_name, mode, environment, external_scope)
       local ok<const>, result<const> = vm_pcall(
           load_compiler.compile,
           source,
           chunk_name,
           mode,
           environment,
           external_scope
       )
       if ok then
           return result
       end
       return nil, result
   ```

2. `machine/bios/compiler/load.lua:27–37` directly invokes `compiler.compile` from `compile_chunk`, with no protected call or failure-tuple conversion:

   ```lua
   function load_compiler.compile_chunk(chunk, chunk_name, environment, external_scope)
       local function_address<const>, const_pool<const> = linker.link(
           compiler.compile(
               chunk,
               chunk_name,
               root_const_pool_register,
               environment,
               external_scope
           )
       )
       return create_root_closure(function_address, const_pool)
   ```

   That direct compiler has a concrete raised-failure path at `machine/bios/compiler/compiler.lua:1942–1945`:

   ```lua
   local proto<const> = compile_function(state)
   if proto.max_stack > max_stack then
       error('[load:' .. chunk_name .. '] function or expression needs too many registers')
   end
   ```

This finding does not audit all loader contracts or propose new failure semantics. It is solely the unsupported breadth of the quoted sentence; the wrapper's own `nil, error` behavior is supported.

## Actual inspected source scope

All ranges below were opened from current files, not accepted from the fact index alone.

### Installation, inventory, captured dependencies

- `machine/bios/main.lua:1–143`: base/library installation, initialization, normal cartridge handoff.
- `machine/bios/base.lua:1–30,190–296`: captured primitives/console, complete public installation, `assert`/`pairs`/`print`/`tonumber` dependency distinctions, bounded `_G`/`_ENV` installer absence.
- `machine/bios/table.lua:1–10,155–165`: own Table and return value.
- `machine/bios/string/base.lua:1–20`: captured module Table and `table.concat` value.
- `machine/bios/string.lua:1–22`: completed Table, registration, return.
- `machine/bios/coroutine.lua:1–40`: returned coroutine Table.
- `machine/bios/math.lua:345–379` and `machine/bios/os.lua:1–12,280–333`: Table/name inventories only; no full numeric, random, OS, or time contracts were audited.
- `machine/ts/spec/blua32/builtin.ts:1–70` paired with `machine/cpp/spec/blua32/builtin.h:1–81`: primitive identities/name installation inventories.

### Ordinary/system bank, arguments/results, shared registration, mutation

- `machine/ts/machine/cpu/cpu.ts:468–474,1009–1127,2155–2204,2344–2357,3622–3639`.
- Paired native owners: `machine/cpp/machine/cpu/cpu.h:552–558`; `machine/cpp/machine/cpu/cpu.cpp:555–643,716–759,1681–1688`; `machine/cpp/machine/cpu/cpu_dispatch.inl:60–77`; `machine/cpp/machine/cpu/value.h:326–345`.
- Checked String name requirement, one get result, absent-name nil, missing setter value nil, no setter results, creation/write including nil, ordinary versus system bank separation, shared same-name slots, new slot nil, GETGL/SETGL slot access rather than Table indexing, and public slot mutation.
- String registration/data-path separation: `machine/ts/machine/cpu/cpu.ts:619–646,3684–3689` paired with `machine/cpp/machine/cpu/cpu.cpp:1727–1732,3243–3257`.

### Fresh system boot route versus EXEC

- `machine/ts/machine/runtime/runtime.ts:48–91` paired with `machine/cpp/machine/runtime/runtime.cpp:76–116`.
- `machine/ts/machine/runtime/frame/loop.ts:152–158` paired with `machine/cpp/machine/runtime/frame/loop.cpp:47–52`: system-reset request dispatch.
- `machine/ts/machine/cpu/cpu.ts:869–927,1500–1547,2188–2195,2756–2771` paired with `machine/cpp/machine/cpu/cpu.cpp:431–482,716–728,1082–1119` and the native EXEC dispatch location in `machine/cpp/machine/cpu/cpu_dispatch.inl:414` (located by source search).
- Checked the named reboot/reset-for-system-boot clearing route and the distinct accepted EXEC path; no arbitrary reset, cartridge/card lifetime, private environment, or heap-reset behavior was inferred.

### Runtime compiler and shell boundary

- `machine/bios/compiler/api.lua:1–24`; `machine/bios/compiler/load.lua:1–49`; `machine/bios/compiler/compiler.lua:1881–1954` (last range only to establish the direct raised-failure counterexample).
- `machine/bios/shell/repl.lua:1–80`: separately created session Table and implicit-environment session loader wrapper.
- `toolchain/ts/rompack/blua32_image_builder.ts:1–15,200–262`: distinct cartridge/static linked-program build boundary, including `compileLuaChunkToProgram`/`encodeCompiledProgramObject`/`linkCartBlua32Image`. No cartridge source-spelling, module-order, or lexical lowering contract was audited here.

The draft contains no literal machine addresses, so there was no address literal to validate in the prose.

## Changed-claims recheck — revised draft

- Revised draft SHA-256: `64658cccfc56466e47cd1b2b488209f6eadc00f55165c1e5caed8a5e8a8d3c45`.
- Outcome: **Finding 1 is resolved; no concrete unsupported or mismatched sentence found in the changed claims.** This is a bounded recheck of the changed claims, not a new audit of every library contract.
- Draft line 78 now says: “The public `load` wrapper reports a protected compilation failure as `nil` followed by an error value.” It explicitly excludes the other `lua_compiler` entries from that conclusion. Reopened `machine/bios/compiler/api.lua:1–24` confirms the captured `vm_pcall` at line 2, the direct `compile_syntax` alias at line 5, protection specifically inside `compiler_api.load` at lines 9–17, and `return nil, result` at line 21. Reopened `machine/bios/compiler/load.lua:21–49` and `machine/bios/compiler/compiler.lua:1940–1946` confirm that the direct compile path still differs. The revised claim matches those owners.
- Draft line 13 now explicitly bounds the `_G`/`_ENV` paragraph to installation, not a source-identifier or loader-environment rule. Reopened complete public installer assignments at `machine/bios/base.lua:205–296` and the library installation at `machine/bios/main.lua:1–23`: neither installs those names as environment Tables. The new disclaimer makes no additional lexical claim, so this recheck neither infers nor audits one. The prior potentially misleading sentence that a program may define either source name has been removed.
- The new relative reference links target `bios-base.md`, `bios-table.md`, `bios-string.md`, and `coroutines.md`; all four destination files exist under `docs/book1/`. Only destination existence was checked. Their prose was not opened or used as technical authority.
- Checked the changed ENV17 and the explicit extraction correction in `docs/book1/facts/blua-programs-environment.md:35,46–48` against the actual loader/compiler ranges above. Their restriction to the `load` wrapper matches the source. The fact sheet was reviewed as the requested documentation change, not used as technical authority.
- No implementation, repository edits, tests, builds, execution, or expanded source-identifier/compiler contract audit was performed. Only this `/tmp` review artifact was appended.
