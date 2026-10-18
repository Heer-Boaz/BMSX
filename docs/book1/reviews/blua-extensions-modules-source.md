# Independent module-subsection actual-source check

Root audit of separately facts-only authored /tmp/bmsx-blua-extensions-modules-prose.md, against actual owners at866396a64. No architecture/PDF. The old general-source body is outside this delta check.

1. Table claim: "An ordinary module, with top-level code and a runtime export."
   Actual no-export require path: toolchain/ts/lua/compiler.ts:5599-5605 emits true for unshaped module; semantic/module_bindings.ts:22-27 recognizes only final top-level single-expression return. An ordinary module does not necessarily have a declared runtime export. Narrowed in integrated manuscript to final-export-declaration supplies export.
2. "scalar locals, branches, static calls, and static memory access."
   toolchain/ts/lua/compiler/passes/static_proto_contract.ts:62 permits memory loads/stores; it does not restrict addresses to compile-time constants. Narrowed in integrated manuscript to scalar memory access.

Actual-owner recheck of these integrated two edits: supported by the cited lines. No other unsupported claim found within bounded module subsection after exact live inspection: parser182-198,246-264,545-579; entry_module7-31 and ROMcallerimagebuilder134-146; module_contract96-150 and const_module_exports30-137; module_path1-32; compiler2398-2445,2466-2525,2664-2695,2375-2395,1561-1630,4372-4390,4629-4641,5576-5623,5644-5646,6251-6284; static_proto_contract6-63; init_participants23-115. Source-to-staticcall loading/captures and all other runtime/SDKbehavior not generalized. Initial factpack gaps are not invented into runtime APIs.
