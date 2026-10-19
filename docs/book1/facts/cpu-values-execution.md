# CPU value supplement: bounded direct paired execution

Historical observations: 2026-10-17, baseline5a5a26e15; no runtime/formatter/table/POW edits in that extraction. Root ran the
actual shared owners, not an ideal printf, host pow or foreign Lua oracle.
Current native targets bmsx_cpu_supervisor_tests and bmsx_table_inspection_tests
were rebuilt with no work needed before these observations.

## Numeric owners

`/tmp/bmsx-cpu-value-probe.ts` and `/tmp/bmsx-cpu-value-probe.cpp` execute the
actual luaPow, central Number normalization and central finite formatNumber.
Logs `/tmp/bmsx-cpu-value-probe-{ts,native}.log` are byte-equal:174rows, comprising
135 special-base/exponent combinations,32 finite formatter inputs and7 limit/
ordinary-power results. IEEE payload words here identify normalized numeric
results including zero sign, not a shared raw CPU value-slot ABI. No nonfinite
value was passed directly to the finite formatter.

Base grid: NaN,+0,-0,+1,-1,+2,-2,+infinity,-infinity. Exponent grid:
NaN,+0,-0,+0.5,-0.5,+1,-1,+2,-2,+3,-3,+infinity,-infinity,2^53-1,2^53.
Index order is exactly that of the scratch sources. This is bounded input
conformance, not exhaustive finite POW parity/accuracy or all NaN payloads.

Selected exact formatter outputs:

| Input Number | Actual text |
|---|---|
| +0 / -0 | `0` / `-0` |
| 0.0000999999 | `9.99999e-05` |
| 0.0001 | `0.0001` |
| 0.00001 | `1e-05` |
| 0.00009999995 | `0.0001` |
| 999999 | `999999` |
| 999999.5 /1000000 | `1e+06` |
| 1.234565 /1.234575 | `1.23456` / `1.23458` |
| 123456.5 /123457.5 | `123457` / `123458` |
| 2147483648 | `2.14748e+09` |
| 5e-324 | `4.94066e-324` |
| 1.7976931348623157e308 | `1.79769e+308` |

123456.5 is a deliberate caution: the owner rounds its **computed normalized
scaled binary64 intermediate**, not a promise of ideal decimal ties-even for
the original input. No formatter correction or generic %.6g claim is inferred.

Exact numeric limit observations (IEEE high/low words, not value-slot words):
2^-1074=00000000:00000001;2^-1075=00000000:00000000;
2^1024=7ff00000:00000000;(-2)^1025=fff00000:00000000;
(-2)^-1075=80000000:00000000;
10^0.05=3ff1f3c9:9f6bc436;0.1^1.1=3fb455b5:a30b035c.

## Table owners

Scratch `/tmp/bmsx-cpu-table-probe.{ts,cpp}` creates an actual CPU-owned table,
without attempting execution or resetting an empty-ROM CPU. Logs
`/tmp/bmsx-cpu-table-probe-{ts,native}.log` contain30rows. Their first24rows are byte-equal; the boundary-refill difference below is intentional evidence, not a passing parity claim.

- Set1=10,2=20,3=30: lengths1,2,3. Delete2:nil ->1. Set4=40 ->1.
  Restore2=20 ->4. Delete1 ->0;restore1 ->4;set2=false ->4 (false is present).
- Numeric+0/-0 share key: after90 then91, either reads91; length stays4.
- Numeric-1,1.5, String`1`,false,true read12,15,16,17,18 respectively; numeric1
  remains its separate10. NaN keys replace each other and read22;±infinity keys
  read23/24. Missing99 returns nil; all leave length4.
- Same Table-reference key returns31; distinct table reference misses with nil.
- Writing nil under NaN deletes its shared entry; later NaN read is nil.
- Nil key read and nil key store each raise LuaExecutionError reason4.

No metatable chain, malformed table, iteration-order or huge-capacity execution
claim is inferred from those24rows. The extractor's paired owner facts, not
these tests alone, define the normative explanatory claims.


### Table boundary refill: historical and current instruction execution

The historical direct owner probes add six boundary rows. With array capacity4/hash8,
fill numeric1..5, delete2 and refill2 with the generic setter: TS length5,
native length4, while key5 still reads50 in both. The integer setter refill
returns5 in both. Exactly one of the30 rows differs; do not describe the full
Table probe logs as byte-equal.

Separate actual CPU programs `/tmp/bmsx-cpu-table-guest-probe.{ts,cpp}` use the
central writeInstruction and existing test system-ROM linker. Function maxStack6,
NEWT R0,4,8; SETT keys1..5 with values10..50; LEN R3; delete2 via SETT;
LEN R4; restore2=20 via SETT; LEN R5; RET R3,3. Historical pre-fix logs:

```
TS:     SETT-LEN 5 1 5 cycles 33
native: SETT-LEN 5 1 4 cycles 33
```

These were actual CPU instruction results, not merely a guessed reachable Table
method difference. Both completed in33 charged cycles. The old logs are not
current passing-parity evidence.

After the native owner fix `f13fad92f`, the same actual instruction sequence
was rerun against the current TS owner and a rebuilt native core. Both return:

```text
SETT-LEN 5 1 5 cycles 33
```

The rebuilt native probe is `/tmp/bmsx-cpu-table-guest-probe-native-fixed`.
Maintained regressions are `tests/lua/table.test.ts:65-118` and
`tests/cpp/table_inspection_test.cpp:55-91`: generic/encoded or numeric-fast,
integer and integer-fast paths refill interior and capacity-boundary holes,
retain false entries, extend through numeric hash keys and allocate no guest
storage during the array refills. This closes the recorded Table producer
difference only; the other CPU questions and unaudited Table scopes remain
separate.
