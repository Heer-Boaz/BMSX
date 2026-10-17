# BIOS base services: source and execution review

2026-10-18; source baseline24a37a1df. Current software is the authority.
This is a bounded chapter review, not whole-BIOS/manual acceptance, exhaustive
runtime/optimizer conformance or native execution of the ordinary cartridge.

## Separation of work and production reference

A read-only extractor recorded96 facts for the actual12 requested base globals;
root's initial count13 was corrected rather than inventing another API. Separate
facts-only authors wrote the five value/conversion services and seven traversal/
argument/global/output services. A third author implemented/executed the ordinary
cartridge and wrote the complete program section from its source/observations.
Root assembled the chapter and supplied bounded decimal-order, history-unit,
continuation precision, namespace and public-reader follow-through facts.

The production [Lua base-library source](https://github.com/lua/lua/blob/master/lbaselib.c)
was inspected before implementation as an organizational reference only. No
external Lua behavior, architecture document or historical reference PDF became
a BMSX fact. The source checks below are independent of paragraph authorship.

## Execution scope

The final actual program is40 result-module lines plus103 entry-module lines;
its five complete-program Lua fences reproduce all143 lines literally. The
separate one-line assert illustration is not an extra source module. Full
cartridge validation, the37 retained non-completion assertions and separate
ordinary BIOS playback of all17 diagnostic lines pass after three long source
statements were wrapped and every required command rerun. Artifact
`5d81c556352c901b2c6874317b55f2ca29df2ee9ecc4bdb008cb95965cb7c322`.
Detailed hashes/commands/ranges and the discarded default-player instruction
are in [example facts](../facts/bios-base-example.md). That unproven player
command was not counted as actual cartridge observation or silently repaired.

Nine additional bodies at O0/O3 pass18 TS/native true completions with equal
decoded snapshots via the existing17-cycle-grant CPU save/restore route. These
use the real base/coroutine modules but an explicit empty console fixture: they
are not diagnostic-output, full BIOS-boot or physical timing evidence. No raw
encoded-byte equality or whole-runtime parity is claimed. Real ordinary output
uses the separately executed installed BIOS. Scratch setup mistakes and the
additional genuine source-zero observation are retained in the source index.

## Figures

The chapter has no images or schematic figures; generated receipt counts0.
Its actual nonvisual outputs are the diagnostic transcript and retained values.
No decorative drawing, synthetic screenshot or text output is presented as
physical CPU/display evidence. Remaining graphics-output teaching tasks stay
separate. Program/listing/table source acceptance is below; print is separate.

## Independent value/conversion source audit

Scope: opening and Value checks and conversion (assert, rawequal, type, tostring,
tonumber); paired truth/equality/category text/finite formatting, call shaping,
primitive type cost and relevant BIOS/compiler producers were inspected.
The N13–N16 digit/fraction/exponent/sign order was checked, and no universal
literal-source signed-zero promise was inferred from the formatter-input rule.

PASS — unsupported or mismatching factual sentences/table cells: none.

Narrow follow-up PASS — the added assert capture paragraph and A12 contain no unsupported or mismatching factual sentences. `machine/bios/base.lua:8-9` captures the two primitives; `machine/bios/base.lua:223-226` uses those captures.


## Independent traversal/global/output source audit

# BIOS base traversal/globals/output: independent source audit

Baseline: live HEAD `24a37a1df`. Reviewed only `docs/book1/bios-base.md:161-233` against the live owners and `docs/book1/facts/bios-base-reference.md` (including root P07). The program beginning at line 235 is outside this review. This is a read-only source audit, not runtime execution or architectural/library completeness acceptance. No architecture document, PDF, or external reference was consulted; no repository files were changed.

## Finding: one unqualified continuation-key sentence

`docs/book1/bios-base.md:173`:

> A missing non-array continuation key ends traversal rather than raising an invalid-key error.

As written, “missing” does not distinguish a missing live mapping from a missing recognizable continuation node. The owners terminate only for the latter. They can recognize a retained dead hash node after its mapping has ceased to be a live entry, then continue to a later live hash slot:

- TypeScript `machine/ts/machine/cpu/table.ts:961-983` accepts a matching retained key without requiring a nonnil stored value, and also recognizes retained dead object-key hash IDs. `:1013-1017` terminates only if that node lookup fails; a recognized node advances to its next live hash slot.
- Native `machine/cpp/machine/cpu/table.cpp:102-124` performs the corresponding recognizable-node lookup; `:599-603` likewise terminates only when no node is found.
- These are produced states, not hypothetical corrupt state: TypeScript weak-entry clearing calls `markHashNodeDead` at `machine/ts/machine/cpu/table.ts:592-613`, whose scalar-key case retains the key and nils its value at `:1394-1412`. Native weak-entry clearing calls its marker at `machine/cpp/machine/cpu/table.h:145-156`, and `machine/cpp/machine/cpu/table.cpp:381-390` likewise retains scalar keys while niling their values. Thus a missing live hash mapping is not by itself the source's termination condition.

The adjacent mutation caveat correctly avoids a mutation-safety guarantee, but it does not qualify this preceding unconditional sentence. This is a narrow prose precision issue; no runtime repair, weak-table contract expansion, or new iteration guarantee is requested by this audit. The same shorthand appears in fact I05/I06; the live lookup is the stronger authority.

## Finding: CPU system globals are not SYSTEM register facilities

`docs/book1/bios-base.md:215`:

> They do not look up or assign a local or an upvalue merely because it has the same spelling, and they do not access the separate system-register namespace.

> Use the system-register facilities described in **System control and timing** for that separate namespace; a String passed to `getglobal` or `setglobal` does not redirect the operation there.

The non-redirection point is supported, but the namespace name and reference conflate CPU system globals with SYSTEM MMIO registers. The actual alternate namespace is the CPU's system-global storage, accessed by GETSYS/SETSYS, not by the SYSTEM device register facilities:

- `machine/ts/machine/cpu/cpu.ts:2344-2349` moves guest values to/from `systemGlobalSlots`; `:2171-2185` owns its separate name map and slot store. The scoped getter/setter instead use `globalSlotByKey` and `globalSlots` at `:3622-3638`.
- Native `machine/cpp/machine/cpu/cpu_dispatch.inl:60-68` accesses `m_systemGlobalValues`; the distinct ordinary/system maps and stores are visible at `machine/cpp/machine/cpu/cpu.cpp:731-758`.
- The existing CPU reference explicitly owns the two namespaces and their execution-image name indexes at `docs/book1/cpu.md:818-822`. `docs/book1/system.md:3-17` instead introduces SYSTEM's word ports and retained diagnostic buffers. These are different owners, not alternative facilities for one namespace.

This does not imply a new cartridge-callable system-global accessor.

## Remaining reviewed claims

Apart from the two findings above, no unsupported or mismatching sentence/table cell was found in the bounded section. In particular, source inspection supports the iterator triples and delayed target faults; nil rather than false termination; stored traversal versus inherited ordinary indexing and the limited String-index acceptance; select's raw signed-word conversion and filtered extreme cases; ordinary rather than system globals themselves, direct writes, and zero setter results; mutable global dependencies; print's producer-emitted one-nil fallthrough; original diagnostic character codes versus code-63 one-byte BIOS history substitutions and 8192 entries; absence of a drawing/presentation promise; and the incremental +1 builtin charge rather than a total-call-cycle claim.

## Inspected owner scope

- BIOS aliases, mutable dependency reads, and iterator/output bodies: `machine/bios/base.lua:1-12,205-216,265-296`.
- BIOS console MMIO/history owner: `machine/bios/tty/console.lua:3-52`.
- TypeScript primitive dispatch, iteration/select/global bodies, indexing, faults, charging and return shaping: `machine/ts/machine/cpu/cpu.ts:496-505,619-685,2155-2181,3406-3438,3622-3642,3841-3857,4173-4191,4286-4317,4320-4348`.
- Native equivalents: `machine/cpp/machine/cpu/cpu.cpp:371-390,731-758,1661-1665,1681-1690,1876-1891,2093-2104,2152-2173,3127-3139,3243-3274`.
- Table traversal, resolution, and the narrowly relevant continuation state: `machine/ts/machine/cpu/table.ts:349-369,574-615,709-745,951-1020,1394-1412`; `machine/cpp/machine/cpu/table.cpp:93-124,381-390,574-612`; `machine/cpp/machine/cpu/table.h:132-158`.
- Paired primitive metadata and native word/argument representations: `machine/ts/machine/cpu/value.ts:109-142`; `machine/cpp/machine/cpu/value.h:56-93,199-229,326-343`.
- Compiler producer paths for ordinary name loads, function fallthrough, result expansion, and generic for: `toolchain/ts/lua/compiler.ts:591-600,1491-1501,2813-2828,4528-4571,5661-5690,5754-5770`.

Additional narrow cross-reference verification: `machine/ts/machine/cpu/cpu.ts:2344-2349`; `machine/cpp/machine/cpu/cpu_dispatch.inl:60-68`; `docs/book1/cpu.md:818-822`; `docs/book1/system.md:3-17`.

No console transcript, display behavior, benchmark, total-cycle bound, or paired execution result is claimed.

## Closure: narrow corrected-prose recheck

Re-read the current chapter's two corrected paragraphs at `docs/book1/bios-base.md:173,215` and the supporting I05/I17/G11 facts. Both findings are closed:

- The traversal paragraph now makes termination depend on absence from current recognizable continuation storage, explicitly distinguishes an absent live mapping, and preserves the no-mutation-guarantee limitation. This matches the paired node lookup/continuation source cited above without promising that every removed key remains usable.
- The globals paragraph now identifies the separate CPU system-global namespace and points to its CPU reference owner, without claiming a SYSTEM MMIO facility or a new callable accessor.

No unsupported or mismatching sentence/table cell remains in the reviewed `Traversal, argument selection, globals, and output` section (`docs/book1/bios-base.md:161-233`). This closure does not review the program below it or widen the initial source-only scope. `git diff --check` passed after the recheck.

## Public-reader follow-through: numeric selector conversion

Narrowly rechecked the newly expanded conversion description at current `docs/book1/bios-base.md:199` against S07/S08 and the actual owners. No unsupported or mismatching mathematical claim was found.

- Native `machine/cpp/machine/cpu/value.h:199-217` truncates the bounded finite branch through `int64_t`, preserves the unsigned low 32 integer bits, and implements the same operation for larger finite magnitudes by extracting and shifting the binary significand. Encoded NaN/infinity exponents return zero at `:205-207`; magnitudes with exponent at least 84 have zero low 32 bits and return zero at `:209-211`. `:224-229` applies the signed 32-bit interpretation.
- Native select calls that conversion before testing the sign or applying its relative offset at `machine/cpp/machine/cpu/cpu.cpp:2164-2168`. TypeScript select performs its signed-word conversion first with `selectorScalar | 0`, then applies the same offset ordering at `machine/ts/machine/cpu/cpu.ts:4304-4307`.

The stated truncation, modulo-2^32 reduction, signed interpretation, and NaN/either-infinity-to-zero behavior are therefore supported for this selector boundary. This recheck does not claim new execution coverage: the parent's scratch vectors were not rerun or generalized by this audit. The prior two finding closures are unchanged. `git diff --check` passed.


## Independent opening/program/source-observation audit

# BIOS base-services opening and ordinary program: independent source review

Baseline: live HEAD `24a37a1df`, 2026-10-18. Read-only repository audit; no runtime repair, authoring, or test-suite rerun.

## Findings

No mismatching or unsupported claim found in the bounded scope below.

## Verified scope

- **Opening, `docs/book1/bios-base.md:3-20`:** exactly twelve scoped APIs; installed before cartridge startup, ordinary mutable global bindings, captured versus live dependencies, no required cartridge BIOS import, and no new MMIO interface. Read actual installation/implementations at `machine/bios/base.lua:1-12,205-296` and boot order at `machine/bios/main.lua:4-12,105-113,136-143`. Cross-reference titles/scope agree with `docs/book1/cpu.md:1,637-660,820-827,884-895`, `memory.md:1,122-145,185-199,290-304`, `coroutines.md:1-15,29-43`, and `system.md:1,129-150,239-255`.
- **Complete program, `docs/book1/bios-base.md:253-550`:** literal extraction confirms five Lua fences of 40, 34, 35, 26, and 8 lines. Final keep-together markup was rechecked after concurrent layout-only edits; fence 1 exactly equals `carts/bios_base_manual/results.lua:1-40`; fences 2-5 concatenated without additions exactly equal `cart.lua:1-103`. All twelve APIs occur as real calls; the only cartridge require is `require('results')` (`cart.lua:3`). Reviewed every program prose block against the complete source, rather than accepting the fact sheet as authority.
- **Live owners behind the demonstrated operations:** actual BIOS bodies `machine/bios/base.lua:67-203,219-296`; TS/native truth `machine/ts/machine/cpu/value_slots.ts:157-160` / `machine/cpp/machine/cpu/value.h:193-196`; equality `cpu.ts:3569-3585` / `cpu_dispatch.inl:341-349`; categories/text `value.ts:149-205` / native `value.h:481-494,value.cpp:9-29`; real running Thread `cpu.ts:3694-3697` / native `cpu.cpp:1737-1740`; next `cpu.ts:4173-4195,table.ts:709-745,990-1020` / native `cpu.cpp:2093-2104,table.cpp:574-612`; select `cpu.ts:4286-4318` / native `cpu.cpp:2152-2173`; ordinary global writes/reads `cpu.ts:2155-2181,3622-3639` / native `cpu.cpp:731-758,1681-1688`; thrown-value preservation `cpu.ts:4370-4380` / native `cpu.cpp:2225-2227`; fixed/open result handling `cpu.ts:3272-3296,3406-3418` / native parameter shaping `cpu.cpp:3018-3042`; print fallthrough producer `toolchain/ts/lua/compiler.ts:1491-1501,5767-5771` and real console `machine/bios/tty/console.lua:19-52`. No demonstrated owner disagreement found; this is not a full runtime-parity audit.
- **Every retained row, `docs/book1/bios-base.md:504-521`:** matches actual typed fields and the 37 source assertions at `tests/carts/bios_base_manual/bios_base_manual_assert.lua:11-47`. The 38 scalar slots comprise those 37 non-completion observations plus `completed`, which is the wait predicate at `:8-10`, not an extra assertion. `/tmp/bmsx-bios-base-cart-test.log:5` records the passing case. The existing derived-image construction is visible at `toolchain/ts/rompack/test_cartridge.ts:156-183`; that passing retained test is not mislabeled as ordinary playback or native execution.
- **Exact diagnostic output, `docs/book1/bios-base.md:527-549`:** all 17 lines, including literal tab separators, exactly equal `/tmp/bmsx-bios-base-ordinary.log:13-29`; startup occupies `:9-12`, and `:30` records timeline completion. The command/load lines `:1-4` identify ordinary cartridge and installed BIOS images, rather than the console-stub probe.
- **Full companion README, `carts/bios_base_manual/README.md:1-126`:** source assembly instructions `:14-30` correctly reconstruct both complete modules; the YAML `:34-38` exactly matches `res/manifest/manifest.rommanifest:1-3`; JSON `:63-70` exactly matches the entire six-line `tests/carts/bios_base_manual/ordinary_timeline.json`. Build/retained and ordinary-playback procedures remain separate (`README.md:40-105`). README output `:83-99` also exactly equals the ordinary log. No unsupported frame-4 latency or cycle-budget claim found.
- **Published artifact identity:** `/tmp/bmsx-bios-base-cart-build.log:30` reports `5d81c556352c901b2c6874317b55f2ca29df2ee9ecc4bdb008cb95965cb7c322`; its `artifact.json:1` agrees on target/debug/O3 and current exported ROM digests. Independently recomputed current SHA256s agree with `docs/book1/facts/bios-base-example.md:107-121`: cart `31ea25f5359c4f323bf841e0dddbbaf91f04840b33485805d17c531ca61cd51a`, BIOS `01b9f2f197e59144867d5844863aa7fd9752811e227e7a6901a1541a17b6e664`, tooling `a38274f9eea37a4a4a759a3d0b11c72fe8170e525d2eaf0ffe1a41d069c43470`.

## Separate bounded BZ01 check

`docs/book1/facts/bios-base.md:54-60` accurately reports the four observations: `/tmp/bmsx-bios-base-probe.log:3-8,25-30` gives literal-zero text `-0` at O0 versus `0` at O3, parsed-zero text `-0` at both, division text `-inf` at both, rounded text `123457` at both. `:4,26` records TS/native agreement for each same linked image. The actual observation source is `/tmp/bmsx-bios-base-probe.ts:18-23`; compilation and snapshot comparison are `:120-133`.

The cited relevant producer locations are accurate: unary evaluation call `toolchain/ts/lua/compiler/optimizer/index.ts:580-588`, Number negation `compiler/optimizer/values.ts:165-168`, zero-to-K0 selection `:123-131`, ordinary constant emitter `toolchain/ts/lua/compiler.ts:3157-3159`. **The complete causal optimizer-pass/rewrite chain is not independently proved by this review.** The facts explicitly retain that limit at `docs/book1/facts/bios-base.md:67-71`; no contradictory claim was found. This remains a separate compiler/source-producer question, not a TS/C++ runtime mirror mismatch.

## Evidence limits

The chapter contains no figures. The ordinary transcript is genuine nonvisual diagnostic evidence, not graphics, screenshot, display-presentation, or UI evidence. No architecture document or reference PDF was inspected. No widening into the full optimizer or unrelated runtime questions; no repository edits. `git diff --check` passed.



## Source disposition

All three bounded nonauthor source assignments pass. The two traversal findings
(continuation storage versus a missing live mapping, and CPU system-global
namespace versus SYSTEM MMIO) were corrected and independently rechecked. The
public reader's assert-dependency and selector-conversion gaps were also
independently source-checked after addition. These decisions do not close the
seven runtime-owner questions or separate source-zero producer finding.

Public-only newcomer acceptance and exact generated-page print acceptance are
recorded in `bios-base-reader.md` and `bios-base-print.md`, not inferred from
these source/execution results or a passing publication gate.
