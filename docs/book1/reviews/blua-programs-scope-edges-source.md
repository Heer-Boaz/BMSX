# Independent finite actual-source review: scope edges and init boundary

Reviewed checkout: `master`, `e43ee94f19d73aa4564f620e42ddbaa2c306a52f`, 2026-10-18. Read `AGENTS.md`. The two `/tmp` fact extractions were used only as owner indexes; the conclusions below were checked against actual source. No architecture document, historical PDF, public chapter, or public review was opened. No build, test, guest execution, implementation repair, or repository edit was performed. This file is the review artifact, not native-execution or optimizer-wide approval.

## Findings

1. **Scope-edge candidate: no unsupported factual sentence found within the stated direct grammar/binder/lowering and paired-opcode source boundary.** The candidate does not turn goto acceptance into an initialization/lifetime guarantee. The last sentence's required-initialization caution agrees with the actual jump-only owner. This is not a proof of all value-flow/compiler transforms for arbitrary goto graphs.
2. **Private LS01 record: actual directly connected owners disagree; this remains OPEN.** Binder acceptance must not be published as a working body-local value guarantee. The supplied source and captured logs support this one finite debug `-O3`, ordinary TypeScript playback observation. They do not approve the observed global read as an intended language rule, establish native execution, or justify a compiler repair in this manual slice.
3. **Resolved LS01 historical-provenance finding:** the earlier draft's initial uncommitted quality-rule failure/correction history was not corroborated by the two supplied logs. Root removed it. The final record now states only the supported current source, successful build artifact, and captured ordinary-playback observation; no unsupported historical-attempt claim remains.
4. **Withdrawn preliminary finding:** my first, depth-limited file inventory missed the supplied manifest. The actual manifest is `carts/repeat_scope_probe/res/manifest/manifest.rommanifest:1-3`, using the repository's `.rommanifest` representation. The private record's supplied-manifest statement is supported. No missing-manifest finding remains.
5. **Final init candidate: no unsupported factual sentence found.** The placement, ordinary lexical declaration, normal-startup statements and added non-entry scheduled-module restriction match actual source. The addition correctly says scheduled-module set rather than falsely making literal require the only possible schedule root. The scheduled-set link target itself is outside this review's public-chapter exclusion.

## Scope-edge sentence-by-sentence recheck

Candidate: `/tmp/bmsx-language-scope-edges-prose.md`.

| Candidate line / sentence | Actual source inspected | Result |
| --- | --- | --- |
| 5: `...` reads the current call's arguments; nested calls do not inherit enclosing varargs | `machine/ts/machine/cpu/cpu.ts:2896-2916,3232-3236,3275-3278`; `machine/cpp/machine/cpu/cpu.cpp:3017-3021,3094-3098`; `machine/cpp/machine/cpu/cpu_dispatch.inl:475-487` | Supported: opcode reads the current frame's vararg base/count. No enclosing-frame search occurs. |
| 7: current software accepts the expression without a written vararg parameter, including entry | `toolchain/ts/lua/syntax/parser.ts:716-746,1318-1342`; `toolchain/ts/lua/semantic/model.ts:1191-1199`; `toolchain/ts/lua/semantic/diagnostics.ts:124-137`; `toolchain/ts/lua/compiler/compile_value_flow.ts:298-303`; `toolchain/ts/lua/compiler.ts:4699-4707,4749-4751,5913-5965,6181-6185` | Supported as no rejection for this named expression/context on these owners, assuming no independent error. This is not a statement that every possible surrounding source passes the SDK's quality rules. |
| 7: bare `...` is not thereby a statement | `parser.ts:400-433,906-924,965-966` | Supported: ordinary statement parsing requires assignment or a call expression, not a standalone vararg expression. |
| 7: non-vararg functions and entry have zero available varargs, despite extra supplied arguments | `compiler.ts:5979-6000,6301-6327`; `toolchain/ts/rompack/blua32_linker.ts:903-909`; paired frame-entry ranges above | Supported: parameter-list flag is recorded separately from expression lowering; absent flag forces frame vararg count to zero. `diagnostics.ts:395-400` checks minimum arity, not an upper argument limit. |
| 9: zero available values differs from one nil; open form supplies zero; fixed form nil-fills, including one position | `compiler.ts:4379-4394,4749-4751,5754-5764`; paired VARARG owners above | Supported for emitted VARARG: B=0 sets top to A with count zero; B>0 fills each missing requested position with nil. The CPU chapter link is a cross-reference supplied by root, not a chapter audited here. |
| 15: function-wide label names; forward/backward and cross-block targets | `parser.ts:582-600`; `semantic/model.ts:1047-1055`; `compiler.ts:1258-1259,2075-2086,4588-4619` | Supported: maps are builder-owned, keyed only by spelling; lexical push/pop does not add/remove label namespaces. |
| 15: separate nested functions/chunks cannot satisfy each other's labels | `compiler.ts:5979-5986,6301-6313,6340-6350`; `compiler.ts:1343-1352,1486-1502,2093-2099` | Supported: every such builder has independent maps and resolves pending names when finalizing its own body. |
| 17: same-function duplicate diagnostic, cross-block duplicate, missing diagnostic, separate-function independence | `compiler.ts:2093-2099,4588-4619`; builder ranges above | Supported, including exact diagnostic strings. |
| 19: no local-declaration/block-crossing rejection; target and encoding checks remain | `parser.ts:582-600`; `semantic/model.ts:1047-1055`; `semantic/diagnostics.ts:124-137`; `compile_value_flow.ts:888-896`; `compiler.ts:1859-1878,2093-2099,4588-4619` | Supported: direct checks do not compare lexical local sets, scope depth, or initialization. Encoding checks concern patched signed displacement. |
| 21: acceptance inserts no initialization, cleanup, or capture-close operation | `compiler.ts:2075-2086,3111-3130,4588-4619`; `cpu.ts:2849-2852`; `cpu_dispatch.inl:424-427` | Supported: goto emits/patches JMP only; scope pop deletes compiler bindings but emits no such instruction; runtime JMP changes pc. |
| 21: forward can skip initializers; backward resumes earlier target; no blanket fresh-nil/recreated-local guarantee | Same goto/JMP owners, plus `compiler.ts:3622-3682,4411-4462` | Supported as a statement about the jump itself. Ordinary reached instructions may execute again; the source does not confer block-entry initialization on a jump or define every skipped register's value. |
| 21: keep required initialization on executed path; jump is not a block-entry initialization operation | Same direct lowering/JMP owners | Supported operational caution, not an optimizer-equivalence guarantee. |

Additional exact-owner searches checked all label-map references in `compiler.ts` and vararg/goto references in the diagnostics owner. `compile_value_flow.ts:535-537,682-684,894-896` does not add source goto-scope rejection. `compileIf` and `compileWhile` iterate their bodies in lowering (`compiler.ts:4411-4462`), including labels within ordinary lexical bodies. No broad optimizer certification follows from these reads.

## Private LS01 source-disagreement and observation check

Inspected the initial private LS01 record and re-read final `docs/book1/facts/blua-programs-repeat-scope.md:1-96`, the actual complete probe and manifest, README, timeline, and both captured logs.

- Parser shape: `parser.ts:829-840` places body and condition under one repeat statement.
- Actual consumed binder: `semantic/model.ts:703-745,921-930,1570-1596,2071-2082` activates the direct body local and visits the condition before leaving the loop scope. `semantic/frontend.ts:599-613,657-668` classifies the recorded condition reference as lexical within the recorded repeat scope. `semantic/diagnostics.ts:246-270` does not reject this bound name as undefined.
- Actual compiler: `compiler.ts:4465-4484` pops the body scope before lowering the condition; `compiler.ts:2082-2086` deletes those body-local binding IDs. `compiler/bound_reference.ts:18-36` preserves the lexical declaration ID. `compiler.ts:2217-2223,2241-2265,2268-2285,2299-2328` does not substitute an outer same-spelling local for the deleted ID.
- Reached bare-name route: `compiler.ts:3299-3312,5445-5453,5521-5523,4720-4722,2745-2828` cannot use the deleted body's const/current-local/upvalue binding; the lexical reference is not the `unresolved` rejection case, so the tail resolves by name and emits GETGL/GETSYS. `compiler.ts:591-600,768-776` owns that slot selection/allocation.
- Paired load execution: `cpu.ts:2344-2354` and `cpu_dispatch.inl:60-72` read the selected normal/system bank. This is not a TS/C++ opcode disagreement, and neither side reconstructs a lexical binding removed during compilation.
- The actual probe `carts/repeat_scope_probe/entry.lua:1-15` exactly matches the quoted complete source and recorded SHA-256. It sets only its owned global true, increments the lexical counter, and computes its distinct direct body `<const>` local as `passes >= 3`. No guest timeout/alternate exit guard appears. It prints after the loop and then halts in its ordinary infinite tail. The hypothetical lexical read's third-pass contrast follows from this finite source, not a second captured execution.
- Build log: the captured `/tmp/bmsx-repeat-scope-build.log` records `validate:toolchain:cart`, recipe `debug -O3`, ordinary compile/lint phases and successful publish/export with artifact `b686b33ad533de322e86968ef552b090269d24a6406723b29c55c111884d7a44`.
- Ordinary log: `/tmp/bmsx-repeat-scope-ordinary.log` records the separate `headless:tooling` ordinary debug-ROM invocation and exactly one guest `Repeat scope\t1` output, followed by timeline completion. It does not record native execution or an output assertion.
- Manifest: `carts/repeat_scope_probe/res/manifest/manifest.rommanifest:1-3` exists. The actual timeline `tests/carts/repeat_scope_probe/ordinary_timeline.json:1-6` contains only endpoint frame 4 and a description, with no event/capture/assertion. `scripts/bootrom/platforms/input_timeline.ts:67-96,124-158` uses cartridge presentation-frame origin and completes at that zero-based presentation offset; `scripts/bootrom/platforms/node_tooling_entry.ts:427-441` reports completion. The host TTL is not a guest diagnostic exit guard, and the log reports completion rather than TTL failure.
- The private note explicitly leaves source-policy intent, native/O0/all-optimizer/compound/typed/capture/reset/parser coverage outside this result and retains OPEN status. No runtime or compiler repair is proposed by this review.

## Init-boundary sentence recheck

Candidate: `/tmp/bmsx-language-init-boundary-prose.md`.

- Placement and syntax: `parser.ts:553-580` parses the attribute only between a local function name and parameter list; `parser.ts:677-717` has no such global/method declaration route. `compiler/passes/init_participants.ts:23-68,82-115,141` rejects compile-time modules, nested/block placement, parameters and varargs. `compiler.ts:6186-6206` invokes these checks on entry and every canonical source module.
- Non-entry static-participation restriction: `compiler.ts:916-920` rejects an init-bearing non-entry module absent from `staticModulePathSet`; `compiler.ts:2375-2396` records the dependency schedule; `compiler.ts:6382` actually requests ordered participants before creating vectors. This check is real compilation policy, not a tooling API.
- Ordinary lexical closure / declaration does not run the body: `compiler.ts:4629-4641` declares the lexical local, compiles its ordinary function expression and emits CLOSURE plus participant-slot publication, not CALL. `compiler.ts:5968-6000` supplies the ordinary parent/upvalue path and non-static participant closure representation.
- Not an automatic normal-startup call: `compiler.ts:1561-1588` performs section init, ordinary static-module work and entry call, with no init-vector call. `compiler.ts:6382-6402` generates the init and startup protos separately; the startup arguments include section-init and entry, not init-vector index. `compiler.ts:1592-1611` separately owns explicit init-vector calls. This review does not expose or audit a tooling API.
- Actual data/bss-before-module-before-entry ordering: `compiler.ts:1505-1556,1561-1588,1613-1631` supplies the section copy/zero work, ordinary module loader and subsequent entry call. The module work is the scheduled ordinary modules, not compile-time modules or every discovered source file.
- Current installed BIOS startup selection: `toolchain/ts/rompack/blua32_tail.ts:355-369` publishes startup/IRQ/exception fields; `machine/bios/main.lua:58-73,105-114` selects the scanned cartridge startup and writes it to cop0.exec, without participant lookup. No alternate BIOS/reset/save-state/tooling behavior is inferred.
- Final ordinary boot-initialization advice follows the generated startup/declaration distinction: source bodies that must run during normal boot need executed ordinary top-level/entry code or explicit calls there. This does not claim `<init>` is never explicitly invoked in other contexts.

## Final recheck and hashes

Final scope-edge candidate is unchanged at the reviewed hash below. Re-read the final init draft with its added non-entry scheduled-module restriction and the final LS01 note after removal of the unsupported earlier-attempt history. The added restriction is exactly the non-entry membership gate at `compiler.ts:916-920`, executed via `compiler.ts:6382`; it does not imply literal require is the only scheduling root. No unsupported claim remains in these final inputs within this finite source/observation boundary. HEAD remains `e43ee94f19d73aa4564f620e42ddbaa2c306a52f`. No source-owner implementation or repository edit was made by this reviewer.

Final reviewed input SHA-256 values:

```text
b4a106fb6c3b4710c27768eb1c9a0ea9198a27a2096c34efa34178af1c4b70f7  /tmp/bmsx-language-scope-edges-prose.md
486842282360b9060f156959d8e507b845f3cf10f4e8c4d7949b6c3485536173  /tmp/bmsx-language-scope-edges-facts.md
f8b7e52b74aee57d1aae0af85cd487e18f9c3010adbef15567359002a466333f  /tmp/bmsx-language-init-boundary-prose.md
3c30cd9958ade7ecd3389a541c9675c72fe40d261e67a5dcc8e58e9b71e332ba  /tmp/bmsx-language-init-lifecycle-facts.md
1e18ddcff286a77a4e591b2e4b72ad77b312773a6cf0d4ac5c5aade8e1fc057a  docs/book1/facts/blua-programs-repeat-scope.md
2414eedb8a75714f059c0e7fd015cdd5f992613192fb2c07c2a3c415d2278798  carts/repeat_scope_probe/entry.lua
da89d87d295ce3227d9981ff8c44b42319d09fa7dbe7be3f53b6c307c8d1c3b5  carts/repeat_scope_probe/res/manifest/manifest.rommanifest
69974706d15d2f6e05eb7c6f3b4b4fa9dce9ee5534b13d73d36aaf4616327485  tests/carts/repeat_scope_probe/ordinary_timeline.json
4ca4f5a11016769afaebafe70ea92b4f8f123b98084c2b8f148f5c4bc5bf7dc5  /tmp/bmsx-repeat-scope-build.log
14789a8525b21b2c735b9417121675f8e0daad1a18656008e0205118c8b16a15  /tmp/bmsx-repeat-scope-ordinary.log

```

Inspected actual-owner SHA-256 values at final recheck:

```text
92928fddbece104df67dc915722451b406a1e8d5cead1f189026cc498ad481a0  toolchain/ts/lua/syntax/parser.ts
cf3ce042d6a62a74c38c3b984d121be39648b156f31fd637b0c0546e9bfadbd3  toolchain/ts/lua/semantic/model.ts
c554364a3d9a3e5f251357b8ef0314434812576edd8f5346b9f763319e4a9e23  toolchain/ts/lua/semantic/frontend.ts
53e7f7e8b89363279534c0e923c7e96aab9f02bf0ee4abecb54613159c322108  toolchain/ts/lua/semantic/diagnostics.ts
4df1e7fa039fed229bdd3a3e50a08a55a0527bd5ca75223dc8e4b13d0caeb891  toolchain/ts/lua/compiler.ts
3b2bcd53be5a49b10d605db5e7647a9734280384fcd30b893a6140388be7d3ad  toolchain/ts/lua/compiler/bound_reference.ts
5551dac7805d127c88162b78e7e4a2ac2c80fbd5c555b07eb002b29dcaf8d966  toolchain/ts/lua/compiler/compile_value_flow.ts
afca85e29d5cab0e5626a286326ce61303fdefaae1986b7baa6465c2e73c7c71  toolchain/ts/lua/compiler/passes/init_participants.ts
b4e1aa0bd4344805e2a0c276fcda330653c4144e4c8c5eee2a30489794aa7aee  toolchain/ts/rompack/blua32_linker.ts
0a85f193bf7c8b54d755416873ec9247a0c25f98b29ada1cdd363ab542109330  toolchain/ts/rompack/blua32_tail.ts
e0968b94a62d8d38cd8d4563d7af6467c04ba3978f3ce8cfaf080832372b4b91  machine/ts/machine/cpu/cpu.ts
4fd9a24d035d671237bd68fa146e9fc7c2405268d838cca1aa8442398bc46f83  machine/cpp/machine/cpu/cpu.cpp
9fb0fb4d89ba40de5e48af23d315686a959f243db3ce0b5e9bf619ff239a6114  machine/cpp/machine/cpu/cpu_dispatch.inl
d32e0d8bf940976fb745e2a7795eb5f6ff8db80393a5324e142c838274cd3821  machine/bios/main.lua
57bafed6c4fcd41bba97d611b39a3077b48bea27e86f7f448540a83080b5ebcd  scripts/bootrom/platforms/input_timeline.ts
7c1715709c8f07035b069cf4226e59ce7c8803efc13bd8edfb84493a1eabe9e2  scripts/bootrom/platforms/node_tooling_entry.ts
```
