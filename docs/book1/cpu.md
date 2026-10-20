# CPU and BLua32 instruction reference {#sec-cpu}

The BLua32 processor executes the cartridge program, performs arithmetic and
controls the console's memory-mapped units. Its instruction set operates on
function-frame value registers and transfers numeric scalars to and from
byte-addressed storage. Function calls, closures and language error handling
are part of the processor's execution architecture.

This chapter defines instruction encoding, operand values, execution timing
and CP0 control. [[Memory](memory.md#sec-memory)]{.content-visible when-format="html"}[Book I, “Memory and bus access”]{.content-visible when-format="pdf"} defines the address map;
[Program images and startup](program-images.md#sec-program-images) defines program records;
[[IRQ](irq.md#sec-irq)]{.content-visible when-format="html"}[Book I, “Interrupt controller”]{.content-visible when-format="pdf"} defines interrupt-source service; [[SYSTEM](system.md#sec-system)]{.content-visible when-format="html"}[Book I, “System control and timing”]{.content-visible when-format="pdf"} defines
supervisor device contexts. Device commands and their result formats are
defined in the corresponding Book I chapters.

## Programming model {#sec-cpu-programming-model}

Function-local registers hold values used by arithmetic, branches and calls.
Byte-addressed storage holds instructions, static data, transfer buffers and
device registers. Scalar memory instructions connect these paths: a load
produces a Number from addressed bytes, and a store writes the selected numeric
representation.

| Operation | Source | Result |
|---|---|---|
| Arithmetic and comparison | Frame registers or image constants | A language value or a branch/skip decision |
| Closure call | A closure and argument values | A new call frame; returned values go to the caller's result slots |
| Typed memory access | Numeric byte address and scalar format | A numeric load or a byte/word write through the memory map |
| Device programming | Numeric register address and command/operand words | Work admitted by the addressed unit under its own rules |
| Exception entry | Accepted interrupt or synchronous CPU exception | Saved CP0 state and an exception frame |

Register R0 belongs to the current function frame; R0 in a called function is
a different slot. An ordinary call retains the caller's continuation and uses
the callee's function record to establish its entry PC and register capacity.
A return places results in the caller's requested result range. Captured locals
remain connected to their closures; the closure rules below describe their
lifetime.

To control a device, prepare its addressed payload and operands, then write its
command port. The receiving unit supplies a status or interrupt condition for
its subsequent completion. Wait for that condition before reusing live input or
output storage. [[Memory](memory.md#sec-memory-device-specific-buffer-lifetimes)]{.content-visible when-format="html"}[Book I, “Memory and bus access”, under “Device-specific buffer lifetimes”]{.content-visible when-format="pdf"} describes
these lifetimes across DMA, geometry, drawing and sound.

### Values are not register words {#sec-cpu-values-are-not-register-words}

A CPU register holds a language value, not an unconditionally interpreted 32-bit word. The value kinds are nil, false, true, Number, String, Table, Closure, BuiltinFunction, and Thread. Copying a register or loading a constant preserves its value kind: copying false does not turn it into zero, and copying a Table preserves the reference to that Table.

An ordinary Number is a double-precision floating-point value. It can carry fractional values, signed zero, infinities, and NaN. Arithmetic does not implicitly wrap it to 32 bits or give it a fixed-point interpretation. A raw 32-bit word, by contrast, is a pattern of 32 bits. The bitwise and shift instructions perform a word conversion at their inputs and return the signed 32-bit interpretation as an ordinary Number; they do not change how other Numbers are stored or calculated.

Numeric operand reads are not general value conversions. A Number supplies its numeric value; any other value kind supplies NaN. In particular, a numeric string is not parsed, and a boolean is not converted to zero or one. Numeric results remain Numbers, including results that are NaN.

This distinction matters when choosing operations in BLua. Use ordinary arithmetic when fractions and non-wrapping numeric results are wanted. Use bitwise operations when the calculation concerns flags, masks, or particular word bits. Use the truth rules for conditions rather than assuming that a numeric zero is false.

### Values and register notation {#sec-cpu-values-and-register-notation}

Register operands select logical value slots in the current call frame. A slot
is not a byte address or a four-byte data word.


The instruction descriptions use the following notation:

| Notation | Meaning |
|---|---|
| `R(i)` or `R[i]` | Logical register slot `i` in the current frame. |
| `K(i)` or `K[i]` | Constant `i` in the execution image. |
| `RK(x)` | `R(x)` when the decoded operand `x` is nonnegative; otherwise `K(-1-x)`. Thus `RK(-1)` selects `K(0)`. |
| `top` | The exclusive upper limit of the frame's active register range. An open value range beginning at `A` contains `max(top-A, 0)` values. |
| `index(base, key)` | A language-level indexed lookup or assignment, not a memory access at a byte offset. |



Unless a dedicated rule below says otherwise, writing a register raises `top` to at least one past that register and does not lower it. Writing a table element, global, or upvalue does not itself extend the register range.

### From stored bytes to a frame value {#sec-cpu-from-stored-bytes-to-a-frame-value}

Consider four data bytes at consecutive addresses:

| Byte address | `p` | `p+1` | `p+2` | `p+3` |
|---|---|---|---|---|
| Stored byte | `78H` | `56H` | `34H` | `12H` |

Let R1 hold the numeric address `p`, four-byte aligned in readable data storage,
and reserve R0 through R2 in the current frame. The following two instructions
read from the same starting address:

| Instruction | Meaning of its operands | Result |
|---|---|---|
| `LOAD_MEM 0,1,2` | Destination R0; address from R1; format 2, unsigned little-endian halfword | R0 receives Number 22136 (`5678H`) |
| `LOAD_MEM 2,1,3` | Destination R2; address from R1; format 3, unsigned little-endian word | R2 receives Number 305419896 (`12345678H`) |

The address selects the bytes; the format selects how many are read and how
they become a Number. R0 and R2 are both value slots, not permanently typed
halfword and word registers. Neither load changes R1 or the stored bytes.
Likewise, a scalar store converts a numeric value to its selected storage
representation; it does not write the complete language value into memory.

These are the same bytes used by `halves[0]` and `*whole` in the
[worked computation](#sec-cpu-worked-computation-numbers-words-and-stored-bytes).
Those BLua pointer types select the memory operation; they do not give the
destination value slot a different numeric kind. The instruction encoding
below carries the destination, address selection and format as operands A, B
and C. The [memory reference](#sec-cpu-memory-transfers) defines all formats,
alignment rules and fault effects.

### Following a closure call {#sec-cpu-following-a-closure-call}

A call changes both the current instruction stream and the current register
frame. Follow a call to the function whose record is at `10001230H`, using R3
for its closure:

| Step | Caller state | Execution effect |
|---|---|---|
| Construct the function's closure in R3 | R3 holds the callable value | Execution continues in the caller; the callee has not started |
| Execute `CALL 3,1,1` | R3 supplies that closure; B=1 supplies no arguments; C=1 requests one result | A new frame starts at the code address in the function record |
| Return normally from that callee | Its first result replaces the caller's R3, or nil is supplied if it produced none | The caller resumes at the instruction following the CALL |

The callee uses its own R0 and subsequent slots. Its function-record address
identifies the entry metadata, while its PC identifies the instructions being
executed. The caller retains its next PC during the call; that continuation is
not an argument or an ordinary returned value. Constructing the closure,
entering the function and receiving its results are therefore separate steps.
The [call reference](#sec-cpu-calling-and-returning-values) defines argument
placement, variable result counts and other return routes. The
[encoding example](#sec-cpu-linkage-operands-and-encoding-examples) below turns
this same R3 call sequence into instruction bytes.


## Worked computation: Numbers, words and stored bytes {#sec-cpu-worked-computation-numbers-words-and-stored-bytes}

Start after normal BIOS entry, which has initialized the cartridge's DATA and
BSS. The following operations require no device setup. The storage declarations
provide assigned byte addresses; they are not CPU register allocations.

```lua
module<entry>
rodata operands: f64[3] = { -7, 3, 2147483648 }
rodata bytes: u8[4] = { 0x78, 0x56, 0x34, 0x12 }
bss word_result: word
bss rounded: f32

local numbers<const>: *f64 = operands
local halves<const>: *u16 = bytes
local whole<const>: *u32 = bytes
local quotient = numbers[0] / numbers[1]
local floor_quotient = numbers[0] // numbers[1]
*word_result = numbers[2]
*rounded = numbers[2] + 1
```

| Expression or stored result | Value | Reason |
| --- | --- | --- |
| `quotient` | −7/3, approximately −2.3333333333333335 | Number division retains a fraction. |
| `floor_quotient` | −3 | Floor division rounds downward. |
| `numbers[0] % numbers[1]` | 2 | A nonzero remainder follows the divisor's sign. |
| `-numbers[0] % -numbers[1]` | −2 | Reversing the signs changes the remainder's sign. |
| `*word_result` | `80000000H`, read as 2147483648 | A word store retains raw low 32 bits. |
| `numbers[2] \| 0` | −2147483648 | Bitwise output uses signed-word interpretation. |
| `numbers[2] >> 1` | −1073741824 | Right shift preserves the sign bit. |
| `1 << 32`, `1 << -1` | 1, −2147483648 | Shift counts retain their low five bits. |
| `-1.75 \| 0` | −1 | Word conversion truncates toward zero. |
| `halves[0]`, `halves[1]` | `5678H`, `1234H` | Halfword reads are little-endian. |
| `*whole` | `12345678H` | The same four bytes form one word. |
| `*rounded` | 2147483648 | The f32 store rounds 2147483649. |

Arithmetic Number results do not wrap at the signed-word boundary. A stored
word, a signed bitwise result and an f32 value are different representations.
Finite printed Numbers are rounded text, not an exact substitute for those
stored values. See the Number-to-text rules below.

## Instruction words and execution resources {#sec-cpu-instruction-words-and-execution-resources}

| Resource | Specification |
|---|---|
| System-cycle timebase | 33,868,800 cycles/s |
| Installed main RAM | 4 MiB; mapped windows, reservations and ownership are in the Memory chapter |
| Language-allocation budget | 3.5 MiB of shared accounting capacity, not an additional raw RAM region or wholly free register storage |
| Opcode field | 6 bits, 64 opcode identities including the WIDE prefix |
| Instruction word | 32 bits, four bytes, big-endian code bytes |
| Instruction length | One word; two words with one WIDE prefix |
| Numeric value | Double-precision Number, distinct from other language values |
| Data word and CP0 word | 32 bits; scalar data transfers are little-endian |
| Frame registers | Logical value slots relative to the current call frame; the function record supplies its parameter count and maximum stack allocation |
| Register/count encoding | Format-dependent limits below, not a fixed physical register allocation or unlimited recursion guarantee |


### Word fields {#sec-cpu-word-fields}

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


The Bx family comprises LOADK, KSMI, the three branches, CLOSURE and the four
global-name instructions. Memory forms ending in `_D` use displacement fields;
other instruction bodies use ABC. Each instruction table identifies which
operands are registers, counts, immediate values, constant indices or RK
selectors. Apply that row's interpretation after decoding the fields.

### WIDE — opcode 00H {#sec-cpu-wide-opcode-00h}

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

### Constructing instruction bytes {#sec-cpu-constructing-instruction-bytes}

To assemble a body word, put its six-bit fields `a`, `b`, `c` and extension byte
`E` into:

`word = (E << 24) | (opcode << 18) | (a << 12) | (b << 6) | c`

Write that word most-significant byte first. The following table splits the
complete operands into those fields and the six-bit prefix fields `pA`, `pB`,
`pC`. `B` and `C` here mean raw fields, before any RK sign interpretation.

| Format | Body fields | Body `E` | WIDE prefix fields |
|---|---|---|---|
| ABC | `a=A&63`, `b=B&63`, `c=C&63` | `(((A>>6)&3)<<6) \| (((B>>6)&7)<<3) \| ((C>>6)&7)` | `pA=A>>8`, `pB=B>>9`, `pC=C>>9` |
| Bx | `a=A&63`, `b=(U>>6)&63`, `c=U&63` | `(U>>12)&255` | `pA=A>>6`, `pB=U>>20`, `pC=0`, except the CLOSURE register-address flag |
| Displacement | `a=A&63`, `b=B&63`, `c=C&63` | `disp` | `pA=A>>6`, `pB=B>>6`, `pC=C>>6` |

For an unsigned Bx operand, `U` is Bx itself. For a signed Bx operand, `U` is its
two's-complement pattern in **20 bits without WIDE or 26 bits with WIDE**.
Similarly, encode a negative RK operand in 9 or 15 bits before splitting its
raw B/C field. Merely adding a zero-filled prefix to a narrow negative operand
does not preserve its sign. A prefix word uses opcode zero, its `a/b/c` fields
are `pA/pB/pC`, and its ignored extension byte can be zero.

The [two loads above](#sec-cpu-from-stored-bytes-to-a-frame-value) use ABC with
opcode `31H`. Their operands fit the low fields, so EXT is zero and no WIDE
prefix is needed:

| Instruction | A | B | C | Instruction word | Code bytes, in address order |
|---|---:|---:|---:|---|---|
| `LOAD_MEM 0,1,2` | 0 | 1 | 2 | `00C40042H` | `00 C4 00 42` |
| `LOAD_MEM 2,1,3` | 2 | 1 | 3 | `00C42043H` | `00 C4 20 43` |

The instruction bytes describe which operation to perform. The data bytes
`78 56 34 12` remain at `p` in their little-endian data order. Encoding or
fetching either instruction does not change that stored representation.

### Linkage operands and encoding examples {#sec-cpu-linkage-operands-and-encoding-examples}

A known function target still uses `CLOSURE` followed by `CALL`; `CALL` has no
function-address immediate. The immediate CLOSURE relocation is the absolute
**function-record byte address divided by 16**, not a code address, function
ordinal, image-relative offset or constant index. In its register-address form,
encode the register index as Bx and set prefix `pC=32`; the register supplies
the full byte address without division by 16. Both forms produce a closure for
the same `CALL` mechanism. CP0 `EXEC`, by contrast, consumes a full byte address
and replaces execution, as specified below.

The immediate form represents sixteen-byte-aligned targets: up to `00FFFFF0H`
without WIDE, or `3FFFFFF0H` with WIDE. A cartridge-ROM target therefore needs
WIDE even when its destination register is small. The register-address form
does not discard the address's low four bits; record access and execution
still follow their own mapped-memory rules.

Constant operands and global-name operands retain their zero-based image-table
indices when their table order is unchanged; they are not absolute addresses.
An address stored **as a Number constant's payload** is still an address and
must be distinguished from the instruction's index selecting that constant.
[Program images and startup](program-images.md#sec-memory-blua32-executable-image)
defines the referenced records and their address fields.

The first three rows below encode the R3 closure and call introduced in
[Following a closure call](#sec-cpu-following-a-closure-call). All numbers in
the table are hexadecimal except register numbers and argument/result counts.
Spaces separate actual code bytes:

| Operation | Code bytes | Decoded operands |
|---|---|---|
| Construct the closure for the record at `10001230H` in R3 | `00 00 04 00 00 AC 31 23` | `pB=10H`, Bx=`01000123H`; Bx×16=`10001230H` |
| Construct a closure in R3 from the byte address held in R5 | `00 00 00 20 00 AC 30 05` | Register-address flag set; Bx=5 |
| Call the closure in R3 with no arguments and one requested result | `00 BC 30 41` | `CALL A=3, B=1, C=1` |
| Jump back to the branch's own first byte, without WIDE | `FF A0 0F FF` | Signed Bx=−1; one word from instruction end to start |
| Jump back to the prefix's own first byte, with WIDE | `00 00 0F C0 FF A0 0F FE` | Signed Bx=−2; two words from instruction end to prefix |

For branch relocation, compute the signed word difference from the end of the
**final-width** instruction to the target; the Branches section gives the exact
PC formula and range. Inserting WIDE changes that origin by four bytes. This
word-relative branch operand must not be confused with the byte address in a
function record or with the unsigned word displacement of a `_D` memory access.

### Register and constant selection {#sec-cpu-register-and-constant-selection}

ABC RK consumers sign-extend their 9-bit unprefixed or 15-bit prefixed B/C field.
A nonnegative result selects that frame register. A negative result selects
constant `-1-RK`: −1 names K0, not a negative-number immediate. Thus each
unprefixed RK can name R0–R255 or K0–K255; each WIDE RK can name R0–R16383 or
K0–K16383. A raw count/key field instead keeps its unsigned encoded value.

An instruction's encoding range does not allocate its referenced registers or
constants. A frame obtains its entry PC, parameter count and stack allocation
from its function record. The reserved capacity is at least one slot, including
when the record's maximum stack is zero. All reserved slots begin nil before
arguments are copied; missing fixed parameters are nil. Ordinary register writes can
extend the active range, while result placement and open varargs have the
specific top rules in the call reference. Do not treat the instruction's
maximum field value as available scratch storage in every function.

### Execution addresses and instruction reads {#sec-memory-execution-addresses-and-instruction-reads}

#### Function records and instruction addresses {#sec-memory-function-records-and-instruction-addresses}

A function address points to a **function record**, not to the first
instruction. The record's `CODE_ADDRESS` word supplies the instruction
address. These two addresses are not interchangeable.

The record and the instructions also use different byte orders:

| Item | Representation |
| --- | --- |
| Function record's `CODE_ADDRESS` word | 32-bit little-endian |
| Instruction word | Four bytes, big-endian |

Reading a function record therefore does not use the byte order used to
decode its instructions.

#### Execution domains and cartridge sockets {#sec-memory-execution-domains-and-cartridge-sockets}

BMSX has three execution domains:

| Domain ID | Execution image |
| --- | --- |
| −1 | System |
| 0 | Cartridge socket 0 |
| 1 | Cartridge socket 1 |

For cartridge execution, the active image binds instruction reads to its
cartridge socket. Domain identifiers are not RAM addresses and do not
allocate isolated RAM.


### Fetch and conditional skip {#sec-cpu-fetch-and-conditional-skip}

#### Instruction alignment and read faults {#sec-memory-instruction-alignment-and-read-faults}

Instruction PC is an unsigned 32-bit byte address and must be four-byte aligned.
Sequential advancement, WIDE-body addresses, branch targets and conditional
skips retain the low 32 bits of the calculated address. A misaligned
fetch records BadAddress and raises `AddressErrorLoad`. A new bus fault reading
either the first word or the WIDE body raises `InstructionBusError`; the saved
fetch PC is the instruction start, including the prefix address when the body
read fails. Fetch exception entry has a one-cycle charge; an unfetched body is
not dispatched with its nominal instruction cost.

In ordinary sequential execution, an instruction's effects precede a fault
fetching the following instruction. The completed instruction's effects remain
in place; the saved fetch PC identifies the instruction whose fetch failed.

Conditional-skip instructions decode the next instruction's full width and
skip that whole instruction without executing its handler or charging its
body's base cost. The skipped code can still cause a fetch exception while its
width is determined. The branch section separately defines signed word
relative targets; a branch instruction does not itself read its target.

## BLua operators and instruction costs {#sec-cpu-blua-operators-and-instruction-costs}


The table relates BLua operators to their principal instruction families.
Include operand preparation, typed loads/stores and branches when calculating
a source expression's timing. A declared static array's `#` supplies its known
element count; String and Table length use LEN.

| Source operation | Principal instruction family |
|---|---|
| `+`, binary `-`, `*`, `/` | `ADD`, `SUB`, `MUL`, `DIV` |
| `//`, `%`, `^` | `FLOORDIV`, `MOD`, `POW` |
| `&`, binary `\|`, binary `~` | `BAND`, `BOR`, `BXOR` |
| `<<`, `>>` | `SHL`, `SHR` |
| Unary `-`, `not`, `#`, unary `~` | `UNM`, `NOT`, `LEN`, `BNOT`, subject to static-array length above |
| `==`, `~=` | `EQ` with true or false expectation |
| `<`, `<=` | `LT`, `LE` with true expectation |
| `>`, `>=` | `LT`, `LE` with reversed operands and true expectation |
| `..` | CONCAT or CONCATN, with operand preparation |



The arithmetic binary forms use RK operands. Unary forms use a source register.
The comparison instructions are predicates that conditionally skip another
instruction; they do not store a Boolean in `A`. Producing a comparison value
can therefore require Boolean loads and a jump as well as the predicate. Use
the instruction path, not the number of source operators, when calculating a
cycle budget.

Source `and` and `or` select values by short-circuit evaluation rather than
requesting a Boolean-valued arithmetic instruction. Their evaluation and
result-adjustment rules are in
[BLua — Logical expressions](blua-programs.md#sec-cpu-logical-expressions).

## Values and numeric instructions {#sec-cpu-values-and-numeric-instructions}

### Reading the instruction tables {#sec-cpu-reading-the-instruction-tables}

The tables use the [register and value notation](#sec-cpu-values-and-register-notation)
introduced in the programming model. Unless a row says otherwise, A selects
the destination register. Comparison instructions instead use A as an expected
boolean result. Formulas describe instruction effects, not BLua source syntax.


The narrow and WIDE forms have the following encoding limits. These limits describe what the instruction can encode, not how many registers or constants are allocated for a particular function.

| Operand | Ordinary encoding | WIDE encoding |
|---|---:|---:|
| RK B or C | Signed 9 bits: R0–R255 or K0–K255 | Signed 15 bits: R0–R16383 or K0–K16383 |
| A in ABC formats | 8 bits | 14 bits |
| A in Bx formats | 6 bits | 12 bits |
| LOADK Bx | Unsigned 20 bits | Unsigned 26 bits |
| KSMI sBx | −524288 through 524287 | −33554432 through 33554431 |



A single-result destination write raises the current frame's top to at least
A+1 and never lowers it. The positive-count LOADNIL range is described separately
below.

Opcode numbers are zero-based. Nominal cycles are the base charge applied before
an instruction executes. The constant, arithmetic, bitwise, text and comparison
instructions below each cost one cycle except CONCATN, which costs two.
LOADNIL adds no per-register charge, and CONCATN adds no per-input or per-byte
charge. Readiness waits, counted-transfer surcharges and builtin charges are
separate; [Cycle accounting and execution boundaries](#sec-cpu-cycle-accounting-and-execution-boundaries)
defines their place in the execution budget.

### Constants and copies {#sec-cpu-constants-and-copies}


The constant and copy instructions move complete values or create a specific value kind. K0, K1, KM1, and KSMI create Numbers, not a separate integer kind. LOADNIL's B operand is a count: for example, A=4 and B=3 write nil to R4, R5, and R6, not through R7.

| Mnemonic | Opcode | Operands and specified domain | Result | Nominal cycles |
|-------------|-------:|----------------------------|--------------------------------------------|--------:|
| MOV | `01H` | A destination; B source register; C unused | `R[A] = R[B]`, preserving the complete value | 1 |
| LOADK | `02H` | A destination; Bx identifies an existing constant | `R[A] = K[Bx]`, preserving the constant's value kind | 1 |
| LOADNIL | `03H` | A first register; B register count; C unused | For B>0, set exactly `R[A]` through `R[A+B−1]` to nil and raise frame top to at least A+B without lowering it. B=0 changes neither slots nor top. | 1 |
| KNIL | `05H` | A destination; B and C unused | `R[A] = nil` | 1 |
| KFALSE | `06H` | A destination; B and C unused | `R[A] = false` | 1 |
| KTRUE | `07H` | A destination; B and C unused | `R[A] = true` | 1 |
| K0 | `08H` | A destination; B and C unused | Number +0 in `R[A]` | 1 |
| K1 | `09H` | A destination; B and C unused | Number 1 in `R[A]` | 1 |
| KM1 | `0AH` | A destination; B and C unused | Number −1 in `R[A]` | 1 |
| KSMI | `0BH` | A destination; signed immediate sBx within the encoding range above | Number equal to sBx in `R[A]` | 1 |
| LOADKR | `35H` | A destination; B source register; C unused | Convert `R[B]` to unsigned 32-bit index i, then `R[A] = K[i]`, preserving the constant's value kind. An index outside the pool raises `INVALID_ARGUMENT` (10) before the destination is written. B is not an RK operand. | 1 |



### Arithmetic {#sec-cpu-arithmetic}

ADD, SUB, MUL, DIV, MOD, FLOORDIV, and POW read two numeric operands through RK B and RK C and write a Number to R[A]. They do not saturate or apply integer-word wrapping. A non-Number operand supplies NaN rather than causing an arithmetic type fault.

DIV is ordinary floating-point division. FLOORDIV instead rounds the quotient downward, not toward zero: dividing −7 by 3 gives a floor quotient of −3, and dividing 7 by −3 also gives −3. The result is still a Number, not a different integer value kind. MOD adjusts a nonzero remainder to agree with the divisor's sign for finite inputs and a nonzero divisor: −7 modulo 3 is 2, whereas 7 modulo −3 is −2. A zero remainder keeps the sign of the initial remainder; it is not forced to the divisor's sign.


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



### Bitwise operations and shifts {#sec-cpu-bitwise-operations-and-shifts}

Each bitwise input is converted to a 32-bit word by truncating its Number toward zero and reducing the integer modulo 2³². Positive zero, negative zero, NaN, infinities, and fractions of magnitude below one become the zero word. Large finite values wrap modulo 2³² rather than saturating. A non-Number numeric operand first supplies NaN and therefore becomes the zero word in these operations.

The output word is interpreted as a signed 32-bit integer and written as a Number. For example, the word with all 32 bits set becomes Number −1. A left shift of 1 by 31 produces −2147483648. SHR is an arithmetic, sign-extending right shift: shifting −8 right by one produces −4, not a large positive value.


Shift counts undergo the same word conversion and then use only their low five bits. A count of 32 therefore acts as zero, and a count of −1 acts as 31. Negative counts do not reverse the shift direction, and large counts do not saturate.

| Mnemonic | Opcode | Operands | Result in R[A] | Nominal cycles |
|---|---:|---|---|---:|
| BAND | `18H` | Word conversions of numeric reads of RK(B), RK(C) | Signed Number interpretation of the 32-bit AND | 1 |
| BOR | `19H` | Word conversions of numeric reads of RK(B), RK(C) | Signed Number interpretation of the 32-bit OR | 1 |
| BXOR | `1AH` | Word conversions of numeric reads of RK(B), RK(C) | Signed Number interpretation of the 32-bit exclusive OR | 1 |
| SHL | `1BH` | Left word from RK(B); count from the low five bits of the word converted from RK(C) | Shift left, discard bits leaving the 32-bit word, then write its signed Number interpretation | 1 |
| SHR | `1CH` | Left word from RK(B); count from the low five bits of the word converted from RK(C) | Sign-extending right shift of the signed 32-bit left operand, written as a Number | 1 |
| BNOT | `22H` | Word conversion of the numeric read of R[B], not RK(B); C unused | Complement all 32 bits, then write the signed Number interpretation | 1 |



### Truth, length, and text {#sec-cpu-truth-length-and-text}

Only nil and false are falsey. Every other value is truthy, including Number 0, Number NaN, and an empty String. NOT writes a boolean, not a Number. In particular, negating the truth of zero produces false.

LEN returns a Number. A String's length is its stored Unicode codepoint count, not its byte count. A Table's length is its maintained array length. LEN on any other value kind faults; it does not invoke a metatable length operation.


Concatenation uses language value-to-string conversion rather than accepting only strings and Numbers. CONCAT joins its two RK operands in B-then-C order. CONCATN joins exactly C consecutive registers starting at R[B], in increasing register order. All CONCATN sources are read before the result is written, so the destination may overlap the input range. A zero CONCATN count produces the empty String.

| Mnemonic | Opcode | Operands and domain | Result in R[A] | Nominal cycles |
|---|---:|---|---|---:|
| CONCAT | `1DH` | RK(B), then RK(C); every language value kind has the conversion shown below | Combined String | 1 |
| CONCATN | `1EH` | B first register; C register count; neither B nor C is RK | String formed from `R[B]` through `R[B+C−1]`; empty String when C=0 | 2 |
| NOT | `20H` | R[B], not RK(B); C unused | Boolean true for nil or false; boolean false for every other kind | 1 |
| LEN | `21H` | R[B], not RK(B); C unused; String or Table | Number equal to the String codepoint count or Table array length; other kinds fault | 1 |




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
| Finite Number | Default six-significant-digit conversion below; +0 becomes `0`, and −0 becomes `-0` |



Concatenating a Table therefore does not serialize its entries, and concatenating a function does not print its contents or identity. Use concatenation to assemble readable text, but do not assume that its text distinguishes every language value. Finite Number formatting is shared numeric formatting, not a conversion to a 32-bit word.

### Comparisons and conditional execution {#sec-cpu-comparisons-and-conditional-execution}

EQ, LT, and LE do not write a result register. They evaluate a predicate and compare it with the expectation encoded by A: zero expects false, and any nonzero A expects true. If the predicate differs from that expectation, execution skips exactly the next decoded instruction. A WIDE prefix and its instruction body form one instruction for this skip. If the predicate matches the expectation, the next instruction executes normally.


To produce a Boolean value for `R1 < R2`, the program must also select a
Boolean load. With R1 and R2 holding Numbers and R0 available for the result,
the following five unprefixed instructions select the appropriate load.
P is a four-byte-aligned instruction address:

| Instruction address | Instruction | Operation |
|---|---|---|
| P | `LT 1,1,2` | Expect the comparison to be true; skip the instruction at P+4 when it is false |
| P+4 | `JMP +2` | Continue at P+16 |
| P+8 | `KFALSE 0` | Write false to R0 |
| P+12 | `JMP +1` | Continue after the sequence at P+20 |
| P+16 | `KTRUE 0` | Write true to R0 |

The true path executes LT, the first JMP and KTRUE. The false path skips the
first JMP and executes KFALSE followed by the second JMP. Both paths reach
P+20 with a Boolean in R0 and have three base instruction cycles, assuming
successful instruction reads. LT itself never writes R0; its A=1 is the
expected truth, not register R1. The [branch reference](#sec-cpu-branches)
defines the word-relative offsets used by the two jumps.

Equality respects value kinds. Different kinds are unequal; there is no numeric-string or boolean-number equality conversion. Numbers use numeric equality, so NaN is unequal even to itself, while +0 and −0 are equal. Table, Closure, and Thread equality is reference identity rather than a comparison of their contents.

| Matching operand kinds | EQ predicate |
|---|---|
| nil, false, or true | Equal to the same kind |
| Number | Numeric equality; NaN is unequal, +0 equals −0 |
| String | Same interned string identity |
| BuiltinFunction | Same builtin identifier |
| Table, Closure, or Thread | Same reference identity |
| Different kinds | False |




Ordering is defined for two Numbers or two Strings. Numbers use numeric less-than or less-than-or-equal comparison. Strings use lexical UTF-8 order. Mixed kinds and all other kind combinations produce a false predicate rather than a comparison type fault. Equality of Tables can therefore test whether two values refer to the same Table, but LT and LE do not provide an ordering of Tables.

| Mnemonic | Opcode | Operands | Predicate and control effect | Nominal cycles |
|---|---:|---|---|---:|
| EQ | `23H` | RK(B), RK(C); A is expected truth, not a destination | Equality by the value-kind rules above; skip the next decoded instruction if the predicate differs from `(A≠0)` | 1 |
| LT | `24H` | RK(B), RK(C); A is expected truth, not a destination | Number less-than or String lexical less-than; false otherwise; skip the next decoded instruction if the predicate differs from `(A≠0)` | 1 |
| LE | `25H` | RK(B), RK(C); A is expected truth, not a destination | Number less-than-or-equal or String lexical less-than-or-equal; false otherwise; skip the next decoded instruction if the predicate differs from `(A≠0)` | 1 |



## Numeric result details {#sec-cpu-numeric-result-details}

### POW: exponentiation {#sec-cpu-pow-exponentiation}

POW computes a Number base `x` raised to a Number exponent `y`, written here as `x^y`. Its result is a Number, including when the result is a signed zero, an infinity, or NaN. In this section, `+0` and `-0` are distinct zeros; `+infinity` and `-infinity` have their usual signs. NaN means a not-a-number result, without a promise to preserve an operand's NaN payload.

#### Order of special cases {#sec-cpu-order-of-special-cases}

Apply these rules in order. The order matters when more than one description appears to fit.

1. **Either zero exponent produces `+1`.** For every base, `x^(+0)` and `x^(-0)` are `+1`. This includes zero, infinity, and NaN bases.
2. **Otherwise, either NaN operand produces NaN.** Consequently, `NaN^0` is `+1`, but `1^NaN` is NaN.
3. **An infinite exponent uses the base's magnitude.** For a non-NaN base, the following table applies before the rules for finite exponents.

| Base magnitude | Exponent `+infinity` | Exponent `-infinity` |
|---|---|---|
| `abs(x) < 1`, including either zero | `+0` | `+infinity` |
| `abs(x) = 1`, meaning `+1` or `-1` | NaN | NaN |
| `abs(x) > 1`, including either infinity | `+infinity` | `+0` |

The base's sign does not change these infinite-exponent results. In particular, neither `1^(+infinity)` nor `(-1)^(-infinity)` is `1`. Every zero and infinity produced by this table is positive.

#### Finite, nonzero exponents {#sec-cpu-finite-nonzero-exponents}

The next table covers all finite, nonzero exponents for the special bases. **Odd** and **even** mean integer exponents; **fractional** means nonintegral, not merely a decimal spelling. The exponent's sign selects a column group independently of its parity: `-3` is odd, while `-2` is even.


For a **positive finite exponent**:

| Base | Odd integer | Even integer | Nonintegral |
|---|---|---|---|
| `+0` | `+0` | `+0` | `+0` |
| `-0` | `-0` | `+0` | `+0` |
| `+infinity` | `+infinity` | `+infinity` | `+infinity` |
| `-infinity` | `-infinity` | `+infinity` | `+infinity` |
| `+1` | `+1` | `+1` | `+1` |
| `-1` | `-1` | `+1` | NaN |



For a **negative finite exponent**:

| Base | Odd integer | Even integer | Nonintegral |
|---|---|---|---|
| `+0` | `+infinity` | `+infinity` | `+infinity` |
| `-0` | `-infinity` | `+infinity` | `+infinity` |
| `+infinity` | `+0` | `+0` | `+0` |
| `-infinity` | `-0` | `+0` | `+0` |
| `+1` | `+1` | `+1` | `+1` |
| `-1` | `-1` | `+1` | NaN |


Thus a fractional exponent does not itself make a negative-zero or negative-infinity base invalid. For example, `(-0)^0.5` is `+0`, `(-0)^(-0.5)` is `+infinity`, `(-infinity)^0.5` is `+infinity`, and `(-infinity)^(-0.5)` is `+0`.

For other finite, nonzero bases:

- A positive base has a positive result magnitude, which may become `+0` or `+infinity` at the range limits.
- A negative base with a nonintegral exponent produces NaN. For example, `(-2)^0.5` is NaN.
- A negative base with an odd integer exponent has a negative result; an even integer exponent has a positive result. This sign rule also applies when the magnitude becomes zero or infinity. A negative exponent takes a reciprocal magnitude; it does not reverse the result's sign.


#### Specific finite exponents {#sec-cpu-specific-finite-exponents}

Several exponents have particularly direct meanings. The earlier zero-exponent and NaN rules still take precedence.

| Exponent | Result |
|---|---|
| `+1` | The base unchanged, including `-0` and `-infinity`. |
| `-1` | The reciprocal `1/x`, preserving the reciprocal's sign: `-0` becomes `-infinity`, and `-infinity` becomes `-0`. |
| `+2` | The Number product `x*x`. Either zero becomes `+0`; either infinity becomes `+infinity`. A finite product can overflow, become subnormal, or round to `+0`. |
| `+0.5` | For a positive finite base, the positive square root. The special-base table gives `+0` for either zero and `+infinity` for either infinity; a negative finite, nonzero base produces NaN. |


In particular, `(-0)^0.5` does **not** preserve the base's negative-zero sign.

#### Represented exponent parity {#sec-cpu-represented-exponent-parity}

Oddness and evenness refer to the exponent Number actually supplied. Numbers use binary64 precision. From `2^52` upward, every representable finite exponent is integral. From magnitude `2^53` upward, every representable finite exponent is even: no odd exponent exists at that precision.

The largest positive representable odd integer is `2^53 - 1`, or `9007199254740991`. Therefore `(-1)^(2^53 - 1)` is `-1`, whereas `(-1)^(2^53)` is `+1`. The same parity distinction applies to the corresponding negative exponents. Sign selection cannot recover an intended odd integer that the supplied Number cannot represent.

#### Range limits and subnormal results {#sec-cpu-range-limits-and-subnormal-results}

POW accepts nonzero subnormal bases and can produce subnormal results; it does not discard all such values as zero. Overflow produces infinity, while sufficiently small magnitudes round to zero. For negative bases with odd integer exponents, these results retain a negative sign.

The following are exact result examples, not decimal display approximations:

| Expression | Result |
|---|---|
| `2^(-1074)` | `2^(-1074)`, the smallest positive subnormal Number |
| `2^(-1075)` | `+0` |
| `2^1024` | `+infinity` |
| `(-2)^1025` | `-infinity` |
| `(-2)^(-1075)` | `-0` |

These exact examples do not establish a universal correct-rounding or error guarantee for other finite powers.

### Default Number-to-text conversion {#sec-cpu-default-number-to-text-conversion}

Concatenating a Number with a String uses the default Number-to-text conversion. For example, `'' .. 1.234565` produces `1.23456`. Both `CONCAT` and `CONCATN` use this ordinary conversion; neither supplies a format string, precision, field width, padding, or notation choice. The rules below describe that default conversion, not a configurable formatting operation.

The precision target is **six significant decimal digits**, not six decimal places and not a requirement to display six digits. Fractional trailing zeros disappear. Thus `0.0001` has fewer visible digits, while a small value can have several zeros after the decimal point before its significant digits begin. Integer trailing zeros remain part of the printed integer.

#### Sign, zero, and the integer shortcut {#sec-cpu-sign-zero-and-the-integer-shortcut}

Positive zero becomes `0`; negative zero becomes `-0`. Neither goes through normalization. For every other finite value, conversion works on the positive magnitude and prefixes one `-` if the input was negative. Positive inputs have no leading `+`.

An exact integer magnitude **strictly below 1000000** is printed directly as a decimal integer, without normalization or rounding. For example, `999999` becomes `999999`, and `-999999` becomes `-999999`. The strict limit matters: `1000000` takes the normalized path and becomes `1e+06`.

#### Normalization and rounding {#sec-cpu-normalization-and-rounding}

For all remaining finite inputs, let *n* initially be the positive magnitude and let the decimal exponent *e* initially be zero. Perform the following operations in the stated order, using ordinary Number arithmetic at each multiplication. The powers in the table steps are fixed Number constants, not exponentiation operations requested by the program.

1. **Normalize the magnitude.** Use the descending stage order
   **256, 128, 64, 32, 16, 8, 4, 2, 1**.

   If the initial *n* is at least 10, visit each stage *k*. Whenever the current *n* is at least 10<sup>*k*</sup>, multiply *n* by the Number constant 10<sup>−*k*</sup> and add *k* to *e*. After the table stages, while *n* is still at least 10, multiply it by `0.1` and increment *e*.

   If the initial *n* is below 1, visit the same descending stages instead. Whenever the current *n* is below 10<sup>−*k*</sup>, multiply *n* by the Number constant 10<sup>*k*</sup> and subtract *k* from *e*. After the table stages, while *n* is still below 1, multiply it by `10` and decrement *e*.

   An initial magnitude in [1, 10) needs neither branch. These operations normalize a computed Number; they are not exact real-number decimal normalization.

2. **Scale and round.** Multiply the computed *n* by `100000`. Round this computed result to the nearest integer: a fractional part below `0.5` rounds down, one above `0.5` rounds up, and exactly `0.5` selects the even integer. This produces the rounded digit integer used to construct the text.

3. **Apply a carry before choosing notation.** If the rounded integer is `1000000`, replace it with `100000` and increment *e*. Both the digit buffer and the exponent now include the rounding carry.

Nearest-even applies to the **computed normalized and scaled Number**, not directly to the original input's mathematical decimal expansion. This distinction is observable: `123456.5` prints `123457`, not `123456`. In contrast, `1.234565` prints `1.23456`, and `1.234575` prints `1.23458`. Do not substitute an ideal six-significant-digit decimal-rounding rule for the ordered Number operations above.

#### Choosing and spelling the notation {#sec-cpu-choosing-and-spelling-the-notation}

Use the exponent **after the carry**. Fixed notation is selected exactly when

**−4 ≤ *e* < 6**.

In fixed notation, the decimal point position is *e* + 1, counted from the start of the six-digit buffer. A positive position places that many digits before the point; insert a point only when the position is below six. A position of zero or less produces `0.`, followed by the required leading fractional zeros and then the six-digit buffer. Remove trailing fractional zeros, then remove the decimal point if no fractional digits remain. Do not remove integer trailing zeros.

All other exponents use scientific notation. Place the point after the first digit of the six-digit buffer, then trim fractional zeros and an empty decimal point in the same way. Append lowercase `e`, an explicit `+` or `-`, and the exponent magnitude. Exponent magnitudes below 100 use exactly two digits, including a leading zero when needed; larger magnitudes use three digits. Examples of exponent suffixes are `e+06`, `e-05`, and `e-324`.

The notation boundary is therefore not merely a comparison of the original magnitude with `0.0001` or `1000000`. Rounding can move the exponent across a boundary: `0.00009999995` prints `0.0001`, while `999999.5` prints `1e+06`.


#### Number-to-text examples {#sec-cpu-number-to-text-examples}

Each row gives a Number input and its resulting text. The same conversion is obtained by using that input in `'' .. input`.

| Number input | Resulting text |
| --- | --- |
| positive zero / negative zero | `0` / `-0` |
| `0.0000999999` | `9.99999e-05` |
| `0.0001` | `0.0001` |
| `0.00001` | `1e-05` |
| `0.00009999995` | `0.0001` |
| `999999` | `999999` |
| `999999.5` / `1000000` | `1e+06` / `1e+06` |
| `1.234565` / `1.234575` | `1.23456` / `1.23458` |
| `123456.5` / `123457.5` | `123457` / `123458` |
| `2147483648` | `2.14748e+09` |
| `5e-324` | `4.94066e-324` |
| `1.7976931348623157e308` | `1.79769e+308` |


The output is not a lossless serialization: distinct inputs such as `999999.5` and `1000000` produce the same text. Nonfinite Numbers bypass the finite conversion described above: NaN becomes `nan`, positive infinity becomes `inf`, and negative infinity becomes `-inf`.

## Calls, closures, globals, and tables {#sec-cpu-calls-closures-globals-and-tables}

### Calling and returning values {#sec-cpu-calling-and-returning-values}

Function calls use language value slots. A frame's register area follows its variable-argument area in the active thread's slot stack. The function record's maximum-stack value is a **slot count**, not a RAM address or byte count. These slots have no cartridge-addressable byte-RAM base; do not place an assumed stack at the top of main RAM.

`CALL A,B,C` takes its callee from `R(A)`. Arguments occupy consecutive registers starting at `R(A+1)`, and returned values replace consecutive registers starting at `R(A)`.

Only closure and builtin-function values are callable. A number is not callable merely because its numeric value is a function-record address. Calling any other value category raises `CALL_NON_FUNCTION`.


The three count operands in the call/return family deliberately do not use one common encoding:

| Instruction operand | Zero | Positive value |
|---|---|---|
| `CALL B`: supplied arguments | Use `max(top-A-1, 0)` arguments. | Supply exactly `B-1` arguments. In particular, `B=1` supplies none. |
| `CALL C`: requested results | Accept all produced results. | Accept exactly `C` results. |
| `RET B`: produced results | Return `max(top-A, 0)` values. | Return exactly `B` values. |
| `VARARG B`: copied arguments | Copy all saved varargs. | Copy exactly `B` values, filling any shortage with nil. |



For example, place a callee in R3 and two arguments in R4 and R5, then execute
`CALL 3,3,2`. It supplies those two arguments and requests two results in R3 and
R4. If the function produces only one result, R4 becomes nil; if it produces
more than two, the excess is discarded. After result placement, `top` is
exactly 5, so the earlier argument in R5 lies outside the active range.

An open-result call instead sets `top` to `A` plus the number of results actually produced. This exact-top rule makes a returned value range available to a following open-argument call or open return without treating every previously written register as an argument or result. It also means that result placement can lower `top`. Normal builtin completion follows the same result selection, nil padding, and exact-top rules.

On entry to a closure, the function record supplies the code address and parameter metadata. The frame starts with `top` equal to its fixed-parameter count, not its maximum stack allocation. Supplied arguments fill the fixed parameters in order, and missing fixed arguments become nil. Excess arguments are retained as varargs only for a function marked vararg; otherwise they are not retained as varargs.

`VARARG A,0` copies the saved excess arguments starting at `R(A)` and sets `top` exactly to the end of that copied range. If there are none, it sets `top` to `A`. A fixed-count `VARARG` pads with nil as needed and only raises `top`, to at least `A+B`.

`RET` closes the returning frame's open upvalues before routing its results. An ordinary nested return places results in the caller's saved destination range and releases the returning frame. A return need not have an ordinary caller: protected-call targets, completion, and coroutine resumption have distinct return routes. Returning from a root frame with no resumer records completion values.

### Closures and captured variables {#sec-cpu-closures-and-captured-variables}

A closure is a callable language value associated with a function record and captured upvalues. `CLOSURE` constructs this value; it does not merely copy a numeric code address into a callable register.

The `CLOSURE` register-address flag chooses how to obtain the function-record address:

- Flag clear: the address is `Bx × 16`.
- Flag set: `Bx` selects the register supplying the unsigned address.

The function record is read before the destination is written. It identifies the function's code and frame metadata, including the fixed-parameter count, maximum stack allocation, vararg and static flags, and upvalue information. A failed record read hard-halts without writing `R(A)`. A bus-read fault while reading the upvalue descriptors likewise hard-halts without writing `R(A)`.


Each upvalue descriptor is a 32-bit word. Descriptor `i` is read at `upvalueTableAddress + 4i`:

| Descriptor bits | Capture source |
|---|---|
| High bit set | A register slot in the parent frame; the low 31 bits select the slot. |
| High bit clear | An upvalue of the parent closure; the low 31 bits select that upvalue. |



An open upvalue accesses its captured parent-frame register directly. Captures can share an already-linked open upvalue for that slot, so updates through the captured variable remain shared. Closing an upvalue retains the current language value separately from the frame; subsequent reads and writes access that retained storage. `GETUP` and `SETUP` use the same upvalue operand regardless of whether the upvalue is open or closed.

Repeated CLOSURE operations for a STATIC function record with no upvalues
return the same function value for that record address. An ordinary call uses
that value; a numeric function-record address is supplied to CLOSURE or EXEC
under their separate operand rules.

### Two global namespaces {#sec-cpu-two-global-namespaces}

Ordinary globals and system globals are separate namespaces. `GETGL` and `SETGL` access ordinary globals; `GETSYS` and `SETSYS` access system globals. A matching name in one namespace does not select the value stored under that name in the other.

For these instructions, `Bx` is an index into the corresponding execution-image name table. It is not a register operand, a constant-pool string operand, or a table key. Each image's ordinary and system name tables are independently mapped to their namespace slots. Registering a new name initializes its value to nil; registering an existing name reuses the slot in that namespace. The namespace distinction alone does not specify a privilege boundary.

### Tables, keys, and method receivers {#sec-cpu-tables-keys-and-method-receivers}

The table instruction families differ in where the key comes from:

- `GETT` and `SETT` take general keys through `RK` operands.
- `GETI` and `SETI` carry the integer key directly in an instruction operand.
- `GETFIELD`, `SETFIELD`, and `SELF` select a string key directly from the image constant pool. That constant operand is not an `RK` operand.

Reads accept a table base. A string base instead uses the CPU's string-index table; these instructions do not specify substring indexing. Other base value categories raise `INDEX_NON_TABLE`. Without a metatable, a table read is direct. The table-only inherited lookup and its exact chain bound are specified below.

Writes accept only table bases, including for integer and string-field forms. Assigning through any other value category, including a string, raises `ASSIGN_NON_TABLE`.

`SELF` prepares both a method value and its receiver. It preserves the original `R(B)` in `R(A+1)` before looking up the string-keyed field into `R(A)`. The receiver therefore remains available as the first argument when the method value is called. Both destination writes extend `top` as needed. Preserving the original receiver also defines the result when a destination overlaps the source register.

`NEWT` creates an empty table with an array-capacity request and a hash-size request. These operands request storage; they neither supply initial elements nor state the number of elements already present.

### Table entries and inherited reads {#sec-cpu-table-entries-and-inherited-reads}

A Table maps admissible keys to non-nil values. Numeric and nonnumeric keys may coexist in the same Table. Array storage and hash storage are internal placement choices, not separate kinds of Table. Moving an entry between them does not change its key category.

#### Keys and presence {#sec-cpu-keys-and-presence}

Nil is not an admissible key. Reading or writing with a nil key raises `INDEX_NIL` (4), even when the Table is empty or the value being written is nil. This is distinct from reading a missing admissible key, which returns nil.

| Key category | Matching rule |
| --- | --- |
| Boolean | `false` and `true` are distinct keys. |
| Number | Numeric matching, with the zero and NaN rules below. |
| String | String identifiers match; no conversion to a numeric key occurs. |
| Table, closure, thread | The same reference matches; separate objects do not match by contents. |
| Builtin function | The same builtin identity matches. |

Numeric `1`, string `"1"`, and boolean `true` are separate keys. Positive zero and negative zero address the same key. A canonical numeric NaN is also an admissible key: repeated NaN keys address the same mapping, although ordinary numeric NaN equality is false. Positive and negative infinity are admissible numeric keys.

Only positive integral numeric keys from 1 through `0x7fffffff` are eligible for array storage. Zero, negative numbers, fractions, NaN, infinities, and larger numbers use hash storage. An eligible numeric key may also reside in hash storage when it lies beyond the allocated array capacity. Numeric key zero has no special indexing role.

A non-nil value establishes a mapping. In particular, `false` is present: it is not a missing entry and does not permit an inherited value to replace it. Assigning nil removes the Table's own mapping. It does not create a retrievable nil-valued entry. An allocated but empty array slot is likewise missing. Deletion does not erase other keys.

#### Stored length {#sec-cpu-stored-length}

The Table length operation, `#t`, reads a stored length maintained by Table mutations. It does not count all mappings, find the largest numeric key, traverse a metatable, or search for a boundary when the length is read. Initial capacity allocates storage only: an empty Table has length zero regardless of its array or hash capacity.

Let `L` denote the stored length. Deleting an array-eligible numeric key `k` shortens the length to `k - 1` when `k - 1 < L`. Otherwise that deletion does not shorten it. Entries above the new boundary remain mapped. Thus a Table can retain entries at keys greater than its reported length.

An in-capacity non-nil write at key `L + 1`, or a newly inserted hash entry for that array-eligible key, advances the length over consecutive non-nil own entries until the first missing numeric key. This scan continues into hash storage beyond array capacity. A `false` entry participates in that advance. Other in-capacity non-nil writes do not advance the boundary merely because their key is large. Replacing an existing non-nil hash mapping does not itself recompute the stored length. Storage redistribution can rebuild length through reinsertion, so not every apparently unrelated insertion is guaranteed to leave an already path-dependent length unchanged.

For example, with array capacity four and keys 1 through 5 populated, the initial length is 5. Deleting key 2 shortens it to 1 without removing key 5. Restoring key 2 advances the length to 5, including that hash-held entry.

#### Metatables and indexed reads {#sec-cpu-metatables-and-indexed-reads}

A Table may have a metatable. An ordinary indexed read first checks the queried Table's own mapping. A non-nil value wins immediately, including `false`. If the entry is missing, the read obtains the direct `"__index"` member of that Table's metatable. Only a Table-valued `__index` continues the lookup, using the original key on that next Table. Each subsequent Table is processed in the same way.

An absent or non-Table `__index` terminates the read with nil. Function-valued indexers are not called. The `__index` member itself is read directly; its retrieval does not start another inherited lookup. One chained read permits 32 visited Tables. Exhausting that bound raises `METATABLE_LOOP` (5); an actual cyclic reference is not required to exhaust the bound.

Writes always modify the named target Table directly. They do not redirect through `__newindex` and do not invoke a function stored there. Deleting an own mapping may therefore expose an inherited mapping on a later ordinary read.


The [BIOS Table and metatable interface](bios-base.md#sec-bios-base-table-and-metatable-access)
specifies `rawget`, `rawset`, `getmetatable` and `setmetatable`. Raw reads bypass
the inherited lookup above; raw writes use the same maintained Table length.

### Language allocation and lifetime {#sec-cpu-language-allocation-and-lifetime}

The CPU provides a **3.5 MiB language-allocation budget** for system and
cartridge execution together. Installed library values and active execution
state already consume part of it at cartridge entry. Further retained values
and storage growth use the remaining capacity.

The budget covers Table storage, dynamic closures and captured-variable cells,
Threads and their reserved value-slot capacity, and String storage charges.
Capacity matters as well as visible contents: a Table can reserve more entries
than it currently contains, and a Thread's reserved slot storage can exceed its
active argument/local range. Setting one field to nil or returning from one
call therefore does not imply an equal immediate increase in available budget.

Collection reclaims allocations that are no longer reachable from retained
program values. Globals, active frames, reachable Tables and closures, and
retained Threads can keep other objects alive; mutually referencing objects
can be reclaimed when the whole group becomes unreachable. Weak Table behavior
is defined in [Weak references and collection](#sec-cpu-weak-references-and-collection).
Allocation may invoke collection before it succeeds. If the requested growth
still exceeds capacity, it raises the Lua out-of-memory error. If language
error handling does not handle it, the CPU takes a Trap exception with
LuaFaultReason `9` (`OUT_OF_MEMORY`).

Language allocations have value identity rather than cartridge-visible byte
addresses. Plan DATA/BSS and hardware buffers using the separate byte-storage
reservations in [[Memory](memory.md#sec-memory-reserved-and-cartridge-storage-in-main-ram)]{.content-visible when-format="html"}[Book I, “Memory and bus access”, under “Reserved and cartridge storage in main RAM”]{.content-visible when-format="pdf"}.
Use addressed byte storage for exact device records and payloads.


#### Weak references and collection {#sec-cpu-weak-references-and-collection}

The collector reads a Table's metatable member `__mode` directly. A String
containing lowercase `k` selects weak keys; lowercase `v` selects weak values;
both select both. Other characters do not select a mode. A missing or non-String
member selects ordinary strong entries. This lookup does not invoke `__index`.

| Mode | Collection effect |
| --- | --- |
| Strong | Entries retain their keys and values. |
| `k` | An entry's value is retained only when its key is alive independently; chains of such dependencies are followed to convergence. A value cannot keep its own otherwise unreachable weak key alive through that entry. |
| `v` | Keys remain strong; values alone do not retain collectable objects. |
| `kv` | Neither side alone retains collectable objects. |

Collectable weak entries can refer to Tables, threads and dynamically captured
closures. Numbers, booleans, builtin functions and canonical static closures do
not disappear through weak-entry collection. Strings also remain in surviving
weak entries; they are not removed merely because their weak position is their
only reference. A static function with zero upvalues has the canonical closure
identity described above, not the lifetime of a newly allocated captured closure.

```lua
local owners = {}
setmetatable(owners, { __mode = 'k' })
local key = {}
owners[key] = { label = 'attached' }
key = nil
```

The entry does not keep the former key alive. Once collection determines that
key unreachable, the mapping is removed; this sequence does not specify an
immediate collection or reclamation deadline. Collection removes mappings,
not their inherited replacements, and can shorten a weak-value array's stored
length when it clears an earlier element.

### Instruction reference {#sec-cpu-instruction-reference}

The following tables describe the decoded operands. `A`, `B`, `C`, and `Bx` name instruction fields, not additional language values. Opcode values use hexadecimal notation (`H`). All costs are base instruction cycles; see **Builtin call charges** below.


#### Calls and captured values {#sec-cpu-calls-and-captured-values}

| Instruction | Opcode | Operands | Result or effect | Base cycles |
|---|---:|---|---|---:|
| `CALL` | `2FH` | `A, B, C` | Call the closure or builtin in `R(A)` with arguments beginning at `R(A+1)`. `B=0`: use the open argument range; otherwise supply `B-1` arguments. `C=0`: accept all results; otherwise accept exactly `C`, truncating or nil-padding. Results begin at `R(A)`. | 2 |
| `RET` | `30H` | `A, B` | Close the frame's open upvalues and return values beginning at `R(A)`. `B=0`: produce the open range; otherwise produce exactly `B` values. | 2 |
| `VARARG` | `2EH` | `A, B` | Copy saved varargs beginning at `R(A)`. `B=0`: copy all; otherwise copy exactly `B`, padding with nil. | 2 |
| `CLOSURE` | `2BH` | `A, Bx`, register-address flag | Construct a closure in `R(A)`. Flag clear: function record at `Bx × 16`. Flag set: address supplied by `R(Bx)`. Capture according to the record's upvalue descriptors. | 1 |
| `GETUP` | `2CH` | `A, B` | `R(A) = upvalue(B)` of the current closure. | 1 |
| `SETUP` | `2DH` | `A, B` | `upvalue(B) = R(A)` in the current closure. | 2 |




#### Global namespaces {#sec-cpu-global-namespaces}

| Instruction | Opcode | Operands | Result or effect | Base cycles |
|---|---:|---|---|---:|
| `GETGL` | `38H` | `A, Bx` | Load into `R(A)` the ordinary global selected by ordinary-global image name index `Bx`. | 1 |
| `SETGL` | `39H` | `A, Bx` | Store `R(A)` into the ordinary global selected by ordinary-global image name index `Bx`. | 2 |
| `GETSYS` | `36H` | `A, Bx` | Load into `R(A)` the system global selected by system-global image name index `Bx`. | 1 |
| `SETSYS` | `37H` | `A, Bx` | Store `R(A)` into the system global selected by system-global image name index `Bx`. | 2 |




#### Tables and field lookup {#sec-cpu-tables-and-field-lookup}

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



### Builtin call charges {#sec-cpu-builtin-call-charges}

CALL costs 2 base cycles. A primitive target adds its own base charge of 1, 2
or 4 cycles; this surcharge has no per-argument or per-result term. Installed
BIOS functions can execute ordinary instructions and call further primitives,
so include the executed sequence when budgeting the whole service. The
[BIOS base](bios-base.md#sec-bios-base), [String](bios-string.md#sec-bios-string) and
[protected-call/coroutine](coroutines.md#sec-coroutines) references identify their primitive
surcharges and error behavior.

## Worked values: signed zero and inherited fields {#sec-cpu-worked-values-signed-zero-and-inherited-fields}

Use runtime operands when the distinction between Number values matters:

```lua
local values = { -0, 3, -3, 0.5 }
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

The first group produces negative zero, positive zero and negative infinity.
The reciprocal exposes the sign that an equality comparison cannot distinguish.
The POW reference above covers infinities, NaNs, represented exponent parity
and subnormal results; these rules also apply to runtime operands.

Additional runtime-operand examples follow directly from the POW reference:

| Expression | Result |
| --- | --- |
| `(-0)^3`, `(-0)^0.5` | Negative zero, positive zero |
| `(-0)^(-3)` | Negative infinity |
| `(-infinity)^0.5`, `(-infinity)^(-3)` | Positive infinity, negative zero |
| `(-1)^infinity`, `(-2)^0.5` | NaN |
| `NaN^0` | 1 |
| `(-1)^9007199254740991` | −1 |
| `(-1)^9007199254740992` | 1 |
| `2^(-1074)` | Smallest positive subnormal Number |
| `(-2)^(-1075)` | Negative zero |

Here infinity and NaN denote Number operands, not additional source keywords.

The second group produces `42`, `9`, then `42`. The inherited read does not
create an own mapping. Assigning `nil` removes the own mapping and exposes the
parent again. `rawget(child, 'answer')` is then `nil`. A function-valued
`__index` is not called by this indexed-read datapath; consult the table
reference above rather than assuming another Lua version's metatable behavior.

## Memory transfers {#sec-cpu-memory-transfers}

Memory instructions transfer numeric scalars between frame registers and
byte-addressed storage. Word and U32LE loads produce unsigned 32-bit integer
Numbers. Floating loads interpret the stored IEEE bit pattern. The format
selector determines the byte width and conversion in the following table.


### Scalar formats {#sec-cpu-scalar-formats}


The `C` operand of a scalar load or store selects one of six formats:

| `C` | Format | Bytes | Loaded register value | Store conversion | Required address alignment |
|---|---|---:|---|---|---:|
| 0 | `Word` | 4 | Unsigned 32-bit integer Number | Convert to unsigned 32-bit integer | 4 bytes |
| 1 | `U8` | 1 | Integer Number, 0–255 | Store the low 8 integer bits | 1 byte |
| 2 | `U16LE` | 2 | Integer Number, 0–65535 | Store the low 16 integer bits | 2 bytes |
| 3 | `U32LE` | 4 | Unsigned 32-bit integer Number | Convert to unsigned 32-bit integer | 4 bytes |
| 4 | `F32LE` | 4 | Number decoded from IEEE single precision | Round the numeric value to IEEE single precision and store its bits | 4 bytes |
| 5 | `F64LE` | 8 | Number decoded from IEEE double precision | Store the numeric value's IEEE double-precision bits | **4 bytes** |



All multi-byte formats are little-endian: the least significant byte occupies the lowest address. `Word` and `U32LE` transfer the same numeric data, but identify the access differently in bus-fault metadata. Floating-point transfers decode or encode floating-point bits; they are not integer conversions of the floating-point number. No guarantee of preserving every NaN payload is made.

A scalar load or store with C greater than 5 is a reserved instruction. It
raises `ReservedInstruction` (exception code 10, Cause `00000028H`) with EPC at
the instruction start, before address conversion, alignment checks or a data
access. BadAddress and the Memory fault record are unchanged. The normal
two-cycle base charge still applies. In counted word stores, C is a word count,
not a scalar-format selector.

Address conversion and integer-store conversion truncate toward zero and retain the unsigned low 32 bits. Non-numeric register values take the numeric-conversion path through NaN and become zero on this integer path. Numeric NaN and infinities also become zero on this integer path. Floating-point stores use numeric conversion instead, so a non-numeric register value becomes NaN. A fractional address is converted before its alignment is checked.

`F64LE` is two ordered 32-bit transfers, not one indivisible eight-byte transfer. The low half is accessed at the starting address, then the high half four bytes later. Four-byte alignment is sufficient; eight-byte alignment is not required.

### Address operands {#sec-cpu-address-operands}

The ordinary forms, `LOAD_MEM`, `STORE_MEM`, and `STORE_MEM_WORDS`, obtain their starting byte address from `RK(B)`. A nonnegative `B` selects register `B`; a negative `B` selects constant `-1-B`. The selected value is converted to an unsigned 32-bit address.

The displacement forms, whose names end in `_D`, always use register `B` as the base:

`address = (u32(R[B]) + 4 × disp) modulo 2^32`

Here `disp` is the instruction's **unsigned eight-bit word displacement**, from 0 through 255. It reaches byte offsets 0 through 1020. It is neither signed nor extended by `WIDE`. A negative displacement therefore cannot be expressed by setting the top displacement bit. `WIDE` can extend the other operand fields without extending this displacement.

### Scalar access and IO {#sec-cpu-scalar-access-and-io}

Scalar loads check alignment before attempting a memory access. If a new bus fault occurs during the read, the destination register is not changed. This does not undo a read or a device side effect that has already occurred.

Scalar stores check alignment, then ask whether the mapped starting address is ready for a write. This readiness check precedes reading and converting the source register for the write. If the target is not ready, no store takes place: the instruction is left blocked on that raw target address. A matching ready event clears the blocked condition; the next attempt starts the instruction again. Readiness is checked only at the starting address, including for `F64LE`.

A readiness check is not a permission or fault preflight. An aligned but not-ready IO target can defer a store before a width or bus fault would be observed. Once a scalar store is attempted, a new bus fault raises `DataBusError`; effects already produced by the store remain.

The two halves of an `F64LE` access are fault-ordered. A new fault on the low half prevents the high-half access. A high-half fault leaves the low-half access or store already performed. A load updates its destination only if both halves succeed. The high half of an `F64LE` store is not covered by a separate readiness preflight.


Memory instructions are available in user and supervisor modes. Each mapped
target applies its own access rules. In I/O space, an aligned U8 load reads a
whole register and returns its low byte. U8 stores and U16LE accesses fault.
Word, U32LE, F32LE and each half of F64LE use whole-word register operations,
including that register's side effects.


### Counted word stores {#sec-cpu-counted-word-stores}

`STORE_MEM_WORDS` and `STORE_MEM_WORDS_D` use `C` as a **word count**, not a scalar-format selector. They write consecutive registers to consecutive words:

`R[A+i] → (start + 4 × i) modulo 2^32`, for `i = 0 … C-1`.

Each register is converted to an unsigned 32-bit integer. The starting address must be four-byte aligned, even when `C` is zero. A zero count otherwise performs no writes and adds no sequence surcharge.

Before writing anything, the instruction scans the counted span's IO overlap in increasing address order and waits on the first not-ready word. This preflight happens before the sequence surcharge as well as before any write. Consequently, a later not-ready IO word can defer the instruction before an earlier word would otherwise commit or fault. The readiness span is computed without 32-bit wrap; the actual write addresses wrap modulo `2^32`. Do not treat this as readiness preflight for IO reached only by wrapping into low addresses.

Once preflight succeeds, the instruction charges one additional cost unit per four counted words, rounded up: `(C + 3) >> 2`. It then attempts the words in increasing `i` order and checks for a new bus fault after every word. The first such fault stops the sequence and raises `DataBusError`. Earlier successful words remain written; later words are not attempted. The full sequence surcharge has already been charged even if a later word faults.

A blocked attempt writes nothing and retries from the instruction start.
After writes begin, the first new bus fault terminates the sequence with its
completed prefix retained. Arrange output and recovery around those ordered
partial effects.

### Memory instruction reference {#sec-cpu-memory-instruction-reference}


`read_C(address)` below means a read in the scalar format selected by `C`. `u32` denotes the conversion described above, not serialization of a language value. The common alignment, readiness, fault, and partial-effect rules apply to every applicable row. Costs are nominal base charges plus the stated surcharge; execution-budget, prefix, and retry accounting follow the CPU execution rules.

| Opcode | Instruction and operands | Effect | Nominal cost |
|---|---|---|---:|
| `04H` | `LOAD_MEM_D A, B, C, disp` | Load `read_C((u32(R[B]) + 4×disp) mod 2^32)` into `R[A]`; leave `R[A]` unchanged on a new bus fault | 2 |
| `0CH` | `STORE_MEM_D A, B, C, disp` | Store `R[A]` in scalar format `C` at `(u32(R[B]) + 4×disp) mod 2^32` | 2 |
| `0DH` | `STORE_MEM_WORDS_D A, B, C, disp` | Starting at `(u32(R[B]) + 4×disp) mod 2^32`, store `C` consecutive unsigned words from `R[A]` onward | `2 + ((C+3)>>2)` after successful readiness preflight |
| `31H` | `LOAD_MEM A, B, C` | Load `read_C(u32(RK(B)))` into `R[A]`; leave `R[A]` unchanged on a new bus fault | 2 |
| `32H` | `STORE_MEM A, B, C` | Store `R[A]` in scalar format `C` at `u32(RK(B))` | 2 |
| `33H` | `STORE_MEM_WORDS A, B, C` | Starting at `u32(RK(B))`, store `C` consecutive unsigned words from `R[A]` onward | `2 + ((C+3)>>2)` after successful readiness preflight |



`F64LE` uses the same listed scalar-memory cost as the other scalar formats; it adds no per-half transfer surcharge. Neither this cost nor the counted-store surcharge specifies a device's electrical bandwidth.

## Branches {#sec-cpu-branches}

Branch conditions use value truth. Only Nil and False are false. Numeric zero, numeric NaN, the empty string, and all other language values are true.

The signed `BX` displacement is measured in four-byte instruction words. A branch target is:

`target = (instruction-start PC + full instruction byte width + 4 × signedBX) modulo 2^32`

The full instruction width includes a `WIDE` prefix when present. Thus the displacement is relative to the byte immediately after the complete branch instruction, not its first word. `BX` is signed 20-bit without `WIDE` and signed 26-bit with it. A conditional branch that is not taken continues at the already selected sequential PC.


The branch itself performs no target-memory read or target-alignment check. Fetching at the resulting PC is a separate step governed by the instruction-fetch rules.

| Opcode | Instruction and operands | Effect | Nominal cost |
|---|---|---|---:|
| `28H` | `JMP BX` | Assign the branch target to PC; `A` is ignored | 1 |
| `29H` | `JMPIF A, BX` | Assign the target to PC if `R[A]` is true; otherwise continue sequentially | 1 |
| `2AH` | `JMPIFNOT A, BX` | Assign the target to PC if `R[A]` is false; otherwise continue sequentially | 1 |



## Cycle accounting and execution boundaries {#sec-cpu-cycle-accounting-and-execution-boundaries}

The instruction tables give **base charges**, not whole-program transfer rates.
Before an admitted instruction executes, PC advances over its complete width
and its base charge is deducted. Privilege, address alignment and write-ready
handling occur after that base charge. There is no refund when a store blocks;
a later retry incurs its base charge again.

An instruction's base charge is not subdivided at a device-event deadline.
An admitted operation can carry system time past that deadline; due device work
is then serviced against the advanced time. For example, a one-cycle `LOADK`
followed by a successful two-cycle ordinary RAM `LOAD_MEM` consumes three
cycles, even if a device deadline falls within that interval. A store whose
destination is not ready follows the [write-ready and retry rules](#sec-cpu-scalar-access-and-io).
Eight-byte
and counted accesses retain their specified ordered, potentially partial bus
effects; the timing rule does not make them atomic.

Use the complete instruction charge when calculating a straight-line sequence.
Use device status and interrupt protocols for synchronization, rather than
assuming that a device request interrupts a partially executed instruction.
Instruction costs do not specify one universal request-to-handler delay.

### Selected instruction base charges {#sec-memory-selected-instruction-base-charges}

The CPU/system timebase is **33,868,800 cycles per second**. The following
are selected instruction base charges, not a complete timing table:

| Instruction | Base charge |
| --- | --- |
| Scalar `LOAD_MEM` and `STORE_MEM` | 2 cycles |
| Scalar displaced forms `LOAD_MEM_D` and `STORE_MEM_D` | 2 cycles |
| `ADD`, `SUB`, `MUL` | 1 cycle |
| `WIDE` prefix | 0 cycles |

A `WIDE` instruction uses its body's base charge; the prefix does not add
another base charge. These charges do not specify the cost of a source
expression, total program execution time, or sustained memory bandwidth.

The accounting rules above define admission, retries and additional work; the
[memory instruction reference](#sec-cpu-memory-instruction-reference) gives the complete
transfer-instruction table. [[DMA — Transfer timing and sharing the bus](dma.md#sec-dma-transfer-timing-and-sharing-the-bus)]{.content-visible when-format="html"}[Book I, “Direct memory access”, under “Transfer timing and sharing the bus”]{.content-visible when-format="pdf"} supplies endpoint rates, block and tail budgets, contention and GPU transport examples; CPU instruction charges are not DMA transfer rates.

### Additional work and waiting {#sec-cpu-additional-work-and-waiting}


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

## CPU reset and program replacement {#sec-cpu-cpu-reset-and-program-replacement}

At CPU reset, Status is `00000001H`; Cause, EPC, BadAddress, LuaFaultReason and
the exception-domain word are zero. Retained pre-NMI report words are also
zero. Interrupt-wait, blocked-store, hard-halt and pending interrupt states are
cleared. The CPU discards the active call stack and enters the system startup
static function with no arguments.

The first PC comes from that startup function's record, not an assumed
instruction address zero. Reset is not the same edge as `EXEC`: the latter
replaces execution with a selected static function and sets the entry Status
according to that function's execution domain. Neither statement implies that
all RAM has been erased. The [program startup reference](program-images.md#sec-memory-reset-and-cartridge-startup)
supplies the reset vector, BIOS cartridge selection and section-initialization route; SYSTEM defines the
separate software reset request and device-context transitions.

### Hard halt and instruction exceptions {#sec-cpu-hard-halt-and-instruction-exceptions}

A reserved opcode, a WIDE body containing another WIDE, or an unreadable
required function record causes a hard halt. EXEC also hard-halts when its
record lacks STATIC. Execution and interrupt acceptance stop until reset.
HALT, in contrast, is a resumable interrupt wait.

Misaligned instruction addresses and mapped instruction-read faults take the
address-error or instruction-bus-error exception route. The scalar-memory
reference separately defines ReservedInstruction for unsupported format fields.

## CP0 and execution control {#sec-cpu-cp0-and-execution-control}

CP0 holds exception and privilege state. Current privilege comes from **Status bit 1**, not from the identity of the currently selected image. A clear bit means supervisor mode; a set bit means user mode. Status bit 0 is the current interrupt-enable bit. System entry initializes Status to 1; cartridge entry initializes it to 3.

`MFC0`, `MTC0`, and `RFE` require supervisor mode. In user mode they raise coprocessor-unusable before selecting a CP0 field, converting a source value, or checking whether `RFE` has an exception frame. `HALT`, branches, and the memory instructions have no corresponding current-mode check.

### CP0 fields {#sec-cpu-cp0-fields}


For `MFC0` and `MTC0`, `A` names the value register and `B` is the raw CP0 field number, **not an RK operand**. Their handlers do not use `C`.

| Field number | Name | `MFC0` result | `MTC0` effect in supervisor mode |
|---:|---|---|---|
| 8 | `BadAddress` | Raw unsigned word as a Number | Ignored |
| 9 | `LuaFaultReason` | Raw unsigned word as a Number | Ignored |
| 12 | `Status` | Raw unsigned word as a Number | Replace the complete word, without masking |
| 13 | `Cause` | Raw unsigned word as a Number | Ignored |
| 14 | `EPC` | Raw unsigned word as a Number | Replace the complete word, without an alignment check |
| 15 | `EXEC` | Zero | Replace execution with the addressed static function |



`MTC0` converts `R[A]` to an unsigned 32-bit word before applying the selected field's write behavior, including an ignored write. An unknown field number hard-halts in supervisor mode. This is not a coprocessor-unusable exception, and a rejected `MFC0` does not update its destination. A hard halt does not itself assign a new CP0 Cause.

### Exception entry and cartridge dispatch {#sec-cpu-exception-entry-and-cartridge-dispatch}

On an accepted maskable interrupt, Cause is `00000400H` and EPC is the
interrupted instruction address. Entry shifts the low six Status bits left by
two within that six-bit field, retaining higher Status bits. Current interrupt
enable and current user mode are consequently clear. In word notation, the
new Status is `(Status & ~0x3f) | ((Status << 2) & 0x3f)`.

The CPU enters the function selected by the ROM's IRQ or exception address as
an exception frame with no supplied arguments. Lua-trap entry additionally
places the error value in R0; other exception entries leave R0 nil.

The [BLua control interface](blua-programs.md#sec-cpu-blua-control-syntax)
defines source access and the standard `irq` and `exception` callbacks. An
ordinary callback returns to its entry routine, which issues RFE from the
exception frame. A custom entry routine must provide its own dispatch and
exception return. The [BIOS monitor](bios-monitor.md#sec-memory-installed-response-to-a-memory-exception)
defines installed memory-fault service.

### Exception return {#sec-cpu-exception-return}

In supervisor mode, `RFE` requires the current frame to be an exception frame; otherwise it hard-halts. It samples the active EPC, closes the exception frame's open upvalues, removes that frame, and restores the register-stack top to the removed frame's vararg base.

`RFE` replaces Status bits 0–3 with the former bits 2–5, retaining the higher bits. If a caller remains, its PC is assigned the sampled EPC. In particular, writing EPC before `RFE` changes this return target; `RFE` does not impose a separate alignment check on it.

Returning from an NMI-marked exception frame also restores the retained pre-NMI Cause, EPC, BadAddress, LuaFaultReason, and exception-domain words. The return PC still comes from the active EPC sampled before that restoration. The retained pre-NMI Status word is not restored wholesale.

### EXEC {#sec-cpu-exec}

Writing `EXEC` supplies a **function-record address**, not an instruction-entry address. The record is read on the CPU bus and must identify a static function; otherwise execution hard-halts.

A successful `EXEC` clears the active call stack, selects the function's image, and starts the static function with zero arguments. It clears HALT, retained-interrupt-event, blocked-write and hard-halt state. The new Status is 3 if the selected execution-domain ID is nonnegative, or 1 otherwise. `EXEC` replaces execution: it is neither an ordinary function call with a saved return point nor an exception return.

### HALT {#sec-cpu-halt}

`HALT` is available in user mode as well as supervisor mode. If an interrupt event is already retained, it consumes that event without creating a HALT condition. Otherwise it records the active thread and current frame depth; the HALT condition matches only while both still match. This is an IRQ-wait latch, not a program busy loop or a request for a fixed elapsed duration. Interrupt acceptance and wake scheduling follow the interrupt rules.


### Control instruction reference {#sec-cpu-control-instruction-reference}

| Opcode | Instruction and operands | Effect | Nominal cost |
|---|---|---|---:|
| `26H` | `MFC0 A, B` | Supervisor only: copy CP0 field `B` into `R[A]` as an unsigned-word Number; EXEC reads zero; unknown fields hard-halt | 1 |
| `27H` | `MTC0 A, B` | Supervisor only: convert `R[A]` to an unsigned word and apply the CP0 field's write behavior; EXEC replaces execution; unknown fields hard-halt | 1 |
| `34H` | `RFE` | Supervisor only: return from the current exception frame using active EPC and the Status restoration above; a non-exception frame hard-halts | 1 |
| `3FH` | `HALT` | Consume a retained interrupt event, or record the current thread/frame-depth HALT condition | 1 |

`RFE` and `HALT` do not use `A`, `B`, or `C`.


### Read CP0 in a cartridge IRQ {#sec-cpu-read-cp0-in-a-cartridge-irq}

Use this sequence after fresh BIOS cartridge entry, with the running beam
unchanged and this program as the sole VBlank callback and IRQ-mask owner.
There must be no supervisor request or device-context takeover. Entry is in
user mode with interrupt enable set; main cannot read CP0 directly.

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

Define the callback before enabling delivery. The initial mask and ACK discard
old delivery and old pending VBlank; the final MASK write admits VBlank. In the
callback, saved Status is `0000000CH`, Cause is `00000400H`, and EPC is the
variable interrupted **instruction address**, not a function-record address.
Full supplied flags contain VBlank and may contain other masked pending bits.


The callback returns normally. The standard IRQ entry performs RFE and main
continues after the wait. Do not issue RFE from the callback's ordinary call
frame. CPU supervisor privilege during IRQ does not by itself activate the
SYSTEM supervisor device context; SYSTEM STATUS remains zero under these
assumptions. Masking further delivery does not clear CPU interrupt enable or
prevent later VBlank pending bits from being raised.


## Memory faults and saved PC {#sec-cpu-memory-faults-and-saved-pc}

A misaligned load raises `AddressErrorLoad`; a misaligned scalar or counted store raises `AddressErrorStore`. Both record the converted effective address in BadAddress before any mapped access. A newly raised bus fault produces `DataBusError`; that exception does not itself replace BadAddress.

For these synchronous instruction exceptions, EPC identifies the **start of the faulting instruction**, not its already advanced sequential PC. Common exception entry records Cause and the exception domain, shifts the low six Status bits left by two while retaining the higher bits, and creates an exception frame.

Bus-fault detail and CPU exception detection are distinct. The detailed bus-fault record retains the first unacknowledged fault, while each new fault event is still detectable by the CPU. A new `DataBusError` can therefore coexist with older latched detailed fault metadata until that record is acknowledged. A preexisting record alone does not make a later load or store fail.
