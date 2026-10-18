# BIOS runtime-compilation API: actual-source check

2026-10-18, baseline5b264d38a. Root checked the independently facts-only authored
API fragment against actual current source bodies, not merely its fact packet.
Scope: installation/interface, mode/name/default sequencing, protected results,
reached/source-call distinction, binding precedence, retained dependencies and
incremental primitive cost. No runtime/compiler edit or new execution here.

## Finding and correction

Original: “The environment is retained as the supplied guest value, not copied
into a new set of globals.” This could imply that even an unused environment
always survives in the compiled closure. Actual constant preparation only adds
it for reached environment_key nodes: `compiler.lua:76-86`; the original program
object stores it at1881-1895, but closure ownership is the linked constant pool,
not that program object (`load.lua:27-38`, `linker.lua:25-35,70-72`).

Corrected: “Generated environment-name accesses retain the supplied guest value,
not a copied set of globals.” Narrower statement matches those bodies. No
unconditional unused-environment retention is now promised.

## Direct source scope and result

- `machine/bios/main.lua:4-12`, compiler/api.lua1-24, compiler/load.lua1-49:
  actual bindings, five/four arguments, tuple counts, no implicit execution,
  text-mode membership, defaults and direct/unprotected syntax alias.
- `machine/bios/compiler/semantic.lua:151-187,387-435` and
  compiler.lua8-12,76-97,367-372,407-442,950-1011,1881-1895: lexical/external/
  environment/global routing, exact retained accessors and live guest values.
- Paired CPU fixed calls: TS cpu.ts3272-3297; C++ cpu.cpp3017-3042.
  Protected boundaries/classification: TS1942-1969,4094-4131;
  C++2643-2659,2050-2074. No allfault/rollback guarantee is inferred.
- Paired String-codepoint readers: TS cpu.ts4320-4351; C++ cpu.cpp2176-2207.
  LEN: TS2672-2685; C++cpu_dispatch.inl319-330. Modefalse error uses current
  common reason text; Tablemode consumes maintainedlength, not Stringvalidator.
- Source-call metadata actual omission: toolchain/ts/lua/builtin_descriptors.ts36-37;
  minimum35-56 in semantic/call_signature.ts and recognized-call required-count
  check in semantic/diagnostics.ts357-375,395-415. No invented maximum.
- PCall cost: TS value.ts109-124 and cpu.ts3841-3845; C++ value.h63-75 and
  cpu.cpp1876-1880; both enum id10. Four incremental cycles, no totalduration.

Result: bounded API fragment PASS after one retention qualification. Accepted
API prose SHA-256: `f2d5a2a1a6b5b49880506c5aceada8dfede988b4f995915571b9a5860c2f6540`.
This does not approve grammar/factory/lifetime/programme/public reader/PDF,
close publication dependencies, or prove native/all-input behavior.
