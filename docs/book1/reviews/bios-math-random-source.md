# BIOS Math Random numbers: independent actual-source audit

Scope: `docs/book1/bios-math.md:209-284` only, including both exports and generator-state prose.
Method: opened actual BIOS, compiler, and paired TypeScript/C++ numeric, word, call, return, equality, comparison, and error owners. Facts file used only as an index.
Snapshot: HEAD `0fca01fd4bd23a4b5029f05a45e21c855085110b`; RNG section SHA-256 `1a97577652b980324cdfc60896fbda4e7ba2871dbf2e53a9f013fb40489cce74`.

## Material finding: uncaptured public error dependency is unqualified

- `bios-math.md:220`: “Otherwise, if `upper` is nil, truncate `lower` toward zero to obtain `upper_int`. If `upper_int < 1`, raise exactly:”
- `bios-math.md:232`: “Otherwise, truncate `lower` first and `upper` second to obtain `lower_int` and `upper_int`. If `upper_int < lower_int`, raise exactly:”
- These statements require the initialized `error` binding. `machine/bios/math.lua:329,336` calls the public global `error`; it is not a captured private/builtin function. The supplied literal strings are correct, but an altered `error` can return instead of raising, after which the result formula executes.
- Actual lowering: `toolchain/ts/lua/compiler.ts:2827-2828` loads a live global; `:5670-5672,5690` loads and calls the dynamic callee. Paired live-slot consumers are `machine/ts/machine/cpu/cpu.ts:2344-2357` and `machine/cpp/machine/cpu/cpu_dispatch.inl:60-76`.
- Initialized-error evidence: `machine/bios/base.lua:9,214`; literal raised-value owners: `machine/ts/machine/cpu/cpu.ts:4370-4380` and `machine/cpp/machine/cpu/cpu.cpp:2225-2227`.
- The RNG section correctly names the live `os.clock` dependency but does not name live `error`; the earlier dependency paragraph explicitly names only elementary-function bodies. Qualify these bound-error claims or explicitly extend the initialized-public-dependency assumption to RNG. This same qualification applies to the positive-bound-error summary at `bios-math.md:248,250`.

No other material unsupported/mismatching RNG sentence found in this finite inspection. In particular, the claimed one-nil result is supported by actual bare/default-return lowering (`compiler.ts:1496-1501,4372-4377,5767-5770`) and paired RET consumers (`cpu.ts:2942-2944`; `cpu_dispatch.inl:506-507`).

## Actual-owner snapshot hashes

SHA-256 values for opened owners (full paths relative to repository):
```text
d75f00a569914c101dffbc0d1ba1367226b9a350c3bb7eab4a30676cf805c7d1  machine/bios/math.lua
5cc3684c42a3ace630c57f122ed6b2caa019f8e44270f29336769e0212374bca  machine/bios/os.lua
8533102d2144010ddd66e62ebbe013bee696e5274e80c2316d6762dd1b75ad6f  machine/bios/base.lua
4df1e7fa039fed229bdd3a3e50a08a55a0527bd5ca75223dc8e4b13d0caeb891  toolchain/ts/lua/compiler.ts
52aa51e0bd4ffe01720ed3439ee393f14eb93f57404e637294a19f3eeb0a351d  toolchain/ts/lua/compiler/struct_types.ts
e0968b94a62d8d38cd8d4563d7af6467c04ba3978f3ce8cfaf080832372b4b91  machine/ts/machine/cpu/cpu.ts
b979a3da6c243095de8998239e6233b388d27cd781b3e95fdd1924a2f2753baf  machine/ts/machine/cpu/value.ts
0a64e2c2e262b56b266c3775e22f2797ed530b386b6005793df3e4d5b495270e  machine/ts/machine/cpu/value_slots.ts
1a720fd8bd64e8ae12b70f16340ebe7bb03e0cac2be3e0c313e14ad1902ed9b2  machine/ts/spec/blua32/numeric.ts
1c20c933db94865182e8f590cb4953ac575e76ce4eb1c813afab73f253aed065  machine/ts/machine/memory/memory.ts
4fd9a24d035d671237bd68fa146e9fc7c2405268d838cca1aa8442398bc46f83  machine/cpp/machine/cpu/cpu.cpp
9fb0fb4d89ba40de5e48af23d315686a959f243db3ce0b5e9bf619ff239a6114  machine/cpp/machine/cpu/cpu_dispatch.inl
c8658882e624f50ef1a988d943f3c86465bfa38e9a58ed8bf5d2810e47e62e45  machine/cpp/machine/cpu/value.h
b348e11aa8c97599ff8e1a92aa8a5a77d2ab288541fc3a34168f8484ae534768  machine/cpp/spec/blua32/numeric.h
8a57ccc60424c0b4f0014711353a97afbeabf400a4436b1db2c0c3a714a004f4  machine/cpp/machine/memory/memory.cpp
```

Limits: source inspection only; no builds, tests, guest execution, disassembly, architecture/PDF review, whole-chapter review, or repository edits. No reset, cart/thread lifecycle, save-state, statistical, entropy, or all-extreme-number guarantee inferred. CPU7/Table/BZ01/LS01 remain open; no mirror repair or complete parity claim.

## Narrow recheck: finding closed

The qualification at `docs/book1/bios-math.md:215` explicitly names live public `error` and scopes subsequent raised-String claims to its installed BIOS definition. It resolves the sole finding above. The R-E01 addendum at `docs/book1/facts/bios-math-random.md:76` accurately records the inspected dependency.
Corrected RNG-section SHA-256: `90f235883ec0544a968859d8c890d6a4b5ffafd0ac2984a267144b8b9e89cb09`. Removing only the added paragraph reproduces the previously audited section hash. BIOS math and compiler owner hashes are unchanged.
Disposition: no remaining material unsupported/mismatching sentence found within the finite RNG-only source-audit scope. No broader review or execution performed.
