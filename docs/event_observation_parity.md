# Event observation: machine-equivalence correction

## Decision and representation gate (2026-10-05, before runtime edits)

Debug metadata may describe execution; it must not change executable code,
constants, allocation, cycles or interrupt admission at the same optimization
level. The `hostTraceChannels` native-call route violates that rule and is to
be removed, including its guest primitive and bootstrap exception. Emitted
guest trace sinks remain confined to explicitly derived Scenario cartridges.

Production references studied: [MAME instruction observation](https://github.com/mamedev/mame/blob/master/src/emu/debug/debugcpu.cpp)
and [QEMU host translation callbacks](https://github.com/qemu/qemu/blob/master/accel/tcg/plugin-gen.c).
Observation belongs to host execution dispatch, not to extra guest operations.
Neither reference establishes BMSX performance; that requires measurement.

| Representation | TypeScript | C++ | Owner |
| --- | --- | --- | --- |
| Observed locations | domain-indexed sets of physical PCs | domain-indexed `unordered_set<u32>` | host CPU inspection configuration |
| Observation callback | `(domain, pc, ValueSlots) => void` | callback/context with borrowed `const Value*` | CPU, read-only and synchronous |
| Cached dispatch | `DecodedDispatchOp.Observe` | same enum | host-only decode cache; never a ROM opcode |
| Underlying instruction | existing raw decoded opcode/operands | same | unchanged CPU datapath |
| Event binding | source/function/inline identity and live local-slot metadata | no native Studio | IDE source tooling |
| Event evidence | existing bounded typed snapshots/ring | no native Studio | IDE, outside save-state |

Hot callsites affected: TS `CPU.decodeInstruction`, `runUntilDepthInstrumented`,
`executeInstruction`; C++ `CPU::decodeInstruction`, `runLoop` dispatch. The
normal execution loop keeps its existing dispatch with no additional per-PC
lookup. Decode installs observation only at selected PCs and prevents fusion
across such a boundary. Cold rebinding invalidates cached dispatch, including
predecessors. The selected dispatch observes before executing the original
instruction and charges exactly that original instruction once. Interrupts,
fetch faults and source stops retain their existing precedence. Observation
does not stop execution, evaluate Lua, retain borrowed registers or modify
guest memory. Its host cost is not subtracted from guest cycle accounting.

The source owner binds once per installed media revision, including inlined
locations. Missing symbols/functions/argument locations are explicit tool
availability, never guessed parameter slots. Rewind suppresses duplicate
evidence using the existing history owner; it does not alter execution.

Validation must cover executable equality, observed/unobserved complete state
and cycles, source-stop ordering, inline/nested events, fusion boundaries,
cache rebinding/invalidation and native parity. Timing and actual Studio
operation are independent of compilation/unit-test results.

## Result

The guest transport has been removed and sparse observation is implemented in
both CPUs. See [validation](studio_event_viewer.md#validation-of-the-host-only-correction-2026-10-05).
ROM packages are not byte-identical: debug source/symbol payloads can relocate
physical function addresses. The fixed-address executable gate compares bytes;
the real packer gate compares erased side effects, constants, instruction size,
results, cycles and guest allocations. This distinction must not be hidden by
pretending that metadata-bearing packages themselves have identical bytes.

Inlining can optimize parameter locations out of the current debug metadata.
The binder reports `arguments-unavailable` rather than guessing a caller slot,
keeping guest argument copies alive or disabling optimization. Ordinary cartlib
emission remains available and has been exercised at both O0 and O3. Inlined
entry points without unavailable argument reads are covered separately.
