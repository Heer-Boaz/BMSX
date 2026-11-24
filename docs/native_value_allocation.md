# Native value locations (compiler design)

This is the target design for the C++ baseline compiler, not an ISA change or
a description of an allocator already shipped. SLJIT emits operations on
locations selected by its client. It does not allocate BLua values.

## What is allocated

Use one forward allocator for the region CFG. Allocate components of **value
definitions**, not pairs of registers per stack slot. A slot names an
architectural destination; it can successively contain unrelated definitions,
and a MOV can make several destinations name one definition. Today's
NativeValueId is scoped: equal IDs from two scopes do not establish identity.
Block inputs name parameters; each incoming edge supplies the current
definition for each live parameter. A public entry supplies those parameters
from its admitted frame. This also gives loop headers names independent of
which predecessor happens to be emitted first.

IR owns consumer requirements, slot definitions and semantic exit points.
For example a nil test consumes a tag, integer addition consumes two proved
words, and passing an unknown value to a table store consumes both planes.
A type guard is a use; its success establishes a fact only on that path.
A known tag is reconstructible, not a register reservation. ARM integer and
floating register classes are distinct; moving a payload between classes is a
bit transfer unless the IR actually requests a numeric conversion.

SLJIT lowering owns physical registers, ABI constraints, locations and edge
moves. Keep next-use eviction among eligible unpinned locations; do not import
a trace allocator's reverse traversal into this forward CFG compiler. Retain
the existing cycle-resolving parallel move emitter. Assign from workspace
storage reused per compilation, not runtime objects per value or per guard.

## Two reasons to retain a value

An instruction's inputs demand components for execution. Separately, an exit
demands the frame at its *specified* guest boundary, including slots observable
by a debugger even when no later native instruction reads them. Keep the
existing PC, top and paid-prefix plan. Associate each dirty architectural
destination with its reaching definition there. Only changed locations need
entries in a restoration map. A component is recoverable from a coherent
guest slot, immediate, host register or native spill. A guest slot ceases to
be a restore source when overwritten or exposed to a writer; a mutable table
or global is not a replayable load.

Thus in `a = t[k]; if a == nil ...` only the tag feeds the comparison.
If an intervening exit exposes a, its payload must nevertheless be recoverable:
reuse an existing coherent copy or retain the loaded word. It is not correct
to reload t[k] in the exit stub. With no exit and a subsequent overwrite of a,
that unused word needs neither a load nor a spill. On eviction, discard a
dead component, reuse a valid restore source for a live component, and spill
only when it otherwise loses its last copy. For GC, reconstruction after a
call is too late: roots must be visible *before* a collecting helper runs.

## Joins, calls and publication

Choose a single layout for the live inputs of each joint block, using the
first incoming layout filtered to its required components as the baseline
merge target. Fix loop-header destinations before lowering backedges. Only
retain type facts valid at the destination. A clean memory copy is usable
after the join only if it is coherent on *every* incoming path (or was made
so on the incoming edge). Subsequent edges reconcile in parallel; do not
flush all values because there are two predecessors. Conversely a location
for which all inputs already reside in memory need not occupy a register.
A public-entry stub imports the same layout *after* validating admission;
short grants and failed guards reconstruct their own pre-transfer state.

Record two independent properties at calls: the ABI clobber set, and the
architectural state the callee can observe or modify. For a word-only leaf
helper with no guest observation, preserve only live clobbered locations.
For a frame reader publish its read set first. For an open upvalue write,
invalidate the affected slot's restore source; a call which may activate guest
code or relocate the window needs a fully reconstructible activation and
rebound bases. Classify from helper bodies including exceptional paths, not
from the presence of a C call or its opcode name.

## Acceptance boundary

First vertical slice: a table/global read followed by a nil test, a diamond
with distinct incoming values for the same slot, and an exit before overwrite.
Drive the same body through both predecessors, its public entry, a backedge and
an insufficient grant. Compare restored raw words (including NaN payloads),
tags, PC, top and remaining cycles with scalar execution. Include a helper
that observes an open slot and a collecting call with a live reference.
Replace the producer-local next-use policy only when consumer and recovery
requirements cover its behavior.

Separately compare executed ARM on the unchanged Pietious construction path:
distinguish demanded table loads from guest-slot reloads, parallel moves,
native spills, helper entries and exit stores. Report whole foreground work,
worker work, compilation cost and emitted bytes independently. Neither fewer
local moves nor a different code layout establishes a Mini frametime gain.

## Implementation precedents

- [LuaJIT ARM loads and stores](https://github.com/LuaJIT/LuaJIT/blob/96f7b297326e9fd454b7186c6858b2773f94a0dc/src/lj_asm_arm.h#L1152-L1221)
  and [snapshot uses](https://github.com/LuaJIT/LuaJIT/blob/96f7b297326e9fd454b7186c6858b2773f94a0dc/src/lj_asm.c#L952-L1008): separate operand demand from exit demand.
- [Luau's forward allocator](https://github.com/luau-lang/luau/blob/0.727/CodeGen/src/IrRegAllocA64.cpp#L612-L699):
  eviction and restore sources. A64 is a design reference, not the Mini ABI.
- [Liftoff merge targets](https://github.com/v8/v8/blob/12.4.254.21/src/wasm/baseline/liftoff-assembler.cc#L73-L151):
  a common destination layout with incoming transfers.
- [QEMU TCG call lowering](https://github.com/qemu/qemu/blob/v10.1.0/tcg/tcg.c#L6154-L6171):
  guest coherence and calling-convention clobbers are different obligations.
