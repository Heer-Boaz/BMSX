# BIOS String operations: independent bounded contract-source review

## Current pattern and packet contracts — bounded source review

2026-10-18; baseline b515e804e plus the documentation/example worktree.
Current public chapter SHA-256:
`a7b97cbab88db05e0e2a65a871beec4872b705292e298262bf5947b8e7ea01b5`.
This added scope starts at **Pattern language** and continues through the packet
reference, excluding the separately audited complete programs. Earlier format
and base evidence below retains its historical scope, not a new whole-library
or whole-manual approval.

Fresh facts-only authors supplied the atoms, four-API and packet drafts.
Independent reviewers read the actual complete pattern and pack/float owners,
not just those facts. The pattern review identified two failures: unqualified
capture/result/replacement/output enumeration across actual Table lengths, and
an unsupported effects claim for replacement Table lookup. The final public
account has a shared Table dependency boundary, explicitly Table-valued
`__index` chaining without Function callbacks, and a function-only effects
caution. The final targeted disposition is recorded with the program review.
The earlier frontier and terminal-percent parsing corrections are retained.

The packet review found no contradicted sentence in its full bounded draft.
It checked every token/control, exact alignment/X lookahead, safe-integer tests
and signed-read order, text-copy branches, unusual accepted categories,
float encoding/decoding equations, explicit errors, work and captured/current
bindings. The final shared paragraph also qualifies normal String helper Tables,
not only accepted Table operands. No universal octet ABI or repaired IEEE
encoding is imported.

Actual source scope:

| Surface | Owners inspected directly by independent reviewers |
| --- | --- |
| Pattern implementation/install/bindings | `machine/bios/string/pattern.lua:1-567`; `machine/bios/string.lua:1-22`; `machine/bios/main.lua:4-9`; `machine/bios/string/base.lua:1-82`; `machine/bios/table.lua:41-98`; `machine/bios/base.lua:1-90,195-260` |
| Packet and float implementation | `machine/bios/string/pack.lua:1-452`; `machine/bios/string/float/encode.lua:1-56`; `machine/bios/string/float/decode.lua:1-37`; same immediate String/Table/base dependencies |
| Codepoints, LEN, numbers and comparisons | TS `machine/ts/machine/cpu/cpu.ts:2550-2848,4286-4368`; `value_slots.ts:124-160`; native `machine/cpp/machine/cpu/cpu_dispatch.inl:171-383`; `cpu.cpp:2152-2228`; `value.h:95-160,189-230`; paired `spec/blua32/numeric` leaves |
| Ordinary replacement Table lookup | TS `machine/ts/machine/cpu/cpu.ts:619-653`; `table.ts:334-369`; native `machine/cpp/machine/cpu/cpu.cpp:3243-3249`; `table.h:67-81,225-239` |
| Actual call/result adjustments, not parentheses assumptions | `toolchain/ts/lua/compiler.ts:3889-3939,4372-4409,5628-5699,5754-5764`; `toolchain/ts/lua/syntax/parser.ts:1345-1349`; paired TS `cpu.ts:3272-3297,3406-3439` and native `cpu.cpp:3017-3043,3127-3148` |

The narrow pack `select` calls are nonfinal outer arguments or scalar locals;
that is the one-result boundary, not grouping. Pattern callback assignment is
scalar; final tuple forwarding and fixed gsub return are distinct. Inspection
of these actual callsites does not prove every optimizer/source pipeline.
The separate SF1 card keeps the descriptor omission visible; no tooling fix was
silently made.

Raw bounded reports: `/tmp/bmsx-patterns-current-source-review.md`,
`/tmp/bmsx-pack-current-source-review.md`, and the final follow-up records cited
in [the complete-program review](bios-string-program.md). Facts are indexed in
[pattern](../facts/bios-string-pattern.md) and
[packet](../facts/bios-string-pack.md) sheets. No architecture/reference PDF,
runtime/BIOS/compiler/publisher repair, benchmark or universal runtime theorem
is part of this contract audit. Common Table length, CPU7 and BZ01 remain OPEN.

### Final targeted disposition

The independent final pattern reviewer directly checked the corrected public
boundary and paired lookup leaves: **F1/F2 addressed, no concrete remaining
failure in that targeted scope**. It explicitly did not close the Table contract.
The raw final report is `/tmp/bmsx-pattern-program-source-review.md`, SHA-256
`199973062dbb745a528e2268c5287db6e0372a5244760d56812810328b20787c`.
The packet reviewer likewise checked the final shared Table paragraph against
actual `out`/`#out`/concat/unpack consumers, including ordinary String operands.

The edited opening classification at lines3–9 received a separate editor
owner check at `machine/bios/main.lua:4-6`, `machine/bios/string.lua:1-22`,
`machine/bios/string/pattern.lua:420-449,516-565` and
`machine/bios/string/pack.lua:277-384`. This is not falsely included in the
independent pattern-program review's declared line963-onward scope. No further
technical fact is introduced by the opening's interface grouping.

---

## Earlier formatting and base-operation evidence

## Current string.format contract — bounded actual-source review

### Snapshot and scope

- Baseline HEAD: `f3a86b01c6d6b32e0665e1083b28c44c666f0556`.
- Reviewed chapter: `docs/book1/bios-string.md`, SHA-256 `32db34535a77fda7a4e4efa53ecdfba866e581f1e340356fcb2680e38a144666`.
- Public-prose scope: opening format classification/import/separate-interface wording at lines 3–8, and the entire added contract at lines 630–769, stopping before `### Complete program: formatted text` (line 771). The three keep-together sections are layout-only markup, not behavioral claims.
- `docs/book1/facts/bios-string-format.md` was used only to locate actual owners, not as independent evidence. Its inspected SHA-256 is `e2bab2ee061b4b584e4ef85b4b1c657075434e730a3ab2390fb249d4730c772e`.
- No chapter, runtime, BIOS, compiler, publisher or other repository edit was made. No build, guest/native execution, test, benchmark, PDF or architecture-document inspection was performed by this reviewer.

### Actual owners inspected

These ranges were read directly, not accepted from the facts sheet:

| Claim surface | Actual owners/ranges |
| --- | --- |
| Installation and separate exports | `machine/bios/main.lua:1–23,108–143`; `machine/bios/string.lua:1–22`; `machine/bios/string/base.lua:1–7,39–55,85–95,123`; signature only: `toolchain/ts/lua/builtin_descriptors.ts:79,93–108` |
| Format entry, literals, grammar, stars, selection order, unsupported/incomplete conversions, final result | `machine/bios/string/format.lua:21–27,57–70,282–463` |
| Padding, signs, words, integer digits, quoting and floating algorithms | `machine/bios/string/format.lua:1–279` (entire helper body) |
| Captured/transitive dependencies and work loops | `machine/bios/string/base.lua:1–4,27–36,58–82,97–123`; `machine/bios/table.lua:1–2,52–78`; `machine/bios/math.lua:27–62,349–379`; `machine/bios/base.lua:205–237` |
| TS guest arithmetic, concatenation, length, unary negation, ordered/equality comparisons and numeric RK access | `machine/ts/machine/cpu/cpu.ts:2551–2736,2812–2848,3546–3597`; `machine/ts/machine/cpu/value_slots.ts:124–135`; `machine/ts/spec/blua32/numeric.ts:1–13` |
| Native guest arithmetic, concatenation, length, unary negation and comparisons | `machine/cpp/machine/cpu/cpu_dispatch.inl:171–229,271–383`; `machine/cpp/machine/cpu/cpu.h:447–452`; `machine/cpp/machine/cpu/value.h:95–160,199–229`; `machine/cpp/spec/blua32/numeric.h:7–19` |
| Paired select, byte/codepoint, variadic char and raised error leaves | `machine/ts/machine/cpu/cpu.ts:4286–4381`; `machine/cpp/machine/cpu/cpu.cpp:2152–2228`; `machine/cpp/machine/cpu/value.h:326–346` |
| Paired absent-parameter, vararg and fixed-result Nil producers | `machine/ts/machine/cpu/cpu.ts:3272–3297,3421–3439`; `machine/cpp/machine/cpu/cpu.cpp:3017–3043,3127–3140` |
| Current host parser/call lowering, scalar locals, explicit multireturn producer and one-result classification | `toolchain/ts/lua/syntax/parser.ts:1331–1349`; `toolchain/ts/lua/compiler.ts:800–825,944–950,3875–3937,4159–4205,4372–4409,5628–5764` |
| Paired default category/numeric text conversion | `machine/ts/machine/cpu/value.ts:170–206`; `machine/cpp/machine/cpu/value.cpp:9–35`; `machine/ts/common/number_format.ts:10–143`; `machine/cpp/common/number_format.h:10–179` |
| Direct String codepoint count/read/write dependencies | `machine/ts/machine/cpu/string_pool.ts:16–35,54–60,124–132`; `machine/ts/common/utf8.ts:1–30`; `machine/cpp/machine/cpu/string_pool.cpp:27–74,138–146`; `machine/cpp/common/utf8.h:13–115` |

Important source hashes: `machine/bios/string/format.lua` = `1e17da19e665212963166b2a515a49f5d52a7449418085e335115d0f03b13383`; `toolchain/ts/lua/compiler.ts` = `4df1e7fa039fed229bdd3a3e50a08a55a0527bd5ca75223dc8e4b13d0caeb891`; `toolchain/ts/lua/syntax/parser.ts` = `92928fddbece104df67dc915722451b406a1e8d5cead1f189026cc498ad481a0`.

### Disposition

No failed or unsupported added technical sentence was found within the finite prose scope against the actual source leaves above. This includes the behavior, arguments/results, grammar, numbers, flags, algorithms, explicit errors, value-dependent work and captured-versus-current binding claims. No corrective chapter rewrite is proposed.

In particular, the current `%c` wording agrees with the inspected producer/consumer chain, rather than stock Lua grouping expectations: `math.modf` explicitly returns integer then fraction (`math.lua:59–62`); the parenthesized-expression parser returns the inner call (`parser.ts:1345–1349`); the outer final-call argument can remain expanding (`compiler.ts:5648–5652,5685–5690,5754–5764`); both char leaves process every received argument and emit one String (`cpu.ts:4353–4367`, `cpu.cpp:2209–2222`). Scalar-star/local selection has a distinct fixed-one-result boundary (`compiler.ts:3890–3923`). The explicit two-expression return and RET-based one-result classifier were also read (`compiler.ts:4372–4409,816–824`). This is bounded source-chain agreement, not a blanket all-compiler-modes theorem or independently executed evidence for the named `%c` examples.

The Table-length boundary is not silently narrowed to intended String input. The reviewed prose retains both initial Table input behavior and temporary helper-Table dependencies (`format.lua:45–54,209–229,282–290`; `string/base.lua:58–82`; paired LEN leaves). This review does not resolve the common Table-length producer disagreement, the seven CPU-owner questions, BZ01, capacities/allocation/fault routing, whole-call timing, compiler-wide correctness, firmware compiler behavior, or native/end-to-end execution. Those remain outside this review; no global publication/source/compiler/native clearance follows from this disposition.


The separately reviewed complete formatting program, literal reconstruction,
execution logs and frozen artifacts are in [bios-string-program.md](bios-string-program.md).
The bounded public-reader and actual expanded-draft decisions are in
[bios-string-reader.md](bios-string-reader.md) and
[bios-string-print.md](bios-string-print.md). None clears the shared length stop.

---

## Earlier base-operation evidence

The following source/artifact review is retained at its earlier bounded scope;
it is not an approval of the later formatting extension or a current hash.

2026-10-18. Nonauthor review. Only this report was written; no chapter,
runtime, BIOS, compiler, publisher or example source was edited. Neither the
architecture document nor a historical/reference PDF was opened. No execution
or build commands were run by this reviewer.

## Scope and findings

Reviewed the opening and every API/reference section before **Complete
program: codepoints and mapped UTF-8**, including the inline examples, result
counts, conversion and error statements, accepted Table branches, captured
helpers, transitive globals, work descriptions and mapped-input cautions.
The added decoder-capture paragraph is included. The complete-program section
and its execution/artifact evidence belong to the separate program audit.

**No concrete false or unsupported sentence was found in this bounded
contract scope.** There is consequently no quoted failure or requested prose
rewrite. This is a factual-scope result, not publication approval, print/reader
acceptance, an exhaustive runtime audit or completion of the whole manual.

Chapter inspected: 628 lines, contract heading through line359; SHA256
`b5e1dd12a60dc47a8693ab95a0b92f8e0c21341720f2564e00f89f811dd97363`.

## Actual source boundary inspected

Factsheets were indexes, not source proof. Actual leaves inspected:

- Installation, shared String-index Table and captures: `machine/bios/main.lua:4-12,105-113,136-143`,
  `machine/bios/string.lua:1-22`, `machine/bios/string/base.lua:1-123`,
  `machine/bios/string/utf8.lua:1-58`, `machine/bios/table.lua:1-98`;
  TS CPU `cpu.ts:629-637,3684-3689`, native `cpu.cpp:1727-1732,3243-3257`.
- Primitive argument order, conversion, scalar validity, single results and
  traversal: TS `machine/ts/machine/cpu/cpu.ts:4320-4368`, native
  `machine/cpp/machine/cpu/cpu.cpp:2176-2223`, native central word conversion
  `value.h:199-229` and missing-argument view `:326-345`.
- LEN, numeric/non-Number arithmetic, floor division, comparison and ordinary
  concatenation: TS CPU `cpu.ts:2607-2657,2672-2685,2701-2736`,
  `value_slots.ts:128-131`, `value.ts:182-205`,
  `machine/ts/spec/blua32/numeric.ts:1-13`; native CPU
  `cpu_dispatch.inl:171-218,271-305,319-330,356-368`, `value.h:125-148`,
  `value.cpp:9-29`, `machine/cpp/spec/blua32/numeric.h:7-19`.
- Exact argument/length error Strings and protected original-error transfer:
  TS CPU `cpu.ts:496-505,1962-1966,4094-4131`; native
  `cpu.cpp:371-380,1980-1990,2654-2658`.
- Incremental two-cycle primitive charges: paired `spec/blua32/builtin`
  StringByte/StringChar IDs7/8; TS CPU `value.ts:109-122,cpu.ts:3841-3842`,
  native `value.h:63-73,cpu.cpp:1876-1877`.
- String value/codepoint construction, constant-index fields and literal
  escapes: paired CPU string pools and common UTF-8 counters/append leaves;
  `toolchain/ts/lua/compiler.ts:3788-3798,5181-5189`,
  `toolchain/ts/lua/syntax/lexer.ts:338-381`. Direct-call minima were checked
  against `builtin_descriptors.ts:93-108` and
  `semantic/diagnostics.ts:357-375,395-415`; the explicit-nil `sub` form is
  distinguished from the body default, not presented as a runtime validator.
- Typed mapped-byte read and machine-fault boundary:
  `toolchain/ts/lua/compiler.ts:5308-5318`; TS CPU
  `cpu.ts:2992-3009,3051-3084`, native `cpu_dispatch.inl:554-576`;
  TS Memory `memory.ts:442-451`, native `memory.cpp:332-341`.

The named public CPU, Memory, BIOS base, protected-call/coroutine, table-library
and SYSTEM crossreferences exist. Their connected representation, conversion,
length, storage, protected-error and mapped-fault sections were inspected;
their own publication dispositions are not changed by this review.

## Existing publication stop remains open

The common Table-length producer difference is still present in the actual
owners: TS `machine/ts/machine/cpu/table.ts:801-812,1426-1440` crosses the
array/hash boundary when updating length. Native SETT reaches
`machine/cpp/machine/cpu/cpu_dispatch.inl:152-161` and
`table.h:36-43,172-184`, whose refill scan stops at array capacity. The
different native integer path at `table.h:186-195` cannot close that difference.

The String chapter's accepted Table-dependent branches must retain that stop.
The current facts and review JSON do so: datapath/programming coverage remains
open independently of the bounded factual-scope pass. Naming captured L or
passing ordinary String examples does not establish a universal common
Table-length contract.
No owner repair is inferred or authorized by this review.

No contract section in the stated nine-API scope remains unreviewed. Pattern,
format, pack, arbitrary corrupt image strings, all pointer/word combinations,
exhaustive Unicode/resource/GC/optimizer behavior, complete-program acceptance
and the other open CPU/BIOS questions remain outside this bounded review.
