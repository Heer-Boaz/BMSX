# CPU frozen source index and stopped claims

2026-10-17; instruction baseline375de6170, value supplement baseline5a5a26e15.
Current software is the authority. This is a
facts index, not chapter prose. No architecture document or historical reference
PDF was used. All instruction families have separate paired-owner extractions.

- [Installed model configuration](cpu-installed-model.md): actual product
  selection and consumers establish33,868,800Hz and4MiB, not an all-overrides claim.
- [Instruction/fetch/charge/reset boundaries](cpu-boundaries.md): paired
  decode and scheduling, encoding limits versus allocated frame resources.
- [Opcode identities, selectors and base costs](cpu-opcodes.md): all64
  identities and192 mirrored table cells agree.
- [Values/numeric operations](cpu-numeric.md): constant/copy, arithmetic,
  bitwise, shifts, truth, length, concat and predicates.
- [Calls and object operands](cpu-calls.md): frame counts/top, closures/upvalues,
  separate globals, table/method operand sources and builtin additional charges.
- [Memory and control](cpu-memory-control.md): six scalar kinds, readiness and
  partial effects, counted stores, branches, CP0/EXEC/RFE/HALT.
- [Ordinary source operators](cpu-source-operators.md): owning producer's
  spellings/lowering, not an assumption of stock Lua or one instruction per line.
- [Logical expressions](cpu-logical-expressions.md): actual left-first short-circuit
  lowering, selected one-result operands, paired truth and Boolean NOT; the
  public-reader numeric-flag gap is resolved without a foreign Lua assumption.
- [Ordinary BLua control forms](cpu-source-control.md): actual cop0 members,
  halt statement, generated RFE return and installed BIOS precedents.
- [Complete executable BLua example](cpu-example.md): actual cartridge source,
 26 retained observations and separate ordinary diagnostic output.
- [Bounded actual paired decode/cost replay](cpu-replay.md):12 raw programs,
 13 exact common output rows, not native execution of the new ordinary cartridge.

- [Default Number text conversion](cpu-number-format.md): complete finite
  normalization/rounding/carry/notation, separate nonfinite consumer spellings.
- [POW special cases](cpu-pow-special.md): ordered zero/NaN/infinite exponent,
  signed special bases, represented exponent parity and range limits.
- [Table keys and mutation boundaries](cpu-table-semantics.md): nil-key fault,
  NaN/zero/identity equality, deletion and table-only index chain; stopped
  cross-capacity length-refill producer disagreement.
- [Narrow installed table globals](cpu-table-bios.md): real set/getmetatable,
  rawget/rawset signatures and faults, not a complete builtin reference.
- [Value supplement bounded execution](cpu-values-execution.md):174 common
  numeric rows;29 common/one differing direct Table rows; actual guest SETT/LEN
  proof of the length mismatch, not an invented common result.
- [Complete value and Table cartridge](cpu-values-example.md):136 literal source
  lines,68 retained checks and separate ordinary diagnostic output.

## Stops; no editorial runtime repair

1. LOADKR exceptional indices: TS passes a Number unchanged to typed constant
   arrays; native first casts to size_t. See numeric STOP-1 for both locations.
2. LOADNIL count0 top: TS empty loop leaves top; native raises to A even at0.
   See numeric STOP-2. Both write no values, but no shared top effect is taught.
3. Scalar memory kinds outside0..5: TS absent alignment/switch path and native
   unchecked array/unreachable path do not establish a common output/trap.
   See memory/control X01. Sequence C remains a count, not a scalar kind.
4. Simultaneous requested yield plus HALT/hard-halt/blocked state has a paired
   run-boundary precedence disagreement already isolated in SYSTEM. No guest
   reachability or common output consequence has been established.
5. Decode/reset boundary extraction separately audits sequential/skip PC at
   the top of the address space and zero-maxStack clearing. Do not infer a
   common modulo32 sequential PC or spare-slot initialization promise.

6. Table general numeric boundary refill: TS scans into numeric hash keys;
   native generic SETT/rawset scans only its allocated array slots, unlike its
   SETI path. Actual paired SETT/LEN program returns5 versus4 after the same
   fill/delete/refill sequence, both33 cycles. The key above that boundary
   remains present. Exact owners and bounded replay are retained separately.

The instruction reference states the proven common domains; narrowing prose
is not closure of these representable-state questions. Publication approval
must not be inferred from successful execution, source accuracy or PDF length.

## Further reference coverage, not mirror disagreements

The finite Number formatting and full special-base POW references have now
been extracted separately, with bounded paired replay. Table key admissibility,
missing-key, deletion and metatable lookup are likewise extracted; a complete
common mutation-length contract is stopped by the seventh paired difference,
not closed by a single working example. The separate
[protected-call/coroutine chapter](../coroutines.md) now supplies all eleven
installed interfaces with a complete ordinary example. The separate
[BIOS base-services chapter](../bios-base.md) now covers the twelve remaining
base globals. The [BIOS table-library draft](../bios-table.md) now documents
all six shared source procedures and a complete ordinary program, but retains
the seventh length-producer stop as a publication blocker. Other installed
libraries and on-console environment references remain unfinished.
The current instruction manuscript remains a draft; no successful source,
reader or PDF pass constitutes whole-manual completion.


## Separate compiler producer question

The base-services paired replay found a source-level signed-zero difference:
`tostring(-0)` yields `-0` at O0 and `0` at O3 on both owners of each linked image.
Actual negative zero returned by `tonumber('-0')` formats as `-0` at both levels;
the formatter's input contract is not the disagreement. Exact observed rows,
producer locations and the not-yet-fully-traced rewrite scope are retained in
[bios-base BZ01](bios-base.md). No universal source-literal sign-preservation
promise or compiler repair is inferred. This is separate from the seven
runtime-owner questions, not an eighth runtime-mirror discrepancy.
