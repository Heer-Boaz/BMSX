# Numeric-loop public prose and complete program: independent actual-source review

## Verdict and limits

**PASS for this bounded numeric-loop documentation slice. No unsupported factual sentence, control-table row, executable listing, or printed result was found in the reviewed material.** There is consequently no unsupported claim/source-line quotation to report.

Reviewed on `master`, HEAD `e43ee94f19d73aa4564f620e42ddbaa2c306a52f` (2026-10-18). The review covers `/tmp/bmsx-language-numeric-loops-prose.md`, the matching `docs/book1/blua-programs.md:449-511` section, and that chapter's numeric-loop complete program and explanation at lines 1078-1241. The linked numeric-loop recipe at `docs/programming/getting-started.md:662-722` was checked for its program/evidence scoping. The two fact sheets were source/evidence indices, not authorities.

`AGENTS.md` was read. Actual parser/compiler/binder, paired TS/C++ execution owners, cartridge sources, assertion suite, and the already-captured build/guest/ordinary logs supplied the evidence. No repository file was changed; no build, test, compiler/cart execution, native execution, architecture/PDF reading, or foreign-reference lookup was performed. Text extraction, byte comparisons and hashes are audit operations only. The separate init/vararg/goto additions are not audited here. This does **not** close whole-language acceptance, CPU7, Table length, BZ01, LS01, the repeat-scope discrepancy, arbitrary optimizer correctness, or all-Number/NaN/infinite termination.

## Actual producer and representations

- Cartridge program sources go through `parseLuaChunk` in `toolchain/ts/rompack/blua32_image_builder.ts:84-108`, then `compileLuaChunkToProgram`, object encoding and `linkCartBlua32Image` at 213-231. `toolchain/ts/lua/analysis/parse.ts:16-21` constructs the real lexer/parser. `compiler.ts:3651-3653` dispatches the actual numeric-for AST to the lowerer.
- This is the directly consumed compiler semantic frontend, not an IDE inference: `compiler.ts:5913-5934,6181-6185,6301-6314`; `semantic/frontend.ts:157-169,197-220,599-613`.
- TS Numbers occupy tagged scalar slots backed by `Float64Array` (`machine/ts/machine/cpu/value_slots.ts:25-35,128-131,181-186`). C++ Numbers use the double-bit encoding of the `uint64_t Value` (`machine/cpp/machine/cpu/value.h:29,95-110,132-145,159-161`). No integer-only induction counter is introduced by the numeric-for lowerer.
- Logical lowerer registers and edges are not claimed to be identical optimized ROM bytes. Finalization can invoke the general optimizer (`compiler.ts:1690-1693,1728-1778`; `compiler/optimizer/index.ts:2086-2122`). Inspected Number ADD and LT folds use `+` and `<` (`compiler/optimizer/values.ts:183-189,217-226`). Jump finalization accounts for instruction widths (`compiler.ts:1847-1878,2010-2020`); linking copies/relocates text (`blua32_linker.ts:818-837,956-958,1128-1154`). These facts do not prove all transformations for arbitrary programs.

## Every numeric-for prose claim checked

The `/tmp` prose is byte-equivalent to the chapter's Numeric for section after removing only trailing section whitespace.

| Public lines | Claim group checked against actual source | Result |
| --- | --- | --- |
| 451-457 | Numeric syntax, optional comma/step, square brackets as grammar notation only | Supported by `syntax/parser.ts:843-849,871-891`. The fence is `text`, not executable Lua; the explicit sentence correctly says brackets are not source text. |
| 459-465 | Ordered, once-per-ordinary-entry header evaluation; one result per expression/call; omitted step is Number 1, explicit 0 is present; start initializes the variable; separate retained limit/step | `compiler.ts:4486-4502,4518-4519` compiles start, limit, explicit step with requested count 1 before `loopStart`. Calls propagate that requested result count (`4732-4734,5628-5635,5653-5657,5690-5697`); paired result-transfer owners are TS `cpu.ts:3406-3439`, C++ `cpu.cpp:3127-3139`. |
| 467-471 | Enclosing-scope header references; body-local loop binding; after-loop invisibility; ordinary shadowing | `semantic/model.ts:933-950` binds headers before introducing/activating a local. Declaration activation and nearest-scope lookup are at 1665-1681 and 2071-2082; scope exit at 2110-2112. Compiler bindings use declaration handles and are removed on scope exit (`compiler.ts:2082-2086,2124-2155,2193-2204,2217-2223,2307-2312`). |
| 473-484 | Exact selector/strict exits; finite inclusive paraphrases; no universal <=/>= or termination claim; ordinary Number arithmetic | `compiler.ts:4500-4509` and paired LT/ADD owners below support both rows. For finite Number operands, failure of strict `limit < i`/`i < limit` gives the inclusive readings. The public qualification explicitly prevents extending that paraphrase to all Number values. |
| 486-491 | Current body-visible variable is the control variable; mutation permitted; tail addition after ordinary fallthrough; no mid-body recheck; break bypasses tail | `compiler.ts:4488-4490,4504,4508,4513-4525`; assignment/load paths at 2799-2805,4090-4103,4207-4211,4242-4248,4720-4722. Binder declares local, not constant (`semantic/model.ts:945`); const-write diagnostics reject only constant (`semantic/diagnostics.ts:274-293`). Break is the pending loop-exit JMP (`compiler.ts:4621-4627`). |
| 493-499 | Explicit zero accepted rather than omitted/rejected; second test; finite below/equal/above cases; no zero counter progress; mutation or break can exit | Parser preserves present step; lowerer tests AST presence and loads 1 only when absent (`parser.ts:875-889`; `compiler.ts:4493-4498`). Zero is emitted as K0 (`3157-3163`). Diagnostic dispatcher has no zero-step rule (`semantic/diagnostics.ts:124-137`); cited lowerer/ADD/LT paths have no such trap. With zero, `0 < step` is false. The prose's ability-to-exit statement is a finite deduction, not an unmeasured universal run/termination claim. |
| 501-504 | Complete program exercises evaluated/cached headers, forward/reverse mutation and finite zero cases; entered zero cases break | Directly supported by actual `carts/loops_manual/entry.lua:6-61` and the matching public listings. |
| 506-511 | Ordinary Number instructions/calls and selected executed-path costs, not fixed source-loop cycle charge | The lowerer emits ordinary LT/JMP/ADD; normal and instrumented TS instruction charging is in `cpu.ts:1838-1854,1920-1933`, paired C++ at `cpu.cpp:2466-2479`; call lowering is ordinary CALL. The prose assigns no invented fixed per-iteration charge and does not turn links into timing/native/whole-CPU proof. |

### Paired execution owners and polarity

| Datapath/edge | TypeScript | C++ | Audited meaning |
| --- | --- | --- | --- |
| LT | `machine/ts/machine/cpu/cpu.ts:2701-2736` | `machine/cpp/machine/cpu/cpu_dispatch.inl:356-368` | Number comparison is strict `<`; skip occurs when comparison differs from `A != 0`. |
| Whole-instruction skip | `cpu.ts:1994-2004` | `cpu.cpp:1008-1017` | Advances by next decoded instruction width, not a hard-coded single word. |
| JMP destination and execution | `cpu.ts:1343-1349,2849-2852` | `cpu.cpp:931-937`; `cpu_dispatch.inl:424-427` | Relative word displacement forms decoded target; JMP sets PC to it. |
| Number ADD | `cpu.ts:2551-2571,3589-3597,3497-3500` | `cpu_dispatch.inl:171-175`; `cpu.h:447-452`; `value.h:132-145,159-161` | Reads RK operands and stores ordinary Number sum. |
| K0/K1 | `cpu.ts:2325-2330` | `cpu_dispatch.inl:40-47` | Number 0 and Number 1. |

Tracing actual `compiler.ts:4502-4519`: `LT 0,0,step` skips the alternate-test jump when `0 < step`; positive test `LT 1,limit,index` executes exit JMP exactly when `limit < index`; alternate test `LT 1,index,limit` executes exit JMP exactly when `index < limit`. Ordinary body fallthrough performs `ADD index,index,step` and jumps back only to the test. Both exit/break targets lie after ADD/backedge. `emitJumpPlaceholder`/patching are actual JMP/target operations (`compiler.ts:3111-3129`), not assumed pseudocode behavior.

## Public complete-program reconstruction

The one `results.lua` block and ordered concatenation of all three `entry.lua` blocks were extracted from the chapter and compared byte-for-byte with the actual files. **Both match exactly**, including blank lines and final newlines; no ellipses, missing declaration or omitted executable statement occurs. The chapter explicitly instructs readers to concatenate the three entry parts, not run them as three modules.

| Reconstruction | Actual source | Complete lines | SHA-256 of both |
| --- | --- | --- | --- |
| Chapter 1095-1119 | `carts/loops_manual/results.lua` | 25 | `c334c00a38d8d14daa3a75b28eba0f7f75a558de5fe97437dc161352bfbc1b7b` |
| Chapter 1128-1156 + 1162-1194 + 1200-1213 | `carts/loops_manual/entry.lua` | 76 | `160567daf9eb176efb5d35533fb2a88a980de0c126d466664a7294e6b6248f79` |

The seventeen word fields include `completed`; sixteen are retained observations. This is typed BSS, not an invented numeric address/device-register Table (`results.lua:3-23`, `entry.lua:3-4`). The owner emits BSS zeroing before entry (`compiler.ts:1534-1554,1567-1571`; word primitive size/access `compiler/struct_types.ts:54`). The separate-cartridge advice and supplied manifest/tree agree with the actual files.

The program has seven numeric-for statements (`entry.lua:12,21,31,36,43,48,55`). The final `while true`/`halt_until_irq` is the post-completion parking loop, not an eighth finite numeric loop or a claim that the cartridge exits. The two entered zero-step bodies contain the exact explicit break conditions (`48-61`). Their completion is not being inferred merely from an observation timeout.

## All results and explanations

Chapter lines 1224-1229 match the six `Loops ...` lines at `/tmp/bmsx-loops-manual-ordinary.log:13-18` **byte-for-byte**, including tabs. `machine/bios/base.lua:265-275` is the actual tab-separating print implementation.

| Public row/line | Actual finite calculation from entry source | Captured result |
| --- | --- | --- |
| Headers, 1234 | Calls return 1,2,3; header expressions therefore supply 1,4,1. Visits 1,2,3,4. | `Loops headers\t3\t4\t10` |
| Cached, 1235 | Retained 4/1 survives writes of source locals 0/7; visits 1,2,3,4. | `Loops cached\t4\t10\t0\t7` |
| Mutation, 1236 | Ascending post-body +1 plus tail +1 yields visits 1,3,5; descending body -1 plus tail -1 yields 5,3,1. | `Loops mutation\t3\t9\t3\t9` |
| Zero-empty, 1237 | Initial alternate-test exit `1 < 3` is true. | `Loops zero-empty\t0` |
| Zero-fixed, 1238 | Index stays 3; written break on third visit. | `Loops zero-fixed\t3\t9` |
| Zero-equal, 1239 | Index stays 2; written break on second visit. | `Loops zero-equal\t2\t4` |

All introductory/explanatory sentences at 1080-1090,1122-1123,1220-1221 and every program comment agree with those actual source files and finite calculations. The observations explicitly do not establish a general numerical termination rule.

## Existing validation evidence: exact scope

- `/tmp/bmsx-loops-manual-build.log:8-9,10-30` names `loops_manual`, `debug -O3`, system/cart build and lint stages, publication/export, and artifact `36ca627ddeef9c16f601f9519eceb58c34aa8f8d1a95093b4814f372d3d5287e`. It is captured build evidence, not a new review execution or proof of every optimizer case.
- The actual suite is integration (`tests/carts/loops_manual/loops_manual_assert.lua:5`). It waits on `completed == 1` at 8-10 and then has **exactly sixteen** explicit assertions at 11-26, one per retained observation. Completion is a wait condition, not miscounted as a seventeenth explicit assertion. `/tmp/bmsx-loops-manual-guest.log:5` reports `[test] numeric_loop_control: passed`.
- The guest route is a fresh derived TS test image, not byte-identical ordinary playback: actual headless runner constructs `TestRun` with O3 and `OffscreenMachine` (`scripts/bootrom/platforms/hostrunner/test_runner.ts:16-34`); `ide/testing/run.ts:38-45` builds the test cartridge then creates a target. `toolchain/ts/rompack/test_cartridge.ts:156-183,199-217` retains the integration entry, adds/preloads test execution modules, and rebuilds the image. This scopes the assertion evidence correctly.
- Ordinary evidence is the **separate captured** headless debug command (`ordinary.log:1-8`), six printed groups (13-18), then timeline completion (19). Timeline `frame:4` is an observation endpoint (`ordinary_timeline.json:3`), not six assertions or startup/cycle/native timing proof.
- The linked recipe at `getting-started.md:692-722` makes the same distinctions: sixteen retained checks; separate ordinary output; TS rather than native; no all-Number/NaN/infinite termination, runtime-parser or whole-SDK/console closure. No stronger claim was imported from the fact sheets or this audit.

## Final reviewed hashes

The following SHA-256 inventory freezes the actual reviewed files. A later edit requires comparison/re-review of the changed content, not assuming this whole-file digest still applies. The fact-sheet hashes identify the indices consulted, not an endorsement of every unrelated claim inside them.

```text
3240c47d59735c27866b4c5153a164418286f5ff3658c958bafd924f11e1873f  /tmp/bmsx-language-numeric-loops-prose.md
02748c1d03257b93b37eb09c80a409bc4c5084d52d3e5de895881df9bede7f6a  docs/book1/blua-programs.md
af3829f6562b84687c65b464032a3180044e920766fd4c95714b2592ce765c8c  docs/programming/getting-started.md
c334c00a38d8d14daa3a75b28eba0f7f75a558de5fe97437dc161352bfbc1b7b  carts/loops_manual/results.lua
160567daf9eb176efb5d35533fb2a88a980de0c126d466664a7294e6b6248f79  carts/loops_manual/entry.lua
a1a0795f7158b2d698eba8868afa70e53df943aa4ff5afeaea80255d01ce13c0  carts/loops_manual/res/manifest/manifest.rommanifest
e9c690bb97a26fabb068844f4fbc7644725619f18abfed62d70e42273c92c97b  carts/loops_manual/README.md
ad53e42061e2c3d411144de82b14a8f0d99edae0575ffe88a0a7c0ef112dae65  tests/carts/loops_manual/loops_manual_assert.lua
60dc04b10738a0542b1dd81f260dacc61ff7a1f614d318dadf954fadd8159ab0  tests/carts/loops_manual/ordinary_timeline.json
001723dd1ba70ab31d32377104f3bf2a618286ca3cd1454958bf15484ec811bf  /tmp/bmsx-loops-manual-build.log
30c0c76825a38842c788bfcaa3286f37ac440425b6baf7755f7470577b1a5b65  /tmp/bmsx-loops-manual-guest.log
c3003a6635222906b9e2f0a667739970660848e97368b3121fb3db386433f7f6  /tmp/bmsx-loops-manual-ordinary.log
7ea16fbe444bcbef1fda4d9bd1d9e1b10362d725396e96b6d4537d5bbacf3a3a  /tmp/bmsx-language-numeric-loop-edges-facts.md
c92a5f4717737d2e226cb7da44278151c35f7d1d5a128da299f680141a32d6c3  docs/book1/facts/blua-programs-loops-program.md
96335555b48e0b41944b1fe546335ca875f36bbcd1a8cb084355590ec3c5ef27  AGENTS.md
92928fddbece104df67dc915722451b406a1e8d5cead1f189026cc498ad481a0  toolchain/ts/lua/syntax/parser.ts
dadb02f4b49c442aec99ce4f1ab2709565abcb3cab30694430336471b878bab4  toolchain/ts/lua/analysis/parse.ts
4df1e7fa039fed229bdd3a3e50a08a55a0527bd5ca75223dc8e4b13d0caeb891  toolchain/ts/lua/compiler.ts
cf3ce042d6a62a74c38c3b984d121be39648b156f31fd637b0c0546e9bfadbd3  toolchain/ts/lua/semantic/model.ts
53e7f7e8b89363279534c0e923c7e96aab9f02bf0ee4abecb54613159c322108  toolchain/ts/lua/semantic/diagnostics.ts
c554364a3d9a3e5f251357b8ef0314434812576edd8f5346b9f763319e4a9e23  toolchain/ts/lua/semantic/frontend.ts
291fc05da6aa240205fde26305dc8d8c769c471a41d1df5ed8c34d5753db0151  toolchain/ts/lua/compiler/optimizer/index.ts
357f8484a331af0f6de27e35b7f112627c0abc72ca2664e763f1348d8d9cd54f  toolchain/ts/lua/compiler/optimizer/values.ts
52aa51e0bd4ffe01720ed3439ee393f14eb93f57404e637294a19f3eeb0a351d  toolchain/ts/lua/compiler/struct_types.ts
ad72a23ad3fcc76dd04e4411a60533c2e1bc6b6af4a68c87a24c33b942ca8935  toolchain/ts/rompack/blua32_image_builder.ts
b4e1aa0bd4344805e2a0c276fcda330653c4144e4c8c5eee2a30489794aa7aee  toolchain/ts/rompack/blua32_linker.ts
7c268afabe1c4c3835eaa723197545ef1e4c75db7a4c3141b708c493177cd66b  toolchain/ts/rompack/test_cartridge.ts
e0968b94a62d8d38cd8d4563d7af6467c04ba3978f3ce8cfaf080832372b4b91  machine/ts/machine/cpu/cpu.ts
0a64e2c2e262b56b266c3775e22f2797ed530b386b6005793df3e4d5b495270e  machine/ts/machine/cpu/value_slots.ts
84bbfb9f9b771d8e1a80aaed26ff2359b26ee6e7af8f90b983ddbd8475701c20  machine/ts/spec/blua32/opcode.ts
9fb0fb4d89ba40de5e48af23d315686a959f243db3ce0b5e9bf619ff239a6114  machine/cpp/machine/cpu/cpu_dispatch.inl
4fd9a24d035d671237bd68fa146e9fc7c2405268d838cca1aa8442398bc46f83  machine/cpp/machine/cpu/cpu.cpp
676102ecd88cf5629180a9e96d2a493177fe16ef2746ede1301badb00c9c42f6  machine/cpp/machine/cpu/cpu.h
c8658882e624f50ef1a988d943f3c86465bfa38e9a58ed8bf5d2810e47e62e45  machine/cpp/machine/cpu/value.h
8533102d2144010ddd66e62ebbe013bee696e5274e80c2316d6762dd1b75ad6f  machine/bios/base.lua
6b197af4ee6928a30684ca84e54a23f2a7736485473a75e753a803d3d15a8ec7  scripts/bootrom/platforms/hostrunner/test_runner.ts
4714d58421a02b2dc2d0720b8145cbc8556ebf1197389e86c8e551fed088fd37  ide/testing/run.ts
```
