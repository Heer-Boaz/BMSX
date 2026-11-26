# CPU and BLua32 instruction reference {#sec-cpu}

> WARNING! The behavior of the BLua32 CPU and its instruction set may not fully conform to the Lua standard due to implementation-specific details. Any deviations from the Lua standard should actually be regarded as bugs and not as intended features. Therefore, treat any non-standard behavior in this document as bugs and not as contracts, except for the extensions!

The BLua32 processor executes the cartridge program, performs arithmetic and
controls the console's memory-mapped units. Its instruction set operates on
function-frame value registers and transfers numeric scalars to and from
byte-addressed storage. Function calls, closures and language error handling
are part of the processor's execution architecture.

This chapter defines instruction encoding, operand values, execution timing
and CP0 control. [[Memory](memory.md#sec-memory)]{.content-visible when-format="html"}[Book I, Chapter 2]{.content-visible when-format="pdf"} defines the address map;
[Program images and startup](program-images.md#sec-program-images) defines program records;
[[IRQ](irq.md#sec-irq)]{.content-visible when-format="html"}[Book I, Chapter 3]{.content-visible when-format="pdf"} defines interrupt-source service; [[SYSTEM](system.md#sec-system)]{.content-visible when-format="html"}[Book I, Chapter 12]{.content-visible when-format="pdf"} defines
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
the callee closure's bound function data to establish its entry PC and register capacity.
A return places results in the caller's requested result range. Captured locals
remain connected to their closures; the closure rules below describe their
lifetime.

To control a device, prepare its addressed payload and operands, then write its
command port. The receiving unit supplies a status or interrupt condition for
its subsequent completion. Wait for that condition before reusing live input or
output storage. [[Memory](memory.md#sec-memory-device-specific-buffer-lifetimes)]{.content-visible when-format="html"}[Book I, §2.11]{.content-visible when-format="pdf"} describes
these lifetimes across DMA, geometry, drawing and sound.

### Values are not register words {#sec-cpu-values-are-not-register-words}

A CPU register holds a language value, not an unconditionally interpreted 32-bit word. The value kinds are nil, false, true, Number, String, Table, Closure, BuiltinFunction, and Thread. Copying a register or loading a constant preserves its value kind: copying false does not turn it into zero, and copying a Table preserves the reference to that Table.

Number has two subtypes. An Integer is a signed two's-complement 32-bit value;
its range is −2147483648 through 2147483647. A Float is an IEEE 754 binary32
value, including fractions, signed zero, infinities and NaN. Copying a Number
preserves its subtype. Integer arithmetic wraps to 32 bits; floating arithmetic
rounds to binary32. An Integer and a Float with the same numerical value compare
equal, but their subtypes remain distinct.

A raw word is a pattern of 32 bits. Loading a word into an Integer preserves
all its bits; bit 31 is the Integer sign bit. Thus the word `FFFFFFFFH` is
Integer −1. Bitwise operations act on those bits. Memory addresses and device
ports use the word bits, not the signed comparison of the Integer carrying
them.

Arithmetic requires Number operands. A different kind raises
`INVALID_ARGUMENT` (10); a numeric String is not parsed and a Boolean is not
converted. Use explicit numeric conversion when a program accepts text. Use
the truth rules for conditions rather than assuming that numeric zero is false.

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
| Execute `CALL 3,1,2` | R3 supplies that closure; B=1 supplies no arguments; C=2 requests one result | A new frame starts at the code address bound to the closure |
| Return normally from that callee | Its first result replaces the caller's R3, or nil is supplied if it produced none | The caller resumes at the instruction following the CALL |

The callee uses its own R0 and subsequent slots. Its function-record address
identifies the record from which its closure acquired entry metadata, while its PC identifies the instructions being
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

| Expression or stored result | Value | Reason |
| --- | --- | --- |
| `quotient` | approximately −2.33333325 | `/` produces a Float. |
| `floor_quotient` | Integer −3 | Integer floor division rounds downward. |
| `numbers[0] % numbers[1]` | 2 | A nonzero remainder follows the divisor's sign. |
| `-numbers[0] % -numbers[1]` | −2 | Reversing the signs changes the remainder's sign. |
| `*word_result` | Integer −2147483648, word `80000000H` | A word load retains all 32 bits. |
| `*word_result >> 1` | Integer 1073741824 | Right shift fills the top bit with zero. |
| `1 << 32`, `8 << -1` | 0, 4 | Wide shifts produce zero; negative counts reverse direction. |
| `halves[0]`, `halves[1]` | `5678H`, `1234H` | Halfword reads are little-endian. |
| `*whole` | `12345678H` | The same four bytes form one word. |
| `*rounded` | Float 16777216.0 | The binary32 addition rounds before the store. |

Integer arithmetic wraps at the word boundary; Float arithmetic rounds at
binary32 precision. The bits of the stored word are unchanged by its signed
Integer interpretation. Finite Float text is not necessarily a lossless
substitute for its binary32 value.

## Instruction words and execution resources {#sec-cpu-instruction-words-and-execution-resources}

| Resource | Specification |
|---|---|
| System-cycle timebase | 33,868,800 cycles/s |
| Installed main RAM | 4 MiB; mapped windows, reservations and ownership are in the Memory chapter |
| Language-allocation budget | Shared capacity between the active image’s heap floor and the runtime management area |
| Opcode field | 6 bits, 64 opcode identities including the WIDE prefix |
| Instruction word | 32 bits, four bytes, little-endian |
| Instruction length | One word; two words with one WIDE prefix |
| Numeric value | Integer or binary32 Float Number, distinct from other language values |
| Data word and CP0 word | 32 bits; scalar data transfers are little-endian |
| Frame registers | Logical value slots relative to the current call frame; the function record supplies its parameter count and maximum stack allocation |
| Register/count encoding | Format-dependent limits below, not a fixed physical register allocation or unlimited recursion guarantee |


### Word fields {#sec-cpu-word-fields}

Instruction words use the same little-endian byte order as multi-byte scalar data.

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
Bx. For `SETFIELD`, the prefix's own EXT byte requests 0 to 255
additional hash slots when the assignment needs new table storage.
For other instructions that byte is ignored.

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

Write that word least-significant byte first. The following table splits the
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
are `pA/pB/pC`. Use zero for an ordinary prefix, or the additional
hash-slot request for a prefixed `SETFIELD`.

The [two loads above](#sec-cpu-from-stored-bytes-to-a-frame-value) use ABC with
opcode `31H`. Their operands fit the low fields, so EXT is zero and no WIDE
prefix is needed:

| Instruction | A | B | C | Instruction word | Code bytes, in address order |
|---|---:|---:|---:|---|---|
| `LOAD_MEM 0,1,2` | 0 | 1 | 2 | `00C40042H` | `42 00 C4 00` |
| `LOAD_MEM 2,1,3` | 2 | 1 | 3 | `00C42043H` | `43 20 C4 00` |

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
| Construct the closure for the record at `10001230H` in R3 | `00 04 00 00 23 31 AC 00` | `pB=10H`, Bx=`01000123H`; Bx×16=`10001230H` |
| Construct a closure in R3 from the byte address held in R5 | `20 00 00 00 05 30 AC 00` | Register-address flag set; Bx=5 |
| Call the closure in R3 with no arguments and one requested result | `42 30 BC 00` | `CALL A=3, B=1, C=2` |
| Jump back to the branch's own first byte, without WIDE | `FF 0F A0 FF` | Signed Bx=−1; one word from instruction end to start |
| Jump back to the prefix's own first byte, with WIDE | `C0 0F 00 00 FE 0F A0 FF` | Signed Bx=−2; two words from instruction end to prefix |

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
constants. A fixed constant selector, whether encoded as RK, LOADK, or a
string-field key, must name an entry in the active execution image's constant
pool. A field-key selector must name a String constant. A missing constant or
a field key of another kind raises `INVALID_ARGUMENT` (10)
after the nominal instruction charge and before any operand read or result
write. If an instruction skips it, its encoded width is still used,
but the operand fault is not raised.

A frame obtains its entry PC, parameter count and stack allocation
from its closure's bound function data. The reserved capacity is the largest of one slot, the declared maximum stack
and the fixed-parameter count. Missing fixed parameters are nil;
other scratch slots must be written before they are read. A call may reuse its
caller's argument and temporary slots as the callee's register window. Ordinary register writes can
extend the active range, while result placement and open varargs have the
specific top rules in the call reference. The prefix below `top` is live;
an open upvalue independently retains its captured cell until that upvalue is
closed. Collection may clear other scratch slots at or above `top`, including
slots left by a completed call. Keep uncaptured values that must survive an
open-range operation below its destination register. An empty open range may
set `top` beyond the reserved capacity without allocating or accessing slots.
Do not treat the instruction's maximum field value as available scratch storage
in every function.

A fixed register read or write must fit the current frame's reserved
window, independently of `top`. A fixed capture selector must name a cell
in the current closure. An instruction that actually attempts either
access outside those limits raises `INVALID_ARGUMENT` (10). Empty
ranges do not access a slot. Call argument placement, vararg placement
and return placement use their own windows and range rules.

### Execution addresses and instruction reads {#sec-memory-execution-addresses-and-instruction-reads}

#### Function records and instruction addresses {#sec-memory-function-records-and-instruction-addresses}

A function address points to a **function record**, not to the first
instruction. The record's `CODE_ADDRESS` word supplies the instruction
address. These two addresses are not interchangeable.

The record and the instructions both use little-endian byte order:

| Item | Representation |
| --- | --- |
| Function record's `CODE_ADDRESS` word | 32-bit little-endian |
| Instruction word | Four bytes, little-endian |

A word written to memory has the same byte order when fetched as an instruction.

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
fetch records BadAddress and raises `AddressErrorLoad` before attempting a bus
read. Instruction words may be fetched from system ROM, installed main RAM
outside the decoded I/O aperture and below the language-heap floor, and
cartridge ROM or RAM. The language heap and the runtime management area,
from the floor to the end of installed RAM, do not supply instructions
([[Memory — Language heap](memory.md#sec-memory-language-heap)]{.content-visible when-format="html"}[Book I, §2.3.1]{.content-visible when-format="pdf"}). The executable
windows retain their ordinary mapped storage behavior, including zero reads
outside fitted ROM or card storage. System I/O, cartridge MMIO and the language-heap
range do not supply instructions: a fetch from any of them is an unmapped U32
bus read, rejected before
the addressed device is read. Ordinary data access to those devices is unchanged.
A new bus fault reading
either the first word or the WIDE body raises `InstructionBusError`; the saved
fetch PC is the instruction start, including the prefix address when the body
read fails. Fetch exception entry has a one-cycle charge; an unfetched body is
not executed with its nominal instruction cost.

In ordinary sequential execution, an instruction's effects precede a fault
fetching the following instruction. The completed instruction's effects remain
in place; the saved fetch PC identifies the instruction whose fetch failed.

Conditional-skip instructions decode the next instruction's full width and
skip that whole instruction without executing it or charging its
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
an instruction executes. The tables distinguish short register operations,
indexed-value operations,
frame control and long arithmetic. Most constant, arithmetic, bitwise and
comparison instructions cost two cycles; DIV, MOD, FLOORDIV, POW and LEN have
the distinct charges shown below. CONCATN costs three cycles.
LOADNIL adds one cycle per written register. Text construction and String
ordering add the length-dependent charges specified below. Readiness waits,
counted-transfer surcharges and builtin charges are
separate; [Cycle accounting and execution boundaries](#sec-cpu-cycle-accounting-and-execution-boundaries)
defines their place in the execution budget.

### Constants and copies {#sec-cpu-constants-and-copies}


The constant and copy instructions move complete values or create a specific value kind. K0, K1, and KSMI create Integer Numbers. LOADNIL's B operand is a count: for example, A=4 and B=3 write nil to R4, R5, and R6, not through R7.

| Mnemonic | Opcode | Operands and specified domain | Result | Nominal cycles |
|-------------|-------:|----------------------------|--------------------------------------------|--------:|
| MOV | `01H` | A destination; B source register; C move kind | Copy or reinterpret the numeric payload as specified below | 2 |
| LOADK | `02H` | A destination; Bx identifies an existing constant | `R[A] = K[Bx]`, preserving the constant's value kind | 2 |
| LOADNIL | `03H` | A first register; B register count; C unused | For B>0, set exactly `R[A]` through `R[A+B−1]` to nil and raise frame top to at least A+B without lowering it. B=0 changes neither slots nor top. | 2 |
| KNIL | `05H` | A destination; B and C unused | `R[A] = nil` | 2 |
| KFALSE | `06H` | A destination; B and C unused | `R[A] = false` | 2 |
| KTRUE | `07H` | A destination; B and C unused | `R[A] = true` | 2 |
| K0 | `08H` | A destination; B and C unused | Integer 0 in `R[A]` | 2 |
| K1 | `09H` | A destination; B and C unused | Number 1 in `R[A]` | 2 |
| KSMI | `0BH` | A destination; signed immediate sBx within the encoding range above | Number equal to sBx in `R[A]` | 2 |
| LOADKR | `35H` | A destination; B source register; C unused | Convert `R[B]` to unsigned 32-bit index i, then `R[A] = K[i]`, preserving the constant's value kind. An index outside the pool raises `INVALID_ARGUMENT` (10) before the destination is written. B is not an RK operand. | 2 |



### Numeric word moves {#sec-cpu-numeric-word-moves}

`MOV A, B, 0` copies the complete value unchanged. The two other move kinds
transfer a Number's word without arithmetic or memory access:

| C | Required source | Result |
|---|---|---|
| 1 | Float | Integer containing the Float's complete binary32 word |
| 2 | Integer | Float whose binary32 word is the Integer's complete word |

These transfers preserve both zero signs and every NaN bit, including a
signaling NaN. They do not round, canonicalize, allocate or access the bus.
A source of the wrong subtype raises `INVALID_ARGUMENT` without changing
the destination. Values of C other than 0, 1 and 2 are reserved encodings and
raise Reserved Instruction. All three defined forms cost two cycles.

### Arithmetic {#sec-cpu-arithmetic}

ADD, SUB, MUL, DIV, MOD, FLOORDIV, and POW read two Number operands through
RK B and RK C. UNM reads one Number from R[B]. A non-Number operand raises
`INVALID_ARGUMENT` (10) without writing the destination.

ADD, SUB, MUL, MOD and FLOORDIV use Integer arithmetic when both operands are
Integers. Integer ADD, SUB and MUL retain the low 32 bits, interpreted as a
signed result. Integer UNM likewise wraps: negating −2147483648 produces
−2147483648. Integer FLOORDIV rounds the quotient toward negative infinity;
integer MOD satisfies `a = (a // b) * b + a % b` in word arithmetic, with a
nonzero remainder having the divisor's sign. Dividing an Integer by zero with
FLOORDIV or MOD raises `INVALID_ARGUMENT` without writing the destination.
The overflow case `−2147483648 // −1` wraps to −2147483648; its remainder is
zero.

If either operand of ADD, SUB, MUL, MOD or FLOORDIV is a Float, the other
operand is converted to binary32 and the result is a Float. DIV and POW always
convert both operands to binary32 and produce a Float. Floating UNM produces a
Float. Conversion and arithmetic use round-to-nearest, ties-to-even, with
gradual underflow; a subnormal value is not flushed to zero. A Float preserves
its zero sign and infinities according to the operation's rules. An arithmetic
NaN result is the quiet NaN word `7FC00000H`. This rule applies after each
ADD, SUB, MUL, DIV, MOD, FLOORDIV and POW, not merely when a value is stored.
Float UNM instead toggles bit 31 and preserves the other 31 bits, including a
NaN's payload and quiet/signaling bit. Copying a Float preserves all 32 bits.
For example, negating a canonical arithmetic NaN produces `FFC00000H`; copying
that value retains the negative NaN word.

FLOORDIV rounds a floating quotient toward negative infinity. Floating MOD
starts with the truncation-based remainder `r`: when `r > 0` and the divisor
is negative, or `r < 0` and the divisor is positive, its result is `r + b`;
otherwise its result is `r`, including its zero sign. Floating division by
zero uses the binary32 infinity and NaN results, rather than the integer
zero-divisor fault.


DIV has a fixed execution budget of 31 cycles; FLOORDIV adds one cycle for
rounding the quotient downward. Including the uniform instruction-supply
allowance, their nominal charges are 32 and 33 cycles. MOD has a fixed
34-cycle charge for the remainder class, including its divisor-sign adjustment.
POW has a fixed 128-cycle charge for general exponentiation. These are distinct
nominal arithmetic classes, not operand-dependent iteration counts. Their base
charges do not change for special operands, nonfinite results or a result that
can be determined without the general arithmetic path. ADD, SUB and MUL retain
the two-cycle nominal charge.

The nominal charge of each arithmetic opcode is the same for Integer and
Float operands. The faulting attempt retains its base charge; the exception
does not publish a destination result.

| Mnemonic | Opcode | Operands | Number result in R[A] | Nominal cycles |
|---|---:|---|---|---:|
| ADD | `11H` | Numeric reads of RK(B), RK(C) | left + right | 2 |
| SUB | `12H` | Numeric reads of RK(B), RK(C) | left − right | 2 |
| MUL | `13H` | Numeric reads of RK(B), RK(C) | left × right | 2 |
| DIV | `14H` | Numeric reads of RK(B), RK(C) | left divided by right | 32 |
| MOD | `15H` | Numeric reads of RK(B), RK(C) | Remainder with the divisor's sign, using the subtype rules above | 34 |
| FLOORDIV | `16H` | Numeric reads of RK(B), RK(C) | Quotient rounded toward negative infinity, using the subtype rules above | 33 |
| POW | `17H` | Numeric reads of RK(B), RK(C) | left raised to the power right, with the special cases below | 128 |
| UNM | `1FH` | Numeric read of R[B], not RK(B); C unused | Negation in the operand's subtype | 2 |



### Bitwise operations and shifts {#sec-cpu-bitwise-operations-and-shifts}

Each bitwise operand must be an Integer or a Float whose value is an exact
integer in the signed 32-bit range. Such a Float converts to the equivalent
Integer. A fraction, infinity, NaN, out-of-range Float or non-Number raises
`INVALID_ARGUMENT` (10), without writing the destination.

The operation uses the Integer's 32 bits and writes an Integer. For example,
the word with all bits set is Integer −1; shifting 1 left by 31 produces
−2147483648. Both shift directions fill vacated positions with zero. A negative
shift count reverses the direction; a magnitude of 32 or more produces zero.
Thus `−8 >> 1` is 2147483644, `8 << −1` is 4, and `1 << 32` is zero.

| Mnemonic | Opcode | Operands | Result in R[A] | Nominal cycles |
|---|---:|---|---|---:|
| BAND | `18H` | Integer-converted RK(B) and RK(C) | Integer with the 32-bit AND result | 2 |
| BOR | `19H` | Integer-converted RK(B) and RK(C) | Integer with the 32-bit OR result | 2 |
| BXOR | `1AH` | Integer-converted RK(B) and RK(C) | Integer with the 32-bit exclusive-OR result | 2 |
| SHL | `1BH` | Integer-converted RK(B) and RK(C) | Shift the left word left by the signed count, reversing direction for a negative count | 2 |
| SHR | `1CH` | Integer-converted RK(B) and RK(C) | Shift the left word right by the signed count, reversing direction for a negative count | 2 |
| BNOT | `22H` | Integer-converted R[B], not RK(B); C unused | Integer with all 32 bits complemented | 2 |



### Truth, length, and text {#sec-cpu-truth-length-and-text}

Only nil and false are falsey. Every other value is truthy, including Number 0, Number NaN, and an empty String. NOT writes a boolean, not a Number. In particular, negating the truth of zero produces false.

LEN returns a String's byte count or a Table's length. Bytes may contain NUL or sequences that are not valid UTF-8. A Table with a `__len` method uses its first result (or nil if it returns none); otherwise the CPU finds a boundary in the Table's own positive integer keys. LEN on any other value kind faults.


Concatenation uses language value-to-string conversion rather than accepting only strings and Numbers. CONCAT joins its two RK operands in B-then-C order. CONCATN joins exactly C consecutive registers starting at R[B], in increasing register order. All CONCATN sources are read before the result is written, so the destination may overlap the input range. A zero CONCATN count produces the empty String.

CONCAT adds one cycle per byte in the converted, combined result. CONCATN
adds C cycles for its supplied source range and one cycle per byte in the
combined result. The result length includes zero bytes and the text of
converted non-String values. These charges apply even when an identical String
already exists.

For CONCAT and for CONCATN with at most 64 operands, the CPU samples operand
values and their byte counts at issue. It also charges results of at most 256
bytes at issue. A longer result is assembled one byte per available result cycle.

For CONCATN with more than 64 operands, each source cycle samples one
register and its converted byte count, in ascending register order. A write
before that cycle changes the operand; a later register write does not. While
sources remain to be sampled, collection retains the active register window
through the last source without changing the published frame top. Result
assembly starts only after all source cycles and consumes one cycle per byte,
including for results of 256 bytes or fewer.

In either form, a sampled source String remains reachable until its last byte
has been read, even if its source register is overwritten. The final mark
scans unread operands within its normal work quanta. Writes to String payloads
cannot change bytes already assembled.
The destination is written only after the completed sequence has been interned; interrupts wait for
retirement. An allocation fault retains the charge. A concatenation result must fit the
22-bit byte length of a RAM String. At 4 MiB or more the instruction raises
out-of-memory without interning the result or collecting. Its byte charge
saturates at 4,194,304 cycles; the base and full range charges still apply even if an early operand establishes the overflow.
A zero-count CONCATN therefore costs
only its three base cycles.

| Mnemonic | Opcode | Operands and domain | Result in R[A] | Nominal cycles |
|---|---:|---|---|---:|
| CONCAT | `1DH` | RK(B), then RK(C); every language value kind has the conversion shown below | Combined String | 2 |
| CONCATN | `1EH` | B first register; C register count; neither B nor C is RK | String formed from `R[B]` through `R[B+C−1]`; empty String when C=0 | 3 |
| NOT | `20H` | R[B], not RK(B); C unused | Boolean true for nil or false; boolean false for every other kind | 2 |
| LEN | `21H` | R[B], not RK(B); C unused; String or Table | String byte count, Table length boundary, or first result of `__len` | 3 |




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
| Finite Number | Default Integer or Float conversion below |



Concatenating a Table therefore does not serialize its entries, and concatenating a function does not print its contents or identity. Use concatenation to assemble readable text, but do not assume that its text distinguishes every language value. Number formatting is numeric formatting, not a conversion to a raw device word.

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
P+20 with a Boolean in R0 and have six base instruction cycles, assuming
successful instruction reads. LT itself never writes R0; its A=1 is the
expected truth, not register R1. The [branch reference](#sec-cpu-branches)
defines the word-relative offsets used by the two jumps.

When both operands of LT or LE are Strings, add one cycle for each byte
in the shorter operand. This charge depends only on the two lengths, including
zero bytes; it does not depend on the position of the first difference or
whether the operands are the same String. EQ and comparisons involving other
value kinds have no text-length surcharge. The comparison completes, including
its skip decision, before the CPU accepts a pending interrupt.

If the shorter String has at most 64 bytes, the byte cycles are charged at issue.
When the shorter String is longer than 64 bytes, the CPU samples both record
references and their lengths at issue. Each byte cycle available after issue advances one
position. If the grant ends, the next grant continues at that position. A
difference fixes the ordering but does not cancel the remaining byte cycles.
Only after the last byte cycle can the following instruction execute. A write to a String
record between grants cannot change the comparison of bytes already consumed.

Equality respects value kinds. Different kinds are unequal; there is no numeric-string or boolean-number equality conversion. Integer and Float are subtypes of Number and compare by their exact numerical values. NaN is unequal even to itself; Integer zero and both Float zero signs compare equal. Table, Closure, and Thread equality is reference identity rather than a comparison of their contents.

| Matching operand kinds | EQ predicate |
|---|---|
| nil, false, or true | Equal to the same kind |
| Number | Numeric equality; NaN is unequal, +0 equals −0 |
| String | Same String contents |
| BuiltinFunction | Same builtin identifier |
| Table, Closure, or Thread | Same reference identity |
| Different kinds | False |




Ordering is defined for two Numbers or two Strings. Numbers use numeric less-than or less-than-or-equal comparison. A mixed Integer/Float comparison compares their exact represented values: it does not first round the Integer to binary32. Thus Integer 16777217 is greater than Float 16777216.0. NaN is unordered. Strings are ordered lexicographically by unsigned byte values. Mixed value kinds and all other kind combinations produce a false predicate rather than a comparison type fault. Equality of Tables can therefore test whether two values refer to the same Table, but LT and LE do not provide an ordering of Tables.

| Mnemonic | Opcode | Operands | Predicate and control effect | Nominal cycles |
|---|---:|---|---|---:|
| EQ | `23H` | RK(B), RK(C); A is expected truth, not a destination | Equality by the value-kind rules above; skip the next decoded instruction if the predicate differs from `(A≠0)` | 2 |
| LT | `24H` | RK(B), RK(C); A is expected truth, not a destination | Number less-than or String lexical less-than; false otherwise; skip the next decoded instruction if the predicate differs from `(A≠0)` | 2 |
| LE | `25H` | RK(B), RK(C); A is expected truth, not a destination | Number less-than-or-equal or String lexical less-than-or-equal; false otherwise; skip the next decoded instruction if the predicate differs from `(A≠0)` | 2 |


### Table iteration {#sec-cpu-table-iteration}

An ordinary generic loop can invoke any callable iterator. For a loop that
may be using the built-in `next`, put the iterator, its state and its
control value in three consecutive registers. To start a traversal, the
state is the Table and the control value is nil. Place ITERN immediately
before a branch to the ordinary iterator call. If ITERN handles the step,
it skips that branch; otherwise the branch runs with the original inputs.
Both paths should test the first result for nil before entering the body.

| Mnemonic | Opcode | Operands | Effect | Nominal cycles |
|---|---:|---|---|---:|
| ITERN | `0AH` | A first register of iterator/state/control; B first result register; C positive result count | Advance a built-in `next` traversal when the state is a Table and the control value is nil. Skip one decoded instruction on that path; otherwise fall through without writes. | 8 |

For an admitted step, the Table's own entries are visited in the same
order as `next`. R[B] receives the key, R[B+1] receives its value if
C is at least two, and any remaining results are nil. Exhaustion places
nil in all C results and still skips the following instruction. The skip
includes both words of a WIDE instruction. The CPU writes the results
before updating R[A+2] and raises the frame top to at least B+C without
lowering it. The admitted step adds C cycles, including on exhaustion,
with no additional charge for scanning empty entries. A step not admitted
has only the nominal charge and does not change the frame top.

R[A+2] remains nil as a language value and carries a traversal position
between instructions. Keep this slot separate from the visible loop
variables and preserve it until the next step. Start each new traversal
with a fresh nil. The Table modification rules for `next`
(@sec-bios-base-nexttable-key) still apply.
A zero C or either register range outside the reserved frame raises
`INVALID_ARGUMENT` (10) before reading or writing any registers.


## Numeric result details {#sec-cpu-numeric-result-details}

### POW: exponentiation {#sec-cpu-pow-exponentiation}

POW converts its Number operands to binary32 and computes a Float base `x`
raised to a Float exponent `y`, written here as `x^y`. Its result is a Float,
including when it is a signed zero, an infinity, or NaN. Integer operands are
rounded to binary32 before the cases below are selected. In this section,
`+0` and `-0` are distinct Float zeros; `+infinity` and `-infinity` have their
usual signs. NaN means a not-a-number result, without a promise to preserve an
operand's NaN payload.

#### Order of special cases {#sec-cpu-order-of-special-cases}

Apply these rules in order. The order matters when more than one description appears to fit.

1. **Either zero exponent produces `+1`.** For every base, `x^(+0)` and `x^(-0)` are `+1`. This includes zero, infinity, and NaN bases.
2. **A positive-one base produces `+1`.** This includes `1^NaN`.
3. **Otherwise, either NaN operand produces NaN.** Consequently, `NaN^0` is `+1`.
4. **An infinite exponent uses the base's magnitude.** For a non-NaN base, the following table applies before the rules for finite exponents.

| Base magnitude | Exponent `+infinity` | Exponent `-infinity` |
|---|---|---|
| `abs(x) < 1`, including either zero | `+0` | `+infinity` |
| `abs(x) = 1`, meaning `+1` or `-1` | `+1` | `+1` |
| `abs(x) > 1`, including either infinity | `+infinity` | `+0` |

The base's sign does not change these infinite-exponent results. Every zero
and infinity produced by this table is positive.

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
| `+2` | The binary32 product `x*x`, after conversion of the base. Either zero becomes `+0`; either infinity becomes `+infinity`. A finite product can overflow, become subnormal, or round to `+0`. |
| `+0.5` | For a positive finite base, the positive square root. The special-base table gives `+0` for either zero and `+infinity` for either infinity; a negative finite, nonzero base produces NaN. |


In particular, `(-0)^0.5` does **not** preserve the base's negative-zero sign.

#### Represented exponent parity {#sec-cpu-represented-exponent-parity}

Oddness and evenness refer to the exponent after conversion to binary32. From
`2^23` upward every representable finite Float is integral. From magnitude
`2^24` upward every representable finite Float is even. The largest positive
representable odd exponent is `2^24 - 1`, or `16777215`; `(-1)^16777215`
is `-1`, while `(-1)^16777216` is `+1`. In particular, an Integer exponent
`16777217` rounds to Float `16777216.0` before POW selects its result.

#### Range limits and subnormal results {#sec-cpu-range-limits-and-subnormal-results}

POW accepts nonzero subnormal bases and can produce subnormal results; it does not discard all such values as zero. Overflow produces infinity, while sufficiently small magnitudes round to zero. For negative bases with odd integer exponents, these results retain a negative sign.

The following are exact result examples, not decimal display approximations:

| Expression | Result |
|---|---|
| `2^(-149)` | `2^(-149)`, the smallest positive subnormal Float |
| `2^(-150)` | `+0` |
| `2^128` | `+infinity` |
| `(-2)^129` | `-infinity` |
| `(-2)^(-151)` | `-0` |

These exact examples do not establish a universal correct-rounding or error guarantee for other finite powers.

### Default Number-to-text conversion {#sec-cpu-default-number-to-text-conversion}

Concatenation converts a Number to text using its subtype. Integer text is an
exact signed decimal integer. Float text is a seven-significant-digit decimal
rendering of the represented binary32 value. For example, Integer `1000000`
produces `1000000`, while Float `2.0` produces `2.0`. These rules also apply
to default value-to-text conversion outside concatenation.

#### Sign, zero, and the integer shortcut {#sec-cpu-sign-zero-and-the-integer-shortcut}

An Integer is written in base ten without leading zeros, preceded by `-` if
negative. Integer zero is `0`; the minimum Integer is `-2147483648`. No
scientific notation or floating-point conversion is used for an Integer.

Float positive and negative zero are `0.0` and `-0.0`. Float NaN is `nan`;
positive and negative infinity are `inf` and `-inf`. Other negative Floats
have a leading `-` followed by the formatted positive magnitude. There is no
leading `+` on positive values.

#### Normalization and rounding {#sec-cpu-normalization-and-rounding}

For a finite nonzero Float, consider the exact value represented by its
binary32 bits. Round its decimal magnitude to seven significant decimal digits,
to nearest with ties to an even last digit. If that rounding produces an
additional leading digit, adjust the decimal exponent before selecting the
notation. This is decimal rounding of the represented value; it does not
perform intermediate binary32 multiplications or divisions.

#### Choosing and spelling the notation {#sec-cpu-choosing-and-spelling-the-notation}

Let `e` be the decimal exponent of the rounded value when its leading digit is
placed immediately before the decimal point. Use fixed notation when
`−4 <= e < 7`, otherwise use scientific notation. Remove fractional trailing
zeros and an empty decimal point. In fixed notation append `.0` if no decimal
point remains; this distinguishes Float text from Integer text. Scientific
notation uses lowercase `e`, an explicit exponent sign and at least two
exponent digits. It needs no appended `.0`.

#### Number-to-text examples {#sec-cpu-number-to-text-examples}

| Number input | Resulting text |
| --- | --- |
| Integer 0 / Integer 1000000 | `0` / `1000000` |
| Float +0 / Float −0 | `0.0` / `-0.0` |
| Float `2.0` | `2.0` |
| Float `0.1` | `0.1` |
| Float `1000000.0` | `1000000.0` |
| Float `10000000.0` | `1e+07` |
| Smallest positive subnormal Float | `1.401298e-45` |
| Largest finite Float | `3.402823e+38` |
| NaN / positive infinity / negative infinity | `nan` / `inf` / `-inf` |

Seven digits are intended for readable output, not lossless serialization:
separate Float values can produce the same text.

## Calls, closures, globals, and tables {#sec-cpu-calls-closures-globals-and-tables}

### Calling and returning values {#sec-cpu-calling-and-returning-values}

Function calls use language value slots. Each call has a frame-relative register window in its thread's shared value stack and, for a variable-argument function, a saved argument range. The function record's maximum-stack value is a **slot count**, not a RAM address or byte count. The stack occupies reserved language storage in main RAM. A cartridge uses the frame-relative slot numbers, not a fixed byte address for that stack; see [Language allocation and lifetime](#sec-cpu-language-allocation-and-lifetime).

`CALL A,B,C` takes its callee from `R(A)`. Arguments occupy consecutive registers starting at `R(A+1)`, and returned values replace consecutive registers starting at `R(A)`.

Registers below `A` survive the call. `R(A)` and all higher registers are
call-clobbered: the caller must place every local, temporary and captured local
that remains live after the call below `A`. On return, only the selected result
range has defined result values. This rule also applies to builtin calls.

The first fixed parameter uses the supplied argument slot at `R(A+1)` without
copying a separate register bank. Variable-argument functions retain their
extra arguments below a relocated working window. Parameter writes therefore
cannot change later reads of `...`. The register reservation covers at least one slot, the declared maximum stack,
and every formal parameter, whichever is largest. Program records normally
declare a maximum stack no smaller than their formal parameter count.
Scratch registers are not initialized at
function entry; initialize a local without an initializer with `LOADNIL` before
reading it. Missing parameters and missing requested results are always nil.

Only closure and builtin-function values are callable. A number is not callable merely because its numeric value is a function-record address. Calling any other value category raises `CALL_NON_FUNCTION`.


All count operands in the call/return family use the same encoding: zero
selects an open range; a positive operand encodes the fixed count plus one.
An operand of one therefore selects an empty range, distinct from one nil value:

| Instruction operand | Zero | Positive value |
|---|---|---|
| `CALL B`: supplied arguments | Use `max(top-A-1, 0)` arguments. | Supply exactly `B-1` arguments. In particular, `B=1` supplies none. |
| `CALL C`: requested results | Accept all produced results. | Accept exactly `C-1` results. `C=1` discards all results. |
| `RET B`: produced results | Return `max(top-A, 0)` values. | Return exactly `B-1` values. `B=1` returns no values. |
| `VARARG B`: copied arguments | Copy all saved varargs. | Copy exactly `B-1` values, filling any shortage with nil. `B=1` copies nothing. |



For example, place a callee in R3 and two arguments in R4 and R5, then execute
`CALL 3,3,3`. It supplies those two arguments and requests two results in R3 and
R4. If the function produces only one result, R4 becomes nil; if it produces
more than two, the excess is discarded. After result placement, `top` is
exactly 5, so the earlier argument in R5 lies outside the active range.

An open-result call instead sets `top` to `A` plus the number of results actually produced. This exact-top rule makes a returned value range available to a following open-argument call or open return without treating every previously written register as an argument or result. It also means that result placement can lower `top`. Normal builtin completion follows the same result selection, nil padding, and exact-top rules.

On entry to a closure, its bound function data supplies the code address and parameter metadata. The frame starts with `top` equal to its fixed-parameter count, not its maximum stack allocation. Supplied arguments fill the fixed parameters in order, and missing fixed arguments become nil. Excess arguments are retained as varargs only for a function marked vararg; otherwise they are not retained as varargs.

`VARARG A,0` copies the saved excess arguments starting at `R(A)` and sets `top` exactly to the end of that copied range. If there are none, it sets `top` to `A`. A nonempty fixed-count `VARARG` pads with nil as needed and only raises `top`, to at least `A+B-1`. `VARARG A,1` writes nothing and leaves `top` unchanged.

`RET` closes the returning frame's open upvalues before routing its results. An ordinary nested return places results in the caller's saved destination range and releases the returning frame. A return need not have an ordinary caller: protected-call targets, completion, and coroutine resumption have distinct return routes. Returning from a root frame with no resumer records completion values.

#### Value placement and capture cycles

In addition to their nominal instruction or primitive base charge, these
operations add **1 cycle per value slot placed**:

- `LOADNIL` counts its B nil writes. `B=0` adds nothing.
- `VARARG` counts every selected slot, including nil padding. An empty selected
  range adds nothing.
- A fixed-parameter closure call counts only missing formal parameters filled
  with nil: supplied fixed arguments already occupy the callee's slots and add
  no placement charge. A vararg call counts all formal parameters, copied or
  nil-filled, in its relocated working window. The saved extra arguments remain
  in their existing slots and add no charge.
- A first coroutine resume copies arguments between threads: it counts the
  formal parameter slots and any retained extra arguments. Subsequent resumes
  count the selected receiving range of the suspended yield, including padding.
- Ordinary returns, builtin completions, coroutine yields and completions, and
  protected success or error completion count their actual receiving ranges.
  Include status prefixes, copied values and nil padding. The error argument
  supplied to an `xpcall` handler counts as one placed slot.

`CLOSURE` additionally charges **1 cycle per upvalue descriptor bound**, whether
it binds a newly opened cell or an existing capture. Closing captures charges
**1 cycle per open cell actually closed**, not per closure referring to that
cell. This applies to `RET`, `RFE`, protected error unwinding and coroutine
close. Traversing calls without open captures adds no capture charge.
Register reservation size does not add a placement charge.

`RET` has a base charge of **16 cycles** and uses the same receiving-range rule.
Do not count produced values that the receiver discards. If the caller requests all results,
the placement charge is the number produced; for a fixed request it is exactly
the requested count. Discarding all results adds no result-placement charge,
even if the returning function produces values; capture-closing charges still
apply.

Completion without an ordinary caller places the produced values in the
completion range and charges that range. Returning to a coroutine resumer or a
protected-call receiver counts its selected range, including a status prefix
and nil padding. Nested protected completions can place successive receiving
ranges; each completed range is charged once. If admission of a later range
fails, charges for earlier completed ranges remain, but the unplaced range adds
no charge.

Placement and capture work is part of the instruction: it completes before the
next instruction begins or the CPU accepts a pending interrupt. An unplaced
range whose admission fails adds no placement charge;
completed ranges and closed captures retain their charges if later work fails.

### Closures and captured variables {#sec-cpu-closures-and-captured-variables}

A closure is a callable language value associated with a function record and captured upvalues. `CLOSURE` constructs this value; it does not merely copy a numeric code address into a callable register.

The `CLOSURE` register-address flag chooses how to obtain the function-record address:

- Flag clear: the address is `Bx × 16`.
- Flag set: `Bx` selects the register supplying the unsigned address.

The function record is a shared prototype in its execution context. It identifies the code address, fixed parameters, stack requirement, flags and upvalue descriptors. `CLOSURE` reads the record before writing the destination, and binds the captures for this particular closure. `CALL` uses the prototype for entry and frame placement. Instruction bytes remain at their addressed locations.

Finish publishing a prototype before constructing any closures from it. Do not replace the record while any closure still uses it; existing calls and new closures have no guaranteed behavior after such a write. To publish a new definition while an older one remains in use, give the new prototype its own record.

A failed record or upvalue-descriptor read hard-halts without writing `R(A)`.


Each upvalue descriptor is a 32-bit word. Descriptor `i` is read at `upvalueTableAddress + 4i`:

| Descriptor bits | Capture source |
|---|---|
| High bit set | A register slot in the parent frame; the low 31 bits select the slot. |
| High bit clear | An upvalue of the parent closure; the low 31 bits select that upvalue. |

A register source must be inside the parent frame's reserved window, and an
upvalue source must be inside the parent closure's capture list. The processor
checks the descriptors before allocating or linking any captures. A descriptor
that selects no source raises `INVALID_ARGUMENT` without writing `R(A)`.

An open upvalue names the owning Thread and the slot for its captured
parent-frame register. Moving the Thread's value slots to a larger block
does not change the capture. Captures of the same register in one activation
can share an already-linked open upvalue. A return closes only the captures
owned by the returning activation, even when the caller and callee have
overlapping register windows. Closing the cell retains the current language
value independently of the frame. `GETUP` and `SETUP` use the same upvalue
operand in either case.

Repeated CLOSURE operations for a STATIC function record with no upvalues may
return the same function value when they use the same prototype in the same
execution context. An ordinary call uses that value; a numeric
function-record address is supplied to CLOSURE or EXEC under their separate
operand rules.

### Two global namespaces {#sec-cpu-two-global-namespaces}

Ordinary globals and system globals are separate namespaces. `GETGL` and `SETGL` access ordinary globals; `GETSYS` and `SETSYS` access system globals. A matching name in one namespace does not select the value stored under that name in the other.

For these instructions, `Bx` is an index into the corresponding execution-image name table. It is not a register operand, a constant-pool string operand, or a table key. Each image's ordinary and system name tables are independently mapped to their namespace slots. Registering a new name initializes its value to nil; registering an existing name reuses the slot in that namespace. The namespace distinction alone does not specify a privilege boundary.

Executing a global instruction whose index is outside its selected name table
raises `INVALID_ARGUMENT` (10) after the nominal instruction charge and before
reading or changing a value. An index cannot continue into the other namespace
or into storage following the name table.

### Tables, keys, and method receivers {#sec-cpu-tables-keys-and-method-receivers}

The table instruction families differ in where the key comes from:

- `GETT` and `SETT` take general keys through `RK` operands.
- `GETI` and `SETI` carry the integer key directly in an instruction operand.
- `GETFIELD`, `SETFIELD`, and `SELF` select a string key directly from the image constant pool. That constant operand is not an `RK` operand.

Reads accept a table base. A string base instead uses the CPU's string-index table; these instructions do not specify substring indexing. Other base value categories raise `INDEX_NON_TABLE`. Without a metatable, a table read is direct. See [Metatables and indexed reads](#sec-cpu-metatables-and-indexed-reads) for lookup and its chain bound.

Writes accept only table bases, including for integer and string-field forms. Assigning through any other value category, including a string, raises `ASSIGN_NON_TABLE`.

`SELF` prepares both a method value and its receiver. It preserves the original `R(B)` in `R(A+1)` before looking up the string-keyed field into `R(A)`. The receiver therefore remains available as the first argument when the method value is called. Both destination writes extend `top` as needed. Preserving the original receiver also defines the result when a destination overlaps the source register.

`NEWT` creates an empty table with an array-capacity request and a hash-size
request. Neither operand supplies initial elements. A nonzero hash request
reserves the least power of two that can hold the requested number of entries.
The reserved slots count against the language-allocation budget, whether or
not they contain entries.

### Table entries and inherited reads {#sec-cpu-table-entries-and-inherited-reads}

A Table maps admissible keys to non-nil values. Numeric and nonnumeric keys may coexist in the same Table. Array storage and hash storage hold entries of the same Table; they are not separate value kinds. Moving an entry between them does not change its key category.

#### Keys and presence {#sec-cpu-keys-and-presence}

Nil and NaN are not stored keys. An own lookup with either key misses, so an ordinary indexed read can pass the key to `__index`. An attempted direct write with either key raises `INDEX_NIL` (4) or `INDEX_NAN` (12), respectively. An ordinary assignment may instead pass the original key to a function-valued `__newindex`.

| Key category | Matching rule |
| --- | --- |
| Boolean | `false` and `true` are distinct keys. |
| Number | Numeric matching, with the zero rule below. |
| String | Matching String contents; no conversion to a numeric key occurs. |
| Table, closure, thread | The same reference matches; separate objects do not match by contents. |
| Builtin function | The same builtin identity matches. |

Numeric `1`, string `"1"`, and boolean `true` are separate keys. An Integer and a Float with the same exact numerical value address the same mapping: Integer `2` and Float `2.0` are the same key. Integer zero and both Float zero signs address the same key. Positive and negative infinity are admissible numeric keys.

Insertion stores an exactly integral Float in Integer range as an Integer key.
This includes both Float zero signs, which become Integer zero. This
normalization applies to keys, not to stored values: a Float value retains
its subtype and word bits.

Only positive integral numeric keys from 1 through `7FFFFFFFH` are eligible for array storage. Zero, negative numbers, fractions, infinities, and larger numbers use hash storage. An eligible numeric key may also reside in hash storage when it lies beyond the allocated array capacity. Numeric key zero has no special indexing role.

A non-nil value establishes a mapping. In particular, `false` is present: it is not a missing entry and does not permit an inherited value to replace it. Assigning nil removes the Table's own mapping. It does not create a retrievable nil-valued entry. An allocated but empty array slot is likewise missing. Deletion does not erase other keys.

#### Table length {#sec-cpu-table-length}

For a Table with a non-nil `__len` in its metatable, `#t` invokes that method
with the Table as both arguments and uses the first result. The base LEN
charge does not include the invocation or the method's work. Without this
method, `#t` returns a **boundary** in the Table's own positive integer keys.
A boundary is a nonnegative integer `L` for which both conditions
hold:

- `L` is zero, or `t[L]` is non-nil;
- `L` is `2^31 - 1`, or `t[L + 1]` is nil.

These tests read only the Table's own mappings, not inherited entries. `false`
is present. The terminal boundary is the largest positive Integer. Keys outside this sequence range
remain ordinary hash keys and do not extend the length beyond that boundary.

A **sequence** has exactly the keys 1 through `n` in this range, with no holes;
its length is `n`. The empty sequence has length zero regardless of its initial
capacity. Length does not count all mappings or find the largest numeric key.

A Table with holes can have several valid boundaries. For example, with keys
1, 3, 4 and 5 present, both 1 and 5 are valid. Deleting key 2 from a
sequence of length 5 does not promise length 1. Restoring key 2 restores
the unique boundary 5. Keep an explicit count or iteration bound when the
Table can have holes and the choice of boundary matters. Repeated length
reads without a mutation return the same boundary and do not change the
Table's mappings.

A Table or String `LEN` costs **3 cycles**. The Table's reserved capacity,
insertion order and number of entries do not change this instruction
charge. A String length is its byte count. An invoked `__len` method is
charged separately.

#### Metatables and indexed reads {#sec-cpu-metatables-and-indexed-reads}

A Table may have a metatable. An ordinary indexed read first checks the queried Table's own mapping. A non-nil value wins immediately, including `false`. If the entry is missing, the read obtains the direct `"__index"` member of that Table's metatable. A Table-valued `__index` continues the lookup on that Table with the original key. Each subsequent Table is processed in the same way.

A function-valued `__index` is called with the receiver at that step and the original key. The read uses its first result, or nil if it returns none. A missing `__index` terminates the read with nil. Forwarding to a String uses its installed index Table. Forwarding to a value that cannot be indexed raises `INDEX_NON_TABLE`. Retrieving the metatable member itself does not start another inherited lookup. One chained read permits 32 visited Tables. Exhausting that bound raises `METATABLE_LOOP` (5); an actual cyclic reference is not required to exhaust the bound.

For Table-valued `__index` traversal, the indexed-read base charge covers the
first visited Table. Each additional visited Table adds **8 cycles**, whether
that visit finds a value or continues the lookup. This additional stage selects
the next target and tests its own mapping; it does not fetch another instruction.
Count visits, not distinct identities: revisiting one Table through a cycle
still adds the same work.
A read that visits 32 Tables before raising `METATABLE_LOOP` adds 248 traversal cycles.
An ordinary missing-key result of nil retains the work of its visited Tables.
The direct `__index` member retrieval is part of that traversal, not another
visited target. A String receiver begins at the installed String-index Table;
that first Table is covered by the indexed-read base charge. `SELF` preserves
its receiver once, not once per visited Table. This surcharge does not count
hash probes or depend on earlier accesses.

For a String key, each visited target that exhausts its hash search without
finding the key adds **one cycle per inspected node after the first**. An
empty hash adds nothing. Finding the key, including a retained key with a nil
value, does not exhaust the search. For a match, the first 64 inspected
nodes are covered; each further node costs one cycle. A match at node 256
therefore adds 192 cycles. The direct search for `__index` is also a String-key search and is
charged separately under the same rule, whatever the requested key type. For example, a missing field
whose chain contains 64 nodes adds 63 cycles even on a Table with no metatable.

An indexed read writes its destination and extends `top` only after obtaining a result, including an ordinary missing-key result of nil. A failed lookup leaves that destination unchanged. For `SELF`, the preceding receiver copy into `R(A+1)` remains visible even if the lookup fails.

An assignment to an existing own mapping writes or deletes it directly.
For a missing mapping, a Table-valued `__newindex` redirects the assignment
to that Table. A function-valued `__newindex` receives the receiver at that
step, the original key and the assigned value. Its results are discarded.
If `__newindex` is absent, the CPU writes the own mapping directly.
Forwarding to a non-Table that cannot be assigned into raises
`ASSIGN_NON_TABLE`. The same 32-Table bound and 8-cycle additional visit
charge apply to assignments. The method invocation and its work are
charged separately from traversing the Tables.


The [BIOS Table and metatable interface](bios-base.md#sec-bios-base-table-and-metatable-access)
specifies `rawget`, `rawset`, `getmetatable` and `setmetatable`. Raw reads bypass
the inherited lookup above; raw writes use the same Table-length rules.

### Language allocation and lifetime {#sec-cpu-language-allocation-and-lifetime}

System and cartridge execution share a language-allocation budget. Its
capacity is the byte count from the active image's page-aligned heap floor to
the start of the runtime management area. Reset uses the system image's floor;
EXEC uses the target image's floor. See
[Reserved and cartridge storage in main RAM](memory.md#sec-memory-reserved-and-cartridge-storage-in-main-ram).
Larger DATA or BSS leaves less capacity. Installed library values and active
execution state already consume some of it at cartridge entry. Charges use
logical byte counts, independent of padding and the placement of blocks in RAM.

The budget covers Table storage, closures and captured-variable cells,
Threads and their reserved value-slot capacity, RAM Strings and their intern
index, the two global namespaces, and activated images' decoded constant
pools and name-to-slot mappings. The ROM copies of the constants and names
do not consume this budget.
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
still exceeds capacity, or no suitably sized contiguous block can be
allocated, it raises the Lua out-of-memory error. If language
error handling does not handle it, the CPU takes a Trap exception with
LuaFaultReason `9` (`OUT_OF_MEMORY`).

A Table or Thread value carries the address of its record in the language heap.
Its identity is that address word, not the contents of the record. The heap's
record layouts are reserved for the language runtime; do not use the area for
buffers. Internal record accesses use a main-RAM offset: a word access masks
the address with `003FFFFCH`, and a byte access with `003FFFFFH`. This does not
mirror ordinary loads, stores or DMA accesses. Plan DATA/BSS and hardware
buffers using the separate byte-storage reservations in [[Memory](memory.md#sec-memory-reserved-and-cartridge-storage-in-main-ram)]{.content-visible when-format="html"}[Book I, §2.3]{.content-visible when-format="pdf"}.
Use addressed byte storage for exact device records and payloads.


#### Language allocation and collection {#sec-cpu-language-allocation-and-collection}

Automatic collection advances incrementally as allocations cross the assist
threshold. It traces and reclaims the same pool regardless of object age.
An explicit step advances that collector. An explicit full collection
finishes before the following instruction executes. An allocation that
requires emergency collection waits for its recovery attempt.

The occupied-byte counts used for admission are:

| Allocation | Occupied budget bytes |
| --- | --- |
| Table with `A` reserved array slots and `H` reserved hash slots | `32 + 5A + 10H` |
| Closure with `U` captured-variable references, function record backed by contiguous ROM | `12 + 4U` |
| Closure with `U` captured-variable references, other mapped function record | `36 + 4U` |
| Captured-variable cell | `16` |
| Thread with `V` reserved Value slots, `F` reserved frame-control records and `P` reserved protected continuations | `80 + 5V + 56F + 20P` |
| RAM String containing `n` bytes | `16 + n` |
| Global namespace with `N` registered names | `9N` |
| Activated image with `C` constants and `G` names across both global namespaces | `5C + 4G` |

Global names remain registered when their Values are set to nil. Writing a
registered name does not add a charge. Space reserved for future names and
the lookup indexes for names and Strings do not contribute to the occupied
budget, including while an index grows. The Strings themselves retain their
addresses during that growth.

Inserting or replacing an entry in already reserved storage adds no charge.
Deleting a mapping, including deletion by collection, leaves the table's
reservation unchanged. Clearing the table releases both reservations.

An insertion that cannot use an existing slot rebuilds the table's storage.
A key that cannot use array storage leaves the array reservation unchanged.
For an eligible positive integer key outside the current array range, a
rebuild selects the largest power-of-two prefix of positive integers for
which more than half the keys are present, including the new key. The hash
reserves the least power of two that holds the remaining entries, or zero
slots if there are none. If allocation recovery clears weak entries,
the insertion can reuse an available slot or retry with a new reservation.

A prefixed `SETFIELD` can reserve space for following field insertions.
Its request applies only when a new non-nil own mapping on the original
receiver needs replacement storage. It adds the prefix's unsigned EXT
value to the number of live hash entries, including the new entry,
before rounding up to a power of two. The array reservation is unchanged.
For example, eight live hash entries, a new field, and an EXT value of
28 request room for 37 entries, so the replacement reserves 64 hash
slots. An overwrite, deletion, insertion into available storage, or
assignment through `__newindex` does not use the request.

The extra slots are a preference. If the preferred replacement exceeds
the language-allocation budget or no free block can hold it, the write
requests the least power-of-two hash capacity needed for the live entries
and the new field. Only the installed capacity is charged. If allocation recovery makes an
existing slot available, the insertion can use that slot without
replacing the storage. No later field is written by this instruction.

A Table keeps its array slots in one allocation and its hash entries and
collision links in another. A hash with more than 64 slots also holds a
word counting its live mappings. From 1,024 slots onward, 32 further words
count its live positive Integer keys by range: key 1, then keys greater than
$2^{i-1}$ and at most $2^i$ for $i=1$ through 31. A deleted entry does not count, even when
its slot is retained for traversal. These counts consume physical storage,
not additional language-allocation budget. Either allocation may be absent. Growing the
hash does not move the array. When the array grows, positive integer keys
that now fit in it move there from the hash. The Table itself retains its
address, including when either allocation must move.

A Thread
keeps its Value slots, frame controls and protected continuations in separate
allocations. Growing one allocation does not move either of the others.
If a call needs both more Value slots and another frame control, both
reservations must succeed before the frame is entered.
Each active frame records the address of its closure, which supplies
the references to its captured-variable cells. It also saves its execution
bank. Resumption restores that bank independently of the current
cartridge socket selector. An executing activation uses the latched bank
until control transfers to another activation; modifying its saved bank
does not switch an instruction fetch already in progress. If there is no
execution image in the resumed bank, the next instruction fetch raises an
instruction bus error. Each frame stores the base and reserved size of
its working register window in the Thread's Value slots. The saved variable-argument
and return windows, the working register window and the live register frontier
use 20-bit slot indices and counts. Their upper bits are not decoded. Slot
transfers use the main RAM address aperture. The Thread record holds the
active frame count and the next free Value slot for a new, separate window.
One count selects the active prefix of the frame area; the other is a
20-bit slot index in the Value area.
Only the active prefix defines frame state. Bytes in the unused frame slots
are reserved scratch; they do not describe suspended activations.
The protected-continuation allocation records a suspended protected call's
caller and result window so it can finish when the Thread resumes. A new
Thread reserves eight Value slots and two frame controls. An ordinary entry leaves
one slot available for exception entry even when no further heap storage can
be admitted. Frame capacity doubles as needed before an entry. The first
protected call reserves one continuation, and a full continuation reservation
doubles before being extended. If the processor cannot admit an exception
activation, it halts rather than recursively raising another exception.
A closure's header and capture references occupy one block. If the function
record is not entirely backed by contiguous ROM, the block also holds
the six function words read at construction. Calling such a closure does not
read the bus for those words again. A RAM String occupies one block containing
its 16-byte header and its bytes. Its byte count is 22 bits. The String
port selects main RAM for the record and uses the 22-bit physical byte
address for its header and bytes; reaching the end of RAM wraps to its start.
An empty backing layout has no charge. When a Table or Thread changes its
reserved capacities, admission considers only the increase in its occupied
bytes. The old and new layouts do not count twice during the transfer. If a
call grows both the Value and frame reservations, their combined increase is
admitted before the call is entered. The reported count can be below capacity
even when there is no suitable free RAM block to satisfy a request.

A reserved Value slot occupies four payload bytes and one kind byte, regardless
of its current value. A reserved hash slot charges room for a key and a Value.
A closure's captured-variable reference occupies four bytes. These fixed sizes apply to
Integer and Float Numbers as well as reference values.
They are capacity charges: replacing one kind with another does not allocate
another slot or change its occupied-byte charge.

The original constants and String bytes remain in the image. The language pool
charges the active image's decoded values and name mapping, not the ROM
records. Only a String constant that resolves to a RAM String retains an
allocation for collection. Numeric values, booleans, nil and references to
ROM Strings do not require heap tracing. This does not change the occupied
budget of the decoded image. The collector compares total occupied language
budget with the assist threshold when starting and advancing marking; growth
in physical occupancy can also advance marking, as described below.

For a full collection, the collector marks retained objects, incrementally
revisits mutable objects and Thread stacks, resolves weak references in a
final atomic remark, and then reclaims unmarked objects and Strings. It
examines the global namespaces during the first pass. Publishing a new
global name or reference during marking keeps the new reference reachable
without rescanning the namespaces in the later passes.
When the second mark pass is underway, writing a strong reference into an
already scanned Table without a metatable, or into a closed captured-variable
cell, marks the new reference instead of scanning the allocation again.
Writes that move Table storage or change its metatable can still require
another scan, since they affect how existing entries are reached. Retained
Thread stacks are examined again before reclamation.
Allocations created during reclamation
survive that collection. An object found reachable earlier in the
cycle may therefore survive until a later collection even if its last
reference has gone.

Marking and reclamation can continue in later steps. The automatic final
remark and weak-entry clearing pause execution between grants; an interrupt
or device deadline cannot occur partway through that pause. The CPU resumes
with its previous cycle budget after this stopped maintenance.

When a write requires a rescan, the allocation joins a queue rather than
immediately restarting the first scan. The second pass revisits Threads
and weak Tables over successive steps before tracing the detached queue.
Rescans requested during that second pass wait for the final remark.
Repeated writes to an already queued object do not add another queue entry.

Incremental collection and allocation recovery do not relocate a surviving
Thread's storage. A requested full collection can halve a surviving Thread's
reserved Value storage. This happens when `V > 16` and three times the required
extent is less than `V`. The required extent includes the Thread's current
stack top and every active frame's complete reserved register window, not only
its live values.
The frame-control and protected-continuation reservations likewise halve when
their reserve exceeds four and three times the active count is less than the
reserve. The three reservations are considered independently. When a
reservation shrinks, the released space leaves the occupied budget. Existing
frame and captured-variable references retain their meaning.

The initial collection threshold is **1 MiB of occupied budget**. A request for
`R` bytes starts collection or assists marking when `B + R` exceeds the current
threshold, where `B` is the occupied budget before admitting the request. The
amount above the threshold is allocation debt. Each ordinary assist does a
bounded amount of collector work, then credits that work against the debt.
Credit beyond the outstanding debt permits more allocation before the next
assist, up to the start of the final eighth of capacity. Unpaid debt makes
subsequent allocations assist again. Within that final eighth, an assist requests
a full work quantum. While the cycle remains active, a full quantum earns
256 bytes above the remaining occupied budget; a partial quantum earns the
corresponding fraction, rounded down. If no work is done, the threshold stays unchanged.
An explicit step sets the threshold to the remaining occupied budget plus
256 bytes while the cycle remains active. When the cycle completes,
let `L` be the remaining occupied budget and `K` the total language-allocation
capacity. The next threshold is:

$$
\max\left(L + 256,\ \min\left(K-\lfloor K/8\rfloor,\ \max(1\ \mathrm{MiB},2L)\right)\right).
$$

The headroom term starts collection before a heavily retained pool fills.
It does not reserve extra capacity or guarantee that new allocations will fit.
Marking and reclamation also follow growth in physical occupancy. Before
reserving storage while either is underway, the collector can do a bounded
amount of work in proportion to the outstanding collection work and the
available space. When marking starts, the work of the previous completed
collection is the estimate, priced against half of the unoccupied space. The
other half remains for growth until the final remark and for reclamation.
After the final remark, the outstanding reclamation work is priced against
the space that is then unoccupied. Work done by any assist, including a
display-tick assist, counts toward this pace. Reservations made while the
final remark is pending do not advance the collection. A logical charge
without a physical reservation does not by itself advance the collection.
Logical capacity still applies throughout the collection.

The collector also compares unoccupied physical heap space with recent
growth in physical occupancy and the remaining collection work. At a
completed display tick, physical pressure can admit one additional quantum
of marking or reclamation. If the CPU is waiting for an interrupt and marking
is already in progress, the allowance is four quanta instead. Work can stop
earlier at a phase boundary. The interrupt wait alone does not start collection
or advance the final remark. The display tick admits the work; the memory
routine then uses ordinary CPU cycles while devices continue to advance.
Interrupt entry waits for the routine to return. A collection started by
physical pressure can finish over later ticks without further allocation.
When scheduled execution resumes with a final remark pending, revisiting
threads and weak tables, scanning roots, tracing, and weak-entry removal also
run on ordinary CPU grants. Free space may be separated by retained
allocations, so enough unoccupied bytes does not guarantee that an allocation
of that size will fit.
The BIOS [collection service](bios-base.md#sec-bios-base-collectgarbage)
can advance it explicitly and report occupied budget and total capacity.

If the fixed logical increase alone exceeds the entire arena capacity, the
request raises out-of-memory without starting or finishing a collection.
A table insertion can change its required increase after weak entries clear;
its proposed capacity is not a fixed request.

If a request could fit but exceeds the remaining logical budget or cannot
reserve the storage it needs, the CPU completes any active cycle and retries
the request. If no cycle was active, or the retry still does not fit, the CPU runs one fresh cycle and
tries the request again. A fresh cycle can remove garbage retained only by an
earlier scan of the interrupted cycle. A request that still cannot fit raises
the out-of-memory error without admitting its bytes. Explicit full collection
always performs the fresh cycle. For a full collection requested through the BIOS,
the CPU admits marking, final remark and reclamation work against successive
cycle grants. Each positive grant admits up to one collection quantum, at
one work word per three cycles, with a minimum allowance of one word. An
indivisible record operation can exceed its allowance. The resident memory
routine marks roots, scans records awaiting tracing, revisits threads and weak
tables, then removes weak entries before reclamation. The sweep
traverses the object inventory, reclaims Table, upvalue, Closure, dead Thread
and String storage, and can shrink the stack of
a retained Thread during a full collection. These operations use ordinary CPU
cycles and are not charged a second time per work word. The rest of the
quantum is charged for the actual work it performs. Device time advances for
both, while interrupt entry and execution of the following instruction wait
until the fresh cycle completes.

If a physical reservation for `NEWT` fails, the allocator frees its partial
reservation before collection. It retries the same request after the permitted
collection cycle. For `NEWT` or a table insertion suspended between attempts,
resident root scanning, tracing, remark visits, weak-entry removal and sweeping
run on ordinary CPU grants: devices continue to advance. The CPU settles any
unpaid cycles already accepted for the issuing instruction before the
routine runs, and does not charge them again on retry. A table insertion
can pause both when its proposed capacity exceeds the remaining logical
budget and when its backing storage does not fit. After collection, the CPU
replans the insertion using the surviving mappings. No table or new mapping
is visible until its reservation succeeds. Interrupt entry and the following
instruction wait until the request completes or raises its error.

When an instruction assists incremental collection to admit a logical charge
or reserve physical storage, it pays **3 cycles per collector work word**
actually performed, not per word requested. Logical and physical
assists each request at most one word per three remaining grant cycles. Fewer
than three cycles defer the assist, not the reservation. An indivisible
scan such as a record header may exceed the requested work. The charge stays
with the instruction even if the reservation later fails or parks. A retry does not
repay completed work. An explicit step or full collection also pays 3 cycles per work word,
including work to finish an already active cycle, except for the ordinary
CPU cycles of the resident routine during a full collection. This also applies when
program replacement requests a collection to free its static region.
In emergency recovery, the issuing instruction pays the same price for any
collector work it performs itself, even if the retry fails. Resident work
run on ordinary grants is not charged a second time. The display-tick assist
also uses its own CPU grants and is not charged to the issuing instruction.
A physical pressure opportunity during timed recovery is deferred until the
pending allocation retires, so it cannot change the
collection-and-retry order.

#### Weak references and collection {#sec-cpu-weak-references-and-collection}

The collector reads a Table's metatable member `__mode` directly, without
invoking `__index`. Exactly `'k'`, `'v'`, `'kv'` and `'vk'` select a weak
mode. A missing member or any other value selects ordinary strong entries.

A change to `__mode` during collection can take effect in that cycle or the
next. In particular, an object already retained by a strong entry need not be
reclaimed in the cycle that makes the entry weak. Weak-entry removal and freed
capacity become observable as collection advances, not at a fixed display frame.

| Mode | Collection effect |
| --- | --- |
| Strong | Entries retain their keys and values. |
| `k` | The key position does not retain collectable objects. The value position still retains its value, including any objects that value refers to. |
| `v` | Keys remain strong; values alone do not retain collectable objects. |
| `kv` or `vk` | Neither side alone retains collectable objects. |

A value in a `k` Table can keep its own key alive by referring to it. Use
`kv` for a cache whose values can refer back to their keys and should not
keep either side alive. When a weak key disappears, the corresponding entry
is removed; its value may survive until a later collection.

Collectable weak entries can refer to Tables, threads and closures, including
closures without captured variables. Numbers, booleans and builtin functions do
not disappear through weak-entry collection. Strings also remain in surviving
weak entries; they are not removed merely because their weak position is their
only reference. Reusing a closure for a static function does not keep that
closure alive solely because it was reused.

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
not their inherited replacements, and can change a weak-value Table's
valid length boundaries when it clears an element.

### Instruction reference {#sec-cpu-instruction-reference}

The following tables describe the decoded operands. `A`, `B`, `C`, and `Bx` name instruction fields, not additional language values. Opcode values use hexadecimal notation (`H`). All costs are base instruction cycles; see **Return result-placement cycles** above and **Builtin call charges** below.


#### Calls and captured values {#sec-cpu-calls-and-captured-values}

| Instruction | Opcode | Operands | Result or effect | Base cycles |
|---|---:|---|---|---:|
| `CALL` | `2FH` | `A, B, C` | Call the closure or builtin in `R(A)` with arguments beginning at `R(A+1)`. `B=0`: use the open argument range; otherwise supply `B-1` arguments. `C=0`: accept all results; otherwise accept exactly `C-1`, truncating or nil-padding. Results begin at `R(A)`. | 32 |
| `RET` | `30H` | `A, B` | Close the frame's open upvalues and return values beginning at `R(A)`. `B=0`: produce the open range; otherwise produce exactly `B-1` values. | 16 |
| `VARARG` | `2EH` | `A, B` | Copy saved varargs beginning at `R(A)`. `B=0`: copy all; otherwise copy exactly `B-1`, padding with nil. | 3 |
| `CLOSURE` | `2BH` | `A, Bx`, register-address flag | Construct a closure in `R(A)`. Flag clear: function record at `Bx × 16`. Flag set: address supplied by `R(Bx)`. Capture according to the record's upvalue descriptors. | 8 |
| `GETUP` | `2CH` | `A, B` | `R(A) = upvalue(B)` of the current closure. | 3 |
| `SETUP` | `2DH` | `A, B` | `upvalue(B) = R(A)` in the current closure. | 4 |




#### Global namespaces {#sec-cpu-global-namespaces}

| Instruction | Opcode | Operands | Result or effect | Base cycles |
|---|---:|---|---|---:|
| `GETGL` | `38H` | `A, Bx` | Load into `R(A)` the ordinary global selected by ordinary-global image name index `Bx`. | 3 |
| `SETGL` | `39H` | `A, Bx` | Store `R(A)` into the ordinary global selected by ordinary-global image name index `Bx`. | 4 |
| `GETSYS` | `36H` | `A, Bx` | Load into `R(A)` the system global selected by system-global image name index `Bx`. | 3 |
| `SETSYS` | `37H` | `A, Bx` | Store `R(A)` into the system global selected by system-global image name index `Bx`. | 4 |




#### Tables and field lookup {#sec-cpu-tables-and-field-lookup}

| Instruction | Opcode | Operands | Result or effect | Base cycles |
|---|---:|---|---|---:|
| `GETT` | `0EH` | `A, B, C` | `R(A) = index(R(B), RK(C))`. | 16 |
| `SETT` | `0FH` | `A, B, C` | `index(R(A), RK(B)) = RK(C)`. | 16 |
| `GETI` | `3AH` | `A, B, C` | `R(A) = index(R(B), C)`. `C` is the integer key itself. | 8 |
| `SETI` | `3BH` | `A, B, C` | `index(R(A), B) = RK(C)`. `B` is the integer key itself. | 8 |
| `GETFIELD` | `3CH` | `A, B, C` | `R(A) = index(R(B), K(C))`, where `K(C)` supplies the string key. | 16 |
| `SETFIELD` | `3DH` | `A, B, C` | `index(R(A), K(B)) = RK(C)`, where `K(B)` supplies the string key. | 16 |
| `SELF` | `3EH` | `A, B, C` | Preserve original `R(B)` in `R(A+1)`, then set `R(A) = index(original R(B), K(C))`, where `K(C)` supplies the string key. | 17 |
| `NEWT` | `10H` | `A, B, C` | Put a new table in `R(A)`, with array-capacity request `B` and hash-size request `C`. | 24 |

`NEWT` has a base charge of 24 cycles whether the construction succeeds or fails.
The capacity requests determine the storage reservation against the
language-allocation budget; they do not change that base charge. The resident
memory routine reserves the table record and any requested array and hash
storage, then initializes them, all using ordinary CPU cycles in addition
to the base charge. The routine can continue across cycle grants while
devices advance. The table becomes visible in the destination register only
after all of its storage is ready. A retry pays for its own reservation work without
paying the base charge again.

An insertion may reserve more storage. Its base charge does not depend on
whether the current storage can hold the mapping, or on how entries are
arranged or moved. A `SETFIELD` prefix request does not change this charge.
When an indexed store must repartition a table to insert a positive Integer
key, it scans the existing array slots to choose the new array size. The first
64 slots of each such scan are included; each further group of four slots,
including a partial group, costs one cycle. A scan of 65,536 slots adds
16,368 cycles. For arrays of at least 1,024 slots, a grant that cannot pay
for the whole scan counts only the slots it covers. The next grant resumes
at the next tag. This is execution of the same store, not an allocation
park: no replacement is reserved until the scan finishes. A reservation
refusal after that point enters ordinary allocation recovery. Collection at
tick boundaries and stopped final remark wait while the scan is in progress.

For a positive Integer key, a hash smaller than 1,024 slots is also scanned: the first 64 slots are included, then each pair costs one
cycle. The largest such scan (512 slots) adds 224 cycles. From 1,024 slots
onward, the processor reads the Integer range counts instead. A hash-only
addition uses the live count above 64 slots. An overwrite or an insertion that fits an
existing slot performs neither scan. A store through `rawset` pays the same
scan charges. A failed reservation does not refund a completed
scan; a recovery attempt that scans again pays for its own work.
When an insertion replaces a hash with more than 64 **old** slots and
either leaves array capacity unchanged or creates the first array backing, the store continues across cycle grants.
It initializes 16 replacement bytes per cycle (rounding the final group up)
and visits each source slot at eight cycles per visit to establish the home
positions. If any entries collide, it visits the source again until the last
collision is placed. Each such visit costs eight cycles, including a repeated
visit when the next free-slot candidate is occupied. A started visit finishes
even if fewer than eight cycles remain.

When growth moves an existing array of at least 1,024 slots to a different
block, the processor transfers 16 destination bytes per cycle. Each retained
payload and tag goes to its position in the larger array; new slots are
initialized to nil. The old array stays attached until publication. A hash
that needs no repartitioning keeps its block and links; otherwise its
replacement proceeds under the same cycle grants. When an array of at least
1,024 slots grows within its existing block, retained payloads stay in place.
The processor moves the retained tags and clears the new payloads and tags at
the same 16 bytes per cycle. A reset during this in-place operation finishes
the store before entering the reset program.

When an array of at least 1,024 slots shrinks, the store transfers the
non-nil entries beyond its new end to the replacement hash. Each placement
pass visits old hash slots first, then the disappearing array slots in
ascending index order. Each run of nil array slots costs one cycle per
four slots, rounding the last group up. Other visits use the eight-cycle
hash placement charge. After placement, the processor moves the retained
tags at 16 bytes per cycle and releases the unused storage. A reset before
the first retained tag moves discards the pending shrink; a reset after that
point finishes it before entering the reset program.

The old hash remains attached until the replacement is complete. The processor
then publishes the insertion before issuing another instruction or accepting
an interrupt. Guest time advances during the replacement; this is not an
allocation park. Collection at tick boundaries and stopped final remark wait
until publication. These charges also apply to a raw store.

Storage growth counts separately against the language-allocation budget. A metamethod invocation pays its ordinary call charge separately.
An incremental allocation assist adds its work charge as specified above. An insertion that
fails to reserve storage leaves the requested mapping unmodified.

### Builtin call charges {#sec-cpu-builtin-call-charges}

CALL costs 32 base cycles. A primitive target adds its own base charge of 1, 2
or 4 cycles. Its completed receiving ranges also incur the value-placement
charges above; discarded scratch results do not.
String construction charges the input work specified in the String reference. Installed
BIOS functions can execute ordinary instructions and call further primitives,
so include the executed sequence when budgeting the whole service. The
[BIOS base](bios-base.md#sec-bios-base), [String](bios-string.md#sec-bios-string) and
[protected-call/coroutine](coroutines.md#sec-coroutines) references identify their primitive
surcharges and error behavior.

## Worked values: signed zero and inherited fields {#sec-cpu-worked-values-signed-zero-and-inherited-fields}

Use runtime operands when the distinction between Number values matters:

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

The first group produces negative zero, positive zero and negative infinity.
The reciprocal exposes the sign that an equality comparison cannot distinguish.
The POW reference above covers infinities, NaNs, represented exponent parity
and subnormal results; these rules also apply to runtime operands.

Additional runtime-operand examples follow directly from the POW reference:

| Expression | Result |
| --- | --- |
| `(-0.0)^3`, `(-0.0)^0.5` | Negative zero, positive zero |
| `(-0.0)^(-3)` | Negative infinity |
| `(-infinity)^0.5`, `(-infinity)^(-3)` | Positive infinity, negative zero |
| `(-1)^infinity`, `(-2)^0.5` | 1, NaN |
| `NaN^0` | 1 |
| `(-1)^16777215` | −1 |
| `(-1)^16777217` | 1, because the Integer exponent rounds to binary32 |
| `2^(-149)` | Smallest positive subnormal Float |
| `(-2)^(-151)` | Negative zero |

Here infinity and NaN denote Number operands, not additional source keywords.

The second group produces `42`, `9`, then `42`. The inherited read does not
create an own mapping. Assigning `nil` removes the own mapping and exposes the
parent again. `rawget(child, 'answer')` is then `nil`. An `__index` function
can compute a missing value instead; see
[Metatables and indexed reads](#sec-cpu-metatables-and-indexed-reads).

## Memory transfers {#sec-cpu-memory-transfers}

Memory instructions transfer numeric scalars between frame registers and
byte-addressed storage. Word and U32LE loads preserve the complete word in an
Integer Number. Floating loads interpret the stored IEEE bit pattern. The
format selector determines the byte width and conversion in the following
table.


### Scalar formats {#sec-cpu-scalar-formats}


The `C` operand of a scalar load or store selects one of six formats:

| `C` | Format | Bytes | Loaded register value | Store conversion | Required address alignment |
|---|---|---:|---|---|---:|
| 0 | `Word` | 4 | Integer with the 32 loaded bits | Store the low 32 integer bits | 4 bytes |
| 1 | `U8` | 1 | Integer Number, 0–255 | Store the low 8 integer bits | 1 byte |
| 2 | `U16LE` | 2 | Integer Number, 0–65535 | Store the low 16 integer bits | 2 bytes |
| 3 | `U32LE` | 4 | Integer with the 32 loaded bits | Store the low 32 integer bits | 4 bytes |
| 4 | `F32LE` | 4 | Float decoded from IEEE binary32 | Convert the Number to binary32 and store its bits | 4 bytes |
| 5 | `F64LE` | 8 | Float decoded from binary64 and rounded to binary32 | Encode the Number as binary64 | **4 bytes** |



All multi-byte formats are little-endian: the least significant byte occupies
the lowest address. `Word` and `U32LE` transfer the same data bits, but
identify the access differently in bus-fault metadata. `FFFFFFFFH` loads as
Integer −1, and storing it writes the same word. The `F64LE` format is an
external data representation, not a double-precision Number subtype: loading
rounds its value to binary32. Storing an Integer or Float encodes its exact
finite value as binary64. An F32LE Float load or store copies its 32-bit word,
including NaN payloads and either zero sign. F64LE conversion does not promise preservation of NaN
payload bits; a converted NaN load produces `7FC00000H`.

A scalar load or store with C greater than 5 is a reserved instruction. It
raises `ReservedInstruction` (exception code 10, Cause `00000028H`) with EPC at
the instruction start, before address conversion, alignment checks or a data
access. BadAddress and the Memory fault record are unchanged. The normal
three-cycle base charge still applies. In counted word stores, C is a word count,
not a scalar-format selector.

Address conversion and integer-store conversion use an Integer's raw bits.
For a finite Float, they truncate toward zero and retain the low 32 bits.
A non-Number, NaN or infinity raises `INVALID_ARGUMENT` (10) for these
conversions. A floating store accepts either Number subtype and raises the
same exception for a non-Number. A fractional address is converted before its
alignment is checked.

`F64LE` is two ordered 32-bit transfers, not one indivisible eight-byte transfer. The low half is accessed at the starting address, then the high half four bytes later. Four-byte alignment is sufficient; eight-byte alignment is not required.

### Address operands {#sec-cpu-address-operands}

The ordinary forms, `LOAD_MEM`, `STORE_MEM`, and `STORE_MEM_WORDS`, obtain their starting byte address from `RK(B)`. A nonnegative `B` selects register `B`; a negative `B` selects constant `-1-B`. The selected value is converted to an unsigned 32-bit address.

The displacement forms, whose names end in `_D`, always use register `B` as the base:

`address = (u32(R[B]) + 4 × disp) modulo 2^32`

Here `disp` is the instruction's **unsigned eight-bit word displacement**, from 0 through 255. It reaches byte offsets 0 through 1020. It is neither signed nor extended by `WIDE`. A negative displacement therefore cannot be expressed by setting the top displacement bit. `WIDE` can extend the other operand fields without extending this displacement.

### Scalar access and IO {#sec-cpu-scalar-access-and-io}

Scalar loads check alignment before attempting a memory access. If a new bus fault occurs during the read, the destination register is not changed. This does not undo a read or a device side effect that has already occurred.

Scalar stores check alignment, then ask whether the mapped starting address is ready for a write. This readiness check precedes reading and converting the source register for the write. If the target is not ready, no store takes place: the instruction is left blocked on that raw target address. A matching ready event clears the blocked condition. The CPU retains the decoded operation, effective address and successor PC while waiting; it resumes that operation without fetching it again or charging its base cost a second time. A write to its instruction words during the wait affects a later execution, not the retained operation. Readiness is checked only at the starting address, including for `F64LE`.

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

Each register is converted to a raw 32-bit word by the conversion above. The starting address must be four-byte aligned, even when `C` is zero. A zero count otherwise performs no writes and adds no sequence surcharge.

Before writing anything, the instruction scans the counted span's IO overlap in increasing address order and waits on the first not-ready word. This preflight happens before the sequence surcharge as well as before any write. Consequently, a later not-ready IO word can defer the instruction before an earlier word would otherwise commit or fault. The readiness span is computed without 32-bit wrap; the actual write addresses wrap modulo `2^32`. Do not treat this as readiness preflight for IO reached only by wrapping into low addresses.

Once preflight succeeds, the instruction charges one additional cycle per
counted 32-bit word: `C` cycles. It converts and attempts the words in
increasing `i` order, checking for a new bus fault after every word. A
source outside the frame or an invalid Number conversion raises
`INVALID_ARGUMENT`; a new bus fault raises
`DataBusError`. Either stops the sequence. Earlier successful words remain
written; later words are not attempted. The full sequence surcharge has
already been charged even if a later word faults.

A blocked attempt writes nothing. The CPU retains the decoded span and its
effective start address; a matching ready edge repeats the readiness preflight,
then continues the retained instruction without another fetch or base charge.
After writes begin, the first new bus fault terminates the sequence with its
completed prefix retained. Arrange output and recovery around those ordered
partial effects.

### Memory instruction reference {#sec-cpu-memory-instruction-reference}


`read_C(address)` below means a read in the scalar format selected by `C`. `u32` denotes the conversion described above, not serialization of a language value. The common alignment, readiness, fault, and partial-effect rules apply to every applicable row. Costs are nominal base charges plus the stated surcharge; execution-budget, prefix, and retry accounting follow the CPU execution rules.

| Opcode | Instruction and operands | Effect | Nominal cost |
|---|---|---|---:|
| `04H` | `LOAD_MEM_D A, B, C, disp` | Load `read_C((u32(R[B]) + 4×disp) mod 2^32)` into `R[A]`; leave `R[A]` unchanged on a new bus fault | 3 |
| `0CH` | `STORE_MEM_D A, B, C, disp` | Store `R[A]` in scalar format `C` at `(u32(R[B]) + 4×disp) mod 2^32` | 3 |
| `0DH` | `STORE_MEM_WORDS_D A, B, C, disp` | Starting at `(u32(R[B]) + 4×disp) mod 2^32`, store `C` consecutive unsigned words from `R[A]` onward | `3 + C` after successful readiness preflight |
| `31H` | `LOAD_MEM A, B, C` | Load `read_C(u32(RK(B)))` into `R[A]`; leave `R[A]` unchanged on a new bus fault | 3 |
| `32H` | `STORE_MEM A, B, C` | Store `R[A]` in scalar format `C` at `u32(RK(B))` | 3 |
| `33H` | `STORE_MEM_WORDS A, B, C` | Starting at `u32(RK(B))`, store `C` consecutive unsigned words from `R[A]` onward | `3 + C` after successful readiness preflight |



An `F64LE` scalar load or store adds two cycles to the listed base charge for
its second word transfer. This format surcharge is charged once when the
instruction starts, including when it later blocks or faults. Neither this
cost nor the counted-store surcharge specifies a device's electrical bandwidth.

## Branches {#sec-cpu-branches}

Branch conditions use value truth. Only Nil and False are false. Numeric zero, numeric NaN, the empty string, and all other language values are true.

The signed `BX` displacement is measured in four-byte instruction words. A branch target is:

`target = (instruction-start PC + full instruction byte width + 4 × signedBX) modulo 2^32`

The full instruction width includes a `WIDE` prefix when present. Thus the displacement is relative to the byte immediately after the complete branch instruction, not its first word. `BX` is signed 20-bit without `WIDE` and signed 26-bit with it. A conditional branch that is not taken continues at the already selected sequential PC.

A closing `JMP` charges one additional cycle per upvalue closed. The closed cell
keeps the value held in the register at the time of the branch. A zero
displacement closes the selected cells and continues at the next instruction.


The branch itself performs no target-memory read or target-alignment check. Fetching at the resulting PC is a separate step governed by the instruction-fetch rules.

| Opcode | Instruction and operands | Effect | Nominal cost |
|---|---|---|---:|
| `28H` | `JMP A, BX` | If `A` is nonzero, close the current frame’s open upvalues from `R(A-1)` upward; then assign the target to PC | 2 |
| `29H` | `JMPIF A, BX` | Assign the target to PC if `R[A]` is true; otherwise continue sequentially | 2 |
| `2AH` | `JMPIFNOT A, BX` | Assign the target to PC if `R[A]` is false; otherwise continue sequentially | 2 |



## Cycle accounting and execution boundaries {#sec-cpu-cycle-accounting-and-execution-boundaries}

The instruction tables give **base charges**, not whole-program transfer rates.
Each executed instruction's base charge includes one cycle for instruction
supply. This is a uniform allowance, not a prediction of individual cache
hits, misses or refill intervals. A base charge is fixed for its opcode: prior
accesses, aliases, module origin and arithmetic special cases do not select a
different price. Only the additional work and readiness waits specified here
are added. Ordinary Table lookup has no per-hash-probe surcharge; Table-valued
`__index` traversal adds the visited-Table work specified above. Table and String LEN have
no surcharge for finding the length.
When an instruction starts, PC advances over its complete width
and its base charge is incurred. Privilege, address alignment and write-ready
handling occur after that base charge. A blocked store retains that charge;
resuming it on the matching ready edge does not incur the base charge again.
A supervisor-cancelled operation is different: a later execution starts a new
instruction and pays its ordinary charge.

For example, a two-cycle `LOADK` followed by a successful three-cycle ordinary
RAM `LOAD_MEM` has a combined base charge of five cycles. Device events do
not change those base charges. A store whose
destination is not ready follows the [write-ready and continuation rules](#sec-cpu-scalar-access-and-io).
Eight-byte and counted accesses retain their specified ordered, potentially
partial bus effects; their base charge does not make them atomic.

Use the complete instruction charge when calculating a straight-line sequence.
Use device status and interrupt protocols for synchronization, rather than
assuming that a device request interrupts a partially executed instruction.
Instruction costs do not specify one universal request-to-handler delay.
Device edges still occur at their scheduled times while the CPU uses these
cycles. An instruction whose charge spans several vertical blanking intervals
does not suppress any of their display edges or armed input samples.

### Selected instruction base charges {#sec-memory-selected-instruction-base-charges}

The CPU/system timebase is **33,868,800 cycles per second**. The following
are selected instruction base charges, not a complete timing table:

| Instruction | Base charge |
| --- | --- |
| Scalar `LOAD_MEM` and `STORE_MEM` | 3 cycles; F64LE adds 2 |
| Scalar displaced forms `LOAD_MEM_D` and `STORE_MEM_D` | 3 cycles; F64LE adds 2 |
| `ADD`, `SUB`, `MUL` | 2 cycles |
| `DIV` | 32 cycles |
| `FLOORDIV` | 33 cycles |
| `MOD` | 34 cycles |
| `POW` | 128 cycles |
| `GETT`, `GETFIELD`, `SETT`, `SETFIELD` | 16 cycles |
| `GETI`, `SETI` | 8 cycles |
| `SELF` | 17 cycles |
| `NEWT` | 24 cycles |
| `CLOSURE` | 8 cycles, plus bound upvalue descriptors |
| `CALL` | 32 cycles, plus placed values |
| `RET` | 16 cycles, plus placed values and closed captures |
| `WIDE` prefix | 0 cycles |

A `WIDE` instruction uses its body's base charge; the prefix does not add
another base charge. These charges do not specify the cost of a source
expression, total program execution time, or sustained memory bandwidth.

The accounting rules above define instruction charges, retries and additional work; the
[memory instruction reference](#sec-cpu-memory-instruction-reference) gives the complete
transfer-instruction table. [[DMA — Transfer timing](dma.md#sec-dma-transfer-timing-and-sharing-the-bus)]{.content-visible when-format="html"}[Book I, §4.7]{.content-visible when-format="pdf"} supplies endpoint rates, burst and tail budgets, contention and GPU transport examples; CPU instruction charges are not DMA transfer rates.

### Additional work and waiting {#sec-cpu-additional-work-and-waiting}


A scalar memory instruction costs 3 base cycles, including either four-byte or
eight-byte numeric formats. A counted store adds `C` cycles, one per 32-bit word, only after its
write-ready preflight succeeds. These are instruction charges, not an
electrical memory-bus bandwidth specification.

| Counted words | Base | Sequence surcharge | Instruction total after ready preflight |
|---:|---:|---:|---:|
| 0 | 3 | 0 | 3 |
| 1 | 3 | 1 | 4 |
| 4 | 3 | 4 | 7 |
| 5 | 3 | 5 | 8 |


The comparison skip, full-width branch and counted-store examples concern
instruction charges, not a completed graphics or audio job. A builtin call has
its additional builtin charge; device-specific command work and completion
remain in the unit chapter.

A blocked store writes nothing while it waits for the owning device's matching
ready edge. The CPU does not repeatedly execute the store while waiting. The ready edge resumes the retained operation before a pending IRQ is accepted. Supervisor entry may cancel a store that has not yet been accepted; exception return then fetches that instruction again.
Console devices continue operating during this wait, IRQ HALT and CPU-held intervals.
A HALT therefore has neither a fixed elapsed
length nor the meaning of stopping every console device. The IRQ chapter
supplies the pending/mask/acknowledgment and accepted-interrupt conditions.

## CPU reset and program replacement {#sec-cpu-cpu-reset-and-program-replacement}

At CPU reset, Status is `00000001H`; Cause, EPC, BadAddress, LuaFaultReason and
the exception-domain word are zero. Retained pre-NMI report words are also
zero. Interrupt-wait, blocked-store, hard-halt and pending interrupt states are
cleared. The CPU discards the active call stack, initializes the runtime
management area, sets the language-heap floor from the system image
([[Memory — Language heap](memory.md#sec-memory-language-heap)]{.content-visible when-format="html"}[Book I, §2.3.1]{.content-visible when-format="pdf"}) and enters the system startup
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
record lacks STATIC, or when its target's static storage would cover
language-heap storage still in use. Execution and interrupt acceptance stop
until reset.
HALT, in contrast, is a resumable interrupt wait.

Misaligned instruction addresses and mapped instruction-read faults take the
address-error or instruction-bus-error exception route. The scalar-memory
reference separately defines ReservedInstruction for unsupported format fields.

## CP0 and execution control {#sec-cpu-cp0-and-execution-control}

CP0 holds exception and privilege state. Current privilege comes from **Status bit 1**, not from the identity of the currently selected image. A clear bit means supervisor mode; a set bit means user mode. Status bit 0 is the current interrupt-enable bit. System entry initializes Status to 1; cartridge entry initializes it to 3.

`MFC0`, `MTC0`, and `RFE` require supervisor mode. In user mode they raise coprocessor-unusable before selecting a CP0 field, converting a source value, or checking whether `RFE` has an exception frame. `HALT`, branches, and the memory instructions have no corresponding current-mode check.

### CP0 fields {#sec-cpu-cp0-fields}


For `MFC0` and `MTC0`, `A` names the value register and `B` is the raw CP0 field number, **not an RK operand**. These instructions do not use `C`.

| Field number | Name | `MFC0` result | `MTC0` effect in supervisor mode |
|---:|---|---|---|
| 8 | `BadAddress` | Raw word as an Integer | Ignored |
| 9 | `LuaFaultReason` | Raw word as an Integer | Ignored |
| 12 | `Status` | Raw word as an Integer | Replace the complete word, without masking |
| 13 | `Cause` | Raw word as an Integer | Ignored |
| 14 | `EPC` | Raw word as an Integer | Replace the complete word, without an alignment check |
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

In supervisor mode, `RFE` requires the current frame to be an exception frame; otherwise it hard-halts. It samples the active EPC, closes the exception frame's open upvalues, and removes that frame together with its register and saved variable-argument slots.

`RFE` replaces Status bits 0–3 with the former bits 2–5, retaining the higher bits. If a caller remains, its PC is assigned the sampled EPC. Writing EPC before `RFE` changes this return target. For mapped code the
next instruction fetch checks it in the ordinary way. For a published
function, the return target must be an instruction start in the caller's
body. A misaligned target produces an instruction-address exception;
another target outside that set produces an instruction-bus exception.
This rejection costs the failed-fetch cycle and does not issue a bus read.

Returning from an NMI-marked exception frame also restores the retained pre-NMI Cause, EPC, BadAddress, LuaFaultReason, and exception-domain words. The return PC still comes from the active EPC sampled before that restoration. The retained pre-NMI Status word is not restored wholesale.

### EXEC {#sec-cpu-exec}

Writing `EXEC` supplies a **function-record address**, not an instruction-entry address. The record is read on the CPU bus and must identify a static function; otherwise execution hard-halts.

Before reading the record, `EXEC` sets the language-heap floor from the target image's static storage ([[Memory — Language heap](memory.md#sec-memory-language-heap)]{.content-visible when-format="html"}[Book I, §2.3.1]{.content-visible when-format="pdf"}). A record address in system ROM selects the system image, and one in the cartridge window selects the image in the selected socket; a record elsewhere keeps the active image's floor. Lowering the floor always succeeds. If raising it would cover heap storage still in use, `EXEC` first completes a full collection. If storage below the new floor is still in use, execution hard-halts before any instruction of the target runs, so none of its DATA or BSS has been written. A floor change applies to the system bus at once. Lowering the floor removes the newly covered range from the bus; raising it makes the released range available, with its current contents. This applies to instruction fetch and data transfer alike.

When the [system image supplies a heap-service descriptor](program-images.md#sec-memory-blua32-executable-image),
the floor operation runs in the resident firmware and consumes ordinary
processor cycles. Both the old program and entry into the target wait while
the service is running. Device time advances and interrupt requests remain
pending; an interrupt handler does not enter during the transfer. The
cartridge socket is selected when `EXEC` begins. The old bus limit holds
until the new floor is admitted. If the first attempt refuses the new
floor, the processor completes a full collection and calls the service
once more before admitting or refusing the transfer.

A successful `EXEC` clears the active call stack, selects the function's image, and starts the static function with zero arguments. It clears HALT, retained-interrupt-event, blocked-write and hard-halt state. The new Status is 3 if the selected execution-domain ID is nonnegative, or 1 otherwise. `EXEC` replaces execution: it is neither an ordinary function call with a saved return point nor an exception return.

### HALT {#sec-cpu-halt}

`HALT` is available in user mode as well as supervisor mode. If an interrupt event is already retained, it consumes that event without creating a HALT condition. Otherwise it records the active thread and current frame depth; the HALT condition matches only while both still match. This is an IRQ-wait latch, not a program busy loop or a request for a fixed elapsed duration. Interrupt acceptance and wake scheduling follow the interrupt rules.


### Control instruction reference {#sec-cpu-control-instruction-reference}

| Opcode | Instruction and operands | Effect | Nominal cost |
|---|---|---|---:|
| `26H` | `MFC0 A, B` | Supervisor only: copy CP0 field `B` into `R[A]` as an Integer with the same raw word bits; EXEC reads zero; unknown fields hard-halt | 2 |
| `27H` | `MTC0 A, B` | Supervisor only: convert `R[A]` to an unsigned word and apply the CP0 field's write behavior; EXEC replaces execution; unknown fields hard-halt | 2 |
| `34H` | `RFE` | Supervisor only: return from the current exception frame using active EPC and the Status restoration above; a non-exception frame hard-halts | 2 |
| `3FH` | `HALT` | Consume a retained interrupt event, or record the current thread/frame-depth HALT condition | 2 |

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
