# Generic-for actual-source audit — finite pass

No material unsupported or mismatching public claim was found in the scoped text.

Scope: `docs/book1/blua-programs.md:517–554,1274–1378`, `docs/programming/getting-started.md:724–782`, and `carts/iterators_manual/README.md`, including syntax, header/result adjustment, scope, cached state/control, nil versus false, writable loop variables, break, reached faults, ordinary costs, complete program and observation table.
Baseline: HEAD `e43ee94f19d73aa4564f620e42ddbaa2c306a52f`; existing dirty/untracked work preserved. Facts documents were indexes, not substitutes for actual owners.

Actual-owner verification: parser `toolchain/ts/lua/syntax/parser.ts:843–869,1345–1349,1502–1508`; binder `semantic/model.ts:952–975,1665–1681`; frontend `semantic/frontend.ts:157–163,416–445`; compiler `compiler.ts:4159–4204,4528–4585,4621–4627,5754–5765` and its actual rompack/frontend consumption chain were opened.
Paired representation boundary: TS `ValueSlots` stores guest tags/scalars/references; C++ `Value` is a tagged `uint64_t`. Generated generic-for uses separate iterator/state/control and visible-local registers, ordinary fixed-two-argument CALL, fixed result adjustment, equality to nil, MOV and JMP. Actual paired CPU owners agree on these inspected paths: TS `cpu.ts:2896–2939,2981–2989,3406–3438,3546–3576`; C++ `cpu_dispatch.inl:341–353,475–503,539–545`, `cpu.cpp:2995–3046,3127–3139`, and both value owners. Ordinary instruction-budget charging paths were also inspected; no fixed per-iteration cost is asserted.

Chapter listing reconstruction was byte-for-byte, including tabs and final newline: `results.lua` 19 lines, SHA-256 `5255144f80f0796ebe73a4e12ece34f1cde8b03800687e8a4d967dfc6f6a115e`; `entry.lua` 44 lines, SHA-256 `2248acbfb66305328f9c54b41bcb2dbb0a29f01a1f541c2d46371cccf9e16ce7`.
The actual manifest and ordinary timeline also match the route listings byte-for-byte. Typed word/BSS ownership and zero initialization were checked in actual compiler/storage owners.
The actual integration suite has exactly ten assertions after its completion wait (`iterators_manual_assert.lua:8–20`), checking all ten retained observations. The captured guest log records `[test] generic_iteration_control: passed`.
All three ordinary diagnostics match the chapter/README byte-for-byte and the captured ordinary log at lines 13–15: `Iter calls\t3\t2\t30`, `Iter controls\t0\t1\t2`, `Iter values\t1\t2\t198\t999` (the displayed escapes denote actual tab bytes).
Captured build log lines 8–30 identify `iterators_manual`, debug -O3, successful publication/export and artifact `15e638f1f6a3056eb722c64841dcb76206ef3d9ae4583213f7f013757705faa8`. These are existing execution records, not new runs.
Derived-image/fresh-target and BIOS-import boundaries were checked in `toolchain/ts/rompack/test_cartridge.ts:99–112,156–217`, `ide/testing/run.ts:31–45` and the actual CLI runner. Timeline ownership (`scripts/bootrom/platforms/input_timeline.ts:67–96,124–158`) supports the documented zero-based presentation endpoint, not output assertion or latency guarantee.

Reviewed public hashes: chapter `6823cbd1ecc504b03f2d5c17908617c9688a634b8410bbae65b263effd2e741e`; getting-started `af3829f6562b84687c65b464032a3180044e920766fd4c95714b2592ce765c8c`; README `993e60d3435def02e1196cd09619beafb8b92a75b0cfe116ec382f33e8dbcb3a`.
Limits: no new build, guest/ordinary/native execution or repository edit; no architecture document, PDF or stock-Lua substitution. This is not all-iterator/input/fault/optimizer, closure-capture/goto, performance, separate BIOS runtime-parser or whole-manual acceptance. Public-reader and PDF reviews are separate. CPU7, Table length, BZ01 and repeat-scope LS01 remain open.
