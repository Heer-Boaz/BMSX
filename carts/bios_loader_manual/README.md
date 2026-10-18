# BIOS runtime compilation ordinary cartridge

This complete BLua program calls the installed `load`,
`lua_compiler.compile_syntax` and `lua_compiler.syntax_factory`. It uses real
source Strings, guest environment/binding Tables and exported syntax factories;
it does not hand-encode syntax tags, instructions or closure records. See the
[BIOS runtime-compilation chapter](../../docs/book1/bios-loader.md).

```text
carts/bios_loader_manual/
  entry.lua
  results.lua
  res/manifest/manifest.rommanifest
tests/carts/bios_loader_manual/
  bios_loader_manual_assert.lua
  ordinary_timeline.json
```

The complete manifest is:

```yaml
title: BIOS Loader Manual
hardware:
    - type: rom
```

`results.lua` is an ordinary module: typed numeric BSS holds counts/results;
its exported mutable observations Table retains closures, environments and
error values as actual guest values. Do not add `module<const>` to that module.
`entry.lua` has one `module<entry>`, prints observations, sets `completed`,
then parks. All assertions belong to the separate integration suite.

## Build and inspect

From the repository root after the prerequisites in
[getting started](../../docs/programming/getting-started.md):

```sh
npm run build:product:node-headless-tooling -- --debug
npm run validate:toolchain:cart -- bios_loader_manual --debug
npm run headless:test -- bios_loader_manual tests/carts/bios_loader_manual/bios_loader_manual_assert.lua
```

Expect `[test] runtime_compilation: passed`. The single case waits for completion
and makes 38 retained assertions. It uses a fresh derived TS integration image,
not byte-identical ordinary playback; linked addresses can differ. Normal
compiler and quality checks remain enabled, and the builder selects its BIOS.

For separate ordinary execution:

```sh
npm run headless:tooling -- --debug --input-timeline tests/carts/bios_loader_manual/ordinary_timeline.json bios_loader_manual
```

The timeline's zero-based presentation offset 8 is an endpoint, not an output
assertion or a compilation/startup/frame/cycle guarantee. Compare all 13
`Load ...` diagnostics and successful timeline completion.

## Ordinary observations

The following block is the checked ordinary execution, with raw tab separators:

```text
Load environment	0	3	8	8
Load external scope	12	14	14	1000
Load globals	7	9	9
Load child	15	25
Load modes	42	nil	attempt to load a text chunk (mode is 'b')
Load false mode	nil	Attempted to get length of an unsupported value.
Load false environment	nil	false	Attempted to index field on a non-table value.
Load source error	nil	[load:manual.invalid] unexpected character at 1:8
Load nil results	1	nil	1	nil
Load result expansion	3	1	3	nil	9
Load syntax factory	42
Load generated symbol	7
Load syntax error	false	[load:manual.invalid_syntax] break outside loop at 1:1
```

Compilation leaves `total` at zero until the closure is invoked. Both calls
use the same environment, including the later `step` update. The fifth-argument
scope owns its descriptor and accessors: its binding reaches 14 while the
same-spelling environment entry remains 1000; `step` resolves through the
environment. This is a self-owned callback binding, not a fabricated frame
location. The global case owns one cartridge-named global and does not rebind
BIOS functions.

The escaping child continues to read the same environment. No forced collection,
code-block reuse or reclamation deadline is tested. A mode String containing
lowercase `t` is accepted even when it is not a conventional mode name. A false
mode fails during length, whereas a false environment compiles and fails only
when the generated indexing is invoked. Source failure is returned by `load`;
direct syntax failure is caught by an explicit `pcall`.

Bare return and fallthrough each return one nil. The last unparenthesized call
expands three results, including the middle nil; parentheses request one result.
Factory examples use a fresh syntax occurrence at every use and share only the
generated-symbol key. They compile to 42 and 7 without manual ABI encoders.

These are finite TS executions, not native parity, all-input/grammar/optimizer
acceptance, collection/exhaustion/cache-reuse validation, performance, reset/
persistence, SDK-installation or whole-console acceptance. General dynamic unary
`&` lowering and the common Table-length publication dependency remain separate
open questions. No runtime/compiler/BIOS or quality-policy change is inferred.
