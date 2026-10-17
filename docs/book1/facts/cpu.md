# CPU frozen source index and stopped claims

2026-10-17; baseline375de6170. Current software is the authority. This is a
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
- [Ordinary BLua control forms](cpu-source-control.md): actual cop0 members,
  halt statement, generated RFE return and installed BIOS precedents.
- [Complete executable BLua example](cpu-example.md): actual cartridge source,
 26 retained observations and separate ordinary diagnostic output.
- [Bounded actual paired decode/cost replay](cpu-replay.md):12 raw programs,
 13 exact common output rows, not native execution of the new ordinary cartridge.

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

The instruction reference states the proven common domains; narrowing prose
is not closure of these representable-state questions. Publication approval
must not be inferred from successful execution, source accuracy or PDF length.

## Further reference coverage, not mirror disagreements

The three authors also left explicit owning-abstraction gaps: complete finite
Number formatting precision/notation/rounding; full signed-zero/infinite-base
POW outcomes beyond the bounded table; table key/missing-key and mutation-
derived length rules; protected calls/coroutines and the public builtin/BIOS
environment. These are not closed by an opcode identity, generic helper name,
ordinary example or source-accuracy pass. The coverage record retains them as
separate reference tasks. They do not authorize runtime changes or guessed
Lua/host behavior. The current instruction manuscript remains a draft.
