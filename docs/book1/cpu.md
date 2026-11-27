# BLua32 instruction reference {#sec-cpu}

> WARNING! The behavior of the BLua32 CPU and its instruction set may not fully conform to the Lua standard due to implementation-specific details. Any deviations from the Lua standard should actually be regarded as bugs and not as intended features. Therefore, treat any non-standard behavior in this document as bugs and not as contracts, except for the extensions!

The BLua32 processor executes BLua: each instruction performs one operation
of the language on the registers of the current function, such as an
addition, a table access or a call. Load and store instructions transfer
numbers to and from memory and the device registers.

This chapter is the machine-language reference, for programs written as
instructions and for program tools. A BLua program does not need it; its
operations are described in [BLua programs](blua-programs.md#sec-blua-programs)
and in the BIOS chapters. This chapter describes the instruction encoding, the
values the instructions operate on, their timing and the CP0 control
registers. The address map is
described in [[Memory](memory.md#sec-memory)]{.content-visible when-format="html"}[Book I, Chapter 2]{.content-visible when-format="pdf"},
program records in [Program images and startup](program-images.md#sec-program-images),
interrupts in [[IRQ](irq.md#sec-irq)]{.content-visible when-format="html"}[Book I, Chapter 3]{.content-visible when-format="pdf"}
and the monitor in [[SYSTEM](system.md#sec-system)]{.content-visible when-format="html"}[Book I, Chapter 12]{.content-visible when-format="pdf"}.

## Programming model {#sec-cpu-programming-model}

Each function has its own registers, which hold the values used by arithmetic,
branches and calls. Memory holds instructions, static data, buffers and device
registers. Load and store instructions connect the two: a load reads bytes
from memory as a number, a store writes a number to memory.

| Operation | Operands | Result |
|---|---|---|
| Arithmetic, comparison | Registers or constants | A value, or a skip of the next instruction |
| Call | A closure and arguments | A new function frame; results are returned to the caller |
| Load, store | Byte address and format | A number read from, or written to, memory |
| Device access | Register address and value | A device command or result |
| Exception | Interrupt or fault | CP0 registers saved; the exception function entered |

R0 of a function is its own register; R0 of a called function is a different
one. A call saves the caller's continuation and starts the called function at
the code address of its closure. A return places the results in the caller's
registers.

To use a device, prepare its data, write its command register, and wait for
its status or interrupt before reusing the data; see
[[Memory](memory.md#sec-memory-device-specific-buffer-lifetimes)]{.content-visible when-format="html"}[Book I, §2.11]{.content-visible when-format="pdf"}.

### Values {#sec-cpu-values-are-not-register-words}

A register holds a value of one of these kinds: nil, false, true, Number,
String, Table, Closure, BuiltinFunction and Thread. Copying a register copies
the value with its kind: false stays false, and a table reference still refers
to the same table.

A Number is either an **Integer**, a signed 32-bit value (−2147483648 to
2147483647), or a **Float**, an IEEE 754 single-precision value with fractions,
signed zero, infinities and NaN. Integer arithmetic wraps at 32 bits; Float
arithmetic rounds to single precision. An Integer and a Float of the same value
are equal but keep their kinds.

Loading a 32-bit word gives an Integer with the same bits: `FFFFFFFFH` is −1.
Bitwise operations act on these bits. Addresses use the bits as an unsigned
number.

Arithmetic needs Number operands; other kinds raise `INVALID_ARGUMENT` (10).
Strings are not converted to numbers and booleans are not converted to 0 or 1.
In conditions, only nil and false are false; the number 0 is true.

### Notation {#sec-cpu-values-and-register-notation}

| Notation | Meaning |
|---|---|
| `R(i)` or `R[i]` | Register i of the current function |
| `K(i)` or `K[i]` | Constant i of the program |
| `RK(x)` | `R(x)` if x ≥ 0, otherwise `K(−1 − x)`; thus `RK(−1)` is `K(0)` |
| `top` | One past the last register in use; a range from A holds max(top − A, 0) values |
| `index(base, key)` | Table lookup or assignment |

Writing a register sets `top` to at least one past that register, unless the
instruction says otherwise.

### Example: loading bytes {#sec-cpu-from-stored-bytes-to-a-frame-value}

Memory holds four bytes:

| Address | `p` | `p+1` | `p+2` | `p+3` |
|---|---|---|---|---|
| Byte | `78H` | `56H` | `34H` | `12H` |

With R1 = p:

| Instruction | Operands | Result |
|---|---|---|
| `LOAD_MEM 0,1,2` | R0 ← halfword at R1 (format 2) | R0 = 22136 (`5678H`) |
| `LOAD_MEM 2,1,3` | R2 ← word at R1 (format 3) | R2 = 305419896 (`12345678H`) |

The format selects how many bytes are read and how they form a number. The
formats are listed under [memory transfers](#sec-cpu-memory-transfers).

### Example: a call {#sec-cpu-following-a-closure-call}

A call to the function whose record is at `10001230H`:

| Step | Effect |
|---|---|
| CLOSURE: closure of the function in R3 | R3 holds the function |
| `CALL 3,1,2` | Call R3 with no arguments (B = 1), one result (C = 2) |
| Return | The result replaces R3 (nil if there is none); the caller continues after CALL |

The called function has its own R0 and following registers. See
[calls](#sec-cpu-calling-and-returning-values) and the
[encoding example](#sec-cpu-linkage-operands-and-encoding-examples).

## Example: numbers and bytes {#sec-cpu-worked-computation-numbers-words-and-stored-bytes}

```lua
module<entry>
rodata operands: i32[2] = { -7, 3 }
rodata bytes: u8[4] = { 0x78, 0x56, 0x34, 0x12 }
bss word_result: word
bss rounded: f32

local numbers<const>: *i32 = operands
local halves<const>: *u16 = bytes
local whole<const>: *u32 = bytes
local quotient = numbers[0] / numbers[1]
local floor_quotient = numbers[0] // numbers[1]
*word_result = 0x80000000
*rounded = 16777216.0 + 1.0
```

| Expression | Value | Reason |
| --- | --- | --- |
| `quotient` | ≈ −2.33333325 | `/` gives a Float |
| `floor_quotient` | −3 | `//` rounds down |
| `numbers[0] % numbers[1]` | 2 | The remainder has the sign of the divisor |
| `-numbers[0] % -numbers[1]` | −2 | |
| `*word_result` | −2147483648 (`80000000H`) | All 32 bits are kept |
| `*word_result >> 1` | 1073741824 | `>>` shifts in zeros |
| `1 << 32`, `8 << -1` | 0, 4 | Shifts of 32 or more give 0; negative counts shift the other way |
| `halves[0]`, `halves[1]` | `5678H`, `1234H` | Little-endian |
| `*whole` | `12345678H` | |
| `*rounded` | 16777216.0 | Single-precision rounding |

## Instruction format {#sec-cpu-instruction-words-and-execution-resources}

| Item | Specification |
|---|---|
| Clock | 33,868,800 Hz |
| Instruction | 32 bits, little-endian; 64 bits with a WIDE prefix |
| Opcode | 6 bits |
| Numbers | Integer (32 bits) or Float (single precision) |
| Registers | Per function; the function record gives the parameter count and the number of registers |

### Fields {#sec-cpu-word-fields}

| Bits | `31:24` | `23:18` | `17:12` | `11:6` | `5:0` |
|---|---|---|---|---|---|
| Field | `EXT` | Opcode | A | B | C |

| Format | Without WIDE | With WIDE | EXT |
|---|---|---|---|
| ABC | A: 8 bits; B, C: 9 bits | A: 14 bits; B, C: 15 bits | Bits 7–6 extend A, 5–3 extend B, 2–0 extend C |
| Bx | A: 6 bits; Bx: 20 bits | A: 12 bits (14 for CLOSURE); Bx: 26 bits | Bx bits 19–12; B and C give bits 11–0 |
| Displacement | A, B, C: 6 bits | A, B, C: 12 bits | Word displacement, 8 bits unsigned |

Bx format is used by LOADK, KSMI, the three branches, CLOSURE and the four
global-name instructions; displacement format by the memory instructions
ending in `_D`; ABC by all others.

### WIDE — opcode 00H {#sec-cpu-wide-opcode-00h}

WIDE precedes an instruction and supplies the upper bits of its operands: for
ABC, A from bit 8 and B, C from bit 9; for displacement, A, B, C from bit 6; for
Bx, A from bit 6 and Bx bits 25–20 (from the WIDE B field). The EXT byte of a
WIDE before `SETFIELD` requests 0 to 255 extra hash slots when the table must
grow; for other instructions it is ignored.

For `CLOSURE`, WIDE C bits 1–0 give A bits 13–12, and WIDE C bit 5 selects the
register form (Bx is a register holding the function-record address); without
it, Bx × 16 is the function-record address.

WIDE followed by another WIDE stops the CPU (hard halt). WIDE takes no cycles.

### Encoding {#sec-cpu-constructing-instruction-bytes}

```text
word = (E << 24) | (opcode << 18) | (a << 12) | (b << 6) | c
```

The word is stored least significant byte first.

| Format | a, b, c | E | WIDE fields pA, pB, pC |
|---|---|---|---|
| ABC | `a=A&63`, `b=B&63`, `c=C&63` | `(((A>>6)&3)<<6) \| (((B>>6)&7)<<3) \| ((C>>6)&7)` | `pA=A>>8`, `pB=B>>9`, `pC=C>>9` |
| Bx | `a=A&63`, `b=(U>>6)&63`, `c=U&63` | `(U>>12)&255` | `pA=(A>>6)&63`, `pB=U>>20`, `pC=0`; for CLOSURE `pC=(A>>12) \| (flag<<5)` |
| Displacement | `a=A&63`, `b=B&63`, `c=C&63` | `disp` | `pA=A>>6`, `pB=B>>6`, `pC=C>>6` |

U is Bx; a negative Bx is encoded as a 20-bit (26-bit with WIDE) two's
complement number. A negative RK operand is encoded in 9 (15) bits. The WIDE
word has opcode 0.

| Instruction | A | B | C | Word | Bytes |
|---|---:|---:|---:|---|---|
| `LOAD_MEM 0,1,2` | 0 | 1 | 2 | `00C40042H` | `42 00 C4 00` |
| `LOAD_MEM 2,1,3` | 2 | 1 | 3 | `00C42043H` | `43 20 C4 00` |

### Calls and branches {#sec-cpu-linkage-operands-and-encoding-examples}

A call is made with `CLOSURE` followed by `CALL`. The immediate operand of
CLOSURE is the **function-record address divided by 16**. Without WIDE it
reaches up to `00FFFFF0H`, with WIDE up to `3FFFFFF0H`; a function in cartridge
ROM therefore needs WIDE. In the register form, the register holds the full
address.

Constant and global-name operands are indices into the program's tables, not
addresses; see [program images](program-images.md#sec-memory-blua32-executable-image).

| Operation | Bytes | Operands |
|---|---|---|
| Closure of the record at `10001230H` in R3 | `00 04 00 00 23 31 AC 00` | pB = 10H, Bx = `01000123H`; × 16 = `10001230H` |
| Closure of the address in R5, in R3 | `20 00 00 00 05 30 AC 00` | Register form, Bx = 5 |
| Call R3, no arguments, one result | `42 30 BC 00` | `CALL A=3, B=1, C=2` |
| Jump to itself, without WIDE | `FF 0F A0 FF` | Bx = −1 |
| Jump to itself, with WIDE | `C0 0F 00 00 FE 0F A0 FF` | Bx = −2 |

A branch offset is counted in words from the end of the branch instruction
(including WIDE) to the target; see [branches](#sec-cpu-branches).

### Registers and constants {#sec-cpu-register-and-constant-selection}

An RK operand is a signed 9-bit (15-bit with WIDE) value. A value ≥ 0 selects a
register; a negative value selects constant −1 − RK. So RK reaches R0–R255 or
K0–K255, and with WIDE R0–R16383 or K0–K16383.

A constant must exist; a field name must be a String constant. Otherwise the
instruction raises `INVALID_ARGUMENT` (10) before it reads or writes anything.
A skipped instruction raises no fault.

A function has as many registers as the largest of 1, its declared number of
registers and its parameter count. Missing parameters are nil. Registers at or
above `top` are not kept across calls. Accessing a register outside the
function's registers, or a captured variable that the closure does not have,
raises `INVALID_ARGUMENT` (10).

### Function records and code {#sec-memory-execution-addresses-and-instruction-reads}

#### Function records {#sec-memory-function-records-and-instruction-addresses}

A function address is the address of a **function record**, whose
`CODE_ADDRESS` word gives the address of the first instruction. Both are
little-endian.

#### Execution domains {#sec-memory-execution-domains-and-cartridge-sockets}

| Domain | Program |
|---|---|
| −1 | System ROM |
| 0 | Cartridge slot 0 |
| 1 | Cartridge slot 1 |

A cartridge program reads its instructions from its own cartridge slot.

### Instruction fetch {#sec-cpu-fetch-and-conditional-skip}

#### Alignment and faults {#sec-memory-instruction-alignment-and-read-faults}

The PC is a 32-bit byte address and must be a multiple of 4; otherwise the
fetch raises `AddressErrorLoad`. Instructions can be fetched from system ROM,
main RAM below [`RAM_END`](memory.md#sec-memory-language-heap) (outside the
I/O area), and cartridge ROM and RAM. The I/O areas and main RAM from `RAM_END`
up supply no instructions: a fetch there is a bus fault. A bus fault during a fetch
raises `InstructionBusError`, with EPC at the start of the instruction (the
WIDE prefix, if any). A fetch exception takes 1 cycle.

The instruction before a failing fetch is completed.

An instruction that skips the next instruction skips it as a whole, WIDE
included; the skipped instruction takes no cycles.

## BLua operators {#sec-cpu-blua-operators-and-instruction-costs}

| Operator | Instructions |
|---|---|
| `+`, `-`, `*`, `/` | `ADD`, `SUB`, `MUL`, `DIV` |
| `//`, `%`, `^` | `FLOORDIV`, `MOD`, `POW` |
| `&`, `\|`, `~` | `BAND`, `BOR`, `BXOR` |
| `<<`, `>>` | `SHL`, `SHR` |
| Unary `-`, `not`, `#`, `~` | `UNM`, `NOT`, `LEN`, `BNOT` |
| `==`, `~=` | `EQ` |
| `<`, `<=` | `LT`, `LE` |
| `>`, `>=` | `LT`, `LE` with the operands exchanged |
| `..` | `CONCAT`, `CONCATN` |

`#` of a declared static array is its fixed length. Comparisons skip the next
instruction; producing a Boolean from a comparison takes further
instructions. `and` and `or` are described in
[BLua — Logical expressions](blua-programs.md#sec-cpu-logical-expressions).

## Value and arithmetic instructions {#sec-cpu-values-and-numeric-instructions}

### Instruction tables {#sec-cpu-reading-the-instruction-tables}

In the tables, A is the destination register unless stated otherwise. For
comparisons A is the expected result.

| Operand | Without WIDE | With WIDE |
|---|---:|---:|
| RK B or C | R0–R255 or K0–K255 | R0–R16383 or K0–K16383 |
| A, ABC format | 8 bits | 14 bits |
| A, Bx format | 6 bits | 12 bits (14 for CLOSURE) |
| LOADK Bx | 20 bits unsigned | 26 bits unsigned |
| KSMI sBx | −524288 to 524287 | −33554432 to 33554431 |

The Cycles column gives the time of each instruction; see
[instruction timing](#sec-cpu-cycle-accounting-and-execution-boundaries).

### Constants and copies {#sec-cpu-constants-and-copies}

| Mnemonic | Opcode | Operands | Function | Cycles |
|---|---:|---|---|---:|
| MOV | `01H` | A, B; C kind | Copy R[B] to R[A]; see below | 2 |
| LOADK | `02H` | A, Bx | `R[A] = K[Bx]` | 2 |
| LOADNIL | `03H` | A, B count | `R[A]` to `R[A+B−1]` = nil; B = 0 does nothing | 2 + B |
| KNIL | `05H` | A | `R[A] = nil` | 2 |
| KFALSE | `06H` | A | `R[A] = false` | 2 |
| KTRUE | `07H` | A | `R[A] = true` | 2 |
| K0 | `08H` | A | `R[A] = 0` (Integer) | 2 |
| K1 | `09H` | A | `R[A] = 1` (Integer) | 2 |
| KSMI | `0BH` | A, sBx | `R[A] = sBx` (Integer) | 2 |
| LOADKR | `35H` | A, B | `R[A] = K[R[B]]`; R[B] is an unsigned index | 2 |

LOADNIL 4, 3 writes nil to R4, R5 and R6. LOADKR with an index outside the
constant table raises `INVALID_ARGUMENT` (10).

### MOV {#sec-cpu-numeric-word-moves}

| C | Source | Result |
|---|---|---|
| 0 | Any value | Copy |
| 1 | Float | Integer with the same 32 bits |
| 2 | Integer | Float with the same 32 bits |

Kinds 1 and 2 keep every bit, NaN payloads and the sign of zero included. A
source of the wrong kind raises `INVALID_ARGUMENT` (10). Other values of C raise
Reserved Instruction.

### Arithmetic {#sec-cpu-arithmetic}

| Mnemonic | Opcode | Operands | Result in R[A] | Cycles |
|---|---:|---|---|---:|
| ADD | `11H` | RK(B), RK(C) | B + C | 2 |
| SUB | `12H` | RK(B), RK(C) | B − C | 2 |
| MUL | `13H` | RK(B), RK(C) | B × C | 2 |
| DIV | `14H` | RK(B), RK(C) | B / C (Float) | 32 |
| MOD | `15H` | RK(B), RK(C) | Remainder, with the sign of C | 34 |
| FLOORDIV | `16H` | RK(B), RK(C) | Quotient rounded down | 33 |
| POW | `17H` | RK(B), RK(C) | B to the power C (Float) | 128 |
| UNM | `1FH` | R[B] | −B | 2 |

The operands must be Numbers; otherwise `INVALID_ARGUMENT` (10) is raised and
R[A] is not written. The times do not depend on the operands.

**Integers.** ADD, SUB, MUL, MOD and FLOORDIV with two Integers give an Integer.
ADD, SUB, MUL and UNM wrap at 32 bits: −(−2147483648) = −2147483648. FLOORDIV
rounds down; MOD satisfies a = (a // b) × b + a % b, with a non-zero remainder
having the sign of b. FLOORDIV and MOD by 0 raise `INVALID_ARGUMENT` (10).
−2147483648 // −1 = −2147483648, remainder 0.

**Floats.** If one operand is a Float, the other is converted and the result
is a Float. DIV and POW always give a Float. Rounding is to nearest, ties to
even; subnormal values are kept. A NaN result of an arithmetic instruction is
always `7FC00000H`. UNM of a Float inverts bit 31 only, so −NaN is
`FFC00000H`. Float FLOORDIV rounds down. Float MOD takes the remainder r of the
truncated division and adds b if r and b have opposite signs. Float division
by 0 gives infinity or NaN.

### Bitwise operations {#sec-cpu-bitwise-operations-and-shifts}

| Mnemonic | Opcode | Operands | Result in R[A] | Cycles |
|---|---:|---|---|---:|
| BAND | `18H` | RK(B), RK(C) | B AND C | 2 |
| BOR | `19H` | RK(B), RK(C) | B OR C | 2 |
| BXOR | `1AH` | RK(B), RK(C) | B XOR C | 2 |
| SHL | `1BH` | RK(B), RK(C) | B shifted left by C | 2 |
| SHR | `1CH` | RK(B), RK(C) | B shifted right by C | 2 |
| BNOT | `22H` | R[B] | NOT B | 2 |

The operands must be Integers, or Floats with an exact integer value in the
32-bit range; otherwise `INVALID_ARGUMENT` (10). The result is an Integer.
Shifts fill with zeros; a negative count shifts the other way, and a count of
32 or more gives 0. So `−8 >> 1` is 2147483644, `8 << −1` is 4 and `1 << 32`
is 0.

### Truth, length and text {#sec-cpu-truth-length-and-text}

| Mnemonic | Opcode | Operands | Result in R[A] | Cycles |
|---|---:|---|---|---:|
| CONCAT | `1DH` | RK(B), RK(C) | B and C joined as text | 2 + length |
| CONCATN | `1EH` | B first register, C count | R[B] to R[B+C−1] joined; "" if C = 0 | 3 + C + length |
| NOT | `20H` | R[B] | true if B is nil or false, otherwise false | 2 |
| LEN | `21H` | R[B] | Length of a String or Table | 3 |

Only nil and false are false; 0, NaN and the empty string are true.

LEN gives the number of bytes of a String, or the length of a Table: the first
result of its `__len` method, or otherwise a border of its positive integer
keys (see [table length](#sec-cpu-table-length)). Other values raise a fault.

CONCAT and CONCATN take one cycle per byte of the result. A result must be
shorter than 4 MiB, otherwise `OUT_OF_MEMORY`. The result is written when it is
complete. Values are converted to text as follows:

| Value | Text |
|---|---|
| nil, false, true | `nil`, `false`, `true` |
| String | Its contents |
| Table | `table` |
| Thread | `thread` |
| Closure, BuiltinFunction | `function` |
| NaN, +infinity, −infinity | `nan`, `inf`, `-inf` |
| Other Number | See [number to text](#sec-cpu-default-number-to-text-conversion) |

### Comparisons {#sec-cpu-comparisons-and-conditional-execution}

| Mnemonic | Opcode | Operands | Function | Cycles |
|---|---:|---|---|---:|
| EQ | `23H` | A, RK(B), RK(C) | Skip the next instruction if (B == C) ≠ (A ≠ 0) | 2 |
| LT | `24H` | A, RK(B), RK(C) | Skip the next instruction if (B < C) ≠ (A ≠ 0) | 2 + n |
| LE | `25H` | A, RK(B), RK(C) | Skip the next instruction if (B ≤ C) ≠ (A ≠ 0) | 2 + n |

n is the length of the shorter String when both operands are Strings, otherwise
0.

**Equality.** Values of different kinds are unequal; there is no conversion
between strings, booleans and numbers. Numbers compare by value: 1 == 1.0,
+0 == −0, NaN ≠ NaN. Strings compare by contents; tables, closures and threads
by identity; built-in functions by their number.

**Order.** Two Numbers compare by their exact values, so Integer 16777217 is
greater than Float 16777216.0. NaN is unordered. Two Strings compare byte by
byte (unsigned). Any other combination gives false.

To get a Boolean for `R1 < R2` in R0:

| Address | Instruction | Function |
|---|---|---|
| P | `LT 1,1,2` | If R1 < R2 is false, skip P+4 |
| P+4 | `JMP +2` | To P+16 |
| P+8 | `KFALSE 0` | R0 = false |
| P+12 | `JMP +1` | To P+20 |
| P+16 | `KTRUE 0` | R0 = true |

Both paths take 6 cycles.

### Table iteration {#sec-cpu-table-iteration}

| Mnemonic | Opcode | Operands | Function | Cycles |
|---|---:|---|---|---:|
| ITERN | `0AH` | A iterator, state, control; B first result; C result count | One step of `next` over a table | 8 (+ C) |

ITERN speeds up a `for … in pairs(t)` loop. R[A], R[A+1] and R[A+2] hold the
iterator, the table and the control value (nil at the start). If R[A] is the
built-in `next` and R[A+1] a table, ITERN performs one step: R[B] receives the
next key, R[B+1] its value (if C ≥ 2), the other results nil, and the next
instruction (a branch to the ordinary call of the iterator) is skipped. At the
end all results are nil. This takes 8 + C cycles. Otherwise ITERN does nothing,
takes 8 cycles, and the following branch calls the iterator.

R[A+2] holds the position in the table between steps; do not change it. The
rules for changing a table during `next` apply
(@sec-bios-base-nexttable-key). C = 0 raises `INVALID_ARGUMENT` (10).

## Number details {#sec-cpu-numeric-result-details}

### POW {#sec-cpu-pow-exponentiation}

POW converts both operands to Float and calculates x^y as a Float.

#### Special cases {#sec-cpu-order-of-special-cases}

These rules are applied in order:

1. x^(±0) = +1, for every x (NaN included).
2. 1^y = +1, for every y (NaN included).
3. Otherwise, a NaN operand gives NaN.
4. An infinite exponent:

| \|x\| | y = +infinity | y = −infinity |
|---|---|---|
| < 1 (zeros included) | +0 | +infinity |
| = 1 | +1 | +1 |
| > 1 (infinities included) | +infinity | +0 |

#### Finite exponents {#sec-cpu-finite-nonzero-exponents}

Positive y:

| x | Odd integer | Even integer | Fraction |
|---|---|---|---|
| +0 | +0 | +0 | +0 |
| −0 | −0 | +0 | +0 |
| +infinity | +infinity | +infinity | +infinity |
| −infinity | −infinity | +infinity | +infinity |
| +1 | +1 | +1 | +1 |
| −1 | −1 | +1 | NaN |

Negative y:

| x | Odd integer | Even integer | Fraction |
|---|---|---|---|
| +0 | +infinity | +infinity | +infinity |
| −0 | −infinity | +infinity | +infinity |
| +infinity | +0 | +0 | +0 |
| −infinity | −0 | +0 | +0 |
| +1 | +1 | +1 | +1 |
| −1 | −1 | +1 | NaN |

For other x: a positive x gives a positive result; a negative x with a
fractional y gives NaN; a negative x with an odd y gives a negative result, with
an even y a positive result.

#### Particular exponents {#sec-cpu-specific-finite-exponents}

| y | Result |
|---|---|
| +1 | x |
| −1 | 1/x (−0 gives −infinity, −infinity gives −0) |
| +2 | x × x |
| +0.5 | Square root of x; +0 for ±0, +infinity for ±infinity, NaN for negative x |

#### Odd and even {#sec-cpu-represented-exponent-parity}

Odd and even refer to y after conversion to Float. From 2^23^ every Float is an
integer and from 2^24^ every Float is even. (−1)^16777215 = −1 and
(−1)^16777216 = +1; Integer 16777217 is converted to 16777216.0.

#### Range {#sec-cpu-range-limits-and-subnormal-results}

Subnormal operands and results are kept; overflow gives infinity.

| Expression | Result |
|---|---|
| 2^(−149) | 2^(−149), the smallest subnormal Float |
| 2^(−150) | +0 |
| 2^128 | +infinity |
| (−2)^129 | −infinity |
| (−2)^(−151) | −0 |

### Number to text {#sec-cpu-default-number-to-text-conversion}

#### Integers and special values {#sec-cpu-sign-zero-and-the-integer-shortcut}

An Integer is written in decimal, with `-` if negative. Float zero is `0.0` or
`-0.0`; NaN, +infinity and −infinity are `nan`, `inf` and `-inf`.

#### Rounding {#sec-cpu-normalization-and-rounding}

A Float is rounded to 7 significant decimal digits, to nearest with ties to
even, from its exact binary value.

#### Notation {#sec-cpu-choosing-and-spelling-the-notation}

With e the decimal exponent (one digit before the point): fixed notation for
−4 ≤ e < 7, otherwise scientific notation. Trailing zeros of the fraction are
removed. Fixed notation always has a decimal point (`.0` if needed), so that a
Float is distinguished from an Integer. Scientific notation uses `e`, a sign
and at least two digits.

#### Examples {#sec-cpu-number-to-text-examples}

| Number | Text |
| --- | --- |
| Integer 0, Integer 1000000 | `0`, `1000000` |
| Float +0, Float −0 | `0.0`, `-0.0` |
| Float 2.0 | `2.0` |
| Float 0.1 | `0.1` |
| Float 1000000.0 | `1000000.0` |
| Float 10000000.0 | `1e+07` |
| Smallest subnormal Float | `1.401298e-45` |
| Largest Float | `3.402823e+38` |
| NaN, +infinity, −infinity | `nan`, `inf`, `-inf` |

Different Floats can give the same text.

## Calls, closures, globals and tables {#sec-cpu-calls-closures-globals-and-tables}

### Calls {#sec-cpu-calling-and-returning-values}

Each call has its own registers on the stack of its thread; a function with a
variable number of arguments also keeps its extra arguments. The function
record gives the number of registers. The stack lies in
[BLua storage](blua-system.md#sec-blua-system-blua-storage).

`CALL A,B,C` calls `R(A)` with the arguments in `R(A+1)` and following; the
results replace `R(A)` and following. Registers below A keep their values;
R(A) and above are overwritten. Keep every value that is still needed after the
call, captured variables included, in registers below A.

The first parameter of the called function is the register at `R(A+1)`, so the
arguments are not copied. Registers other than the parameters have no defined
value at entry: initialize them, for instance with `LOADNIL`. Missing
parameters and missing results are nil.

Closures, built-in functions and System ROM functions can be called. Calling
any other value, a number holding a function address included, raises
`CALL_NON_FUNCTION`. A call that finds no room on the stack raises
`OUT_OF_MEMORY` at the CALL.

Counts in CALL, RET and VARARG are encoded the same way: 0 means "all" (open), and
a value n > 0 means n − 1:

| Operand | 0 | n > 0 |
|---|---|---|
| `CALL B`: arguments | R(A+1) to top − 1 | n − 1 arguments |
| `CALL C`: results | All results | n − 1 results |
| `RET B`: results | R(A) to top − 1 | n − 1 results |
| `VARARG B`: extra arguments | All | n − 1, filled with nil |

Example: callee in R3, arguments in R4 and R5, `CALL 3,3,3` passes the two
arguments and places two results in R3 and R4 (nil if there is only one;
further results are discarded). Afterwards top = 5.

With C = 0, top is set to A plus the number of results, so that a following
call or return with an open count passes exactly these results.

At entry, top equals the number of parameters. Excess arguments are kept only
by functions that take a variable number of arguments.

`VARARG A,0` copies the extra arguments to R(A) and following and sets top to
the end of them (to A if there are none). `VARARG A,n` copies n − 1 values,
filled with nil. If there is no room on the stack, VARARG raises
`OUT_OF_MEMORY`.

`RET` closes the captured variables of the function and returns its results.
If there is no room for them in the caller, RET raises `OUT_OF_MEMORY`.

#### Additional cycles {#sec-cpu-value-placement-and-capture-timing}

These operations take **1 cycle per value placed**, in addition to their listed
times:

- `LOADNIL`: per nil written.
- `VARARG`: per value copied or filled with nil.
- A call: per missing parameter filled with nil; for a function with a variable
  number of arguments, per parameter.
- The first resume of a coroutine: per parameter and extra argument; later
  resumes per value received.
- Return, completion of a built-in function, yield, end of a coroutine and the
  end of a protected call: per value received by the caller, nil padding and
  status included. The error value passed to an `xpcall` handler counts as one.

Closing captured variables takes **1 cycle per variable closed** (in `RET`,
`RFE`, error handling and coroutine close). Values that the caller discards are
not counted.

### Closures {#sec-cpu-closures-and-captured-variables}

`CLOSURE` makes a callable value from a function record and the variables it
captures. The function-record address is Bx × 16, or, with the register flag,
the value of R(Bx).

The function record gives the code address, the parameters, the number of
registers, flags and the capture descriptors. Do not change a function record
while closures made from it are in use; use a new record for a new
definition. A bus fault while reading the record or its descriptors stops the
CPU (hard halt).

Each capture descriptor is a 32-bit word, at `upvalueTableAddress + 4i`:

| Bit 31 | Captures |
|---|---|
| 1 | Register (bits 30–0) of the function that executes CLOSURE |
| 0 | Captured variable (bits 30–0) of the closure that executes CLOSURE |

A descriptor pointing outside the registers or captures raises
`INVALID_ARGUMENT` (10). A closure can capture up to 1024 variables; more
raises `OUT_OF_MEMORY`.

Captures of the same register share one variable. When the function returns,
its captured variables are closed: they keep their values, independently of
the registers. `GETUP` and `SETUP` work the same way before and after.

For a STATIC function record without captures, CLOSURE may return the same
value each time; otherwise it makes a new closure each time. Capturing
variables takes extra time. If no memory can be obtained, CLOSURE raises
`OUT_OF_MEMORY`.

For a function record in System ROM, CLOSURE gives a fixed function value
without allocating memory. Such a function can use memory reserved for the
system. Interrupts wait until it returns. An error in it is reported at the
CALL.

### Globals {#sec-cpu-two-global-namespaces}

There are two separate sets of globals: ordinary globals (`GETGL`, `SETGL`) and
system globals (`GETSYS`, `SETSYS`). Bx is an index into the program's name
table of that set. A new name starts as nil. An index outside the table raises
`INVALID_ARGUMENT` (10).

### Table instructions {#sec-cpu-tables-keys-and-method-receivers}

| Instructions | Key |
|---|---|
| `GETT`, `SETT` | RK operand |
| `GETI`, `SETI` | Integer in the instruction |
| `GETFIELD`, `SETFIELD`, `SELF` | String constant |

Reads accept a table, or a string (read through the string table). Other values
raise `INDEX_NON_TABLE`. Writes accept only a table; other values raise
`ASSIGN_NON_TABLE`.

`SELF` copies R(B) to R(A+1) and then reads the field into R(A), so that the
object is the first argument of the method call.

A table constructor gets an empty table from the BIOS and inserts its fields;
see [table construction](bios-table.md#sec-bios-table-construction).

### Table entries {#sec-cpu-table-entries-and-inherited-reads}

A table maps keys to values other than nil.

#### Keys {#sec-cpu-keys-and-presence}

| Key | Matches |
| --- | --- |
| Boolean | The same boolean |
| Number | The same value; +0, −0 and 0 are the same key |
| String | The same contents |
| Table, closure, thread | The same object |
| Built-in function | The same function |

The number 1, the string "1" and true are different keys; Integer 2 and Float
2.0 are the same key. An integral Float key is stored as an Integer. nil and NaN
cannot be keys: a read misses, a write raises `INDEX_NIL` (4) or `INDEX_NAN`
(12), unless `__newindex` handles it.

A value false is present. Assigning nil removes the entry.

#### Table length {#sec-cpu-table-length}

`#t` calls `__len` of the metatable if there is one, with t as both
arguments, and uses its first result. Otherwise it returns a **border** of t: a
number L ≥ 0 such that

- L = 0 or t[L] is not nil, and
- L = 2^31^ − 1 or t[L + 1] is nil.

Only the table's own entries count. For a sequence 1…n without holes the
length is n. A table with holes can have several borders: with keys 1, 3, 4 and
5, both 1 and 5 are borders. Repeated reads without a change return the same
border. Keep a count when holes are possible.

LEN takes 3 cycles, whatever the size of the table; a `__len` method adds its
own time.

#### Metatables {#sec-cpu-metatables-and-indexed-reads}

A read first looks for the key in the table itself; a value (false included)
is returned at once. If it is missing, `__index` of the metatable is used:

| `__index` | Effect |
|---|---|
| Missing | nil |
| Table | The lookup continues in that table |
| Function | Called with the table and the key; its first result is used |
| String | The lookup continues in the string table |
| Other | `INDEX_NON_TABLE` |

A lookup visits at most 32 tables; more raises `METATABLE_LOOP` (5). Each
table after the first adds **8 cycles**.

An assignment to an existing entry changes it directly. For a missing entry,
`__newindex` is used: a table receives the assignment instead; a function is
called with the table, the key and the value. Without `__newindex` the entry is
created. The same limit of 32 tables and 8 cycles apply.

The destination register is written only when the lookup succeeds. `rawget`,
`rawset`, `getmetatable` and `setmetatable` are described in the
[BIOS](bios-base.md#sec-bios-base-table-and-metatable-access).

### Instructions {#sec-cpu-instruction-reference}

The cycles do not include the [additional cycles](#sec-cpu-value-placement-and-capture-timing)
and the time of the called function.

#### Calls and captured variables {#sec-cpu-calls-and-captured-values}

| Instruction | Opcode | Operands | Function | Cycles |
|---|---:|---|---|---:|
| `CALL` | `2FH` | A, B, C | Call R(A); see above | 32 |
| `RET` | `30H` | A, B | Return R(A) and following | 16 |
| `VARARG` | `2EH` | A, B | Copy the extra arguments to R(A) | 3 |
| `CLOSURE` | `2BH` | A, Bx, flag | Closure in R(A) | 8 |
| `GETUP` | `2CH` | A, B | R(A) = captured variable B | 3 |
| `SETUP` | `2DH` | A, B | Captured variable B = R(A) | 4 |

#### Globals {#sec-cpu-global-namespaces}

| Instruction | Opcode | Operands | Function | Cycles |
|---|---:|---|---|---:|
| `GETGL` | `38H` | A, Bx | R(A) = ordinary global Bx | 3 |
| `SETGL` | `39H` | A, Bx | Ordinary global Bx = R(A) | 4 |
| `GETSYS` | `36H` | A, Bx | R(A) = system global Bx | 3 |
| `SETSYS` | `37H` | A, Bx | System global Bx = R(A) | 4 |

#### Tables {#sec-cpu-tables-and-field-lookup}

| Instruction | Opcode | Operands | Function | Cycles |
|---|---:|---|---|---:|
| `GETT` | `0EH` | A, B, C | R(A) = R(B)[RK(C)] | 16 |
| `SETT` | `0FH` | A, B, C | R(A)[RK(B)] = RK(C) | 16 |
| `GETI` | `3AH` | A, B, C | R(A) = R(B)[C] | 8 |
| `SETI` | `3BH` | A, B, C | R(A)[B] = RK(C) | 8 |
| `GETFIELD` | `3CH` | A, B, C | R(A) = R(B)[K(C)] | 16 |
| `SETFIELD` | `3DH` | A, B, C | R(A)[K(B)] = RK(C) | 16 |
| `SELF` | `3EH` | A, B, C | R(A+1) = R(B); R(A) = R(B)[K(C)] | 17 |

When an insertion needs more room, the table is enlarged within the
instruction; this takes extra time depending on the size of the table. If no
memory can be obtained, `OUT_OF_MEMORY` is raised and the table is unchanged.

## Example: zero signs and inherited fields {#sec-cpu-worked-values-signed-zero-and-inherited-fields}

```lua
local values = { -0.0, 3, -3, 0.5 }
local negative_zero = values[1] ^ values[2]
local positive_zero = values[1] ^ values[4]
local reciprocal = 1 / negative_zero

local parent = { answer = 42 }
local child = {}
setmetatable(child, { __index = parent })
local inherited = child.answer
child.answer = 9
local own = child.answer
child.answer = nil
local inherited_again = child.answer
```

The first group gives −0, +0 and −infinity: the reciprocal shows the sign of
zero, which comparison does not.

| Expression | Result |
| --- | --- |
| `(-0.0)^3`, `(-0.0)^0.5` | −0, +0 |
| `(-0.0)^(-3)` | −infinity |
| `(-infinity)^0.5`, `(-infinity)^(-3)` | +infinity, −0 |
| `(-1)^infinity`, `(-2)^0.5` | 1, NaN |
| `NaN^0` | 1 |
| `(-1)^16777215` | −1 |
| `(-1)^16777217` | 1 (the exponent becomes 16777216.0) |
| `2^(-149)` | Smallest subnormal Float |
| `(-2)^(-151)` | −0 |

The second group gives 42, 9 and 42 again: assigning nil removes the child's own
entry, so the parent's value is seen again. `rawget(child, 'answer')` is then
nil.

## Memory transfers {#sec-cpu-memory-transfers}

### Formats {#sec-cpu-scalar-formats}

Operand C of a load or store selects the format:

| C | Format | Bytes | Load gives | Store writes | Alignment |
|---|---|---:|---|---|---:|
| 0 | `Word` | 4 | Integer, all 32 bits | The low 32 bits | 4 |
| 1 | `U8` | 1 | Integer 0–255 | The low 8 bits | 1 |
| 2 | `U16LE` | 2 | Integer 0–65535 | The low 16 bits | 2 |
| 3 | `U32LE` | 4 | Integer, all 32 bits | The low 32 bits | 4 |
| 4 | `F32LE` | 4 | Float | The number as a single-precision Float | 4 |
| 5 | `F64LE` | 8 | Float, rounded from double precision | The number as a double-precision value | **4** |

All formats are little-endian. `Word` and `U32LE` transfer the same bits; they
are reported differently in the bus-fault registers. F32LE keeps all 32 bits,
NaN payloads included. An F64LE NaN loads as `7FC00000H`. F64LE is two word
accesses: the low word at the address, then the high word 4 bytes further on.

C > 5 raises `ReservedInstruction` (Cause `00000028H`) before any memory access.
For the counted stores, C is a word count.

Addresses and integer stores use the bits of an Integer; a Float is rounded
towards 0 first. A non-number, NaN or infinity raises `INVALID_ARGUMENT` (10).

### Addresses {#sec-cpu-address-operands}

`LOAD_MEM`, `STORE_MEM` and `STORE_MEM_WORDS` take the address from RK(B).
The forms ending in `_D` use

```text
address = R[B] + 4 × disp       (modulo 2^32)
```

with disp an unsigned 8-bit word displacement (0 to 255, byte offset 0 to
1020); WIDE does not extend it.

### Loads, stores and devices {#sec-cpu-scalar-access-and-io}

The alignment is checked before the access. A load that causes a bus fault
leaves its destination register unchanged.

A store to a device register that is not ready (a full FIFO, for example)
waits until the register accepts it. Only the first address is checked, also
for F64LE.

If the low word of an F64LE access faults, the high word is not accessed; if
the high word faults, the low word has already been written.

Memory instructions work in user and supervisor mode. Device registers follow
the [register access rules](memory.md#sec-memory-io-widths-and-read-side-effects).

### Counted word stores {#sec-cpu-counted-word-stores}

`STORE_MEM_WORDS` and `STORE_MEM_WORDS_D` store C registers as words:

```text
R[A+i] → start + 4 × i          for i = 0 … C − 1
```

The start must be a multiple of 4, also when C = 0. Before writing, the
instruction waits until all device registers in the range are ready. The words
are then written in order; a fault stops the sequence, and the words already
written stay written.

### Instructions {#sec-cpu-memory-instruction-reference}

| Opcode | Instruction | Function | Cycles |
|---|---|---|---:|
| `04H` | `LOAD_MEM_D A, B, C, disp` | R[A] = memory[R[B] + 4 × disp], format C | 3 |
| `0CH` | `STORE_MEM_D A, B, C, disp` | memory[R[B] + 4 × disp] = R[A], format C | 3 |
| `0DH` | `STORE_MEM_WORDS_D A, B, C, disp` | Store R[A]… as C words at R[B] + 4 × disp | 3 + C |
| `31H` | `LOAD_MEM A, B, C` | R[A] = memory[RK(B)], format C | 3 |
| `32H` | `STORE_MEM A, B, C` | memory[RK(B)] = R[A], format C | 3 |
| `33H` | `STORE_MEM_WORDS A, B, C` | Store R[A]… as C words at RK(B) | 3 + C |

F64LE adds 2 cycles.

## Branches {#sec-cpu-branches}

```text
target = start of the instruction + its length (WIDE included) + 4 × Bx
```

Bx is a signed word offset (20 bits, or 26 with WIDE). Only nil and false are
false.

| Opcode | Instruction | Function | Cycles |
|---|---|---|---:|
| `28H` | `JMP A, Bx` | If A ≠ 0, close the captured variables from R(A−1) up; jump | 2 |
| `29H` | `JMPIF A, Bx` | Jump if R[A] is true | 2 |
| `2AH` | `JMPIFNOT A, Bx` | Jump if R[A] is false | 2 |

A JMP that closes captured variables takes 1 cycle more per variable.

## Instruction timing {#sec-cpu-cycle-accounting-and-execution-boundaries}

The CPU runs at **33,868,800 cycles per second**. Each instruction takes the
number of cycles given in its table, plus the additional cycles stated with
it. For example, `LOADK` followed by `LOAD_MEM` from RAM takes 2 + 3 = 5
cycles. An instruction that raises an exception takes its full time.

A store to a device register that is not ready waits; the waiting adds to the
time. An interrupt is accepted only when the instruction is complete. When the
monitor is entered during such a wait, the store is repeated after the return.

The devices keep running while the CPU executes, waits or halts. Use device
status and interrupts for synchronization, not instruction counts. DMA timing is
given in [[DMA — Transfer timing](dma.md#sec-dma-transfer-timing-and-sharing-the-bus)]{.content-visible when-format="html"}[Book I, §4.8]{.content-visible when-format="pdf"}.

## Reset and program start {#sec-cpu-cpu-reset-and-program-replacement}

After reset, Status is `00000001H` and Cause, EPC, BadAddress, LuaFaultReason
and the exception domain are 0. The CPU clears the
[[fixed reset bank](memory.md#sec-memory-reset-bank)]{.content-visible when-format="html"}[Book I, §2.3.2]{.content-visible when-format="pdf"}
and starts the System ROM function named in the ROM header. There is one
frame, with no arguments or closure environment. The bank fetches
instructions only from System ROM. Ordinary calls must fit in the fixed
backing, leaving room for an exception frame.

Reset does not map, copy or clear DATA and BSS. System code can use
[`CONTEXT`](#sec-cpu-context) to leave the bank. See
[program startup](program-images.md#sec-memory-reset-and-cartridge-startup).

### Hard halt {#sec-cpu-hard-halt-and-instruction-exceptions}

The CPU stops until reset (hard halt) on a reserved opcode, a WIDE followed by
WIDE, an unreadable function record, or an EXEC of a function that is not STATIC.

## CP0 {#sec-cpu-cp0-and-execution-control}

**Status bit 1** is the mode: 0 = supervisor, 1 = user. Status bit 0 is the
interrupt enable. System programs start with Status = 1, cartridge programs with
Status = 3.

`MFC0`, `MTC0` and `RFE` work only in supervisor mode; in user mode they raise
Coprocessor Unusable.

### Registers {#sec-cpu-cp0-fields}

For `MFC0` and `MTC0`, A is the register and B the CP0 register number.

| No. | Name | MFC0 | MTC0 |
|---:|---|---|---|
| 8 | `BadAddress` | Read | Ignored |
| 9 | `LuaFaultReason` | Read | Ignored |
| 12 | `Status` | Read | Write; bit 8 is restricted to System ROM |
| 13 | `Cause` | Read | Ignored |
| 14 | `EPC` | Read | Write |
| 15 | `EXEC` | 0 | Start an addressed static function; see below |
| 16 | `CONTEXT` | Previous root context address | Select a prepared context; see below |
| 17 | `RAM_END` | 0 | Set the end of ordinary RAM on the bus; see below |
| 18 | `SYSTEM_VECTOR` | System exception function address | Set the System exception function; see below |
| 19 | `PREVIOUS_ACTIVE` | Previous active context address | Ignored |

Another number stops the CPU (hard halt).

Status bit 8 (`00000100H`) inhibits system reset. In supervisor mode, only an
instruction executing from System ROM in the System execution domain can
change this bit; other Status writes leave it unchanged. A pending reset
request is not cleared by changing this bit. See
[[System — Reset](system.md#sec-system-reset-requests)]{.content-visible when-format="html"}[Book I, §12.10]{.content-visible when-format="pdf"}.

#### RAM_END {#sec-cpu-ram-end}

`RAM_END` sets the exclusive end of main RAM visible on the system bus.
A supervisor instruction may write it only when it executes from System ROM
in the System execution domain. Otherwise the write raises Coprocessor
Unusable.

The CPU discards bits 11–0 of the supplied address. The resulting end must be
between `08040000H` and `083FC000H`, inclusive. An end outside that range raises
AddressErrorStore, records the supplied address in BadAddress, and leaves
the map unchanged. A successful write changes the bus map immediately; it
does not alter the contents of RAM. See
[[Memory — Main RAM on the system bus](memory.md#sec-memory-language-heap)]{.content-visible when-format="html"}[Book I, §2.3.1]{.content-visible when-format="pdf"}.

#### CONTEXT and PREVIOUS_ACTIVE {#sec-cpu-context}

On reset these fields report the physical addresses of the previous root and
active contexts. Both are 0 at power-on. A further reset in the reset bank
does not replace them.

A write to `CONTEXT` supplies the address of a prepared context. It is
valid in supervisor mode with one active frame in the reset bank.
The context, frame backing and value backing must be word-aligned and
wholly in private RAM. Put them outside the fixed bank and do not overlap
them. There must be one prepared frame and room for at least two frames.
The prepared PC must be an instruction start in a System ROM function.
A rejected supervisor write hard-halts.

A successful write starts at the prepared PC without allocating backing
or returning to its writer. Status is unchanged. Both saved addresses
clear to 0.

To prepare a new 80-byte context, zero it and write these words:

| Offset | Initial contents |
|---:|---|
| `08H` | 1 (running) |
| `14H` | End of the initial register window, in slots |
| `18H`, `1CH` | Value backing address and slot count |
| `20H` | Frame capacity |
| `38H` | 1 (active frame count) |
| `40H` | Frame backing address |

For `N` slots, value backing is `N` little-endian payload words followed
by `N` one-byte tags. The first frame occupies 56 bytes. Its little-endian
words for System entry without arguments are:

| Offset | Initial contents |
|---:|---|
| `00H` | System function-record address |
| `04H` | Call site: entry PC |
| `08H` | Open captures: 0 |
| `0CH` | Protected call: `FFFFFFFFH` (none) |
| `10H` | Flags: 0 (System, ordinary frame) |
| `14H` | Entry PC |
| `18H`, `1CH` | Vararg base: parameter count; vararg count: 0 |
| `20H`, `24H` | Return base and count: 0, 0 |
| `28H` | Top: parameter count |
| `2CH` | Closure: 0 |
| `30H`, `34H` | Register base: 0; register capacity: window size |

The window size is the largest of 1, the parameter count and the maximum
stack in the function record. Initialize the parameter slots to nil
(zero tag and payload).

#### SYSTEM_VECTOR {#sec-cpu-system-vector}

Reset loads this field from the exception address in the System ROM
header. Only a supervisor instruction executing from System ROM in
the System domain can write it. The address must name a System ROM function-table entry with
a nonempty body and no captures. A rejected address raises
AddressErrorLoad if it is not word-aligned, otherwise InstructionBusError.
The old address is unchanged.

The field selects synchronous exceptions and NMI, not maskable IRQ.

### Exception entry {#sec-cpu-exception-entry-and-cartridge-dispatch}

For a maskable IRQ, Cause becomes `00000400H` and EPC the address of the
interrupted instruction. Bits 5–0 of Status are shifted left by 2:

```text
Status = (Status AND NOT 3FH) | ((Status << 2) AND 3FH)
```

so that interrupts are off and the mode is supervisor. The CPU enters the
IRQ function for the interrupted mode, with no arguments. Synchronous
exceptions and NMI use [`SYSTEM_VECTOR`](#sec-cpu-system-vector). A Lua trap
outside the reset bank puts the error value in R0.

The standard BLua `irq` and `exception` functions are described in
[BLua control](blua-programs.md#sec-cpu-blua-control-syntax); they return to
the entry routine, which executes RFE. See also the
[BIOS monitor](bios-monitor.md#sec-memory-installed-response-to-a-memory-exception).

### RFE {#sec-cpu-exception-return}

`RFE` ends the exception function: it closes its captured variables, sets
Status bits 3–0 to the former bits 5–2 and continues at EPC. RFE outside an
exception function stops the CPU (hard halt). A program may change EPC before
RFE; the fetch at the new address is checked as usual.

After an NMI, RFE also restores the Cause, EPC, BadAddress, LuaFaultReason and
exception domain saved at the NMI.

### EXEC {#sec-cpu-exec}

Writing `EXEC` in the reset bank hard-halts. First select a receiving context
with [`CONTEXT`](#sec-cpu-context). Unlike that write, `EXEC` opens a new
register window, which may require more backing.

Writing a **function-record address** to `EXEC` starts that function as a new
program. The CPU reads the record on the ordinary CPU bus. A record in the
cartridge ROM window is read from the socket selected for that access. An
unreadable record or a function without the STATIC flag causes a hard halt.

EXEC clears the call stack and starts the function without arguments, with
Status = 3 for a cartridge program and 1 for the System program. It does not
return, change `RAM_END` or initialize DATA or BSS. It does not acknowledge
the interrupt controller's pending requests.

### HALT {#sec-cpu-halt}

`HALT` waits until an interrupt is accepted. If an interrupt was accepted since
the last HALT, it returns at once. HALT works in user and supervisor mode. See
[waiting for an interrupt](irq.md#sec-irq-wait-for-service-not-merely-for-a-wake-up).

### Instructions {#sec-cpu-control-instruction-reference}

| Opcode | Instruction | Function | Cycles |
|---|---|---|---:|
| `26H` | `MFC0 A, B` | R[A] = CP0 register B | 2 |
| `27H` | `MTC0 A, B` | CP0 register B = R[A] | 2 |
| `34H` | `RFE` | Return from exception | 2 |
| `3FH` | `HALT` | Wait for an interrupt | 2 |

### Example: reading CP0 in an interrupt {#sec-cpu-read-cp0-in-a-cartridge-irq}

```lua
module<entry>
bss saved_status: word
bss saved_cause: word
bss saved_epc: word
bss services: word

function irq(flags)
    if (flags & 4) ~= 0 then
        mem[0x08000008] = 0
        *saved_status = cop0.status
        *saved_cause = cop0.cause
        *saved_epc = cop0.epc
        mem[0x08000004] = 4
        *services = *services + 1
    end
end

mem[0x08000008] = 0
mem[0x08000004] = 4
mem[0x08000008] = 4
while *services == 0 do
    halt_until_irq
end
```

The program itself runs in user mode and cannot read CP0; the interrupt
handler runs in supervisor mode. In the handler, Status is `0000000CH`, Cause
`00000400H`, and EPC the address of the interrupted instruction.

## Memory faults {#sec-cpu-memory-faults-and-saved-pc}

A misaligned load raises `AddressErrorLoad`, a misaligned store
`AddressErrorStore`; both set BadAddress. A bus fault raises `DataBusError`;
BadAddress is not changed. EPC is the address of the faulting instruction. The
[bus-fault registers](memory.md#sec-memory-bus-fault-status-and-cpu-exceptions)
keep the first fault, but each new fault causes an exception.
