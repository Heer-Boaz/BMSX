# BLua programs {#sec-blua-programs}

> TO CODEX/CLAUDE/GEMINI/GROK/ETC, READ THIS AND CONSIDER THE FOLLOWING CAREFULLY!!
> NEARLY ALL OF THE CONTENT IN THIS CHAPTER IS PROOF THAT THE BLUA-COMPILER AND INTERPRETER HAVE BEEN INCORRECTLY IMPLEMENTED IN SOME WAY. ONLY THE REAL EXTENSIONS ARE CORRECTLY DESCRIBED (e.g. structs, typed address selection, interrupt wait segment, augmented assignments, unary `&` on a String, named-member `->`), BUT THE REST ARE ALL INCORRECT IMPLEMENTATIONS AND SHOULD BE FIXED INSTEAD OF BEING REGARDED AS A CONTRACT! BLUA SHOULD FOLLOW THE LUA-STANDARDS STRICTLY AND NOT DEVIATE FROM THEM (EXCEPT FOR THE REAL EXTENSIONS).

BLua is Lua with extensions for programming the BMSX: modules linked when the
program is built, static storage with fixed byte layouts, typed access to
memory, direct access to memory and control registers, and waiting for
interrupts. This chapter describes the extensions and the points where BLua
differs from Lua. For the Lua language itself, see the
[Lua documentation](https://www.lua.org/docs.html).

Device registers are described in the hardware chapters, the BIOS functions in
the BIOS chapters, the instructions in the [CPU reference](cpu.md#sec-cpu).
Text compiled while the program runs uses the smaller language of
[runtime compilation](bios-loader.md#sec-bios-loader).

## Extensions {#sec-blua-programs-blua-extensions}

| Extension | Forms | Section |
| --- | --- | --- |
| Modules | `module<entry>`, `module<const>`, `require`, `<init>` | [Modules](#sec-blua-programs-module-modes-static-imports-and-init) |
| Static storage | `struct`, `bss`, `data`, `rodata` | [Storage](#sec-blua-programs-typed-storage-layouts-and-address-views) |
| Typed access | `local p: *type`, `*p`, `p.field`, `p[i]`, `&`, `sizeof`, `offsetof`, `#` | [Views](#sec-blua-programs-views-selection-and-byte-addresses) |
| Memory access | `mem`, `mem8`, `mem16le`, `mem32le`, `memf32le`, `memf64le` | [Memory access](#sec-blua-programs-byte-addressed-memory-maps) |
| Control registers | `cop0.…` | [cop0](#sec-blua-programs-control-registers-cop0) |
| Intrinsics | `blua32.closure`, `blua32.float_bits`, `blua32.float_from_bits`, `blua32.trace`, `blua32.trace_sink` | [blua32](#sec-blua-programs-intrinsic-calls-blua32) |
| Interrupt wait | `halt_until_irq` | [halt_until_irq](#sec-blua-programs-interrupt-waiting-halt_until_irq) |
| Augmented assignment | `+=`, `-=`, `*=`, `/=`, `%=`, `^=` | [Augmented assignment](#sec-blua-programs-augmented-assignment) |
| Operators | `&` on a String, `->` | [`&`](#sec-blua-programs-unary-storage-address-or-string), [`->`](#sec-blua-programs-named-members-with) |

## Static storage {#sec-blua-programs-typed-storage-layouts-and-address-views}

Static storage is a range of bytes at a fixed address: for buffers, records
for a device, and tables of constants. A Lua table holds values, not bytes at
an address; use static storage when a device or a format requires bytes.

### Sections {#sec-blua-programs-choosing-a-storage-section}

| Declaration | Storage | Initial contents |
| --- | --- | --- |
| `bss name: type` | RAM | Zero |
| `data name: type = value` | RAM | Copied from ROM at startup |
| `rodata name: type = value` | ROM | Fixed |

```lua
bss scratch: u8[16]
bss total: word
data counter: word = 3
rodata levels: u16[] = { 10, 20, 30 }
rodata title: string = "ready"

*total = *counter
local previous = *counter
*counter = previous + 1
```

`previous` and `*total` are 3, `*counter` is 4. The name of a storage object
is its address: `counter` is the address, `*counter` the word stored there.
A storage name cannot be assigned to.

The startup routine copies DATA and clears BSS before the modules are
initialized; see [startup](program-images.md#sec-memory-when-initialization-occurs).
Each declaration starts at the alignment of its type and is followed by
padding to 4 bytes: two `u8` declarations are not adjacent. Use an array or a
struct where the spacing matters. Place the sections outside the
[[BIOS area](memory.md#sec-memory-reserved-and-cartridge-storage-in-main-ram)]{.content-visible when-format="html"}[Book I, §2.3]{.content-visible when-format="pdf"}.

## Example: copying records {#sec-blua-programs-worked-static-storage}

### Program {#sec-memory-worked-example-prepare-and-copy-two-records}

Two records in ROM are copied to RAM, and a counter is increased:

```lua
module<entry>
struct memory_sample
    tag: u8
    value: word
    samples: u16[2]
end
rodata inputs: memory_sample[2] = {
    { tag = 0x11, value = 0x12345678, samples = { 0x1122, 0x3344 } },
    { tag = 0x22, value = 0x9abcdef0, samples = { 0x5566, 0x7788 } },
}
data counter: word = 0x12345678
bss output: memory_sample[2]
local source<const>: *memory_sample = inputs
local destination<const>: *memory_sample = output

for index = 0, #inputs - 1 do
    destination[index].tag = source[index].tag
    destination[index].value = source[index].value
    destination[index].samples[0] = source[index].samples[0]
    destination[index].samples[1] = source[index].samples[1]
end
*counter = *counter + #inputs
```

### Layout {#sec-memory-record-indexing-is-not-byte-arithmetic}

| Field | Offset | Bytes |
| --- | ---: | ---: |
| `tag` | 0 | 1 |
| Padding | 1 | 3 |
| `value` | 4 | 4 |
| `samples` | 8 | 4 |

A record is 12 bytes, aligned to 4; each array is 24 bytes. Indices start at
0: `&source[1]` is `inputs` + 12, `&source[0].value` is `inputs` + 4,
`&source[1].samples[1]` is `inputs` + 22.

### Result {#sec-memory-resulting-bytes}

| Offset | Word | Contents |
| ---: | --- | --- |
| 0 | `00000011H` | Tag 1 and padding |
| 4 | `12345678H` | Value 1 |
| 8 | `33441122H` | Samples 1 |
| 12 | `00000022H` | Tag 2 and padding |
| 16 | `9ABCDEF0H` | Value 2 |
| 20 | `77885566H` | Samples 2 |

The padding stays 0 from BSS. The counter becomes `1234567AH`: `#inputs` is
the number of records, 2.

### Device registers {#sec-memory-typed-byte-storage-and-address-views}

A view can also be placed on I/O registers:

```lua
local dma0<const>: *word = 0x0800000c
local remaining = dma0[2]
```

`dma0[2]` reads the register at `08000014H` (TRANSFER_COUNT). `dma0 + 2`
is the byte address `0800000EH`. Do not change a buffer that a device is
still reading; see
[[DMA buffers](memory.md#sec-memory-dma-buffer-lifetime)]{.content-visible when-format="html"}[Book I, §2.10]{.content-visible when-format="pdf"}.

### Values and storage {#sec-memory-language-execution-storage-and-byte-ram}

Variables and tables are kept in
[BLua storage](blua-system.md#sec-blua-system-blua-storage),
which has no bus address; calls use the
[CPU registers](cpu.md#sec-cpu-calling-and-returning-values). Only static
storage has an address that can be given to a device.

#### Loading and storing {#sec-memory-values-are-not-byte-buffers}

A load gives a number in the format of the type; a store writes the number
in that format. See
[[scalar access](memory.md#sec-memory-scalar-memory-accesses)]{.content-visible when-format="html"}[Book I, §2.7]{.content-visible when-format="pdf"}.

#### Addresses as arguments {#sec-memory-function-arguments-results-and-bios-calls}

An address is passed to a function as a number; the function places a view on
it. BIOS functions are ordinary calls; see
[BIOS functions](#sec-blua-programs-named-bios-function-imports).

#### Example {#sec-memory-worked-values-byte-storage-and-text}

```lua
bss written: word[2]
local write_pair = function(address, first, second)
    local destination<const>: *word = address
    destination[0] = first
    destination[1] = second
    return first + second, 2
end
local sum, count = write_pair(written, 17, 25)
```

`sum` is 42, `count` 2; `written` holds 17 and 25.

## Declarations {#sec-blua-programs-declaration-and-expression-reference}

| Form | Meaning |
|---|---|
| `struct record … end` | Record layout; fields `name: type`, optionally separated by `,` or `;` |
| `bss name: type` | Zeroed RAM |
| `data name: type = value` | Initialized RAM |
| `rodata name: type = value` | ROM |
| `type[n][m]` | Array |
| `type[]` | Array whose size is given by the initial value (`data`, `rodata`) |
| `local p: *type = address` | View on an address |
| `local p<const>: *type = address` | The same; p cannot be assigned to |
| `*p`, `*p = value` | Load, store |
| `p.field`, `p[i]` | Field, element |
| `&p.field`, `&p[i]` | Address of a field or element |
| `sizeof(type)` | Size in bytes |
| `offsetof(record.field)` | Offset of a field in bytes |
| `#name` | Number of elements of a static array |

### Types {#sec-blua-programs-primitive-storage-types}

| Type | Bytes | Alignment | Load |
|---|---:|---:|---|
| `u8`, `i8` | 1 | 1 | Byte, 0–255 |
| `u16`, `i16` | 2 | 2 | 16 bits, 0–65535 |
| `u32`, `i32`, `word`, `addr` | 4 | 4 | 32-bit Integer |
| `f32` | 4 | 4 | Float |
| `f64` | 8 | 4 | Double, rounded to Float |
| `string` | 4 | 4 | A String constant |

Values are little-endian. A store writes the low bits. `i8` and `i16` load
without sign; to obtain the signed value:

```lua
bss delta: i8
*delta = -3
local raw = *delta                  -- 253
local signed = (raw ~ 0x80) - 0x80  -- -3
```

A `string` field refers to a String constant (`rodata` only); it does not hold
the bytes of the text.

### Initial values {#sec-blua-programs-initializer-rules}

```lua
struct settings
    enabled: u8
    period: u16
end

data presets: settings[2] = {
    { enabled = 1, period = 60 },
    { enabled = 0, period = 120 },
}
data matrix: u8[2][3] = {
    { 1, 2, 3 },
    { 4, 5, 6 },
}
```

Initial values are constants. An array has exactly as many elements as
declared; a struct names each field once. Padding is 0. Only the first
dimension of a `data` or `rodata` array may be omitted (`[]`). `string`
values only in `rodata`. `f32` and `f64` are stored as IEEE 754 single and
double precision.

### Layout {#sec-blua-programs-computing-struct-and-array-layouts}

Fields follow in order, each at its own alignment. A struct is aligned to its
largest field alignment, and its size is rounded up to that alignment. An array
has the alignment of its element.

```lua
struct sample
    tag: u8
    value: u32
    weight: f64
end

bss samples: sample[2]
local current<const>: *sample = samples
current[0].tag = 3
current[0].value = 7
current[0].weight = 1.5
local value = current[0].value
local second_weight = &current[1].weight
local sample_bytes = sizeof(sample)           -- 16
local array_bytes = sizeof(sample[2])         -- 32
local weight_offset = offsetof(sample.weight) -- 8
local count = #samples                        -- 2
```

| Field | Offset | Bytes | Alignment |
|---|---:|---:|---:|
| `tag` | 0 | 1 | 1 |
| Padding | 1 | 3 | — |
| `value` | 4 | 4 | 4 |
| `weight` | 8 | 8 | 4 |
| `sample` | 0 | 16 | 4 |

`&current[1].weight` is `samples` + 24.

### Views {#sec-blua-programs-views-selection-and-byte-addresses}

A view gives a type to an address; it reserves no storage.

```lua
local current<const>: *word = counter
local value = *current      -- the word at counter
*current = 5
```

`<const>` fixes the address of the view, not the contents.

| Expression | Address |
|---|---|
| `p[i]` | p + i × size of the element |
| `p.field` | p + offset of the field |
| `p + n` | p + n bytes |
| `&p[i]`, `&p.field` | The address, without loading |

Indices start at 0 (Lua tables start at 1). `matrix[1][2]` is byte 5 of the
`u8[2][3]` array. Whole structs and arrays cannot be loaded or assigned; use
their fields and elements.

An `addr` field holds an address; place a view on it to use it:

```lua
bss target_address: addr
bss payload: u8[4]
*target_address = payload
local target: *u8 = *target_address
target[0] = 65
```

### sizeof, offsetof, # {#sec-blua-programs-sizes-offsets-and-counts}

| Form | Result |
|---|---|
| `sizeof(sample[2])` | Size of a type in bytes |
| `offsetof(outer.inner.field)` | Offset of a field; no indices in the path |
| `#samples` | Number of elements in the first dimension of a static array (`#matrix` is 2) |

### Faults {#sec-blua-programs-access-hazards}

Indices are not checked. An access that is not aligned to its type (2 for
16-bit types, 4 for the others) raises an address exception; a bus error
raises a bus exception. `rodata` cannot be assigned to. I/O registers are
accessed as words; see [[I/O access](memory.md#sec-memory-scalar-memory-accesses)]{.content-visible when-format="html"}[Book I, §2.7]{.content-visible when-format="pdf"}.
An `f64` is accessed as two words, low word first.

## Operators and names {#sec-blua-programs-operator-spellings-and-source-conventions}

### Augmented assignment {#sec-blua-programs-augmented-assignment}

| Form | Meaning |
|---|---|
| `a += b` | `a = a + b` |
| `a -= b` | `a = a - b` |
| `a *= b` | `a = a * b` |
| `a /= b` | `a = a / b` |
| `a %= b` | `a = a % b` |
| `a ^= b` | `a = a ^ b` |

One target. The address of the target is evaluated once, then b, then a is read
and written. For an I/O register this is a read followed by a write.

### Unary & {#sec-blua-programs-unary-storage-address-or-string}

`&` on a storage expression gives its address. `&` on a String gives the
String unchanged. `*` and `&` have the precedence of unary `-`: `*current + 4`
adds 4 to the loaded value.

### -> {#sec-blua-programs-named-members-with}

`p->field` is the same as `p.field`.

### Names {#sec-blua-programs-names-and-a-line-leading}

Names consist of `a`–`z`, `_`, `$` and digits, not starting with a digit.
Capital letters are not allowed in names (they are in hexadecimal numbers). A
line starting with `*` starts a new statement (a store), not a
multiplication.

## Modules {#sec-blua-programs-module-modes-static-imports-and-init}

A module returns a value (a table, a function) or, as `module<const>`,
constants and functions that are linked when the program is built.

### Module kinds {#sec-blua-programs-choose-the-module-mode}

| First line | Module |
| --- | --- |
| — | Ordinary module |
| `module<entry>` | The main module of the program (one per program) |
| `module<const>` | Constants and static functions |

Modules are named by path with `/`, for instance `lib/state`.

### require {#sec-blua-programs-import-a-literal-module-path}

```lua
local state = require("lib/state")
local settings <const> = require("lib/settings")
```

The argument is a String constant. Modules are linked when the program is
built: a missing module or a cycle is an error at that time. Each module is
initialized once, before the modules that use it.

### Example {#sec-blua-programs-worked-module-linkage}

Module `counter`:

```lua
local counter = { value = 10 }
function counter.advance(amount)
    counter.value += amount
    return counter.value
end
return counter
```

Main module:

```lua
module<entry>
local first = require('counter')
local second = require('counter')
local before = first.advance(2)   -- 12
local after = second.advance(3)   -- 15
```

Both `require` calls give the same table.

### Ordinary modules {#sec-blua-programs-ordinary-exports-stay-runtime-values}

The module's value is given by a `return` at the end of the module; without
it, the value is true.

### module<const> {#sec-blua-programs-a-const-namespace-is-not-a-const-local}

```lua
module<const>
return {
    step = 8,
    scale = function(value)
        return value * 8
    end,
}
```

```lua
local settings <const> = require("lib/settings")
local step = settings.step
local scaled = settings.scale(step)
```

The fields are linked directly: `settings.step` is the constant 8,
`settings.scale` a direct call. There is no table. Fields may be nil, booleans,
numbers, Strings, storage addresses and functions, also nested.

### Static functions {#sec-blua-programs-static-functions-are-call-targets-not-function-values}

A function of a `module<const>` (or the module itself: `return function(v) …
end`) is called directly and is not a value: it cannot be stored, passed or
returned. Static functions use numbers, booleans, locals, memory access and
other static functions; they do not use tables, globals, closures, varargs or
String operations.

### <init> {#sec-blua-programs-init-registers-a-participant-it-does-not-call-it-at-startup}

`<init>` marks a top-level function without parameters as part of the
**preparation function** of the program:

```lua
module<entry>
local count = 0
local function prepare <init>()
    count = 0
end
prepare()
```

The startup routine does not call the preparation function; call `prepare()`
yourself where needed. The preparation function completes the initialization
of the modules and calls all `<init>` functions: first those of the modules
used, the main module last, each in order of declaration. DATA and BSS are not
changed. Its address is at offset `58H` of the program header (0: none):

```lua
local image<const> = 0x10000000 + mem32le[0x10000020]
local participants<const> = blua32.closure(mem32le[image + 0x58])
count = 5
participants()
-- count is 0
```

## BIOS functions {#sec-blua-programs-named-bios-function-imports}

| Number | Module | Function | Reference |
| --- | --- | --- | --- |
| 0 | `math/sin` | Sine of a phase word, × 65536 | [Turn-phase sine](bios-math.md#sec-bios-math-turn-phase-sine) |
| 1 | `string/float/decode` | Float from IEEE 754 words | [Floating-point words](bios-string.md#sec-bios-string-floating-point-word-decoder) |
| 2 | `gpu/system_vram_region` | Position and size of the BIOS area in VRAM | [[VRAM reservation](memory.md#sec-memory-firmware-reservation-in-vram)]{.content-visible when-format="html"}[Book I, §2.4]{.content-visible when-format="pdf"} |
| 3 | `kernel/bios_create_table` | Creates a table | [Tables](bios-table.md#sec-bios-table-construction) |

```lua
local sin_turn32<const> = require('math/sin')
local decode_float<const> = require('string/float/decode')
local system_vram_region<const> = require('gpu/system_vram_region')

local sine = sin_turn32(0x40000000)               -- 65536
local decoded = decode_float(0x3fa00000, 0, 4)    -- 1.25
local origin<const>, size<const> = system_vram_region()
```

These are static functions. The other BIOS functions are globals. The function
numbers are positions in the BIOS function table; see
[BIOS functions](program-images.md#sec-blua-programs-locating-bios-call-targets).

## Direct access {#sec-blua-programs-direct-access-forms-and-intrinsics}

`mem…`, `cop0` and `blua32` are written directly in the forms below. They
are not values and cannot be used as names of locals.

### Memory access {#sec-blua-programs-byte-addressed-memory-maps}

`map[address]` reads or writes at a byte address:

| Form | Value | Bytes | Alignment |
|---|---|---:|---:|
| `mem[a]`, `mem32le[a]` | 32-bit Integer | 4 | 4 |
| `mem8[a]` | Byte | 1 | 1 |
| `mem16le[a]` | 16 bits, unsigned | 2 | 2 |
| `memf32le[a]` | Float | 4 | 4 |
| `memf64le[a]` | Double, as Float | 8 | 4 |

```lua
local raw_word = mem[word_address]
mem[word_address] = 0x00000001
mem8[byte_address] = 0x7f
local halfword = mem16le[halfword_address]
local bits = mem32le[word_address]
memf32le[float_address] = 1.5
local wide = memf64le[double_address]
```

Consecutive words are 4 addresses apart. Faults as for
[typed access](#sec-blua-programs-access-hazards). I/O registers: `mem8`
reads the low byte of a register; `mem16le` and byte writes are not
permitted.

### Typed access {#sec-blua-programs-typed-dereference-is-a-separate-form}

`*p` works only on a view (`local p: *type`); for a plain number, use
`mem32le[address]`.

### Augmented assignment to memory {#sec-blua-programs-compound-assignment-performs-a-read-and-a-write}

`mem[address] += amount` reads and then writes the word; it is not one
indivisible operation.

### cop0 {#sec-blua-programs-control-registers-cop0}

| Field | Register | Access |
|---|---:|---|
| `cop0.bad_address` | 8 | Read |
| `cop0.lua_fault_reason` | 9 | Read |
| `cop0.status` | 12 | Read, write |
| `cop0.cause` | 13 | Read |
| `cop0.epc` | 14 | Read, write |
| `cop0.exec` | 15 | Write |
| `cop0.ram_end` | 17 | Write |

Only in supervisor mode; in user mode, access raises an exception. Status
bits 0 and 1 select interrupt enable and user mode. Its bit 8 inhibits system
reset and can be changed only by System ROM. Writing `cop0.exec` starts a
function with [EXEC](cpu.md#sec-cpu-exec). A System ROM write to
`cop0.ram_end` changes the main RAM boundary
([`RAM_END`](cpu.md#sec-cpu-ram-end)). Neither `exec` nor `ram_end` permits a
read or compound assignment.

#### Instructions {#sec-cpu-blua-control-syntax}

A read is an `MFC0`, a write an `MTC0`.

```lua
local status = cop0.status
local cause = cop0.cause
cop0.epc = resume_address
cop0.status = status | 1
```

The BIOS starts the cartridge with `cop0.exec = startup`, the startup-function
address from the [ROM header](program-images.md#sec-memory-rom-header-fields).

The standard interrupt routine reads FLAGS, calls `irq(flags)` if it is not 0
and returns with RFE. The standard exception routine calls
`exception(error_value)` and returns with RFE. See
[exceptions](cpu.md#sec-cpu-exception-entry-and-cartridge-dispatch).

### blua32 {#sec-blua-programs-intrinsic-calls-blua32}

| Form | Function |
| --- | --- |
| `blua32.closure(address)` | Closure of a function record |
| `blua32.float_bits(f)` | The 32 bits of a Float, as an Integer |
| `blua32.float_from_bits(w)` | The Float with bits w |
| `blua32.trace(subject, channel, …)` | Trace record |
| `blua32.trace_sink(subject, channel, sink)` | Sets the receiver of a channel |

#### float_bits, float_from_bits {#sec-blua-programs-float-word-intrinsics}

```lua
local minus_zero = blua32.float_from_bits(0x80000000)
local word = blua32.float_bits(minus_zero) -- 80000000H
```

All bits are kept. A wrong argument type raises `INVALID_ARGUMENT`. Each is
one [instruction](cpu.md#sec-cpu-numeric-word-moves).

#### closure {#sec-blua-programs-blua32closurefunction_address}

```lua
local callback = blua32.closure(function_record_address)
```

Creates a closure of the function record at the address. Used for the
[preparation function](#sec-blua-programs-init-registers-a-participant-it-does-not-call-it-at-startup)
and the [BIOS functions](program-images.md#sec-blua-programs-locating-bios-call-targets).
An unreadable record halts the CPU.

#### trace {#sec-blua-programs-blua32tracesubject-channel}

`blua32.trace(subject, 'channel', values…)` is a statement; the channel is a
String constant. At build time all traces are removed (the default), or all
or chosen channels are kept. A removed trace evaluates nothing. A kept trace
calls `sink:record(values…)` if a sink is set for the channel.

#### trace_sink {#sec-blua-programs-blua32trace_sinksubject-channel-sink}

`blua32.trace_sink(subject, 'channel', sink)` sets the sink of the channel; nil
removes it.

```lua
local subject = {}
local sink = {}
function sink:record(value)
    self.last = value
end
blua32.trace_sink(subject, 'movement.step', sink)
blua32.trace(subject, 'movement.step', 4)
blua32.trace_sink(subject, 'movement.step', nil)
```

### halt_until_irq {#sec-blua-programs-interrupt-waiting-halt_until_irq}

`halt_until_irq` stops the CPU until an interrupt is accepted. If an interrupt
has already occurred since the last wait, it continues at once. Also usable in
user mode. Test the condition in a loop:

```lua
while completion_sequence == previous_sequence do
    halt_until_irq
end
```

## Differences from Lua {#sec-blua-programs-blua-source-semantics}

### Numbers {#sec-blua-programs-number-spellings}

Integers are 32 bits, Floats single precision.

| Form | Examples |
| --- | --- |
| Integer | `0`, `12`, `480` |
| Fraction | `12.5`, `.5` |
| Exponent | `1e3`, `1E-3`, `1.5e+2` |
| Hexadecimal | `0xff`, `0XFF` |
| Hexadecimal fraction | `0x1.8`, `0x.8`, `0x1.8p+2` |

A decimal integer above 2147483647 is a Float; a hexadecimal integer gives the
low 32 bits: `0x80000000` is −2147483648.

### Strings {#sec-blua-programs-string-literal-differences}

As in Lua.

### Locals {#sec-blua-programs-local-binding-differences}

`<const>` as in Lua; `<close>` is not available. A view follows the
attribute: `local cursor<const>: *word = address`.

### Calls {#sec-blua-programs-known-call-argument-diagnostics}

As in Lua.

### Varargs {#sec-blua-programs-variable-arguments-and-result-positions}

As in Lua.

### Logical operators {#sec-cpu-logical-expressions}

As in Lua: only nil and false are false; `and` and `or` return one of their
operands and evaluate the right one only when needed.

### return {#sec-blua-programs-return-boundaries-and-grouped-results}

As in Lua.

### Numeric for {#sec-blua-programs-numeric-for}

As in Lua.

### Generic for {#sec-blua-programs-generic-for}

As in Lua; see the
[BIOS iteration functions](bios-base.md#sec-bios-base-traversal-argument-selection-globals-and-output).

### goto {#sec-blua-programs-labels-and-goto}

As in Lua.

## Globals {#sec-blua-programs-ordinary-globals-are-a-name-bank}

A global name used in the program must be known when the program is built:
from the BIOS or from an assignment or function declaration in the program.
For names formed while the program runs, use
[`getglobal` and `setglobal`](bios-base.md#sec-bios-base-getglobalname-and-setglobalname-value).
Globals are kept when another program is started with EXEC; see
[globals](program-images.md#sec-blua-programs-fresh-system-boot-and-execution-transfer).
The BIOS globals are listed in the
[BIOS base library](bios-base.md#sec-bios-base-installed-program-environment).

### Runtime compilation {#sec-blua-programs-runtime-compilation}

`load` compiles text while the program runs; see
[runtime compilation](bios-loader.md#sec-bios-loader).
