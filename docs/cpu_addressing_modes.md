# BMSX CPU Addressing Modes

## Motivation

The BMSX VM currently requires two instructions and a temporary register to
write a value at a compile-time-known byte offset from a base address:

```
ADD       r_addr, r_base, #48    ; compute field address (1 instruction + 1 temp register)
STORE_MEM r_val, r_addr, F32     ; write
```

For struct field writes where the offset is known at compile time, the `ADD`
and the temporary register are pure overhead. This proposal removes them by
adding dedicated `LOAD_MEM_D` / `STORE_MEM_D` / `STORE_MEM_WORDS_D` opcodes
with a base register plus an immediate 8-bit word-unit displacement.

---

## Opcode cleanup

`OPCODE_COUNT = 64` and the enum is full. Seven opcodes are dead or duplicated
and can be cleaned up, freeing slots for the three new displacement opcodes
and leaving four spare slots for future use.

### Opcodes to remove

| Dead opcode | Why unused |
|---|---|
| `GETG` | Compiler always emits slot-based `GETGL` / `GETSYS`; string-keyed global access is never used |
| `SETG` | Same |
| `LOADBOOL` | Replaced by `KFALSE` / `KTRUE`; SSA still recognises it but never produces it |
| `TEST` | Never emitted by the compiler; no equivalent pattern exists in BMSX Lua output |
| `TESTSET` | Same |

### Opcode rename: `BR_TRUE` / `BR_FALSE` → `JMPIF` / `JMPIFNOT`

`BR_TRUE` and `BR_FALSE` are the names the compiler currently uses for
conditional jumps. `JMPIF` and `JMPIFNOT` already exist in the enum with
identical CPU dispatch — same semantics, same encoding, just a different name.
The Lua-conventional names (`JMPIF` / `JMPIFNOT`) are clearer about what the
opcode does.

Action: migrate the compiler from `BR_TRUE`/`BR_FALSE` to `JMPIF`/`JMPIFNOT`
at the same enum positions, then remove `BR_TRUE` and `BR_FALSE` as dead slots.

### Slot budget

| Action | Slots freed |
|---|---|
| Remove `GETG`, `SETG`, `LOADBOOL` | 3 → used for `LOAD_MEM_D`, `STORE_MEM_D`, `STORE_MEM_WORDS_D` |
| Remove `TEST`, `TESTSET` | 2 → spare |
| Remove `BR_TRUE`, `BR_FALSE` (replaced by `JMPIF`/`JMPIFNOT`) | 2 → spare |
| **Total freed** | **7 (3 used + 4 spare)** |

### Files to clean up

- `opcode_info.ts` / `opcode_info.h`: replace the seven entries
- `cpu.ts` / `cpu.cpp`: remove dispatch cases for `GETG`, `SETG`, `LOADBOOL`,
  `TEST`, `TESTSET`, `BR_TRUE`, `BR_FALSE`
- `disassembler.ts`: remove name/format entries for all seven
- `compiler.ts`:
  - remove `GETG` / `SETG` from `isConstBxOp` / `isGlobalSlotOp`
  - change all `BR_TRUE` → `JMPIF`, `BR_FALSE` → `JMPIFNOT` emit sites
- `optimizer/ssa.ts`: remove `LOADBOOL` handling from `collectDefs`,
  `isHoistableInstruction`, `isControlFlowInstruction`, loop-invariant code
  motion, and all remaining switch arms; remove `BR_TRUE`/`BR_FALSE` arms
  (replace with `JMPIF`/`JMPIFNOT`); remove `TEST`/`TESTSET` arms
- `control_flow.ts`: remove `LOADBOOL` arms; replace `BR_TRUE`/`BR_FALSE`
  with `JMPIF`/`JMPIFNOT`

---

## New opcodes

### `LOAD_MEM_D`

```
A  = destination register
B  = base address register
C  = MemoryAccessKind  (3 bits, values 0..5)
ext = 8-bit displacement in 4-byte units → effective range 0..1020 bytes
```

```
effective_addr = reg[B] + (ext << 2)
reg[A]         = read(effective_addr, access_kind[C])
```

### `STORE_MEM_D`

```
A  = value register
B  = base address register
C  = MemoryAccessKind
ext = 8-bit displacement in 4-byte units → 0..1020 bytes
```

```
effective_addr = reg[B] + (ext << 2)
write(effective_addr, access_kind[C], reg[A])
```

### `STORE_MEM_WORDS_D`

```
A  = first value register
B  = base address register
C  = word count
ext = 8-bit displacement in 4-byte units → 0..1020 bytes
```

Contiguous word-store with a displaced base. Same semantics as `STORE_MEM_WORDS`
but address is `reg[B] + (ext << 2)` instead of `reg[B]`.

---

## Displacement range

`MemoryAccessKind` has 6 values (Word, U8, U16LE, U32LE, F32LE, F64LE) — 3
bits, fits in C with room to spare.

**Why 4-byte units?**

All BMSX struct fields that are 4 bytes or larger (`u32`, `i32`, `f32`, `addr`,
`word`) are naturally 4-byte-aligned. The 4-byte stride gives:

```
8 bits × 4 bytes = 1020-byte maximum displacement
```

This covers every realistic RPU/VDP packet struct and scene-buffer record. The
largest current struct-like block in `cart.lua` is the joint skeleton at 384
bytes; the largest single scene-buffer record with camera constants and MVP is
under 256 bytes.

For `U8` and `U16LE` fields at non-word-aligned byte offsets, the compiler
falls back to the existing `ADD + LOAD_MEM/STORE_MEM` path. Such fields are
uncommon in RPU/VDP packet layouts.

---

## Concrete instruction-count wins

### Case 1: mat4 instance — 17 field writes, fixed base

One MVP matrix (16 × f32) + one color word per instance. All offsets 0..64
bytes. Base address is in a register.

| Path | Instructions per instance | Temp registers |
|------|--------------------------|----------------|
| Current | 17 × (ADD + STORE_MEM) = **34** | 1 per field |
| With `STORE_MEM_D` | 17 × **STORE_MEM_D = 17** | 0 |

For 2 instances: 68 → **34** (-50%).

### Case 2: struct array — 8 field writes per loop iteration

```lua
draws[i].vertex_count = n   -- offset 16 bytes into a 32-byte record
```

```
; Current — 4 instructions per field
MUL   r_stride, r_i, #32
ADD   r_base,   draws_addr, r_stride
ADD   r_addr,   r_base, #16       ; ← gone
STORE_MEM r_n,  r_addr, U32

; With STORE_MEM_D — 3 instructions per field
MUL   r_stride, r_i, #32
ADD   r_base,   draws_addr, r_stride
STORE_MEM_D r_n, r_base, U32, ext=4   ; 4 × 4 = 16 bytes
```

For 8 fields per iteration:

| Path | Instructions per iteration |
|------|--------------------------|
| Current | 2 (base) + 8 × (ADD + STORE) = **18** |
| With `STORE_MEM_D` | 2 (base) + 8 × STORE_MEM_D = **10** |

### Case 3: scene buffer — 22 fields per draw record

2D array `scene[pass][draw]`: 16-float MVP + 4-float camera eye + shader +
pipeline + vertex_count. All offsets fit in 1020 bytes.

| Path | Instructions per record update |
|------|-------------------------------|
| Current | 22 × (ADD + STORE_MEM) = **44** |
| With `STORE_MEM_D` | 22 × STORE_MEM_D = **22** |

---

## What does not change

- The instruction word format is unchanged. `MAX_OP_BITS` stays 6.
- The CPU runtime register representation stays a number. No struct type
  information enters the VM.
- Existing `LOAD_MEM`, `STORE_MEM`, `STORE_MEM_WORDS` opcodes are unchanged.
  They continue to be used for constant-pool addresses (absolute MMIO
  addresses like `sys_vdp_fifo`) and for displacements > 1020 bytes.
- The `WIDE` prefix mechanism is unchanged.

---

## Files to change

This is a **mirrored ISA change** and must land in both cores simultaneously.

### TypeScript

| File | Change |
|------|--------|
| `packages/bmsx-console/src/machine/cpu/opcode_info.ts` | Replace the 7 dead slots (see Opcode cleanup section) |
| `packages/bmsx-console/src/machine/cpu/cpu.ts` | Remove 7 dead dispatch cases; add dispatch for `LOAD_MEM_D`, `STORE_MEM_D`, `STORE_MEM_WORDS_D`: decode `ext` as displacement, compute `base + (ext << 2)`, dispatch to existing memory access helpers |
| `packages/bmsx-console/src/machine/cpu/disassembler.ts` | Replace name/format entries for all removed opcodes |
| `packages/bmsx-console/src/machine/cpu/profiler.ts` | Include new memory opcodes in memory-opcode detection |
| `packages/bmsx-console/src/machine/program/compiler.ts` | Rename `BR_TRUE`→`JMPIF`, `BR_FALSE`→`JMPIFNOT`; remove `GETG`/`SETG` from `isConstBxOp`/`isGlobalSlotOp`; add compiler-side emit path: fold `base_reg + word_aligned_const ≤ 1020` into the `_D` variant |
| `packages/bmsx-console/src/machine/program/control_flow.ts` | Remove `LOADBOOL`; replace `BR_TRUE`/`BR_FALSE` with `JMPIF`/`JMPIFNOT` |
| `packages/bmsx-console/src/machine/program/optimizer/ssa.ts` | Remove all `LOADBOOL`, `TEST`, `TESTSET` handling; replace `BR_TRUE`/`BR_FALSE` with `JMPIF`/`JMPIFNOT` |

### C++

| File | Change |
|------|--------|
| `native/machine/machine/cpu/opcode_info.h` | Same replacements |
| `native/machine/machine/cpu/cpu.cpp` | Same dispatch changes |

### Tests

| Test | What it proves |
|------|---------------|
| CPU: `STORE_MEM_D` with `ext = 0` | Writes to base address (identity) |
| CPU: `STORE_MEM_D` with `ext = 12` | Writes to `base + 48` |
| CPU: `LOAD_MEM_D` with `ext = 4` | Reads from `base + 16` |
| CPU: `STORE_MEM_WORDS_D` | Writes N words at `base + (ext << 2)` |
| Compiler: `mem[base_reg + 48] = value` | Emits `STORE_MEM_D` with `ext = 12` |
| Compiler: offset `1024` (> 1020) | Falls back to `ADD + STORE_MEM` |
| Compiler: non-word-aligned offset | Falls back to `ADD + STORE_MEM` |
| Core parity: `npm run audit:core-parity` | Both cores agree |

---

## Implementation order

1. **Compiler rename:** change all `BR_TRUE` → `JMPIF`, `BR_FALSE` → `JMPIFNOT`
   emit sites in `compiler.ts`, `control_flow.ts`, and `ssa.ts`. Verify tests
   still pass — no opcode numbers change yet.
2. **Opcode enum cleanup:** in `opcode_info.ts` and `opcode_info.h`, remove the
   7 dead entries (`GETG`, `SETG`, `LOADBOOL`, `TEST`, `TESTSET`, `BR_TRUE`,
   `BR_FALSE`) and add `LOAD_MEM_D`, `STORE_MEM_D`, `STORE_MEM_WORDS_D` at
   three of the freed positions. Recompile all ROMs.
3. **Remove dead dispatch cases** from `cpu.ts`, `cpu.cpp`, `disassembler.ts`,
   `ssa.ts`, `control_flow.ts`. The three new opcode slots throw `Unknown opcode`
   at this point.
4. **Add CPU dispatch** in `cpu.ts` and `cpu.cpp` for the three new opcodes:
   decode `ext` as displacement, compute `base + (ext << 2)`, reuse existing
   memory access helpers.
5. **Add CPU unit tests** for all three new opcodes.
6. **Add compiler emit path:** fold `base_reg + word_aligned_const ≤ 1020` into
   the `_D` variant in `emitMemoryLoad` / `emitMemoryStore` /
   `emitMemoryStoreWords`.
7. **Add compiler tests.**
8. Run `npm run audit:core-parity`.

---

## Relationship to struct support

Struct support (see `docs/lua_struct_support_plan.md`) is the primary producer
of the `base_reg + compile_time_field_offset` pattern. The `_D` opcodes are not
a prerequisite for struct support — struct field writes compile correctly without
them, using `ADD + STORE_MEM`. Addressing modes are a performance layer added on
top of a working struct compiler.

Recommended order: land struct support (phases 1–3), measure actual `ADD +
STORE_MEM` density in compiled output, then land addressing modes.

