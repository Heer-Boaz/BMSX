# BLua source programs and extensions

BLua provides the language facilities used to control the BMSX: named
functions and modules, fixed byte layouts, typed address access, direct
register access and interrupt waiting. This chapter specifies those forms
and the source rules that differ from general Lua.

Use the hardware chapters for device register values and command sequences.
Use the BIOS chapters for installed function calls. The source forms here
select accesses and calls; the addressed device or called routine determines
their effects.

## BLua extensions

BLua provides explicit source forms for program linkage, static storage, typed
address access, processor control, instrumentation, and augmented assignment.
Hardware programming is a principal use, but not the limit of these extensions.

For general Lua syntax and introductory material, see the
[Lua documentation](https://www.lua.org/docs.html). The rules in this chapter
apply where BLua differs. Local `<const>` has its familiar binding role;
`module<const>` additionally selects the static namespace and call rules
specified below.

| Extension family | Source forms | Detailed reference |
| --- | --- | --- |
| Module roles and static linkage | `module<entry>`, `module<const>`, literal `require`, static exports, `<init>` | Module modes, static imports, and `<init>` below |
| Static storage and layouts | `struct`, `bss`, `data`, `rodata`, typed arrays | [Typed storage, layouts, and address views](#typed-storage-layouts-and-address-views) |
| Typed address selection | `local p: *type`, `*p`, fields, indices, unary `&`, `sizeof`, `offsetof`, static-array `#` | [Views, selection, and byte addresses](#views-selection-and-byte-addresses) |
| Six raw mapped-access forms | `mem`, `mem8`, `mem16le`, `mem32le`, `memf32le`, `memf64le` | [Memory](memory.md) and mapped access below |
| Six control fields | `cop0.bad_address`, `cop0.lua_fault_reason`, `cop0.status`, `cop0.cause`, `cop0.epc`, `cop0.exec` | [CPU](cpu.md) and control access below |
| Three intrinsic operations | `blua32.closure`, `blua32.trace`, `blua32.trace_sink` | Intrinsic operations below |
| Interrupt wait statement | `halt_until_irq` | [CPU](cpu.md) and interrupt wait below |
| Six augmented assignments | `+=`, `-=`, `*=`, `/=`, `%=`, `^=` | Augmented assignment below |

Memory-map names, `cop0` and `blua32` must be used in their direct source
forms. Choose a mapped access for an explicit address and width, or a typed
view when field offsets and element strides belong to a declared layout.
Unary `*` reads a typed selection; the view itself occupies no new byte range.


## Typed storage, layouts, and address views

Storage declarations define byte ranges for scalar state, transfer buffers,
lookup tables and structured records. A storage name supplies its byte
address. Field selection and indexing apply the declared layout to that
address; scalar dereference reads or writes the selected bytes.

### Declaration and expression reference

The following forms use lowercase placeholder names; source identifiers cannot contain uppercase letters.

| Form | Meaning |
|---|---|
| `struct record ... end` | Define a layout with fields written as `name: type_name`. |
| `bss buffer: type_name` | Reserve zero-initialized writable storage; no initializer is accepted. |
| `data buffer: type_name = initializer` | Define writable storage with a compile-time initializer. |
| `rodata buffer: type_name = initializer` | Define image-resident storage with a compile-time initializer. |
| `type_name[n][m]` | Array type with explicit dimensions. |
| `type_name[]` | Infer the outer dimension of initialized `data` or `rodata`. |
| `local view: *type_name = address` | Associate a local address value with an access layout. |
| `local view<const>: *type_name = address` | The same view with an immutable local binding. |
| `*view` / `*view = value` | Read or write a selected scalar through a typed address. |
| `view.field` / `view[index]` | Select a field or element using its layout. |
| `&view.field` / `&view[index]` | Obtain a selected address without loading its value. |
| `sizeof(type_name)` | Obtain a type's size in bytes; array dimensions are allowed. |
| `offsetof(record.field)` | Obtain a field's byte offset; nested field paths are allowed. |
| `#buffer` | Obtain the outer element count of a declared static array. |

Struct fields may be separated by commas or semicolons; a separator is not required between successive field declarations.
Storage declarations accept an optional trailing semicolon.
The declaration spellings are contextual forms, not additions to the lexical reserved-keyword list.

<div class="keep-together">

### Primitive storage types

Every size and alignment below is in **bytes**.
An alignment of four means that the address must be divisible by four.

| Type names | Size | Alignment | Stored representation and access |
|---|---:|---:|---|
| `u8`, `i8` | 1 | 1 | Unsigned byte read; stores keep the low 8 bits. |
| `u16`, `i16` | 2 | 2 | Unsigned little-endian read; stores keep the low 16 bits. |
| `u32`, `i32` | 4 | 4 | Unsigned little-endian read; stores keep the low 32 bits. |
| `f32` | 4 | 4 | IEEE float32; stores round the numeric value to float32. |
| `f64` | 8 | 4 | IEEE float64 accessed as two little-endian 32-bit words. |
| `addr` | 4 | 4 | Raw unsigned 32-bit address value, accessed like `u32`. |
| `word` | 4 | 4 | Raw unsigned 32-bit word exposed as a numeric value. |
| `string` | 4 | 4 | Image constant-pool reference; reads the selected constant value. |

</div>

`i8`, `i16` and `i32` have the same **unsigned load** behavior as their `u`
counterparts. Sign extension must be explicit when a stored field represents
a signed quantity. `word` holds a numeric register word, and `addr` holds a
numeric address; select the target layout with an annotated view.

A `string` field holds a constant reference. Its RODATA initializer selects a
String constant, and a read returns the referenced value. It is separate from
inline text bytes; use byte storage and an explicit decoder for encoded text.

### Choosing a storage section

`bss` reserves writable RAM that is cleared to zero during section initialization.
`data` reserves writable RAM whose initial bytes are copied from the cartridge image.
`rodata` places initialized bytes in the image itself.

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

A bare storage name, including `counter` or `total`, evaluates to its linked numeric address.
Use `*counter` to load its scalar contents and `*counter = value` to store them.
Assigning a new value directly to a `bss` or `data` name is rejected; the name is not a rebindable scalar variable.

Section initialization copies `data` bytes into RAM and then clears `bss`, using word accesses.
It precedes static module initializers and the entry routine.
Locate writable program sections outside the installed firmware's RAM
reservation. The standard placement puts program DATA after firmware BSS,
then program BSS after DATA. Access declarations by their resolved addresses;
fixed offsets from the start of RAM can overwrite firmware state. See
[reserved and cartridge storage](memory.md#reserved-and-cartridge-storage-in-main-ram)
for the firmware footprint and placement rules.

Each declaration starts at its type's alignment, and the section cursor after a declaration is rounded to four bytes.
Two separate `u8` declarations therefore need not occupy adjacent bytes.
Use one array or struct when the relative spacing of bytes matters.

<div class="keep-together">

### Initializer rules

Initializer table syntax describes bytes to encode at compile time, not a table allocated for later use.
Integer storage initializers must evaluate to compile-time integers.
A static initializer is not an arbitrary runtime expression.

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

</div>

- Arrays require positional elements and exactly the declared outer element count.
  Each further array dimension requires another nested initializer.
- Struct initializers require identifier-named fields.
  Missing, duplicate, or unknown fields are compilation errors.
- Padding bytes in encoded initializers start at zero.
- An explicit dimension must be a positive compile-time integer.
- Only the outer dimension of initialized `data` or `rodata` may be inferred from the initializer's field count, and that count must be nonzero.
  There is no inference source for `bss`, struct-field, inner-dimension, or local-view `[]`.
- Static `string` initializers must be compile-time strings and are supported only in `rodata`, including string fields inside aggregates.
  A `string` initializer in `data` is rejected.
- `f32` and `f64` initializers in `data` and `rodata` must be compile-time numbers.
  They encode IEEE 754 binary32 or binary64 in little-endian order, including inside arrays and structs.
  `f32` rounds the computed value to binary32; `f64` retains its binary64 value. Both preserve negative zero.

### Computing struct and array layouts

Fields are placed in declaration order.
Before placing each field, its offset is rounded up to that field's alignment.
The struct's alignment is the greatest field alignment; its final size is rounded up to that alignment.
Nested structs use their own resolved sizes and alignments.
An array retains its element type's alignment and multiplies its size by every declared dimension.
There is no packed-layout declaration form.

<div class="keep-together">

This illustrative single-module layout uses a floating-point field without a static floating-point initializer:

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
local sample_bytes = sizeof(sample)       -- 16
local array_bytes = sizeof(sample[2])     -- 32
local weight_offset = offsetof(sample.weight) -- 8
local count = #samples                    -- 2
```

| Part | Byte offset | Size | Alignment |
|---|---:|---:|---:|
| `tag` | 0 | 1 | 1 |
| Padding | 1 | 3 | — |
| `value` | 4 | 4 | 4 |
| `weight` | 8 | 8 | 4 |
| Complete `sample` | 0 | 16 | 4 |

</div>

The second record starts 16 bytes after `samples`.
Its `weight` address is therefore `samples + 24`, not `samples + 8` or `samples + 2`.
The `f64` field requires four-byte, not eight-byte, alignment.

Unknown types, unknown fields, duplicate field declarations, and recursive layouts are compilation errors.
Type declarations have block-wide forward visibility, with lookup through enclosing scopes and then globals.
Storage value references remain ordered; forward visibility of a type does not make every storage value available early.

### Views, selection, and byte addresses

A typed local view supplies a layout for an existing address. Declare it
with `: *type_name`, then select fields or elements in the same way as for
declared storage. The addressed bytes keep their existing lifetime and access
permissions; creating the view reserves no storage and copies no record.

Indexing is **zero-based**.
This is different from the one-based sequence keys used by the
[Table library](bios-table.md). A typed array describes consecutive bytes;
an ordinary Table is a collection of language values keyed by values.
For a view of `u16`, `view[1]` selects the address two bytes after `view`.
For a view of `sample`, `view[1]` selects the address `sizeof(sample)` bytes after it.
For a multidimensional array, each index removes one dimension and uses the size of the remaining array as the stride.
Thus `matrix[1][2]` selects byte offset five in the `u8[2][3]` example.

Numeric address addition is different: `view + 1` adds **one byte**, regardless of the view's type.
Selection offsets, `sizeof`, and `offsetof` all use bytes.
A device register's explicitly specified word count is a device unit, not an automatic consequence of pointer typing.

Storage names and typed local roots permit pointer-style indexing even when their declared type is a scalar or struct.
After indexing, field selection, or dereference, that permission does not continue unless the selected type is an array.
Dereference retains the selected type: it neither removes an array dimension nor automatically follows an address stored in a field.
Whole arrays and structs are address ranges, not scalar values that can be loaded or assigned as complete aggregates.
Select a scalar field or element, or use `&` to obtain the selected address.

An `addr` field loads a numeric address only.
Create an explicitly annotated local view before selecting the target layout.
The same rule applies to scalar address storage:

```lua
bss target_address: addr
bss payload: u8[4]
*target_address = payload
local target: *u8 = *target_address
target[0] = 65
```

Unary `&` on typed storage or a typed selection computes its address without reading its contents.
A bare storage name already provides its base address.
This is not general address-of for arbitrary ordinary locals, and unary `*` requires resolved typed storage or a typed view rather than an arbitrary numeric expression.

### Sizes, offsets, and counts

`sizeof` takes a **type**, not a storage value: use `sizeof(sample[2])`, not `sizeof(samples)`.
`offsetof` takes a struct type followed by named fields, such as `offsetof(outer.inner.field)`.
It adds the selected byte offsets; intermediate fields must be non-array structs.
An indexed path such as `offsetof(outer.items[1].field)` is not accepted.

`#samples` is the declared array's **outer element count**, not its byte size.
For `matrix: u8[2][3]`, the count is two, not six.
This static-array form also recognizes resolved static storage exports, but does not provide capacity for arbitrary typed locals or selected fields.
Do not use `#view` as a pointer-capacity query.

### Access hazards

Typed indexing emits no array bounds check or runtime integer-index check.
A statically known noninteger index is rejected. For computed indices, the
programmer must keep the resulting byte address within the intended range.

Effective access addresses are converted to unsigned 32-bit addresses.
Misaligned accesses cause a synchronous address exception before the mapped access: two-byte alignment for `u16`/`i16`, four-byte alignment for `u32`/`i32`, `word`, `addr`, `f32`, and `f64`.
Byte accesses have no additional alignment requirement.
A bus fault causes a synchronous data-bus exception; a failed load leaves its destination register unchanged.
A store can wait for the mapped destination to become ready before writing.

Direct writes through `rodata` selections are rejected, as are static string-reference assignments and whole-array or whole-struct assignments.
A local view of a RODATA address permits store syntax, so the mapped memory
permissions still govern a write through that view. `<const>` fixes the local
address binding while allowing stores through it.

Typed accesses to memory-mapped I/O invoke the mapped device rather than behaving like inert RAM.
Word accesses are not interchangeable with narrow accesses: an aligned I/O byte read reads the slot and keeps its low byte, other byte positions fault, byte writes fault, and 16-bit reads and writes fault.
Use the device's specified access width; writes to read-only slots fault.

An `f64` access performs its low-word access before its high-word access at byte offset four.
If the first access faults, the second is skipped.
The pair is not atomic: the first write may already have occurred when the second faults.

<div class="keep-together">

## Operator spellings and source conventions

### Augmented assignment

BLua accepts six augmented assignments:

| Assignment | Arithmetic operator |
|---|---|
| `+=` | `+` |
| `-=` | `-` |
| `*=` | `*` |
| `/=` | `/` |
| `%=` | `%` |
| `^=` | `^` |

</div>

Each requires exactly one target and one right-hand expression. There is no
`//=`, bitwise or shift assignment, concatenation assignment, or increment or
decrement form. In particular, `--` begins a comment, not a decrement.

Evaluation prepares the target once, evaluates the right-hand expression,
reads the target, performs the arithmetic and writes the result. This is a
read followed by a write. Device read effects and write effects both apply;
use explicit register values for commands whose fields are not suitable for
read-modify-write operation.

### Unary `&`: storage address or String

For a typed storage selection, unary `&` obtains the selected storage address
without reading its contents. A record field or indexed element therefore
selects an address using its declared layout.

For a String operand, unary `&` returns the String value unchanged. Use
String operations on that result. Only the typed-storage form yields a byte
address; a String operand supplies neither a character-buffer address nor a
numeric identifier.

### Named members with `->`

`base->member` is another named-member spelling alongside `base.member`.
It is not C's automatic extra pointer dereference.

For a typed field selection, the field's address is the base's typed address
plus the declared field offset. The arrow does not first read an address-valued
field and turn its contents into a new typed pointer. Choose the intended
address view explicitly rather than expecting C pointer-member behavior.

### Names and a line-leading `*`

Identifiers begin with lowercase ASCII `a`–`z`, `_`, or `$`; following
characters may also include decimal digits. Uppercase ASCII letters in
identifiers are rejected, and non-ASCII letters are not identifier characters.
Uppercase hexadecimal digits inside numeric literals are a separate matter.

Statements generally need no semicolon, but newlines are not universally
insignificant. When `*` begins a new line, it does not continue the preceding
expression as multiplication: it can begin a dereference statement instead.
Keep a continuation multiplication operator on the existing expression line.
Parentheses do not remove this particular newline rule; do not generalize it
to every operator.


## Module modes, static imports, and `<init>`

A module publishes either an ordinary value or static exports. Use an
ordinary value for mutable state and replaceable function fields. Use static
exports for named constants, storage addresses and directly resolved calls.

### Choose the module mode

Put an optional module marker before the chunk's statements.
The spellings are case-sensitive; an optional semicolon may follow the marker.

| Beginning of chunk | Meaning |
| --- | --- |
| No marker | An ordinary module; a final export declaration supplies its runtime export. |
| `module<entry>` | The program's entry chunk, entered after its ordinary dependencies are initialized. |
| `module<const>` | A compile-time export namespace or root static function, not an allocated module table. |

A program has one entry chunk. `module<entry>` declares that role. Each
module also has a distinct path using `/`; dots remain literal path
characters. Use that path in imports. Physical cartridge selection and
startup are specified separately in [Memory](memory.md) and
[Cartridge interfaces](../book3/cartridge.md).

### Import a literal module path

Use the built-in `require` with exactly one literal string argument:

```lua
local state = require("lib/state")
local settings <const> = require("lib/settings")
```

The first form is suitable for an ordinary runtime export; the second can bind a
compile-time namespace. `require "lib/state"` is also accepted.
A computed path, an extra argument, or a method-style built-in import is a compile
error. A lexical declaration named `require` shadows the built-in.

Imports name supplied modules or installed named function imports.
An unavailable module is a compile error, not a missing-file error during play.
Module names use `/`; dots are not converted to `/`. An import variable's name
does not change the imported module's path.

Literal imports select dependencies for the program, including imports written
inside functions. They are not deferred file-loading instructions.
Ordinary dependencies initialize before their importers; a dependency cycle is a
compile error. Do not rely on filename ordering between unrelated dependencies.

### Ordinary exports stay runtime values

An ordinary module declares its export with a final top-level `return` containing
exactly one expression. Its result may be a table, function, scalar, `false`, or
`nil`. For `return make_value()`, only the call's first result is exported.
An earlier or nested return, bare return, or final multiple-expression return
does not declare that export contract.

The module's top-level code is initialized before entry; an ordinary `require`
expression reads its retained export rather than rerunning that code at the
written import line. Successful initialization is recorded separately from the
export, so exporting `nil` or `false` does not cause another initialization.
An ordinary module with no final single-expression export supplies `true`;
additional requested import results are nil. An earlier return does not select
an alternative published export.

Imports of an ordinary exported table read the same published root.
Its fields remain runtime fields: replacing a function field changes what a later
ordinary `module.field()` lookup calls. A const local naming that table does not
turn the table into a compile-time namespace or freeze its fields.

### A const namespace is not a const local

`local name <const>` makes a local binding immutable.
`module<const>` instead declares compile-time exports: named constant leaves and
static function targets, or a root static function. These are different features.
A recognized const module has no ordinary runtime initializer.

For example, a const module named `lib/settings` can declare:

```lua
module<const>
return {
    step = 8,
    scale = function(value)
        return value * 8
    end,
}
```

Its named exports can be selected without producing a runtime module table:

```lua
local settings <const> = require("lib/settings")
local step = settings.step
local scaled = settings.scale(step)
```

Named fields and literal string keys form export paths; nested fields form nested
namespaces. `settings["scale"](step)` is also a static selection.
Computed indices and positional array entries are not named namespace export paths.

Constant leaves may be `nil`, booleans, numbers, strings, or static storage
addresses. Numeric negation and supported numeric constant expressions can be
folded; arbitrary runtime expressions are not thereby constant expressions.
A named leaf that is neither a compile-time constant nor a static function target is a compile error.

### Static functions are call targets, not function values

Const modules may export function literals, top-level local function declarations,
or top-level const locals initialized with function literals.
A root export can be written as `return function(value) return value * 8 end`.
Bind such a root with `local operation <const> = require("lib/operation")`, then
call `operation(value)`. A named target can have an alias such as
`local scale <const> = settings.scale`.

A compile-time namespace cannot be used as a runtime table. Select its exports instead.
A static function target cannot be stored in a runtime table, passed as an ordinary
callback, or returned as a runtime function value. A constant value export cannot
be called. These are compile errors, not runtime conversions.
Installed named function imports use the same call-target distinction.
Exported static functions cannot capture runtime outer locals or use dynamic call
targets. Their operations are restricted to scalar/static work: numeric and
boolean constants, scalar locals, branches, static calls, and scalar memory access.
Runtime global access, table allocation or dispatch, object length, runtime closure
creation, vararg dispatch, and dynamic string concatenation are excluded.
Ordinary string literals in such function bodies are also excluded; already
interned constants read through immutable typed rodata are permitted.

<div class="keep-together">

### `<init>` registers a participant; it does not call it at startup

The declaration form is a top-level local function with no parameters or varargs:

```lua
module<entry>
local count = 0
local function prepare <init>()
    count = 0
end
prepare()
```

</div>

The explicit `prepare()` call runs the body at that source position.
`<init>` marks participation in the separate preparation sequence. The
participant is an ordinary local closure and may capture local state.
Declarations inside `if`, loops, `do`, or other functions are not top-level
participants. `<init>` is forbidden in a const module and is not an attribute on
global or method declarations. A non-entry participant module must be statically required.

Normal startup initializes data storage, zeros BSS storage, initializes ordinary
dependencies, then enters the entry chunk. It does not invoke the participant
sequence. Use an explicit call when the body is needed during ordinary startup.

When the separate participant sequence is invoked, it first completes any pending
ordinary-module initialization, then calls participants with zero arguments.
Dependency-module participants precede importer-module participants; entry
participants are last, with declaration order retained within each module.
Each invocation runs that participant order again. DATA, BSS and the entry
chunk keep their existing state during the sequence. Use the explicit startup
call for preparation required at normal entry; the annotation alone supplies
no startup call or once-only latch.

## Direct access forms and intrinsics

BLua provides direct memory access, control-register access, closure construction, selectable
tracing, and an interrupt-wait statement. These are language forms, not a library of
replaceable tables and functions.

The six memory roots are `mem`, `mem8`, `mem16le`, `mem32le`, `memf32le`, and `memf64le`. The two
intrinsic roots are `cop0` and `blua32`. None of these eight names may be declared as a local or
parameter. They are not first-class values: do not assign a root to another variable, pass it as an
argument, or replace it by assignment. Their supported forms use the root name directly, as
described below.

<div class="keep-together">

### Byte-addressed memory maps

Each memory map uses `map[byte_address]` for a read or an assignment target. The index is a byte
address, regardless of the access width. For example, adjacent 32-bit words are four address units
apart, not one. Addresses are consumed as unsigned 32-bit addresses.

| Map | Value transferred | Size in bytes | Required byte alignment |
|---|---|---:|---:|
| `mem[address]` | Raw unsigned 32-bit word, little-endian | 4 | 4 |
| `mem8[address]` | Unsigned byte | 1 | 1 |
| `mem16le[address]` | Unsigned 16-bit integer, little-endian | 2 | 2 |
| `mem32le[address]` | Unsigned 32-bit integer, little-endian | 4 | 4 |
| `memf32le[address]` | Numeric IEEE float32, little-endian | 4 | 4 |
| `memf64le[address]` | Numeric IEEE float64, little-endian | 8 | 4 |

</div>

<div class="keep-together">

`mem` and `mem32le` both transfer a little-endian unsigned 32-bit value. They remain distinct access
kinds, including their fault-access identity; `mem32le` is not a source alias for `mem`. The
floating-point maps convert between numeric values and their stored floating representation. They do
not return the integer bit pattern of that representation. Use an integer map when the required
result is raw bits.

</div>

The following fragments show access shapes. Their address variables must already refer to suitable
memory locations; the fragments are not complete programs.

```lua
local raw_word = mem[word_address]
mem[word_address] = 0x00000001
mem8[byte_address] = 0x7f
local halfword = mem16le[halfword_address]
local bits = mem32le[word_address]
memf32le[float_address] = 1.5
local wide = memf64le[double_address]
```

Misalignment raises an address-error-load or address-error-store exception before the access. In
particular, `memf64le` requires four-byte, not eight-byte, alignment. It transfers the low word
first and the high word at the address plus four. A fault stops the sequence; the two-word transfer
is not an atomic transaction. A fault on the second word of a write does not undo the first word.

A mapped device retains its own access rules. An access width is not permission to slice a device
register as though it were ordinary byte storage. For example, a `mem8` I/O read must address an I/O
slot and returns that slot's low eight bits; a byte address between slots faults. `mem16le` I/O
accesses fault even when their two-byte alignment is correct. Word and unsigned 32-bit I/O accesses
use the addressed device slot. Mapped bus faults raise synchronous data-bus-error exceptions. A
device that holds a store pending completes the access when it becomes ready;
the processor waits for that access rather than requiring repeated writes.

### Typed dereference is a separate form

Unary `*` reads a resolved typed pointer, and `*pointer = value` writes its resolved scalar storage.
The pointer's scalar type selects the access kind; the resolved byte offset and read-only status
remain part of the access. Whole-structure scalar reads and assignments are not supported by this
form, and directly resolved RODATA selections cannot be assigned through it. A local typed view
does not retain that RODATA protection; the storage section above distinguishes these cases.

An untyped numeric address is not a dereferenceable pointer. Do not replace `mem[address]` with
`*address` when `address` has no compiled pointer type, and do not use `*0x08000000` as a raw memory
access. Typed-pointer declarations, storage layout, and address views are specified in the [Memory
reference](memory.md).

### Compound assignment performs a read and a write

The compound spellings are `+=`, `-=`, `*=`, `/=`, `%=`, and `^=`. Each requires exactly one target
and one right-hand expression. There are no bitwise compound-assignment spellings such as `|=` or
`&=`.

For a mapped-memory target, evaluation proceeds in this order:

1. Evaluate and retain the target address.
2. Evaluate the right-hand expression.
3. Read the target through the selected memory map.
4. Apply the arithmetic operation and write through that map.

Thus `mem[address] += amount` performs an actual mapped read followed by an actual mapped write. It
is not a device-atomic operation. Read-side effects, write readiness, and access faults still apply
separately. For device registers, use the device-defined write value rather than assuming that
reading and rewriting its previous value is harmless.

### Control registers: `cop0`

Use a direct field read or assignment, such as `cop0.status` or `cop0.epc = resume_address`. The
complete source-visible field set is:

| Field | Register number | Permitted source access |
|---|---:|---|
| `cop0.bad_address` | 8 | Read only |
| `cop0.lua_fault_reason` | 9 | Read only |
| `cop0.status` | 12 | Read and write; compound assignment permitted |
| `cop0.cause` | 13 | Read only |
| `cop0.epc` | 14 | Read and write; compound assignment permitted |
| `cop0.exec` | 15 | Write only; compound assignment rejected |

Other field names are rejected. Reading `cop0.exec` or assigning a read-only field is also rejected,
rather than providing another control-register operation. Every permitted read and write still
requires supervisor mode. In user mode it raises a coprocessor-unusable synchronous exception;
ordinary program code does not gain privileged access by using this syntax.

`cop0.status` and `cop0.epc` writes supply raw unsigned 32-bit words. In `status`, bit 0 is current
interrupt enable and bit 1 is current user mode. Writing `cop0.exec` requests execution of the
supplied function-record address; it is not an ordinary field update or a substitute for a normal
function call. The execution-transfer and exception contracts belong to the [CPU reference](cpu.md).

A supervisor-only source fragment can read exception state and set a resume address:

```lua
local status = cop0.status
local cause = cop0.cause
cop0.epc = resume_address
cop0.status = status | 1
```

Compound assignment to `status` or `epc` evaluates the right-hand expression, then reads the control
register, applies the operation, and writes the result. These are separate control-register
operations, not an atomic update.

### Intrinsic calls: `blua32`

The complete intrinsic operation set is `closure`, `trace`, and `trace_sink`. Use a direct dotted
call on `blua32`; alias calls and colon-method calls do not provide intrinsic access. Unknown
operation names are rejected.

#### `blua32.closure(function_address)`

`closure` constructs one closure from the supplied function-record address.
Supply exactly one argument. The form is valid in an expression or a call
statement; requesting further results supplies nil in those positions.

The address is consumed as an unsigned 32-bit function-record address in the active execution image.
The function record is read before closure construction; an unsuccessful record read hard-halts
execution. This operation does not make arbitrary integers valid function addresses. Function-record
acquisition, capture context, and closure execution must follow the [CPU reference](cpu.md); this
syntax defines no separate address-supply ABI.

```lua
local callback = blua32.closure(function_record_address)
```

`blua32.closure` requires a supplied valid function-record address and the appropriate capture context;
it does not produce or reveal record addresses. For a supported route from
compiled code to a callable root closure, use the BIOS `load` or `lua_compiler.compile_syntax`
facilities described in [BIOS loading and compilation](bios-loader.md). Their
compilation route supplies the linked record and constant-pool capture context.
Ordinary function expressions need no programmer-supplied record address.

#### `blua32.trace(subject, channel, ...)`

`trace` is a statement-only form with at least two source arguments. The channel must be a String
literal, not a variable or computed String. Each payload expression after the channel supplies one
result. `trace` cannot be used as a value-producing expression.

Instrumentation selection is a compilation choice: erase all trace statements, select all channels,
or select a named set of channels. Erasure is the default. Argument-count and literal-channel
requirements still apply to erased statements. An erased statement evaluates neither its subject nor
its payload expressions. Do not put required program effects in those expressions.

For a selected channel, `trace` evaluates the subject and reads its channel sink. If that sink is
falsey, no payload expression is evaluated and no record is made. Otherwise it evaluates the payload
and calls the sink's `record` method with the sink as receiver, followed by the payload values. A
trace is therefore a call to a bound sink, not automatic output to a log.

#### `blua32.trace_sink(subject, channel, sink)`

`trace_sink` is also statement-only and requires exactly three source arguments. Its channel must be
a String literal. It obeys the same compilation selection: an erased binding evaluates neither the
subject nor the sink expression. When selected, it evaluates the subject, then the sink, and binds
that sink to the subject's channel. Passing nil clears the binding. Use the intrinsic rather than
accessing its channel-storage field directly.

<div class="keep-together">

This fragment shows a receiver-aware sink and matching channel literals:

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

</div>

### Interrupt waiting: `halt_until_irq`

`halt_until_irq` is a keyword statement, not a function or replaceable name. It takes no parentheses
or arguments; a following semicolon is optional. Unlike `cop0` access, it has no supervisor-mode
requirement.

If an interrupt-event-pending latch is already set, the statement consumes it without establishing a
new halt. Otherwise it halts the active thread at its current physical frame depth. An occurrence
need not wait for a future event. Accepted interrupts, not arbitrary device activity, define the
interrupt boundary. Maskable interrupt acceptance requires current interrupt enable and an asserted
maskable interrupt line. Full interrupt-entry, return, and scheduling rules are specified in the
[CPU reference](cpu.md).

Wait for the required condition in a predicate loop, for example by comparing an
interrupt-handler-maintained completion sequence with its previous value:

```lua
while completion_sequence == previous_sequence do
    halt_until_irq
end
```

The interrupt handler and sequence belong to the operation being awaited. An interrupt alone does
not establish that the desired transfer or frame completed.

## Worked static storage

A [record-copy example](memory.md#worked-example-prepare-and-copy-two-records)
combines RODATA, DATA and BSS with zero-based typed record views. The layouts
and address calculations there also apply to module exports: exporting a storage
name exports its numeric address, not a copy of the bytes.

## BLua source semantics

This section records source conventions and behavior that must not be inferred
from another Lua edition. General Lua syntax and introductory programming are
outside this reference. Runtime values, arithmetic and instruction costs are
specified by the [CPU reference](cpu.md).

### Number spellings

Decimal literals begin with a digit, or with `.` followed by a digit. A fractional dot after integer digits is part of the number only when another digit follows it. An exponent uses `e` or `E`, an optional sign, and one or more decimal digits.

| Form | Examples |
| --- | --- |
| Decimal integer | `0`, `12`, `480` |
| Decimal fraction | `12.5`, `.5` |
| Decimal exponent | `1e3`, `1E-3`, `1.5e+2` |
| Hexadecimal integer | `0xff`, `0XFF` |
| Hexadecimal fraction | `0x1.8`, `0x.8` |
| Hexadecimal binary exponent | `0x1.8p+2`, `0x.8p-1` |

Hexadecimal literals begin with `0x` or `0X`. Their digits may use either case, independently of the lowercase-only identifier rule. They require at least one hexadecimal digit across the integer and fractional parts. A `p` or `P` exponent has decimal digits and scales the hexadecimal value by a power of two.

A literal whose parsed numeric value is non-finite is rejected. Unary `-` is a separate operator, so `-12` is an expression rather than one signed numeric token. Use `1.0` rather than `1.` for a decimal fraction. Digit separators, binary or octal prefixes, and numeric suffixes are not supplied by these literal forms.

The expressions `-0` and `-0.0` produce negative zero. Constant binding and loading do not replace either expression with positive zero.

Hexadecimal spelling does not create a distinct address or register-word literal type. It is another spelling of a Number literal; address and typed-storage use belongs to the [Memory reference](memory.md).

### String literal differences

Quoted Strings accept `\a`, `\b`, `\f`, `\n`, `\r`, `\t`, `\v`,
`\\`, `\"`, `\'`, `\xHH`, one-to-three-digit decimal `\ddd` (0–255),
and `\z` followed by discarded whitespace. Exactly two hexadecimal digits
follow `\x`. Unsupported escapes, `\u{...}`, backslash-newline continuation,
a literal line feed and an unterminated quoted String are rejected.

Escapes select codepoints, not UTF-8 input bytes. For example,
`'\xc3\xa9'` contains two codepoints, U+00C3 and U+00A9. Decode mapped UTF-8
bytes explicitly with the [String BIOS interface](bios-string.md).
Long bracket Strings skip one initial CR, CR/LF pair or LF; subsequent content
is literal through the matching delimiter. Bracket delimiters do not nest.

### Local binding differences

`<const>` makes the local binding immutable, including through captures, not the
contents of a Table it names. It requires an initializer position. `<close>`
and other local attributes are not supported. A typed address annotation
follows the attribute: `local cursor<const>: *word = address`.

Initializers normally resolve before the new locals become visible. Two forms
make their own name available recursively: `local function name(...) ... end`
and a single-name, single-value `local name<const> = function(...) ... end`.
This exception does not extend to other or multi-name initializers.

### Known-call argument diagnostics

The compiler can diagnose too few written arguments when it resolves a callee signature. This minimum check counts argument expressions as written: an explicit `nil` counts as one argument. Surplus expressions are not rejected by this check. The diagnostic concerns source use, not a runtime fault. If execution reaches a source-function call, missing fixed parameters are filled with `nil`; that runtime behavior does not make every source spelling acceptable to the compiler. See [Calls, closures, globals and tables](cpu.md#calls-closures-globals-and-tables) for the reached-call contract.

### Variable arguments and result positions

`...` reads the variable arguments available to the **current call**. A nested function does not inherit an enclosing call’s variable arguments.

BLua accepts `...` as an expression even when the function’s written parameter list contains no `...`, and in the entry chunk. This does not make a bare `...` a statement. A function without `...` in its parameter list has **zero available variable arguments**, even if its caller supplies extra arguments; the entry chunk likewise has zero available variable arguments.

Zero available arguments are not the same as one `nil` result. With zero available variable arguments, an open-result use of `...` supplies zero values. When a context requests a fixed number of result positions, unavailable positions are filled with `nil`; selecting one result therefore gives `nil` in this case. For argument and result transfer at the machine-call boundary, see [CPU calls](cpu.md#calls-closures-globals-and-tables).

### Return boundaries and grouped results

A newline alone does not terminate `return`. An expressionless return is
recognized only before `end`, `else`, `elseif`, `until`, or end of source;
`return;` is not its accepted spelling. An expressionless source return supplies
one nil, not zero results.

A parenthesized call or variable-argument expression supplies exactly one
result. Extra results are discarded; a call returning no values supplies nil.
Thus `local a, b = (pair())` assigns the first result to `a` and nil to `b`,
even when `pair` returns two values. The same call adjustment applies in the
[BIOS runtime-loaded language](bios-loader.md#calls-and-results).

<a id="complete-program-numeric-loop-control"></a>

### Numeric `for`

```text
for name = start, limit [, step] do
    block
end
```

Square brackets mark the optional step; they are not written in the source.

The header evaluates `start`, then `limit`, then the explicit `step`, once
before the first test on each ordinary entry into the statement. Each
expression supplies one result, including a call expression. Omitting `step`
supplies Number `1`; supplying `0` does not omit it. The start result initializes the loop variable. The limit
and step results are retained for subsequent tests and updates: assigning to
an outer variable used by a header expression does not reevaluate that
expression or replace its retained result.

The header expressions use the enclosing scope. Only the body has the new
local binding named by `name`, so a same-named reference in the header still
refers to its enclosing binding. The loop binding is not visible after the
loop. A distinct local declared inside the body can shadow it in the usual
lexical way.

<div class="keep-together">

Before each body entry, let `i` denote the current loop variable, `limit` the
retained limit, and `step` the retained step. The selector and exit tests are:

| Selector | Exit before the body when | Finite-Number reading |
| --- | --- | --- |
| `0 < step` is true | `limit < i` | The body is allowed while `i <= limit`. |
| `0 < step` is false | `i < limit` | The body is allowed while `i >= limit`. |

</div>

The exit predicates are the strict comparisons shown, not universal
`<=`/`>=` tests. The inclusive paraphrases apply to finite Numbers; they do not
establish termination for every Number value. For Number operands, the loop
uses ordinary Number arithmetic rather than an integer-only counter.

Ordinary fallthrough from the body adds the retained step to the loop
variable's **current** value, then repeats the selector and test. Assignment to
the unshadowed loop variable is permitted and changes that same control
variable, not a hidden copy. It affects the tail addition and next test; it
does not trigger a new range check halfway through the body. A `break` leaves
the loop without performing the tail addition.

An explicit zero step is accepted, not replaced by one or rejected as a
zero-step error. It takes the second test above. With finite Numbers, a start
below the limit skips the body, while a start equal to or above the limit
allows initial entry. If the body leaves the variable unchanged, adding zero
makes no counter progress. Changing the loop variable can make the next test exit; `break` can leave
immediately.

The control path uses ordinary [Number addition and comparison](cpu.md#values-and-numeric-instructions);
header and body calls have the usual [call and result-adjustment costs](cpu.md#calls-closures-globals-and-tables).
Use the [instruction-cost guide](cpu.md#blua-operators-and-instruction-costs) and
[cycle-accounting boundaries](cpu.md#cycle-accounting-and-execution-boundaries)
for the selected instructions and executed path, rather than assigning the
source loop a fixed per-iteration cycle charge.

<a id="complete-program-generic-iteration"></a>

### Generic `for`

A generic `for` obtains each set of loop-variable values by calling an iterator:

```text
for name [, name ...] in expression [, expression ...] do
    block
end
```

There must be at least one loop name and one expression after `in`.

Before the first iteration, the expression list is evaluated once, in source order, and adjusted to three values: **iterator, state, control**. Each expression before the last supplies one value. Only the final expression can supply multiple results: a final call or `...` can fill the remaining entries. Missing entries become `nil`; surplus values are discarded. With three or more expressions, each supplies one value and only the first three values are retained. **Every expression is still evaluated**, including expressions whose results are discarded. Their effects and errors occur before the first iterator call.

A final parenthesized `(factory())` supplies one value to this list. Use an
unparenthesized final call when the iterator factory returns iterator, state
and control together.

The three retained values are cached, not recomputed on subsequent iterations. Rebinding a source variable does not replace its cached value. Caching a mutable value does not copy its contents: changes to shared contents remain visible.

<div class="keep-together">

Each attempted iteration calls exactly:

```text
iterator(state, control)
```

</div>

The call requests as many results as there are loop names. Extra results are discarded and missing results become `nil`.

- If the first adjusted result is `nil`, the loop ends without assigning that call's results to the loop variables or executing the body.
- Otherwise, all adjusted results are assigned to the visible loop variables. The first result also becomes the hidden control value **before** the body starts. After the body, the next iterator call uses that control.

Only `nil` stops iteration: a first result of `false` continues and becomes the next control value. A later result of `nil` does not stop the loop. See [values](cpu.md#values-and-numeric-instructions).

The visible loop variables are writable locals. Reassigning them in the body does not change the already saved hidden control; the next successful iteration replaces their values with new results. Their lexical scope is the loop body. The new locals are not in scope in the `in` expressions or after `end`; a loop name in its own initializer does not refer to the new local.

A reached `break` exits the nearest enclosing loop, skipping the remaining body and subsequent iterator calls.

Iteration uses [ordinary calls](cpu.md#calls-closures-globals-and-tables), passing state and control unchanged. A non-callable iterator causes an error at the attempted call, not an empty loop. Other errors occur at the expression, call or body operation reached. The ordinary [execution costs and boundaries](cpu.md#cycle-accounting-and-execution-boundaries) apply to the loop operations, iterator calls and body.

See the [BIOS iteration routines](bios-base.md#traversal-argument-selection-globals-and-output).

### Labels and goto

Labels use `::name::` and branches use `goto name`.

Label names have **function-wide scope**, not block scope. A `goto` can name a label written before or after it, including a label in another lexical block of the same function. A nested function has its own label names: a label in another function cannot satisfy the jump. Each chunk also has its own label scope.

A second label with the same name in one function is rejected as `Duplicate label 'name'.`, even if the labels occupy different blocks. A target name not defined in that function is reported as `Missing label(s): ...`. A same-spelling label in a separate function is independent.

BLua does not reject a jump merely because it crosses a local declaration or enters or leaves a lexical block. The jump must still have a defined target and an encodable displacement. These are not checks on local scope or initialization.

A forward jump can skip local initialization; a backward jump resumes at its
earlier target with existing values. Jumps insert neither initialization nor
capture-close operations at crossed block boundaries. Keep required
initialization and state changes on the executed path.

## Named BIOS function imports

The named BIOS function imports are:

<div class="keep-together">

| Module path | Arguments and returned values | Routine reference |
| --- | --- | --- |
| `math/sin` | One turn-phase word; returns one signed integer Q16 sine. | [Turn-phase sine](bios-math.md#turn-phase-sine) |
| `string/float/decode` | High word, low word and byte count; returns one Number decoded from the supplied floating-point words. | [Floating-point word decoder](bios-string.md#floating-point-word-decoder) |
| `gpu/system_vram_region` | No arguments; returns packed origin and extent words for the BIOS VRAM reservation. | [Firmware reservation in VRAM](memory.md#firmware-reservation-in-vram) |

</div>

<div class="keep-together">

Each path names a root static function. Import and call them as follows:

```lua
local sin_turn32<const> = require('math/sin')
local decode_float<const> = require('string/float/decode')
local system_vram_region<const> = require('gpu/system_vram_region')

local sine = sin_turn32(0x40000000)                 -- 65536: +1 in Q16
local decoded = decode_float(0x3fa00000, 0, 4)    -- 1.25
local origin<const>, size<const> = system_vram_region()
```

</div>

`math.sin(angle)` is not the turn-phase import: the ordinary Math-library
function takes radians and returns an unscaled Number. Likewise, the floating
word decoder does not read a String or a memory address. Follow the routine
references for complete units, field packing and result contracts.

These paths are reserved published BIOS names. Importing one selects its
static call target; it leaves ordinary program-module initialization
unchanged. A program module cannot redefine one of these paths. Other BIOS
libraries use their installed globals unless a named import is listed.

## The installed program environment

Before normal cartridge entry, the BIOS installs the base functions and publishes the library names `table`, `string`, `coroutine`, `lua_compiler`, `load`, `os`, and `math`. A cartridge entering through this path can use those installed bindings without installing the libraries itself.

These are ordinary public bindings. A program can change them; their initial presence does not make their values immutable. Nor does installation provide a private copy of the global environment for each cartridge.

### Ordinary globals are a name bank

Ordinary global values belong to a shared bank indexed by String names. This bank is separate from the system-global bank. It is not an ordinary Table, and accessing it is not Table indexing.

A previously unseen ordinary name begins with `nil`. When another program image registers the same ordinary name, it uses the existing shared binding; registering the name does not clear its value. Do not assume that moving between program images gives every name a new `nil` value.

The BIOS installers described here do not install `_G` or `_ENV` as global-environment Tables. The installed environment therefore does not supply `_G[name]` or replacement of `_ENV` as its name-based access interface. This is an installation statement, not an additional source-identifier or loader-environment rule.

<div class="keep-together">

### Accessing a global by name

Use the installed functions `getglobal` and `setglobal` to access the ordinary global bank by name.

| Call | Arguments | Results |
| --- | --- | --- |
| `getglobal(name)` | `name` must be a String. | One value: the current ordinary global value, or `nil` if the name is absent. |
| `setglobal(name, value)` | `name` must be a String. A reached call with an absent value writes `nil`; BLua source supplies an explicit `nil` to meet the known-call minimum. | No result values. |

</div>

`setglobal` writes the named binding, creating it when necessary. Writing `nil` is a write of `nil`; it is not a request to clear the whole bank. Both functions address the ordinary global bank directly, rather than a caller-supplied environment Table.

For example, `setglobal("score", 100)` makes `getglobal("score")` return `100`. A subsequent `setglobal("score", nil)` writes `nil`, so `getglobal("score")` then returns `nil`.

### Installed names and library Tables

The base installation provides these public names:

- `next`, `type`, `setmetatable`, `getmetatable`, `rawget`, `rawset`;
- `getglobal`, `setglobal`, `select`;
- `error`, `pcall`, `xpcall`, `assert`;
- `rawequal`, `tostring`, `tonumber`, `print`, `ipairs`, `pairs`.

This is the base installation inventory, not a restriction on names that a program or module may introduce. Consult the [base reference](bios-base.md) for detailed function behavior; the two name-based global operations are specified above.

<div class="keep-together">

Several other installed globals hold ordinary library Tables. The distinction matters: `string` is a global binding, while the library Table initially held by that binding is a separate value.

| Installed name | Interface navigation |
| --- | --- |
| `table` | The Table library. See the [Table reference](bios-table.md) for its operations. |
| `string` | The completed String library Table, also registered for String indexing. See the [String reference](bios-string.md) for indexing and library behavior. |
| `coroutine` | The coroutine library Table. See [Protected calls and coroutines](coroutines.md). |
| `math` | The [mathematics library](bios-math.md), including numeric domains, radian trigonometry and random-number state. |
| `os` | The [time and date library](bios-os.md): cycle-derived elapsed time and deterministic civil-time conversion, not filesystem or process services. |
| `lua_compiler` | A Table containing `compile_syntax`, `syntax_factory`, and `load`, for the BIOS runtime-compilation interface. |
| `load` | Initially the same function value as `lua_compiler.load`; see the runtime-compilation boundary below. |

</div>

Use those routine chapters for argument domains, precision, errors, random-number behavior and timing conventions.

### Public bindings and library references

Public library bindings can be reassigned. A saved Table or function reference
continues to refer to its original value after the global name changes.
The BIOS also retains some dependencies at installation: `assert` keeps its
selection and error operations, `print` keeps its console destination, and
String operations retain their listed helper functions. `pairs` instead
reads the current global `next`; `print` reads current `select` and `tostring`;
`tonumber` reads current `type` and `error`.

String method lookup uses the installed String-index Table. Reassigning the
`string` global leaves that method Table in place. The routine references
describe any further dependency relevant to replacing an installed binding.

### Fresh system boot and execution transfer

Fresh system boot clears both global-name banks, then installs the BIOS
environment before normal program entry. `EXEC` keeps the existing banks
and BIOS bindings while replacing execution. Initialize program-owned globals
explicitly when transferring between programs. See [CPU execution
control](cpu.md#exec) for the complete transfer behavior.

### Runtime compilation

Use BIOS `load` to compile supported text during execution. On success it
returns a closure; a protected compilation failure returns `nil, errorValue`.
The [runtime-compilation reference](bios-loader.md) specifies the accepted
text language, environments, external bindings and errors.

The BIOS monitor maintains its own session environment. Monitor variables
and loaded-chunk environments are separate from the ordinary global bank;
use the appropriate interface for the names being read or written.

<a id="complete-program-modules-and-ordinary-globals"></a>

## Worked module linkage

An ordinary module named `counter` can publish a mutable runtime object:

```lua
local counter = { value = 10 }
function counter.advance(amount)
    counter.value += amount
    return counter.value
end
return counter
```

Its importer begins after that top-level initialization:

```lua
module<entry>
local first = require('counter')
local second = require('counter')
local before = first.advance(2)
local after = second.advance(3)
```

`before` is 12 and `after` is 15. Both imports select the same export, not two
instances. Neither written import reruns the initializer. A dependency written
inside a function is still initialized before entry; imports express dependency
order rather than deferred loading.
