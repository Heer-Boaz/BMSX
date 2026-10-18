# Finite source review: source modules and complete-program explanation

## Scope and disposition

Read-only audit against the live parser, compiler/module passes, ROM builder/linker and the paired TS/C++ CPU owners. The fact sheet `/tmp/bmsx-language-modules-facts.md` was used as an index, not as authority. Read `AGENTS.md`; did not open `docs/architecture.md` or historical PDFs. No repository edits, new tests, builds, runtime execution or runtime corrections were made by this reviewer.

Reviewed the corrected `/tmp/bmsx-language-modules-prose.md`, `/tmp/bmsx-language-program-prose.md`, the corresponding current public sections of `docs/book1/blua-programs.md`, and all six actual source files under `carts/modules_manual/`. The public program's Observations text now says what the program prints; the earlier draft's claims of independent playback and 19 assertions are no longer public-prose claims. This review does not certify those runs or native execution.

**Disposition:** no remaining unsupported claim was found in the prioritized module contract or the concrete program's explained behavior after the two bounded wording corrections below. This is not a proof that the whole language, BIOS, compiler, optimizer, table implementation, runtime source loader or every lifecycle path is complete.

## Findings and changed-claim recheck

### 1. Distinguish ordinary global slots from a captured global environment — corrected

Original draft sentence: “The counter's operation uses its lexical global environment.” (`/tmp/bmsx-language-program-prose.md`, formerly line 100.)

This was too suggestive of a per-closure environment object. The applicable owners resolve lexical locals/upvalues separately and otherwise emit a named global-slot access: `toolchain/ts/lua/compiler.ts:2799–2828,2871–2886`; global/system slot classification is `compiler.ts:591–600`. The runtime instructions copy the selected global slot: TS `machine/ts/machine/cpu/cpu.ts:2351–2357`; C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:70–77`. The counter's captured `value` is a separate lexical upvalue; the function's global `modules_manual_step` is not the caller's local.

Rechecked replacement in both the draft and public program:

> The counter's operation reads the ordinary global `modules_manual_step`, not
> the calling block's same-named local. Changing that ordinary global affects
> the operation's next call.

This replacement is directly supported by those owners and `carts/modules_manual/lib/counter.lua:5–8`, `carts/modules_manual/entry.lua:15–38`. No runtime change is implied.

### 2. Do not infer lexical filtering of dependency discovery from built-in-call recognition — corrected

Original nearby draft sentences: “The built-in is recognized when `require` is an unshadowed identifier. A local binding with that name is an ordinary binding, not another way to access the built-in.” (`/tmp/bmsx-language-modules-prose.md:48`.) These sentences themselves are accurate, but did not state the different dependency boundary.

Executable recognition uses the bound reference and excludes lexical `require` at `toolchain/ts/lua/compiler.ts:2430–2435`. In contrast, dependency discovery checks only the syntactic identifier spelling, one string argument and no method receiver at `toolchain/ts/lua/compiler/module_graph.ts:17–31`. It does not query lexical binding. Dependencies are then followed transitively at `module_graph.ts:43–58` and by initializer scheduling at `compiler.ts:2387–2395`.

Rechecked the newly appended draft/public sentence:

> Dependency discovery scans literal import forms syntactically; do not use shadowing as a way to remove a module dependency.

This is accurate. It does not invent a new runtime behavior, nor claim that the dependency graph has perfect lexical-shadow filtering.

The previously reported uppercase const identifiers and ambiguity between generic ordinary settings and the actual const `lib/settings` were already corrected by the parent before this audit's final snapshot. They are not remaining findings.

## Priority contract checks

| Claim checked | Direct live owner and finite conclusion |
| --- | --- |
| Header placement and alternatives | `toolchain/ts/lua/syntax/parser.ts:182–198,246–264`: exactly one optional initial module attribute is parsed, entry/const flags derive from its one selected value, optional semicolon consumed. The public description matches. |
| Exactly one cartridge entry | `toolchain/ts/lua/entry_module.ts:16–31`; normal ROM caller `toolchain/ts/rompack/blua32_image_builder.ts:145`: absent/multiple entries error. General helper's explicit override exists at `entry_module.ts:11–14`, but the public text does not advertise it as a cartridge option. |
| Module naming and duplicate paths | `toolchain/ts/lua/module_path.ts:1–32` directly supports extension case-insensitivity, case preservation, slash conversion and listed prefix removal. `blua32_image_builder.ts:138–144,168–185` rejects admitted/generated conflicts. The description does not promise dotted-name or relative-directory search. |
| Executable and library inclusion | `blua32_image_builder.ts:203–222` selects entry, explicit preload and generated roots; `compiler/module_graph.ts:63–80` computes reachable source modules. Library closure uses the same collector in `scripts/rompacker/rombuilder.ts:516–542`. “Supplying source text alone” is correctly distinguished from executable inclusion. The dependency-discovery caveat is now explicit. |
| Literal require and missing modules | `compiler.ts:2398–2438`: exact/canonical supplied path, then installed contracts, otherwise compile error; executable built-in must have one literal argument and no receiver. There is no arbitrary runtime filesystem loading in this lowering. |
| Nested imports are eager dependencies | The syntax traversal visits function-expression bodies at `toolchain/ts/lua/syntax/calls.ts:150–152`; collector `module_graph.ts:17–31`; require lowering calls `markStaticModulePath` at `compiler.ts:5576–5588,5599–5616`. Nested written imports cannot be used to defer the ordinary initializer to a runtime call site. |
| Actual startup order | `compiler.ts:2375–2395` recursively records ordinary dependencies first, skips recognized const modules, deduplicates and rejects cycles. `compiler.ts:1568–1584` calls section init, scheduled module initializers, then entry. Public prose does not promise filename/asset/sibling ordering. |
| Nil/false export and completion | `compiler.ts:1614–1629` reads a dedicated initialized slot, calls initializer, then writes true only on successful return; `module_path.ts:38–39` names that separate slot. Export storage is independent at `compiler.ts:4382–4389,5613–5622`. Physical operations agree: TS `cpu.ts:2351–2357,2853–2857`; C++ `cpu_dispatch.inl:70–77,429–433`. Public lifetime limit to initialized state is appropriate. |
| Ordinary final export shape | `toolchain/ts/lua/semantic/module_bindings.ts:22–26` recognizes only the last top-level single-expression return; consumed at `compiler/passes/module_contract.ts:102–106`. `compiler.ts:4382–4389` requests/stores one value even for a factory call. `compiler.ts:5599–5605,5613–5622` produces default true or the retained root and nils extra requested positions. The early-return warning avoids inventing alternate-export semantics. |
| Ordinary table sharing/current field dispatch | Ordinary modules do not receive const member/static classifications at `module_contract.ts:109–122,139–141`. They store/load their runtime root at `compiler.ts:2837–2844,4382–4389,5613–5622`. Ordinary field selection loads from the runtime base at `compiler.ts:4791–4794`, and ordinary calls compile the current callee at `compiler.ts:5661–5672`. Paired field instructions: TS `cpu.ts:2410–2449`; C++ `cpu_dispatch.inl:105–121`. The field-replacement snippet is source-backed; this audit did not execute it. |
| Const namespace/static function distinction | `module_contract.ts:109–141`; `compiler.ts:6331–6337`: recognized const modules are compile-time export namespaces/static functions without ordinary runtime module protos. Scalar-only/empty unsupported shapes are not promised as public APIs. Alias handling is `compiler.ts:2588–2601,2671–2681,3895–3901,4010–4012`; runtime root/function-value errors are `compiler.ts:2685–2690,2741–2757,5594–5611`. Const locals are not described as freezing an ordinary table. |
| Const leaves and static bodies | `compiler/passes/const_module_exports.ts:30–111,124–159,163–185` supports listed literals, supported numeric folding, storage addresses and leaf rejection. `compiler.ts:5644–5645,6275–6280` forbids dynamic targets/runtime captures. Opcode owner `compiler/passes/static_proto_contract.ts:6–62` supports the restricted-operation list, including the explicit LOADKR already-interned rodata exception. The corrected prose preserves that exception. |
| Named BIOS imports | Exactly the three listed root paths occur in `toolchain/ts/rompack/system.ts:9–22`. Cartridge installation/conflicts: `compiler.ts:6216–6225`. BIOS export verification: `blua32_linker.ts:524–548`; direct function relocation: `blua32_linker.ts:660–673`. The prose correctly avoids treating asset IDs/fixed addresses as the API identity or exposing every BIOS source file as an import. |

## Complete program against actual owners

All six listings were compared with the actual `carts/modules_manual/` sources. The explanation fits the following finite source path:

1. `results.lua:3–28` owns the typed BSS record and exports its static address. `lib/settings.lua:1–3` supplies const `step = 3`; neither is an ordinary module constructor. BSS zeroing is emitted at `compiler.ts:1534–1554`, before ordinary constructors via `compiler.ts:1568–1571`.
2. Entry's ordinary imports select `lib/counter`, `lib/false_export`, `lib/nil_export` (`entry.lua:12–25`). `lib/false_export.lua:1` explicitly depends on nil-export. The scheduler puts this ordinary dependency before false-export; for the present traversal, the ordinary schedule is counter, nil-export, false-export. The prose wisely claims only the required dependency order and pre-entry initialization, not a general sibling ordering guarantee.
3. Constructor increments occur once in `lib/counter.lua:3`, `lib/false_export.lua:4`, `lib/nil_export.lua:3`, so entry's observations at `entry.lua:8–10` are `1,1,1`. False-export records the already-completed nil-export count at `lib/false_export.lua:5`.
4. Counter publishes one table containing one closure at `lib/counter.lua:5–10`. Repeated imports load the same retained root; current `value` is lexical captured state, whereas the step is a separately selected ordinary global. Closure/upvalue operations agree in TS `cpu.ts:2865–2894,3302–3404` and C++ `cpu_dispatch.inl:443–471`, `cpu.cpp:2907–2992`. `entry.lua:14` observes root identity; it is not a request for a new counter instance.
5. Arithmetic and the local/global distinction are exactly those printed: `10 + 3*2 = 16`; then `16 + 4*4 = 32`; inside the caller's block the local is 99, while the counter still reads ordinary global 4, giving 36; after assigning global 5, `36 + 2*5 = 46` (`entry.lua:15–38`, `lib/counter.lua:7`).
6. False/nil are explicitly published at `lib/false_export.lua:7` and `lib/nil_export.lua:5`; entry checks both retained values at `entry.lua:22–28`. Repeated imports do not execute those constructors at the import expression. The dedicated completion flag is source-established by the generated loader; the repeated-import program alone is not an independent test of loader re-entry/reset.
7. A newly registered ordinary global begins nil in TS `cpu.ts:1038–1044` and C++ `cpu.cpp:582–588`. Existing-name registration retains the slot, so the explicit fresh-boot qualification is important. The owned name occurs only in this cart among the reviewed cart/BIOS/library Lua sources. No BIOS global assignment is replaced by the program; the one authored ordinary global it assigns is `modules_manual_step`.
8. Five print calls are at `entry.lua:40–49`; tabs between arguments are explicitly emitted by BIOS `machine/bios/base.lua:265–274`. Therefore the public wording “the program prints” and the tab-separated expected lines are source-backed. This review does not independently re-run or attest actual diagnostic-output capture.

## Final reviewed content hashes

SHA-256 hashes at bounded changed-claim recheck:

```text
86ee7012b6be5f683b42f16ebce2ade7f856bc643fc5ba52f5bd49fba04b18fe  /tmp/bmsx-language-modules-prose.md
733b139a08756d83d713fd54dbacbe188c3b8186fc6d4399752097d28c8ff484  /tmp/bmsx-language-program-prose.md
5985bbb555afe5a6dd591fb11bb88c1fa597d45458a107ba78013c0c4ab294ad  docs/book1/blua-programs.md
1d55b06d2353592e24f720169cb3241f79e284bc56778fe8111d4fe621ecca8b  carts/modules_manual/entry.lua
01b22550030ccde5f57d1c5f87ccab8c02780190d5e757ad3325adc806e3550d  carts/modules_manual/results.lua
6419adb30de31b52facb3236e9c2f76de9e0473c75801c4c6bce0f57069c0079  carts/modules_manual/lib/settings.lua
d2e8e61b97043072875fc62ac0fa1ea412abc9d11d41adea4a999b74841cdadf  carts/modules_manual/lib/counter.lua
3d74fa9b23cb32b6a84506f8ace05cdf0106541002d3f986b38643b8da879599  carts/modules_manual/lib/false_export.lua
decacedea9e8608c1dfcb5df5d7b2cbf0a8dea3cddda2bc0fed9db1c93d89e6f  carts/modules_manual/lib/nil_export.lua
```

These hashes describe the reviewed snapshot, not later changes to an assembled chapter. No public citation to the index fact sheet is needed for the claims above: the cited executable owners are the authority.
