# Frozen CPU numeric/value fact sheet

- Scope: requested numeric/value/constant instruction families only; live source inspection, no implementation, no execution tests, no architecture/PDF/old chapter prose, no memory. Repository initially clean (`git status --short`).
- Notation: `R[x]` register value, `K[x]` execution-image constant value, `RK(x)` is `K[-1-x]` for negative decoded x, otherwise `R[x]`. `A` is destination except comparison instructions, where it is a boolean expectation. Ordinary guest Number is not a raw register word.
- Evidence columns: each row identifies a primary owner/range; mirror disposition states the actual inspected second implementation. “Matches” is source inspection, not exhaustive runtime parity proof.

## Stops / no unified claim

| ID | Affected claim | Primary evidence | Actual mirror disposition |
|---|---|---|---|
| STOP-1 | LOADKR handling of fractional/nonfinite/out-of-range Number indices is **not unified**; do not publish a shared index-coercion/fault contract. | `machine/ts/machine/cpu/cpu.ts:2802-2809` passes Number(B) unchanged; `:3517-3529` indexes typed constant arrays with it. | `machine/cpp/machine/cpu/cpu_dispatch.inl:719-721` casts Number(B) to `size_t` before vector indexing. No repair/inference of intended behavior. In-range nonnegative integer indices have the same meaning. |
| STOP-2 | LOADNIL B=0 frame-top effect differs; do not claim common zero-count top behavior. Value writes are empty in both. | `machine/ts/machine/cpu/cpu.ts:2337-2341`: zero loop iterations, no top update. | `machine/cpp/machine/cpu/cpu_dispatch.inl:16-21`: always raises top to `max(top,A+B)`, including B=0. |

## Representation and decoding dependencies

| ID | Fact | Primary evidence | Actual mirror disposition |
|---|---|---|---|
| REP-1 | Guest value kinds: nil, false, true, Number, String, Table, Closure, BuiltinFunction, Thread. TS registers retain separate tag/scalar/reference storage; numeric scalar storage is Float64Array. | `machine/ts/machine/cpu/value.ts:8-18`; storage owner `machine/ts/machine/cpu/value_slots.ts:25-35`. | C++ `machine/cpp/machine/cpu/value.h:29-40,95-145` uses a 64-bit NaN-boxed Value with ordinary double Numbers. C++ enum has no Number enumerator (encoded tag 0 means Number); tag ordinal values are **not** shared TS/C++ ABI numbers. |
| REP-2 | Numeric read of a non-Number register/constant yields NaN, not string/boolean conversion and not an arithmetic type fault. | `machine/ts/machine/cpu/cpu.ts:3589-3596`; register owner `machine/ts/machine/cpu/value_slots.ts:128-131`. | C++ dispatch `machine/cpp/machine/cpu/cpu_dispatch.inl:171-218,308-310` uses `asNumber`; `machine/cpp/machine/cpu/value.h:125-145` makes tagged nonnumbers quiet-NaN bit patterns when interpreted as double. |
| REP-3 | Numeric writes retain Number kind and normalize NaN; this is not integer/fixed-point register-word storage. | `machine/ts/machine/cpu/value_slots.ts:181-185`; normalization `machine/ts/machine/cpu/value.ts:48-50`. | C++ `machine/cpp/machine/cpu/value.h:132-160` stores double bits and canonicalizes NaN to `VALUE_QNAN_MASK`. |
| DEC-1 | RK negative => constant index `-1-rk`; nonnegative => register. | `machine/cpp/machine/cpu/cpu.h:447-452`. | TS `machine/ts/machine/cpu/cpu.ts:3589-3596` matches. |
| DEC-2 | RK B/C are sign-extended 9-bit ordinary operands or 15-bit WIDE operands. Therefore each narrow RK can name R0..R255 or K0..K255; WIDE RK can name R0..R16383 or K0..K16383. These are encoding ranges, not guaranteed allocated capacities. | `machine/ts/machine/cpu/cpu.ts:1355-1361` plus widths `machine/ts/spec/blua32/instruction_format.ts:3-10`. | C++ `machine/cpp/machine/cpu/cpu.cpp:943-950` and `machine/cpp/spec/blua32/instruction_format.h:9-16` match. Note `MAX_EXT_CONST` is 255 in both spec leaves; it alone does not describe WIDE RK decode range. |
| DEC-3 | KSMI signed immediate is 20 bits without WIDE (-524288..524287), 26 with WIDE (-33554432..33554431). LOADK Bx is unsigned 20/26 bits. A in Bx-format instructions is 6/12 bits; generic A is 8/14 bits. These are encoding limits only. | `machine/ts/machine/cpu/cpu.ts:1304-1333`; constants `machine/ts/spec/blua32/instruction_format.ts:3-33`. | C++ `machine/cpp/machine/cpu/cpu.cpp:875-921` matches. Actual function register/constant pool capacity is outside this bounded sheet; no claim that every encoded index is valid. |

## Opcodes and base cost

All numbers below are zero-based enum values. Each opcode row's primary is `machine/ts/spec/blua32/opcode.ts:1-65`; actual mirror is ordered `machine/cpp/spec/blua32/opcode_list.inl:1-64`, included by `machine/cpp/spec/blua32/opcode.h:9-13`; all listed numeric values match.

| Family | Opcode numbers | Base cycle evidence / mirror |
|---|---|---|
| Constants/copy | MOV=1, LOADK=2, LOADNIL=3, KNIL=5, KFALSE=6, KTRUE=7, K0=8, K1=9, KM1=10, KSMI=11, LOADKR=53 | All 1. Primary `machine/cpp/spec/blua32/opcode.cpp:7-17,59`; TS `machine/ts/spec/blua32/opcode.ts:75-83` matches. |
| Numeric binary | ADD=17, SUB=18, MUL=19, DIV=20, MOD=21, FLOORDIV=22, POW=23, BAND=24, BOR=25, BXOR=26, SHL=27, SHR=28 | All 1. Primary `machine/cpp/spec/blua32/opcode.cpp:23-34`; TS base table matches. |
| Strings/unary/comparison | CONCAT=29, CONCATN=30, UNM=31, NOT=32, LEN=33, BNOT=34, EQ=35, LT=36, LE=37 | CONCATN=2, all others=1. Primary `machine/cpp/spec/blua32/opcode.cpp:35-43`; TS base table matches. |
| Charge boundary | Run loop subtracts decoded dispatch base cost before executing the instruction. | Primary `machine/ts/machine/cpu/cpu.ts:1842-1854,1920-1933`; C++ `machine/cpp/machine/cpu/cpu.cpp:2465-2479` matches. |
| Extra charges | Requested ordinary dispatch cases contain no explicit `charge`/`CYCLES_ADD` surcharge, including no LOADNIL per-register or CONCATN per-input/byte surcharge. This is not a host performance estimate or a claim about unrelated GC scheduling. | Primary `machine/ts/machine/cpu/cpu.ts:2309-2342,2551-2736,2802-2847`; C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:6-57,171-383,719-721` matches absence. |

## Constant/copy instruction effects

| Opcode(s) | Operands and result | Primary evidence | Actual mirror disposition |
|---|---|---|---|
| MOV | `R[A] = R[B]`, copying full value kind/payload/reference. C unused. | `machine/ts/machine/cpu/cpu.ts:2309-2311` plus copy owner `:3482-3485`. | C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:6-8` copies Value word. |
| LOADK | `R[A] = K[Bx]`; value kind retained. | `machine/ts/machine/cpu/cpu.ts:2312-2314,3517-3529`. | C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:11-13` matches. No bounds/type fault is encoded in this dispatch. |
| KNIL / KFALSE / KTRUE | Write nil / false / true to R[A]; B/C unused. | `machine/ts/machine/cpu/cpu.ts:2316-2324`. | C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:25-37` matches. |
| K0 / K1 / KM1 | Write ordinary Number +0 / 1 / -1 to R[A]; B/C unused. | `machine/ts/machine/cpu/cpu.ts:2325-2333`. | C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:40-52` matches. |
| KSMI | `R[A] = Number(sBx)`, not raw instruction bits or a distinct integer guest kind. | `machine/ts/machine/cpu/cpu.ts:2334-2336`. | C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:55-57` matches. |
| LOADNIL | Write nil to exactly B slots `R[A]` through `R[A+B-1]`; B is count, not inclusive last index. C unused. | `machine/ts/machine/cpu/cpu.ts:2337-2341`. | C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:16-21` matches writes; **STOP-2** for zero-count top. |
| LOADKR | For nonnegative integral index i in constant pool, `i=Number(R[B]); R[A]=K[i]`. No RK source. C unused. | `machine/ts/machine/cpu/cpu.ts:2802-2809`. | C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:719-721` matches only that bounded domain; **STOP-1** elsewhere. |
| Destination top | Ordinary destination setters raise frame.top to at least A+1 and do not lower it. | `machine/ts/machine/cpu/cpu.ts:3475-3505`. | C++ `machine/cpp/machine/cpu/cpu.cpp:2494-2499` matches. LOADNIL separately described. |

## Numeric instruction effects

| Opcode(s) | Operands, result, edge handling | Primary evidence | Actual mirror disposition |
|---|---|---|---|
| ADD / SUB / MUL / DIV | Number-valued `R[A] = Number(RK(B)) + / - / * / divided by Number(RK(C))`. Ordinary floating arithmetic, no explicit saturation, integer wrapping, zero-divisor test, or arithmetic exception in dispatch. | `machine/ts/machine/cpu/cpu.ts:2551-2580`. | C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:171-197` uses corresponding double operators. Nonfinite results pass through numeric write normalization (REP-3); no invented numeric-fault semantics. |
| MOD | `r=left % right`; if r>0 and right<0, or r<0 and right>0, add right; write r. Zero remainder retains the underlying remainder sign, since neither adjustment condition fires. No zero/nonfinite guard. | `machine/ts/spec/blua32/numeric.ts:7-12`; dispatch `machine/ts/machine/cpu/cpu.ts:2581-2583`. | C++ `machine/cpp/spec/blua32/numeric.h:13-18` starts with `std::fmod` then same adjustment; dispatch `machine/cpp/machine/cpu/cpu_dispatch.inl:199-205`. Do not describe this as raw host `%` or claim every zero takes divisor sign. |
| FLOORDIV | `q=left/right; t=trunc(q); result=(t>q ? t-1 : t)`. No integer type/result wrapping and no zero/nonfinite guard. | `machine/ts/spec/blua32/numeric.ts:1-4`; dispatch `machine/ts/machine/cpu/cpu.ts:2584-2586`. | C++ `machine/cpp/spec/blua32/numeric.h:7-10` same formula with `std::trunc`; dispatch `machine/cpp/machine/cpu/cpu_dispatch.inl:208-212`. |
| POW | `R[A]=luaPow(Number(RK(B)),Number(RK(C)))`; owned mirrored fdlibm/V8-derived algorithm, not host Math.pow/std::pow. | `machine/ts/machine/cpu/cpu.ts:2587-2589`; algorithm provenance/contract `machine/ts/spec/blua32/pow.ts:16-18`. | C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:215-219` calls `machine/cpp/spec/blua32/pow.cpp:27-288`, matching owned algorithm structure. No exhaustive bitwise parity measurement performed here. |
| POW zero/NaN | Exponent +0 or -0 returns 1 before testing NaN; otherwise NaN operand returns NaN. Thus NaN**0=1 in this implementation. | `machine/ts/spec/blua32/pow.ts:61-73`. | C++ `machine/cpp/spec/blua32/pow.cpp:66-78` matches. |
| POW infinite exponent | For |x|=1, infinite y returns NaN; for |x|>1, +inf y returns inf and -inf y returns +0; for |x|<1 signs reverse. | `machine/ts/spec/blua32/pow.ts:96-105`. | C++ `machine/cpp/spec/blua32/pow.cpp:101-110` matches. Code condition, not erroneous adjacent comment, is the evidence. |
| POW negative / special base | Integer parity determines negative result for negative base with odd integral exponent. Special ±0/±inf/±1 handled explicitly; negative finite nonzero base with nonintegral exponent returns NaN. | `machine/ts/spec/blua32/pow.ts:75-94,122-148`. | C++ `machine/cpp/spec/blua32/pow.cpp:80-99,127-153` matches. Signed zero/special base must not be folded into a blanket negative-base rule. |
| POW limits | Algorithm explicitly returns signed overflow/underflow products and computes subnormal outputs by scaling normal range first, then rounding once. No new guest fault. | `machine/ts/spec/blua32/pow.ts:235-246,273-283`. | C++ `machine/cpp/spec/blua32/pow.cpp:240-251,278-288` matches. |
| BAND / BOR / BXOR / BNOT | Binary inputs are RK, unary BNOT input is R[B]. Each input is converted to a 32-bit word; result is the signed int32 interpretation written as an ordinary Number. BNOT complements all 32 bits. | C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:222-249,333-338`. | TS `machine/ts/machine/cpu/cpu.ts:2590-2598,2687-2690` uses JS `&`, `|`, `^`, `~`, with same numeric int32 semantics. |
| Word conversion | Integer truncation toward zero modulo 2^32; ±0, fractional magnitude<1, NaN and infinities convert to zero. Large finite values are reduced by extracting double exponent/significand, not saturating. | `machine/cpp/machine/cpu/value.h:199-229`. | TS bitwise operators at `machine/ts/machine/cpu/cpu.ts:2590-2603,2687-2689` perform ECMAScript int32 conversions. This describes bitwise datapaths, not Number storage. |
| SHL / SHR | `R[A] = signed32(word(left) << (word(right)&31))` for SHL. SHR is arithmetic (sign-extending) signed32 shift; not logical zero-fill. Count is masked to 0..31, so negative/large counts wrap modulo 32 rather than reverse direction or saturate. | C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:252-268`. | TS `machine/ts/machine/cpu/cpu.ts:2599-2603` uses `<<` and `>>` with `right&31`, matching. |
| UNM | `R[A] = -Number(R[B])`; B is register, not RK. C unused. No explicit type fault. | `machine/ts/machine/cpu/cpu.ts:2659-2662`. | C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:308-311` matches. |

## Truth, length, comparisons, concatenation

| Opcode(s) | Operands and effect | Primary evidence | Actual mirror disposition |
|---|---|---|---|
| NOT | `R[A]=not truth(R[B])`; only nil and false are falsey. Number 0 and NaN are truthy. B register, not RK; C unused. | `machine/ts/machine/cpu/cpu.ts:2664-2670`; truth owner `machine/ts/machine/cpu/value_slots.ts:157-160`. | C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:314-316`; truth owner `machine/cpp/machine/cpu/value.h:193-196` matches semantic kinds. |
| LEN | Input R[B]. String => stored Unicode codepoint count, not bytes; Table => maintained arrayLength. Number result in R[A]. Every other kind throws LuaExecutionError(LUA_FAULT_REASON_UNKNOWN). No metatable length dispatch in this opcode. | `machine/ts/machine/cpu/cpu.ts:2672-2685`. | C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:319-330` calls stringPool.codepointCount or Table::length; `machine/cpp/machine/cpu/table.cpp:547-548` returns maintained m_arrayLength. Table mutation/length-boundary policy is delegated, not re-audited here. |
| EQ predicate | Inputs RK(B), RK(C); no result register. Semantic tags must match; nil/false/true equal their same kind; Numbers compare numeric equality (NaN unequal, +0 equals -0), strings compare interned IDs, builtin functions compare scalar IDs, Table/Closure/Thread compare guest reference identity. | `machine/ts/machine/cpu/cpu.ts:3546-3585`. | C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:341-349`: numeric/numeric double equality; all other Values compare full encoded Value words. Thus reference/ID encodings differ. Guest builtin uniqueness and cross-constant reference validity are dependencies not re-audited; do not claim a universal host-object classifier. |
| LT / LE predicate | Inputs RK(B), RK(C); both Number => `<` / `<=`; both String => lexical UTF-8 order; all other kind combinations yield false, not a comparison type fault. No destination value. | `machine/ts/machine/cpu/cpu.ts:2701-2736,2812-2847`; comparison helper `machine/ts/common/utf8.ts:36-54`. | C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:356-383` uses double comparison or std::string UTF-8 byte comparison; mixed/other kinds remain false. Unicode normalization/invalid-string policy is a string-owner dependency, not established here. |
| Comparison control effect | EQ/LT/LE skip exactly the next decoded instruction iff predicate differs from `(A!=0)`; A is expectation (zero=false, any nonzero=true), not result destination. Skip advances by decoded width, so WIDE+body is one skipped instruction. | `machine/ts/machine/cpu/cpu.ts:2692-2699,2733-2735,2844-2847`; skip owner `:1994-2004`. | C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:350-352,365-367,380-382`; skip owner `machine/cpp/machine/cpu/cpu.cpp:1008-1016` matches. Skip decode can fail via existing instruction-fetch handling; do not call it an arithmetic fault. |
| CONCAT | Convert RK(B), RK(C) via guest value-to-string, concatenate in B-then-C order, intern result, write String R[A]. Not limited to string/Number operands. | `machine/ts/machine/cpu/cpu.ts:2607-2641`. | C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:271-287` reserves known string bytes then appendValueString left/right, interns owned text; same semantic order. |
| CONCATN | Convert exactly C consecutive registers R[B]..R[B+C-1] in increasing order; concatenate, intern, write String R[A]. B/C are raw register/count operands, not RK. C=0 => empty String. Sources read before destination write, including overlap. | `machine/ts/machine/cpu/cpu.ts:2643-2657`. | C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:290-305` matches, with reservation prepass. No new max string length established by this dispatch. |
| String conversion | nil=>`nil`, false=>`false`, true=>`true`, strings=>contents, Table=>`table`, Thread=>`thread`, Closure/BuiltinFunction=>`function`; nonfinite Numbers=>`nan`, `inf`, `-inf`; finite Number uses central formatNumber. No conversion fault for these guest kinds. | `machine/ts/machine/cpu/value.ts:182-206`. | C++ `machine/cpp/machine/cpu/value.cpp:9-29` matches semantic cases. Central finite formatting is an explicit dependency, not host default conversion. |
| Signed zero conversion | Finite numeric formatter preserves +0 as `0` and -0 as `-0`, so concatenation does too. | `machine/ts/common/number_format.ts:77-80`. | C++ `machine/cpp/common/number_format.h:64-67` matches. Full formatting algorithm precision/rounding not expanded here. |

## Hot-path execution-owner inventory (not a proposed refactor)

| Path | Source and disposition |
|---|---|
| TS ordinary opcode dispatch | `machine/ts/machine/cpu/cpu.ts:2285-2342,2551-2736,2802-2847`; numeric read `:3589-3596`, equality `:3546-3585`, destination setters `:3482-3529`; central numeric leaves as above. |
| C++ ordinary dispatch | `machine/cpp/machine/cpu/cpu_dispatch.inl:6-57,171-383,719-721`; RK reader `machine/cpp/machine/cpu/cpu.h:447-452`; Value numeric/datapath helpers `machine/cpp/machine/cpu/value.h:132-229`. |
| TS fused numeric dispatch | `machine/ts/machine/cpu/cpu.ts:2206-2282`: FusedShlBxor, FusedShrBxor, FusedAddShl preserve first write, stop at exhausted budget, charge second original opcode base cost before second write. These are dispatch optimizations, not extra guest opcode numbers. |
| C++ fused mirror | `machine/cpp/machine/cpu/cpu.cpp:2520-2614` implements same shift+xor / add+shift pairs, budget boundary and separate second-op charge. Not an exhaustive fusion-eligibility audit. |

## Explicit gaps / limits on use

- No runtime tests or execution traces. No promise of every representable bad index behaving identically; see STOP-1/STOP-2.
- Function register allocation bounds, image constant kinds/capacity, string intern allocation/GC/limits, table mutation policy, exception delivery/protected-call boundaries, and instruction-fetch faults are owner dependencies, not inferred here.
- Zero-divisor and nonfinite arithmetic behavior is sourced as unguarded operator/helper flow; this sheet does not invent CPU traps or manually normalize signs. For POW use its explicit implementation branches, not generic Lua or host pow folklore.
- Source-backed parity only: no bitwise cross-runtime POW/number-format benchmark or performance proof was run.
