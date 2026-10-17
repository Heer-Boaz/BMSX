# CPU and BLua32 instruction reference

The CPU executes BLua32 instructions, maintains function-call frames and moves
numeric scalars between language values and byte-addressed memory. Tables,
closures and threads are language values, not device words. A word transferred
to a device is an unsigned 32-bit numeric payload; it does not transfer an
arbitrary CPU value. Device addresses and payloads are defined by their owning
unit chapters.

This chapter first gives a complete ordinary BLua program, then the instruction
encoding and operation reference. **Memory and program storage** defines the
installed address map, reservations, section initialization and instruction
addresses. **Interrupt controller** defines IRQ masks, acknowledgment and the
installed exception route. **System control and timing** defines supervisor
device contexts and the timing/diagnostic ports. CPU privilege, device context
and function origin are not interchangeable.

## A complete BLua computation program

Start this cartridge through the installed BIOS. The program owns its result
record in BSS; it does not guess an unused RAM address, change a device's
configuration or create a raw CPU-register array. The **Memory and program
storage** chapter supplies section initialization, typed-storage ownership and
cartridge startup. Ordinary calls to the installed `print` global produce the
three diagnostic lines shown below.

### Result-storage module

Name this module `results` and make it available to the entry module. The array
of five operands and the calculated numeric fields use `f64` storage. The
`word` fields hold transferred words or flags; the single `f32` field exposes
single-precision rounding. These are byte-storage declarations, not CPU value
registers.

```lua
module<const>

struct cpu_manual_result
	completed: word
	operands: f64[5]
	quotient: f64
	floor_quotient: f64
	mod_positive: f64
	mod_negative: f64
	number_sum: f64
	word_sum: word
	signed_word: f64
	shift_right: f64
	shift_32: f64
	shift_negative: f64
	truncated_word: f64
	zero_is_true: word
	comparison: word
	read_u16: word[2]
	read_u32: word
	rounded: f32
	rounded_readback: f64
	call_sum: f64
	counter: f64[2]
end

bss result: cpu_manual_result

return { result = result }
```

### Entry module

The first part writes operands to storage, reads them back, and calculates both
ordinary Number results and word-based results. Division is not floor division,
and arithmetic right shift is not a zero-fill shift.

```lua
module<entry>

local state<const> = require('results')
local result<const>: *cpu_manual_result = state.result
rodata little_endian_bytes: u8[4] = { 0x78, 0x56, 0x34, 0x12 }

-- Read operands back from real numeric storage, not just constant expressions.
result.operands[0] = -7
result.operands[1] = 3
result.operands[2] = -1.75
result.operands[3] = 2147483647
result.operands[4] = 2147483648
local numerator<const> = result.operands[0]
local divisor<const> = result.operands[1]
result.quotient = numerator / divisor
result.floor_quotient = numerator // divisor
result.mod_positive = numerator % divisor
result.mod_negative = -numerator % -divisor

-- Arithmetic retains a Number; a word transfer and a bitwise result differ.
result.number_sum = result.operands[3] + 1
result.word_sum = result.number_sum
result.signed_word = result.number_sum | 0
result.shift_right = result.operands[4] >> 1
result.shift_32 = 1 << 32
result.shift_negative = 1 << -1
result.truncated_word = result.operands[2] | 0

local zero<const> = result.operands[1] - 3
if zero then
	result.zero_is_true = 1
end
result.comparison = numerator < divisor and 1 or 0
```

Continue the same entry module. The four bytes are numeric payload storage.
The views read two halfwords or one word without copying that storage; they do
not turn a string reference into an address. The returned closure retains its
counter after `make_counter` returns.

```lua

-- These are typed views of byte storage, not a cast of a string reference.
local halves<const>: *u16 = little_endian_bytes
local whole<const>: *u32 = little_endian_bytes
result.read_u16[0] = halves[0]
result.read_u16[1] = halves[1]
result.read_u32 = *whole
result.rounded = result.operands[4] + 1
result.rounded_readback = result.rounded

local add<const> = function(first, second)
	return first + second
end
local make_counter<const> = function(value)
	return function(delta)
		value = value + delta
		return value
	end
end
result.call_sum = add(numerator, divisor)
local advance<const> = make_counter(10)
result.counter[0] = advance(2)
result.counter[1] = advance(3)

print('CPU: quotient', result.quotient, 'floor', result.floor_quotient)
print('CPU: Number', result.number_sum, 'signed word', result.signed_word)
print('CPU: counter', result.counter[0], result.counter[1])
result.completed = 1
while true do
	halt_until_irq
end
```

### Retained results

<section class="keep-together">

When `completed` becomes 1, the record contains:

| Field | Value | Meaning |
|---|---:|---|
| `quotient` | −7/3, approximately −2.3333333333333335 | Ordinary division retains a fraction. |
| `floor_quotient` | −3 | Floor division rounds downward. |
| `mod_positive`, `mod_negative` | 2, −2 | The nonzero remainder follows the divisor's sign. |
| `number_sum` | 2147483648 | Addition does not wrap at the signed-word boundary. |
| `word_sum` | `80000000H` | The stored raw word has the same low 32 bits. |
| `signed_word` | −2147483648 | Bitwise output is the signed interpretation of those bits. |
| `shift_right` | −1073741824 | `>>` preserves the sign bit. |
| `shift_32`, `shift_negative` | 1, −2147483648 | Shift counts are masked to five bits. |
| `truncated_word` | −1 | Word conversion truncates −1.75 toward zero. |
| `zero_is_true`, `comparison` | 1, 1 | Zero is true; −7 is less than 3. |
| `read_u16[0]`, `read_u16[1]` | `5678H`, `1234H` | Halfwords are little-endian. |
| `read_u32` | `12345678H` | The four data bytes form one little-endian word. |
| `rounded`, `rounded_readback` | 2147483648 | Storing 2147483649 through `f32` rounds it. |
| `call_sum` | −4 | An ordinary two-argument call returns its result. |
| `counter[0]`, `counter[1]` | 12, 15 | The same captured variable changes on successive calls. |

</section>


The diagnostic output is:

```text
CPU: quotient	-2.33333	floor	-3
CPU: Number	2.14748e+09	signed word	-2.14748e+09
CPU: counter	12	15
```

The lines report the quotient and floor, Number and signed-word result, then
the two counter results. Finite numeric text is formatted; the
printed `2.14748e+09` is not the precise stored Number. The final wait does not
render a picture. For actual geometry-to-picture work, use the GTE and GPU
programming chapters rather than treating a CPU value as a drawing command.

<section class="keep-together">

## Instruction words and execution resources

| Resource | Specification |
|---|---|
| System-cycle basis | 33,868,800 cycles/s in the installed model configuration |
| Installed main RAM | 4 MiB; mapped windows, reservations and ownership are in the Memory chapter |
| Language-allocation budget | 3.5 MiB of shared accounting capacity for this configuration, not an additional raw RAM region or wholly free register storage |
| Opcode field | 6 bits, 64 opcode identities including the WIDE prefix |
| Instruction word | 32 bits, four bytes, big-endian code bytes |
| Instruction length | One word; two words with one WIDE prefix |
| Numeric value | Double-precision Number, distinct from other language values |
| Data word and CP0 word | 32 bits; scalar data transfers are little-endian |
| Frame registers | Logical value slots relative to the current call frame; the function record supplies its parameter count and maximum stack allocation |
| Register/count encoding | Format-dependent limits below, not a fixed physical register allocation or unlimited recursion guarantee |

</section>

<section class="keep-together">

### Word fields

Code bytes use the opposite byte order from multi-byte scalar data. Do not
byte-swap one representation merely because the other is little-endian.

| Word bits | `31:24` | `23:18` | `17:12` | `11:6` | `5:0` |
|---|---|---|---|---|---|
| Field | `EXT` | Opcode | Low A | Low B | Low C |

The opcode chooses how the remaining bits are interpreted:

| Format | Unprefixed operands | WIDE operands | EXT use |
|---|---|---|---|
| ABC | A: 8 bits; raw B/C: 9 bits each | A: 14 bits; raw B/C: 15 bits each | EXT[7:6] extends A; EXT[5:3] extends B; EXT[2:0] extends C |
| Bx | A: 6 bits; Bx: 20 bits | A: 12 bits; Bx: 26 bits | EXT is Bx's bits 19:12; low B/C supply bits 11:0 |
| Displacement | A/B/C: 6 bits each | A/B/C: 12 bits each | Unsigned 8-bit word displacement, unchanged by WIDE |

</section>

The Bx family is `LOADK`, `KSMI`, the three branches, `CLOSURE`, the two ordinary
global instructions and the two system-global instructions. The displacement
family is the three memory instructions ending in `_D`. The remaining bodies
use ABC fields; their operation tables say which fields are registers, counts,
immediates, direct constant indices or RK operands. Raw B/C and RK are not
interchangeable interpretations.

### WIDE — opcode 00H

A WIDE word contributes its six-bit A/B/C fields above the body fields. For ABC,
its A bits begin at decoded A bit 8, and its B/C bits begin at decoded B/C bit 9.
For displacement, all three prefix fields begin at bit 6. For Bx, prefix A begins
at A bit 6 and prefix B supplies Bx bits 25:20. Prefix C does not contribute to
Bx. The prefix's own EXT byte is ignored.

Exactly one following word is decoded as the body. This is one eight-byte
instruction, not a separately executed zero-cycle prefix followed by another
instruction. If that body is itself WIDE and reaches execution, the CPU
hard-halts; prefixes do not form an arbitrarily long chain. WIDE adds no separate
base charge to its body's listed cost.

For `CLOSURE`, prefix C bit 5 sets the register-address flag, decoded as C bit 14.
With that bit clear, Bx times 16 supplies the function-record address; with it
set, Bx selects the register supplying that address. This flag does not add
bits to the Bx index. The closure section supplies capture and fault behavior.

### Register and constant selection

ABC RK consumers sign-extend their 9-bit unprefixed or 15-bit prefixed B/C field.
A nonnegative result selects that frame register. A negative result selects
constant `-1-RK`: −1 names K0, not a negative-number immediate. Thus each
unprefixed RK can name R0–R255 or K0–K255; each WIDE RK can name R0–R16383 or
K0–K16383. A raw count/key field instead keeps its unsigned encoded value.

An instruction's encoding range does not allocate its referenced registers or
constants. A frame obtains its entry PC, parameter count and stack allocation
from its function record. Declared register slots begin nil before arguments
are copied; missing fixed parameters are nil. Ordinary register writes can
extend the active range, while result placement and open varargs have the
specific top rules in the call reference. Do not treat the instruction's
maximum field value as available scratch storage in every function.

### Fetch and conditional skip

Instruction PC is a byte address and must be four-byte aligned. A misaligned
fetch records BadAddress and raises `AddressErrorLoad`. A new bus fault reading
either the first word or the WIDE body raises `InstructionBusError`; the saved
fetch PC is the instruction start, including the prefix address when the body
read fails. Fetch exception entry has a one-cycle charge; an unfetched body is
not dispatched with its nominal instruction cost.

Selected numeric instruction sequences can read and decode a successor before
the current instruction executes. A fault on that read can enter the fetch
exception. Do not assume that only the current instruction has been fetched.

Conditional-skip instructions decode the next instruction's full width and
skip that whole instruction without executing its handler or charging its
body's base cost. The skipped code can still cause a fetch exception while its
width is determined. The branch section separately defines signed word
relative targets; a branch instruction does not itself read its target.

## Cycle accounting and execution boundaries

The instruction tables give **base charges**, not whole-program transfer rates.
Before an admitted instruction executes, PC advances over its complete width
and its base charge is deducted. Privilege, address alignment and write-ready
handling occur after that base charge. There is no refund when a store blocks;
a later retry incurs its base charge again.

A positive remaining budget admits the next instruction even if that remainder
is smaller than the instruction's cost. The instruction completes its handler
rather than being cut in half when the budget reaches zero. For example, after
a one-cycle `LOADK`, a two-cycle `LOAD_MEM` can enter with only one cycle left
and leave a remainder of −1: three cycles have been charged, not two. Subsequent
work uses the actual charged amount, including this overshoot.

The machine's cycle time follows these consumed charges. During a running CPU
interval, current time includes charges already made in that interval; after
advancing time the machine services due device events. Work is admitted with
respect to the next event deadline, but the admitted instruction can still
overshoot as described above. Do not infer a sub-instruction interrupt,
transaction rollback or a universal request-to-handler delay from a cycle
budget.

### Additional work and waiting

<section class="keep-together">

A scalar memory instruction costs 2 base cycles, including either four-byte or
eight-byte numeric formats. A counted store adds `(C+3)>>2` only after its
write-ready preflight succeeds. These are instruction charges, not an
electrical memory-bus bandwidth specification.

| Counted words | Base | Sequence surcharge | Instruction total after ready preflight |
|---:|---:|---:|---:|
| 0 | 2 | 0 | 2 |
| 1 | 2 | 1 | 3 |
| 4 | 2 | 1 | 3 |
| 5 | 2 | 2 | 4 |

</section>

The comparison skip, full-width branch and counted-store examples concern
instruction charges, not a completed graphics or audio job. A builtin call has
its additional builtin charge; device-specific command work and completion
remain in the unit chapter.

A blocked store writes nothing while it waits for the owning device's matching
ready edge. Waiting advances machine time toward scheduled events rather than
repeatedly polling and re-executing the store. IRQ HALT and CPU-held intervals
also let due device work advance. A HALT therefore has neither a fixed elapsed
length nor the meaning of stopping every console device. The IRQ chapter
supplies the pending/mask/acknowledgment and accepted-interrupt conditions.

## CPU reset and program replacement

At actual CPU reset, Status is `00000001H`; Cause, EPC, BadAddress,
LuaFaultReason and the exception-domain word are zero. Retained pre-NMI report
words are also zero. HALT, blocked-write, hard-halt, retained interrupt event,
pending NMI and requested-yield states are cleared. The call stack is cleared
and the system startup static function is entered with zero arguments.

The first PC comes from that startup function's record, not an assumed
instruction address zero. Reset is not the same edge as `EXEC`: the latter
replaces execution with a selected static function and sets the entry Status
according to that function's execution domain. Neither statement implies that
all RAM has been erased. The Memory chapter supplies the actual reset vector,
BIOS cartridge selection and section-initialization route; SYSTEM defines the
separate software reset request and device-context transitions.

## BLua operators and instruction costs

<section class="keep-together">

The following is an instruction-selection guide for ordinary cartridge source,
not a one-instruction-per-expression rule. Preparing operands, loading and
storing typed data, forming a comparison value and taking a control path also
execute instructions. A static array's `#` uses its declared element count
rather than a runtime `LEN`.

| Source operation | Runtime instruction family |
|---|---|
| `+`, binary `-`, `*`, `/` | `ADD`, `SUB`, `MUL`, `DIV` |
| `//`, `%`, `^` | `FLOORDIV`, `MOD`, `POW` |
| `&`, binary `\|`, binary `~` | `BAND`, `BOR`, `BXOR` |
| `<<`, `>>` | `SHL`, `SHR` |
| Unary `-`, `not`, `#`, unary `~` | `UNM`, `NOT`, `LEN`, `BNOT`, subject to static-array length above |
| `==`, `~=` | `EQ` with true or false expectation |
| `<`, `<=` | `LT`, `LE` with true expectation |
| `>`, `>=` | `LT`, `LE` with reversed operands and true expectation |
| `..` | Concatenation lowering; not an unconditional single `CONCAT` |

</section>


The arithmetic binary forms use RK operands. Unary forms use a source register.
The comparison instructions are predicates that conditionally skip another
instruction; they do not store a Boolean in `A`. Producing a comparison value
can therefore require Boolean loads and a jump as well as the predicate. Use
the instruction path, not the number of source operators, when calculating a
cycle budget.

## Values and numeric instructions

### Values are not register words

A CPU register holds a language value, not an unconditionally interpreted 32-bit word. The value kinds are nil, false, true, Number, String, Table, Closure, BuiltinFunction, and Thread. Copying a register or loading a constant preserves its value kind: copying false does not turn it into zero, and copying a Table preserves the reference to that Table.

An ordinary Number is a double-precision floating-point value. It can carry fractional values, signed zero, infinities, and NaN. Arithmetic does not implicitly wrap it to 32 bits or give it a fixed-point interpretation. A raw 32-bit word, by contrast, is a pattern of 32 bits. The bitwise and shift instructions perform a word conversion at their inputs and return the signed 32-bit interpretation as an ordinary Number; they do not change how other Numbers are stored or calculated.

Numeric operand reads are not general value conversions. A Number supplies its numeric value; any other value kind supplies NaN. In particular, a numeric string is not parsed, and a boolean is not converted to zero or one. Numeric results remain Numbers, including results that are NaN.

This distinction matters when choosing operations in BLua. Use ordinary arithmetic when fractions and non-wrapping numeric results are wanted. Use bitwise operations when the calculation concerns flags, masks, or particular word bits. Use the truth rules for conditions rather than assuming that a numeric zero is false.

### Reading the instruction tables

`R[x]` denotes register x, and `K[x]` denotes constant x in the execution image. An `RK(x)` operand selects either a register or a constant: a nonnegative decoded x selects `R[x]`; a negative decoded x selects `K[-1-x]`. Thus RK value −1 selects K0, −2 selects K1, and so on. Unless a row says otherwise, A selects the destination register. Comparison instructions instead use A as an expected boolean result.

<section class="keep-together">

The narrow and WIDE forms have the following encoding limits. These limits describe what the instruction can encode, not how many registers or constants are allocated for a particular function.

| Operand | Ordinary encoding | WIDE encoding |
|---|---:|---:|
| RK B or C | Signed 9 bits: R0–R255 or K0–K255 | Signed 15 bits: R0–R16383 or K0–K16383 |
| A in ordinary operand formats | 8 bits | 14 bits |
| A in the Bx format used by LOADK and KSMI | 6 bits | 12 bits |
| LOADK Bx | Unsigned 20 bits | Unsigned 26 bits |
| KSMI sBx | −524288 through 524287 | −33554432 through 33554431 |

</section>


A single-result destination write raises the current frame's top to at least A+1 and never lowers it. The positive-count LOADNIL range is described separately below. Formulas in the tables describe instruction semantics; they are not source-language syntax.

Opcode numbers are zero-based. Nominal cycles are the instruction-accounting charge, applied before the instruction executes, not an elapsed-time estimate. Each instruction below costs one nominal cycle except CONCATN, which costs two. LOADNIL has no additional per-register charge, and CONCATN has no additional per-input or per-byte charge in its operation. Readiness waits, counted-transfer surcharges and builtin call charges are separate from these base entries, as described below.

### Constants and copies

<section class="keep-together">

The constant and copy instructions move complete values or create a specific value kind. K0, K1, KM1, and KSMI create Numbers, not a separate integer kind. LOADNIL's B operand is a count: for example, A=4 and B=3 write nil to R4, R5, and R6, not through R7.

| Mnemonic | Opcode | Operands and specified domain | Result | Nominal cycles |
|---|---:|---|---|---:|
| MOV | `01H` | A destination; B source register; C unused | `R[A] = R[B]`, preserving the complete value | 1 |
| LOADK | `02H` | A destination; Bx identifies an existing constant | `R[A] = K[Bx]`, preserving the constant's value kind | 1 |
| LOADNIL | `03H` | A first register; B positive register count; C unused | Set exactly `R[A]` through `R[A+B−1]` to nil; raise frame top to at least A+B without lowering it | 1 |
| KNIL | `05H` | A destination; B and C unused | `R[A] = nil` | 1 |
| KFALSE | `06H` | A destination; B and C unused | `R[A] = false` | 1 |
| KTRUE | `07H` | A destination; B and C unused | `R[A] = true` | 1 |
| K0 | `08H` | A destination; B and C unused | Number +0 in `R[A]` | 1 |
| K1 | `09H` | A destination; B and C unused | Number 1 in `R[A]` | 1 |
| KM1 | `0AH` | A destination; B and C unused | Number −1 in `R[A]` | 1 |
| KSMI | `0BH` | A destination; signed immediate sBx within the encoding range above | Number equal to sBx in `R[A]` | 1 |
| LOADKR | `35H` | A destination; B source register; `R[B]` is a Number containing a nonnegative integral index i within the constant pool; C unused | `R[A] = K[i]`, preserving the constant's value kind; B is not an RK operand | 1 |

</section>


### Arithmetic

ADD, SUB, MUL, DIV, MOD, FLOORDIV, and POW read two numeric operands through RK B and RK C and write a Number to R[A]. They do not saturate or apply integer-word wrapping. A non-Number operand supplies NaN rather than causing an arithmetic type fault.

DIV is ordinary floating-point division. FLOORDIV instead rounds the quotient downward, not toward zero: dividing −7 by 3 gives a floor quotient of −3, and dividing 7 by −3 also gives −3. The result is still a Number, not a different integer value kind. MOD adjusts a nonzero remainder to agree with the divisor's sign for finite inputs and a nonzero divisor: −7 modulo 3 is 2, whereas 7 modulo −3 is −2. A zero remainder keeps the sign of the initial remainder; it is not forced to the divisor's sign.

<section class="keep-together">

DIV, MOD, and FLOORDIV have no separate zero-divisor or nonfinite-operand guard. They use the arithmetic operations stated below, and their results remain Numbers. Do not assume a checked integer-divide trap, substitute a saturated result, or apply the finite-input quotient-and-remainder rules to every nonfinite case.

| Mnemonic | Opcode | Operands | Number result in R[A] | Nominal cycles |
|---|---:|---|---|---:|
| ADD | `11H` | Numeric reads of RK(B), RK(C) | left + right | 1 |
| SUB | `12H` | Numeric reads of RK(B), RK(C) | left − right | 1 |
| MUL | `13H` | Numeric reads of RK(B), RK(C) | left × right | 1 |
| DIV | `14H` | Numeric reads of RK(B), RK(C) | left divided by right | 1 |
| MOD | `15H` | Numeric reads of RK(B), RK(C) | Start with the floating-point remainder r. If r>0 and right<0, or r<0 and right>0, return r+right; otherwise return r. | 1 |
| FLOORDIV | `16H` | Numeric reads of RK(B), RK(C) | Set q to left/right and t to q truncated toward zero. Return t−1 if t>q; otherwise return t. | 1 |
| POW | `17H` | Numeric reads of RK(B), RK(C) | left raised to the power right, with the special cases below | 1 |
| UNM | `1FH` | Numeric read of R[B], not RK(B); C unused | Negation of the operand, including its zero sign | 1 |

</section>


<section class="keep-together">

POW has defined treatment of NaN and infinite exponents. A zero exponent returns 1 even when the base is NaN. Otherwise a NaN operand returns NaN. The infinite-exponent cases depend on the magnitude of the base as follows.

| Base x | Exponent y | POW result |
|---|---|---|
| Any base, including NaN | +0 or −0 | 1 |
| NaN, or any base with NaN exponent | Any case not already covered by zero exponent | NaN |
| Absolute value exactly 1 | +infinity or −infinity | NaN |
| Absolute value greater than 1 | +infinity | +infinity |
| Absolute value greater than 1 | −infinity | +0 |
| Absolute value less than 1 | +infinity | +0 |
| Absolute value less than 1 | −infinity | +infinity |

</section>


For a negative finite, nonzero base, a nonintegral exponent produces NaN. An odd integral exponent gives a negative result for a negative base; an even integral exponent gives a nonnegative result. Signed zero and signed infinity have special-base treatment and must not be folded into the finite, nonzero negative-base rule. Overflow and underflow produce signed numeric results rather than a new arithmetic fault; subnormal results are supported.

### Bitwise operations and shifts

Each bitwise input is converted to a 32-bit word by truncating its Number toward zero and reducing the integer modulo 2³². Positive zero, negative zero, NaN, infinities, and fractions of magnitude below one become the zero word. Large finite values wrap modulo 2³² rather than saturating. A non-Number numeric operand first supplies NaN and therefore becomes the zero word in these operations.

The output word is interpreted as a signed 32-bit integer and written as a Number. For example, the word with all 32 bits set becomes Number −1. A left shift of 1 by 31 produces −2147483648. SHR is an arithmetic, sign-extending right shift: shifting −8 right by one produces −4, not a large positive value.

<section class="keep-together">

Shift counts undergo the same word conversion and then use only their low five bits. A count of 32 therefore acts as zero, and a count of −1 acts as 31. Negative counts do not reverse the shift direction, and large counts do not saturate.

| Mnemonic | Opcode | Operands | Result in R[A] | Nominal cycles |
|---|---:|---|---|---:|
| BAND | `18H` | Word conversions of numeric reads of RK(B), RK(C) | Signed Number interpretation of the 32-bit AND | 1 |
| BOR | `19H` | Word conversions of numeric reads of RK(B), RK(C) | Signed Number interpretation of the 32-bit OR | 1 |
| BXOR | `1AH` | Word conversions of numeric reads of RK(B), RK(C) | Signed Number interpretation of the 32-bit exclusive OR | 1 |
| SHL | `1BH` | Left word from RK(B); count from the low five bits of the word converted from RK(C) | Shift left, discard bits leaving the 32-bit word, then write its signed Number interpretation | 1 |
| SHR | `1CH` | Left word from RK(B); count from the low five bits of the word converted from RK(C) | Sign-extending right shift of the signed 32-bit left operand, written as a Number | 1 |
| BNOT | `22H` | Word conversion of the numeric read of R[B], not RK(B); C unused | Complement all 32 bits, then write the signed Number interpretation | 1 |

</section>


### Truth, length, and text

Only nil and false are falsey. Every other value is truthy, including Number 0, Number NaN, and an empty String. NOT writes a boolean, not a Number. In particular, negating the truth of zero produces false.

LEN returns a Number. A String's length is its stored Unicode codepoint count, not its byte count. A Table's length is its maintained array length. LEN on any other value kind faults; it does not invoke a metatable length operation.

<section class="keep-together">

Concatenation uses language value-to-string conversion rather than accepting only strings and Numbers. CONCAT joins its two RK operands in B-then-C order. CONCATN joins exactly C consecutive registers starting at R[B], in increasing register order. All CONCATN sources are read before the result is written, so the destination may overlap the input range. A zero CONCATN count produces the empty String.

| Mnemonic | Opcode | Operands and domain | Result in R[A] | Nominal cycles |
|---|---:|---|---|---:|
| CONCAT | `1DH` | RK(B), then RK(C); every language value kind has the conversion shown below | Combined String | 1 |
| CONCATN | `1EH` | B first register; C register count; neither B nor C is RK | String formed from `R[B]` through `R[B+C−1]`; empty String when C=0 | 2 |
| NOT | `20H` | R[B], not RK(B); C unused | Boolean true for nil or false; boolean false for every other kind | 1 |
| LEN | `21H` | R[B], not RK(B); C unused; String or Table | Number equal to the String codepoint count or Table array length; other kinds fault | 1 |

</section>


<section class="keep-together">

| Value being concatenated | Resulting text |
|---|---|
| nil | `nil` |
| false | `false` |
| true | `true` |
| String | Its contents |
| Table | `table` |
| Thread | `thread` |
| Closure or BuiltinFunction | `function` |
| NaN | `nan` |
| Positive infinity | `inf` |
| Negative infinity | `-inf` |
| Finite Number | BMSX numeric text formatting; +0 becomes `0`, and −0 becomes `-0` |

</section>


Concatenating a Table therefore does not serialize its entries, and concatenating a function does not print its contents or identity. Use concatenation to assemble readable text, but do not assume that its text distinguishes every language value. Finite Number formatting is shared numeric formatting, not a conversion to a 32-bit word.

### Comparisons and conditional execution

EQ, LT, and LE do not write a result register. They evaluate a predicate and compare it with the expectation encoded by A: zero expects false, and any nonzero A expects true. If the predicate differs from that expectation, execution skips exactly the next decoded instruction. A WIDE prefix and its instruction body form one instruction for this skip. If the predicate matches the expectation, the next instruction executes normally.

<section class="keep-together">

Equality respects value kinds. Different kinds are unequal; there is no numeric-string or boolean-number equality conversion. Numbers use numeric equality, so NaN is unequal even to itself, while +0 and −0 are equal. Table, Closure, and Thread equality is reference identity rather than a comparison of their contents.

| Matching operand kinds | EQ predicate |
|---|---|
| nil, false, or true | Equal to the same kind |
| Number | Numeric equality; NaN is unequal, +0 equals −0 |
| String | Same interned string identity |
| BuiltinFunction | Same builtin identifier |
| Table, Closure, or Thread | Same reference identity |
| Different kinds | False |

</section>


<section class="keep-together">

Ordering is defined for two Numbers or two Strings. Numbers use numeric less-than or less-than-or-equal comparison. Strings use lexical UTF-8 order. Mixed kinds and all other kind combinations produce a false predicate rather than a comparison type fault. Equality of Tables can therefore test whether two values refer to the same Table, but LT and LE do not provide an ordering of Tables.

| Mnemonic | Opcode | Operands | Predicate and control effect | Nominal cycles |
|---|---:|---|---|---:|
| EQ | `23H` | RK(B), RK(C); A is expected truth, not a destination | Equality by the value-kind rules above; skip the next decoded instruction if the predicate differs from `(A≠0)` | 1 |
| LT | `24H` | RK(B), RK(C); A is expected truth, not a destination | Number less-than or String lexical less-than; false otherwise; skip the next decoded instruction if the predicate differs from `(A≠0)` | 1 |
| LE | `25H` | RK(B), RK(C); A is expected truth, not a destination | Number less-than-or-equal or String lexical less-than-or-equal; false otherwise; skip the next decoded instruction if the predicate differs from `(A≠0)` | 1 |

</section>


## Calls, closures, globals, and tables

### Values and register notation

A frame register holds a language value: nil, a boolean, a number, a string, a table, a closure, a builtin function, or a thread. Register operands select logical value slots in the current call frame. They are not byte addresses, and a register slot is not a four-byte data word.

<section class="keep-together">

The instruction descriptions use the following notation:

| Notation | Meaning |
|---|---|
| `R(i)` | Logical register slot `i` in the current frame. |
| `K(i)` | Constant `i` in the execution image. |
| `RK(x)` | `R(x)` when the decoded operand `x` is nonnegative; otherwise `K(-1-x)`. Thus `RK(-1)` selects `K(0)`. |
| `top` | The exclusive upper limit of the frame's active register range. An open value range beginning at `A` contains `max(top-A, 0)` values. |
| `index(base, key)` | A language-level indexed lookup or assignment, not a memory access at a byte offset. |

</section>


Unless a dedicated rule below says otherwise, writing a register raises `top` to at least one past that register and does not lower it. Writing a table element, global, or upvalue does not itself extend the register range.

### Calling and returning values

`CALL A,B,C` takes its callee from `R(A)`. Arguments occupy consecutive registers starting at `R(A+1)`, and returned values replace consecutive registers starting at `R(A)`.

Only closure and builtin-function values are callable. A number is not callable merely because its numeric value is a function-record address. Calling any other value category raises `CALL_NON_FUNCTION`.

<section class="keep-together">

The three count operands in the call/return family deliberately do not use one common encoding:

| Instruction operand | Zero | Positive value |
|---|---|---|
| `CALL B`: supplied arguments | Use `max(top-A-1, 0)` arguments. | Supply exactly `B-1` arguments. In particular, `B=1` supplies none. |
| `CALL C`: requested results | Accept all produced results. | Accept exactly `C` results. |
| `RET B`: produced results | Return `max(top-A, 0)` values. | Return exactly `B` values. |
| `VARARG B`: copied arguments | Copy all saved varargs. | Copy exactly `B` values, filling any shortage with nil. |

</section>


For example, `CALL A,3,2` supplies two arguments, from `R(A+1)` and `R(A+2)`, and requests two results at `R(A)` and `R(A+1)`. If the function produces only one result, the second result is nil. If it produces more than two, the excess is discarded. After result placement, `top` is exactly `A+2`.

An open-result call instead sets `top` to `A` plus the number of results actually produced. This exact-top rule makes a returned value range available to a following open-argument call or open return without treating every previously written register as an argument or result. It also means that result placement can lower `top`. Normal builtin completion follows the same result selection, nil padding, and exact-top rules.

On entry to a closure, the function record supplies the code address and parameter metadata. The frame starts with `top` equal to its fixed-parameter count, not its maximum stack allocation. Supplied arguments fill the fixed parameters in order, and missing fixed arguments become nil. Excess arguments are retained as varargs only for a function marked vararg; otherwise they are not retained as varargs.

`VARARG A,0` copies the saved excess arguments starting at `R(A)` and sets `top` exactly to the end of that copied range. If there are none, it sets `top` to `A`. A fixed-count `VARARG` pads with nil as needed and only raises `top`, to at least `A+B`.

`RET` closes the returning frame's open upvalues before routing its results. An ordinary nested return places results in the caller's saved destination range and releases the returning frame. A return need not have an ordinary caller: protected-call targets, completion, and coroutine resumption have distinct return routes. Returning from a root frame with no resumer records completion values.

### Closures and captured variables

A closure is a callable language value associated with a function record and captured upvalues. `CLOSURE` constructs this value; it does not merely copy a numeric code address into a callable register.

The `CLOSURE` register-address flag chooses how to obtain the function-record address:

- Flag clear: the address is `Bx × 16`.
- Flag set: `Bx` selects the register supplying the unsigned address.

The function record is read before the destination is written. It identifies the function's code and frame metadata, including the fixed-parameter count, maximum stack allocation, vararg and static flags, and upvalue information. A failed record read hard-halts without writing `R(A)`. A bus-read fault while reading the upvalue descriptors likewise hard-halts without writing `R(A)`.

<section class="keep-together">

Each upvalue descriptor is a 32-bit word. Descriptor `i` is read at `upvalueTableAddress + 4i`:

| Descriptor bits | Capture source |
|---|---|
| High bit set | A register slot in the parent frame; the low 31 bits select the slot. |
| High bit clear | An upvalue of the parent closure; the low 31 bits select that upvalue. |

</section>


An open upvalue accesses its captured parent-frame register directly. Captures can share an already-linked open upvalue for that slot, so updates through the captured variable remain shared. Closing an upvalue retains the current language value separately from the frame; subsequent reads and writes access that retained storage. `GETUP` and `SETUP` use the same upvalue operand regardless of whether the upvalue is open or closed.

A function record marked static and having zero upvalues uses a closure cache keyed by its function-record address. Repeated construction for that record returns its cached closure value. This does not make the numeric address itself callable.

### Two global namespaces

Ordinary globals and system globals are separate namespaces. `GETGL` and `SETGL` access ordinary globals; `GETSYS` and `SETSYS` access system globals. A matching name in one namespace does not select the value stored under that name in the other.

For these instructions, `Bx` is an index into the corresponding execution-image name table. It is not a register operand, a constant-pool string operand, or a table key. Each image's ordinary and system name tables are independently mapped to their namespace slots. Registering a new name initializes its value to nil; registering an existing name reuses the slot in that namespace. The namespace distinction alone does not specify a privilege boundary.

### Tables, keys, and method receivers

The table instruction families differ in where the key comes from:

- `GETT` and `SETT` take general keys through `RK` operands.
- `GETI` and `SETI` carry the integer key directly in an instruction operand.
- `GETFIELD`, `SETFIELD`, and `SELF` select a string key directly from the image constant pool. That constant operand is not an `RK` operand.

Reads accept a table base. A string base instead uses the CPU's string-index table; these instructions do not specify substring indexing. Other base value categories raise `INDEX_NON_TABLE`. Without a metatable, a table read is direct. With a metatable, it uses table index resolution; an exhausted or failed resolution chain raises `METATABLE_LOOP`.

Writes accept only table bases, including for integer and string-field forms. Assigning through any other value category, including a string, raises `ASSIGN_NON_TABLE`.

`SELF` prepares both a method value and its receiver. It preserves the original `R(B)` in `R(A+1)` before looking up the string-keyed field into `R(A)`. The receiver therefore remains available as the first argument when the method value is called. Both destination writes extend `top` as needed. Preserving the original receiver also defines the result when a destination overlaps the source register.

`NEWT` creates an empty table with an array-capacity request and a hash-size request. These operands request storage; they neither supply initial elements nor state the number of elements already present.

### Instruction reference

The following tables describe the decoded operands. `A`, `B`, `C`, and `Bx` name instruction fields, not additional language values. Opcode values use hexadecimal notation (`H`). All costs are base instruction cycles; see **Builtin call charges** below.

<section class="keep-together">

#### Calls and captured values

| Instruction | Opcode | Operands | Result or effect | Base cycles |
|---|---:|---|---|---:|
| `CALL` | `2FH` | `A, B, C` | Call the closure or builtin in `R(A)` with arguments beginning at `R(A+1)`. `B=0`: use the open argument range; otherwise supply `B-1` arguments. `C=0`: accept all results; otherwise accept exactly `C`, truncating or nil-padding. Results begin at `R(A)`. | 2 |
| `RET` | `30H` | `A, B` | Close the frame's open upvalues and return values beginning at `R(A)`. `B=0`: produce the open range; otherwise produce exactly `B` values. | 2 |
| `VARARG` | `2EH` | `A, B` | Copy saved varargs beginning at `R(A)`. `B=0`: copy all; otherwise copy exactly `B`, padding with nil. | 2 |
| `CLOSURE` | `2BH` | `A, Bx`, register-address flag | Construct a closure in `R(A)`. Flag clear: function record at `Bx × 16`. Flag set: address supplied by `R(Bx)`. Capture according to the record's upvalue descriptors. | 1 |
| `GETUP` | `2CH` | `A, B` | `R(A) = upvalue(B)` of the current closure. | 1 |
| `SETUP` | `2DH` | `A, B` | `upvalue(B) = R(A)` in the current closure. | 2 |

</section>


<section class="keep-together">

#### Global namespaces

| Instruction | Opcode | Operands | Result or effect | Base cycles |
|---|---:|---|---|---:|
| `GETGL` | `38H` | `A, Bx` | Load into `R(A)` the ordinary global selected by ordinary-global image name index `Bx`. | 1 |
| `SETGL` | `39H` | `A, Bx` | Store `R(A)` into the ordinary global selected by ordinary-global image name index `Bx`. | 2 |
| `GETSYS` | `36H` | `A, Bx` | Load into `R(A)` the system global selected by system-global image name index `Bx`. | 1 |
| `SETSYS` | `37H` | `A, Bx` | Store `R(A)` into the system global selected by system-global image name index `Bx`. | 2 |

</section>


<section class="keep-together">

#### Tables and field lookup

| Instruction | Opcode | Operands | Result or effect | Base cycles |
|---|---:|---|---|---:|
| `GETT` | `0EH` | `A, B, C` | `R(A) = index(R(B), RK(C))`. | 1 |
| `SETT` | `0FH` | `A, B, C` | `index(R(A), RK(B)) = RK(C)`. | 2 |
| `GETI` | `3AH` | `A, B, C` | `R(A) = index(R(B), C)`. `C` is the integer key itself. | 1 |
| `SETI` | `3BH` | `A, B, C` | `index(R(A), B) = RK(C)`. `B` is the integer key itself. | 2 |
| `GETFIELD` | `3CH` | `A, B, C` | `R(A) = index(R(B), K(C))`, where `K(C)` supplies the string key. | 1 |
| `SETFIELD` | `3DH` | `A, B, C` | `index(R(A), K(B)) = RK(C)`, where `K(B)` supplies the string key. | 2 |
| `SELF` | `3EH` | `A, B, C` | Preserve original `R(B)` in `R(A+1)`, then set `R(A) = index(original R(B), K(C))`, where `K(C)` supplies the string key. | 1 |
| `NEWT` | `10H` | `A, B, C` | Put a new table in `R(A)`, with array-capacity request `B` and hash-size request `C`. | 1 |

</section>


### Builtin call charges

The `CALL` instruction's base charge is 2 cycles. Calling a builtin additionally incurs that builtin's own base charge before its normal or special call route. Builtin base-charge tiers are 1, 2, and 4 cycles; their per-argument and per-result charge coefficients are zero. Thus the instruction base alone is not the complete charge for a builtin call, nor does the builtin base describe every possible cost of its internal work.

The symbolic faults named in this section identify failure reasons. They do not, by themselves, specify error text or which program context can catch a failure.

<section class="keep-together">

## Memory transfers

Memory instructions move numeric scalars between registers and byte-addressed memory. They do not save and restore arbitrary language values. In particular, the `Word` format transfers a raw unsigned 32-bit integer; it is not an encoding of an entire register value. A `Word` load produces an ordinary Number containing that integer.

</section>

### Scalar formats

<section class="keep-together">

The `C` operand of a scalar load or store selects one of six formats:

| `C` | Format | Bytes | Loaded register value | Store conversion | Required address alignment |
|---|---|---:|---|---|---:|
| 0 | `Word` | 4 | Unsigned 32-bit integer Number | Convert to unsigned 32-bit integer | 4 bytes |
| 1 | `U8` | 1 | Integer Number, 0–255 | Store the low 8 integer bits | 1 byte |
| 2 | `U16LE` | 2 | Integer Number, 0–65535 | Store the low 16 integer bits | 2 bytes |
| 3 | `U32LE` | 4 | Unsigned 32-bit integer Number | Convert to unsigned 32-bit integer | 4 bytes |
| 4 | `F32LE` | 4 | Number decoded from IEEE single precision | Round the numeric value to IEEE single precision and store its bits | 4 bytes |
| 5 | `F64LE` | 8 | Number decoded from IEEE double precision | Store the numeric value's IEEE double-precision bits | **4 bytes** |

</section>


All multi-byte formats are little-endian: the least significant byte occupies the lowest address. `Word` and `U32LE` transfer the same numeric data, but identify the access differently in bus-fault metadata. Floating-point transfers decode or encode floating-point bits; they are not integer conversions of the floating-point number. No guarantee of preserving every NaN payload is made.

Address conversion and integer-store conversion truncate toward zero and retain the unsigned low 32 bits. Non-numeric register values take the numeric-conversion path through NaN and become zero on this integer path. Numeric NaN and infinities also become zero on this integer path. Floating-point stores use numeric conversion instead, so a non-numeric register value becomes NaN. A fractional address is converted before its alignment is checked.

`F64LE` is two ordered 32-bit transfers, not one indivisible eight-byte transfer. The low half is accessed at the starting address, then the high half four bytes later. Four-byte alignment is sufficient; eight-byte alignment is not required.

### Address operands

The ordinary forms, `LOAD_MEM`, `STORE_MEM`, and `STORE_MEM_WORDS`, obtain their starting byte address from `RK(B)`. A nonnegative `B` selects register `B`; a negative `B` selects constant `-1-B`. The selected value is converted to an unsigned 32-bit address.

The displacement forms, whose names end in `_D`, always use register `B` as the base:

`address = (u32(R[B]) + 4 × disp) modulo 2^32`

Here `disp` is the instruction's **unsigned eight-bit word displacement**, from 0 through 255. It reaches byte offsets 0 through 1020. It is neither signed nor extended by `WIDE`. A negative displacement therefore cannot be expressed by setting the top displacement bit. `WIDE` can extend the other operand fields without extending this displacement.

### Scalar access and IO

Scalar loads check alignment before attempting a memory access. If a new bus fault occurs during the read, the destination register is not changed. This does not undo a read or a device side effect that has already occurred.

Scalar stores check alignment, then ask whether the mapped starting address is ready for a write. This readiness check precedes reading and converting the source register for the write. If the target is not ready, no store takes place: the instruction is left blocked on that raw target address. A matching ready event clears the blocked condition; the next attempt starts the instruction again. Readiness is checked only at the starting address, including for `F64LE`.

A readiness check is not a permission or fault preflight. An aligned but not-ready IO target can defer a store before a width or bus fault would be observed. Once a scalar store is attempted, a new bus fault raises `DataBusError`; effects already produced by the store remain.

The two halves of an `F64LE` access are fault-ordered. A new fault on the low half prevents the high-half access. A high-half fault leaves the low-half access or store already performed. A load updates its destination only if both halves succeed. The high half of an `F64LE` store is not covered by a separate readiness preflight.

Memory instructions use the CPU memory bus and do not themselves require supervisor mode. This is not a promise that every mapped target admits every access. In IO space, a `U8` load must be word-aligned and reads the low byte of a whole IO word. IO `U8` stores and `U16LE` loads or stores fault. `Word`, `U32LE`, `F32LE`, and each half of `F64LE` use whole-word mapped accesses; individual device-register meanings remain part of the device contract.

### Counted word stores

`STORE_MEM_WORDS` and `STORE_MEM_WORDS_D` use `C` as a **word count**, not a scalar-format selector. They write consecutive registers to consecutive words:

`R[A+i] → (start + 4 × i) modulo 2^32`, for `i = 0 … C-1`.

Each register is converted to an unsigned 32-bit integer. The starting address must be four-byte aligned, even when `C` is zero. A zero count otherwise performs no writes and adds no sequence surcharge.

Before writing anything, the instruction scans the counted span's IO overlap in increasing address order and waits on the first not-ready word. This preflight happens before the sequence surcharge as well as before any write. Consequently, a later not-ready IO word can defer the instruction before an earlier word would otherwise commit or fault. The readiness span is computed without 32-bit wrap; the actual write addresses wrap modulo `2^32`. Do not treat this as readiness preflight for IO reached only by wrapping into low addresses.

Once preflight succeeds, the instruction charges one additional cost unit per four counted words, rounded up: `(C + 3) >> 2`. It then attempts the words in increasing `i` order and checks for a new bus fault after every word. The first such fault stops the sequence and raises `DataBusError`. Earlier successful words remain written; later words are not attempted. The full sequence surcharge has already been charged even if a later word faults.

A counted store is not atomic and has no rollback. Its readiness preflight is not a guarantee that every later write will succeed. A blocked attempt writes nothing and retains no partial-sequence offset; a retry starts the instruction again.

### Memory instruction reference

<section class="keep-together">

`read_C(address)` below means a read in the scalar format selected by `C`. `u32` denotes the conversion described above, not serialization of a language value. The common alignment, readiness, fault, and partial-effect rules apply to every applicable row. Costs are nominal base charges plus the stated surcharge; execution-budget, prefix, and retry accounting follow the CPU execution rules.

| Opcode | Instruction and operands | Effect | Nominal cost |
|---|---|---|---:|
| `04H` | `LOAD_MEM_D A, B, C, disp` | Load `read_C((u32(R[B]) + 4×disp) mod 2^32)` into `R[A]`; leave `R[A]` unchanged on a new bus fault | 2 |
| `0CH` | `STORE_MEM_D A, B, C, disp` | Store `R[A]` in scalar format `C` at `(u32(R[B]) + 4×disp) mod 2^32` | 2 |
| `0DH` | `STORE_MEM_WORDS_D A, B, C, disp` | Starting at `(u32(R[B]) + 4×disp) mod 2^32`, store `C` consecutive unsigned words from `R[A]` onward | `2 + ((C+3)>>2)` after successful readiness preflight |
| `31H` | `LOAD_MEM A, B, C` | Load `read_C(u32(RK(B)))` into `R[A]`; leave `R[A]` unchanged on a new bus fault | 2 |
| `32H` | `STORE_MEM A, B, C` | Store `R[A]` in scalar format `C` at `u32(RK(B))` | 2 |
| `33H` | `STORE_MEM_WORDS A, B, C` | Starting at `u32(RK(B))`, store `C` consecutive unsigned words from `R[A]` onward | `2 + ((C+3)>>2)` after successful readiness preflight |

</section>


`F64LE` uses the same listed scalar-memory cost as the other scalar formats; it adds no per-half transfer surcharge. Neither this cost nor the counted-store surcharge specifies a device's electrical bandwidth.

## Branches

Branch conditions use value truth. Only Nil and False are false. Numeric zero, numeric NaN, the empty string, and all other language values are true.

The signed `BX` displacement is measured in four-byte instruction words. A branch target is:

`target = (instruction-start PC + full instruction byte width + 4 × signedBX) modulo 2^32`

The full instruction width includes a `WIDE` prefix when present. Thus the displacement is relative to the byte immediately after the complete branch instruction, not its first word. `BX` is signed 20-bit without `WIDE` and signed 26-bit with it. A conditional branch that is not taken continues at the already selected sequential PC.

<section class="keep-together">

The branch itself performs no target-memory read or target-alignment check. Fetching at the resulting PC is a separate step governed by the instruction-fetch rules.

| Opcode | Instruction and operands | Effect | Nominal cost |
|---|---|---|---:|
| `28H` | `JMP BX` | Assign the branch target to PC; `A` is ignored | 1 |
| `29H` | `JMPIF A, BX` | Assign the target to PC if `R[A]` is true; otherwise continue sequentially | 1 |
| `2AH` | `JMPIFNOT A, BX` | Assign the target to PC if `R[A]` is false; otherwise continue sequentially | 1 |

</section>


## CP0 and execution control

CP0 holds exception and privilege state. Current privilege comes from **Status bit 1**, not from the identity of the currently selected image. A clear bit means supervisor mode; a set bit means user mode. Status bit 0 is the current interrupt-enable bit. System entry initializes Status to 1; cartridge entry initializes it to 3.

`MFC0`, `MTC0`, and `RFE` require supervisor mode. In user mode they raise coprocessor-unusable before selecting a CP0 field, converting a source value, or checking whether `RFE` has an exception frame. `HALT`, branches, and the memory instructions have no corresponding current-mode check.

### CP0 fields

<section class="keep-together">

For `MFC0` and `MTC0`, `A` names the value register and `B` is the raw CP0 field number, **not an RK operand**. Their handlers do not use `C`.

| Field number | Name | `MFC0` result | `MTC0` effect in supervisor mode |
|---:|---|---|---|
| 8 | `BadAddress` | Raw unsigned word as a Number | Ignored |
| 9 | `LuaFaultReason` | Raw unsigned word as a Number | Ignored |
| 12 | `Status` | Raw unsigned word as a Number | Replace the complete word, without masking |
| 13 | `Cause` | Raw unsigned word as a Number | Ignored |
| 14 | `EPC` | Raw unsigned word as a Number | Replace the complete word, without an alignment check |
| 15 | `EXEC` | Zero | Replace execution with the addressed static function |

</section>


`MTC0` converts `R[A]` to an unsigned 32-bit word before applying the selected field's write behavior, including an ignored write. An unknown field number hard-halts in supervisor mode. This is not a coprocessor-unusable exception, and a rejected `MFC0` does not update its destination. A hard halt does not itself assign a new CP0 Cause.

### EXEC

Writing `EXEC` supplies a **function-record address**, not an instruction-entry address. The record is read on the CPU bus and must identify a static function; otherwise execution hard-halts.

A successful `EXEC` clears the active call stack, selects the function's image, and starts the static function with zero arguments. It clears HALT, retained-interrupt-event, blocked-write, hard-halt, and requested-yield state. The new Status is 3 if the selected execution-domain ID is nonnegative, or 1 otherwise. `EXEC` replaces execution: it is neither an ordinary function call with a saved return point nor an exception return.

### Exception return

In supervisor mode, `RFE` requires the current frame to be an exception frame; otherwise it hard-halts. It samples the active EPC, closes the exception frame's open upvalues, removes that frame, and restores the register-stack top to the removed frame's vararg base.

`RFE` replaces Status bits 0–3 with the former bits 2–5, retaining the higher bits. If a caller remains, its PC is assigned the sampled EPC. In particular, writing EPC before `RFE` changes this return target; `RFE` does not impose a separate alignment check on it.

Returning from an NMI-marked exception frame also restores the retained pre-NMI Cause, EPC, BadAddress, LuaFaultReason, and exception-domain words. The return PC still comes from the active EPC sampled before that restoration. The retained pre-NMI Status word is not restored wholesale.

### HALT

`HALT` is available in user mode as well as supervisor mode. If an interrupt event is already retained, it consumes that event without creating a HALT condition. Otherwise it records the active thread and current frame depth; the HALT condition matches only while both still match. This is an IRQ-wait latch, not a program busy loop or a request for a fixed elapsed duration. Interrupt acceptance and wake scheduling follow the interrupt rules.

<section class="keep-together">

<section class="keep-together">

### BLua control syntax

`halt_until_irq` is the BLua statement for `HALT`, as used in the complete
program above. CP0 access instead uses reserved intrinsic member syntax:

| BLua form | Source access | CP0 field |
|---|---|---:|
| `cop0.bad_address` | Read | 8 |
| `cop0.lua_fault_reason` | Read | 9 |
| `cop0.status` | Read or assign | 12 |
| `cop0.cause` | Read | 13 |
| `cop0.epc` | Read or assign | 14 |
| `cop0.exec` | Assign only | 15 |

</section>

A read emits `MFC0`; an assignment emits `MTC0`. These forms do not grant
supervisor mode. The source interface rejects writes to its read-only members
and a read of `cop0.exec`, even though the raw privileged opcode behaviors
include ignored writes and an EXEC read of zero. Do not confuse source access
restrictions with a new hardware permission fault.

The installed monitor uses `local saved_epc<const> = cop0.epc` and later
`cop0.epc = saved_epc`. Those are supervisor-context patterns, not an instruction
to read CP0 from ordinary user-mode entry. The BIOS boot handoff uses
`cop0.exec = startup`, where `startup` is the discovered static-function record
address described in **Memory and program storage**, not a generic language
function value or an arbitrary instruction address.

The generated IRQ vector calls its bound callback only when its FLAGS read is
nonzero, then performs `RFE`; a zero FLAGS read skips the callback but still
reaches `RFE`. The exception vector calls its bound callback and performs `RFE`
after that callback returns. Return normally from a callback: its normal nested
call frame is not the exception frame required by raw `RFE`.

### Control instruction reference

| Opcode | Instruction and operands | Effect | Nominal cost |
|---|---|---|---:|
| `26H` | `MFC0 A, B` | Supervisor only: copy CP0 field `B` into `R[A]` as an unsigned-word Number; EXEC reads zero; unknown fields hard-halt | 1 |
| `27H` | `MTC0 A, B` | Supervisor only: convert `R[A]` to an unsigned word and apply the CP0 field's write behavior; EXEC replaces execution; unknown fields hard-halt | 1 |
| `34H` | `RFE` | Supervisor only: return from the current exception frame using active EPC and the Status restoration above; a non-exception frame hard-halts | 1 |
| `3FH` | `HALT` | Consume a retained interrupt event, or record the current thread/frame-depth HALT condition | 1 |

</section>


`RFE` and `HALT` do not use `A`, `B`, or `C`.

## Memory faults and saved PC

A misaligned load raises `AddressErrorLoad`; a misaligned scalar or counted store raises `AddressErrorStore`. Both record the converted effective address in BadAddress before any mapped access. A newly raised bus fault produces `DataBusError`; that exception does not itself replace BadAddress.

For these synchronous instruction exceptions, EPC identifies the **start of the faulting instruction**, not its already advanced sequential PC. Common exception entry records Cause and the exception domain, shifts the low six Status bits left by two while retaining the higher bits, and creates an exception frame.

Bus-fault detail and CPU exception detection are distinct. The detailed bus-fault record retains the first unacknowledged fault, while each new fault event is still detectable by the CPU. A new `DataBusError` can therefore coexist with older latched detailed fault metadata until that record is acknowledged. A preexisting record alone does not make a later load or store fail.
