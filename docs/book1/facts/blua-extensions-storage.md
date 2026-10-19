# BLua storage/address extensions: frozen source facts

Baseline inspected: HEAD `d5f491bd3`. Read-only extraction; no repository edits, builds, tests, architecture document, public manual chapter or PDF used. Source references below are relative to `/home/boaz/BMSX`. This packet is finite: declarations, layouts, typed address views and their direct load/store boundary; raw `mem[...]` forms belong to the sibling intrinsics packet.

## 1. Programmer syntax inventory

| Form | Source fact | Owning source |
|---|---|---|
| `struct name field: type_name ... end` | Name and field names are identifiers. Each field has `:` then type. Comma/semicolon separators are accepted; empty semicolon statements are skipped. | `toolchain/ts/lua/syntax/parser.ts:465-491` |
| `bss name: Type` | No initializer in this grammar; optional trailing semicolon. | `toolchain/ts/lua/syntax/parser.ts:494-507` |
| `data name: Type = initializer` | Initializer expression required; optional trailing semicolon. | `toolchain/ts/lua/syntax/parser.ts:509-525` |
| `rodata name: Type = initializer` | Initializer expression required; optional trailing semicolon. | `toolchain/ts/lua/syntax/parser.ts:527-543` |
| `Type[n][m]` / `Type[]` | A type is an identifier followed by zero or more bracketed expression lengths; empty brackets parsed as inferred length. | `toolchain/ts/lua/syntax/parser.ts:1429-1443` |
| `local p: *Type = address` | Local annotation is colon, star, then type reference, not a scalar local-value annotation. Optional attribute precedes annotation, e.g. `local p<const>: *word = address`. | `toolchain/ts/lua/syntax/parser.ts:613-644,669-675`; actual BIOS `machine/bios/kernel/dma.lua:4-8` |
| `*p` / `*p = value` | Unary star parsed as dereference; parser accepts it as an assignment target. Codegen requires resolved typed storage/view, not an arbitrary numeric expression. | `toolchain/ts/lua/syntax/parser.ts:1078-1081,1553-1562`; `toolchain/ts/lua/compiler.ts:4060-4087,5308-5322` |
| `storage.field`, `p.field`, `storage[i]`, `p[i]` | Named field offsets and indexed element strides are compile-time type-directed address selection. | `toolchain/ts/lua/compiler.ts:1673-1687,4982-5023,5025-5125` |
| `&storage`, `&p.field`, `&p[i]` | Unary ampersand resolves a typed storage address first. The same parser operator also serves string-id use; do not describe it as a general C address-of for arbitrary locals. | `toolchain/ts/lua/syntax/parser.ts:1053-1057`; `toolchain/ts/lua/compiler.ts:5248-5277` |
| `sizeof(Type)` | Takes a type reference, including array dimensions, not a value expression; produces resolved byte size. | `toolchain/ts/lua/syntax/parser.ts:1356-1366`; `toolchain/ts/lua/compiler/static_constants.ts:38-39` |
| `offsetof(Type.field.nested)` | One identifier type plus dot-separated field names; no indexed array path syntax. Returns accumulated field byte offsets; intervening selected fields must themselves be non-array structs. | `toolchain/ts/lua/syntax/parser.ts:1368-1387`; `toolchain/ts/lua/compiler/struct_types.ts:128-143` |
| `#storage_array` | Outer-dimension element count for declared static arrays (also resolved static module storage exports), not byte size or total multidimensional element count. | `toolchain/ts/lua/compiler.ts:5127-5168,5296-5302`; `toolchain/ts/lua/compiler/static_constants.ts:128-143` |

The declaration words are recognized contextually as identifier-based declaration headers (`struct name`, and storage word/name/colon), not shown as lexer-reserved keywords here. Source: `toolchain/ts/lua/syntax/parser.ts:437-463`.

## 2. Full primitive layout/access inventory

All sizes/alignment values are bytes. Actual declarations are authoritative; signed-looking aliases do not select a signed load datapath.

| Type | Size | Alignment | Selected access | Read/write representation |
|---|---:|---:|---|---|
| `u8`, `i8` | 1 | 1 | U8 | Unsigned byte read; low-byte store |
| `u16`, `i16` | 2 | 2 | U16LE | Unsigned little-endian 16-bit read; low 16-bit store |
| `u32`, `i32` | 4 | 4 | U32LE | Unsigned little-endian 32-bit read; low 32-bit store |
| `f32` | 4 | 4 | F32LE | IEEE float32 bits, read as guest numeric value; numeric value rounded to float32 on store |
| `f64` | 8 | 4 | F64LE | IEEE float64 bits; two little-endian 32-bit mapped accesses |
| `addr` | 4 | 4 | U32LE | Same raw 32-bit datapath as `u32`; not an automatic typed pointer |
| `word` | 4 | 4 | Word | Raw unsigned mapped 32-bit word, exposed as numeric value; not a serialized guest tagged value |
| `string` | 4 | 4 | const-pool reference | Stored image constant-pool index, read U32LE then generic LOADKR; not in-place text bytes or a UTF-8 pointer. The RODATA String initializer supplies a String reference; an arbitrary view does not force the selected constant's tag. |

Sources for the complete primitive list and exact aliases: `toolchain/ts/lua/compiler/struct_types.ts:44-56`. Six memory kinds and matching TS/C++ alignment masks: `machine/ts/spec/blua32/memory_access_kind.ts:1-10`; `machine/cpp/spec/blua32/memory_access_kind.h:8-24`. Numeric load/store consumers (including unsigned reads and F32 conversion): `machine/ts/machine/cpu/cpu.ts:3080-3153`; `machine/cpp/machine/cpu/cpu_dispatch.inl:621-669`. Integer RAM and mapped access low-bit storage follows `machine/ts/machine/memory/memory.ts:603-620,627-656` and `machine/cpp/machine/memory/memory.cpp:498-550`; byte write boundary is `memory.ts:466-479` / `memory.cpp:356-369`. Float bit conversion: `memory.ts:573-588,659-671`; `memory.cpp:463-480,553-567`. String field load: `toolchain/ts/lua/compiler.ts:5181-5189`.

Important teaching constraint: `i8`, `i16`, `i32` are accepted names but the inspected type-owner and CPU consumers give them the SAME unsigned reads as their `u*` counterparts. No signed extension is emitted. Do not promise negative sign-preserving scalar loads from these names. This is an observed alias, not a proposed correction.

### Struct/array layout rules

- Field placement is declaration order, align-up each offset to the field type's alignment; struct alignment is maximum field alignment; final size is rounded up to that alignment. `toolchain/ts/lua/compiler/struct_types.ts:146-167`.
- Nested structs and arrays use their resolved size/alignment; an array size is base size multiplied by all dimensions and retains base alignment. There is no packed-layout flag in the inspected type grammar/owner. `struct_types.ts:58-69,83-105,154-164`.
- Duplicate fields and recursive layouts are compile-time errors. Unknown type and unknown field are compile-time errors. `struct_types.ts:128-152,155-158`.
- Type syntax has block-wide forward visibility; scope lookup walks enclosing scopes then globals. Storage value syntax remains ordered. `toolchain/ts/lua/semantic/static_declarations.ts:49-60`.
- Explicit dimensions must evaluate to positive compile-time integers. Only the outer dimension of initialized data/rodata may be inferred, from table field count; inferred arrays must contain at least one element. BSS `[]`, inner `[]`, field `[]` and local-view `[]` have no inference source. `struct_types.ts:83-104,107-122`.

Derived layout teaching example (arithmetic derived solely from the cited layout owner, not executed):

```lua
struct sample
    tag: u8
    value: u32
    weight: f64
end
-- tag offset 0; value offset 4; weight offset 8
-- sizeof(sample) = 16; alignment = 4
bss samples: sample[2]
local p: *sample = samples
p[0].value = 7
local value = p[0].value
local address = &p[1].weight
local bytes = sizeof(sample[2])  -- 32
local offset = offsetof(sample.weight) -- 8
local count = #samples -- 2
```

This is owner-derived syntax, NOT a claimed tested cartridge example or an actual BIOS struct usage.

## 3. Storage section/initialization facts

- Declaration compilation records section objects and initializer bytes rather than emitting a runtime table for initializer syntax. BSS records type/size; data and rodata recursively encode initializer bytes at compile time. `toolchain/ts/lua/compiler.ts:3701-3733`.
- Each symbol begins at its type alignment; each section's next symbol cursor is rounded to 4 bytes. Thus separate `u8` symbols are not promised byte-tight packing, unlike fields/elements inside one declaration. `compiler.ts:609-683`.
- Arrays require positional table elements and exact declared outer length. Nested arrays recurse one dimension per nested initializer. Structs require identifier-named fields; unknown, duplicate and missing fields reject compilation. Padding starts zero because encoded storage uses a zero-filled byte array. `compiler.ts:3729-3783`.
- Updated by `3d49ea3d5` (2026-10-19): integer-storage initializers still require compile-time integers. F32LE/F64LE `.data` and `.rodata` initializers accept compile-time numbers and write binary32/binary64 little-endian, preserving negative zero; F32 rounds at storage encoding. The recursive scalar/array/struct writer shares one DataView per declaration. `compiler.ts:3735-3742,3806-3830`; exact encoded words and actual typed reads at O0–O3: `tests/lua/section_bss.test.ts:623-659`. This supersedes the original 2026-10-18 integer-only initializer snapshot; storage sizes and alignments are unchanged.
- Static string initializers must be compile-time strings and only work in `.rodata`; string fields in `.data` reject. Compiler writes constant index plus relocation, not text bytes. `compiler.ts:3788-3798`; linker retains index relocation at `toolchain/ts/rompack/blua32_linker.ts:853-857`.
- `.data` runtime addresses are RAM section base plus symbol offset; `.data` load addresses point to ROM image bytes. `.bss` is RAM base plus symbol offset, `.rodata` is image section address plus symbol offset. `blua32_linker.ts:351-369`.
- The compact linker layout puts system DATA at `DYNAMIC_RAM_BASE`, then its BSS; cartridge DATA starts at the matching BIOS link artifact's `cartridgeStaticRamBase`, then its BSS. This is link-time placement policy and fit checking, not a resident BIOS allocator or hardware adjacency requirement. `blua32_linker.ts:1099-1154`; actual activation/boot and alternate-placement boundary in [memory-rom-header.md](memory-rom-header.md#bios-link-information-and-static-placement-boundary).
- Cartridge image puts rodata and data-load bytes in 4-byte-aligned image sections; the source load address determines actual addresses. `blua32_linker.ts:712-719,840-841`.
- Generated section init copies `.data` ROM load bytes into runtime RAM using word loads/stores, then zeroes `.bss` using word stores. Generated startup calls section init before static module initializers and entry. Initialization is guest code performing mapped accesses, not a host-side implicit allocation. `compiler.ts:1505-1558,1561-1584`.
- Reading a bare static storage identifier yields its linked numeric address, including scalar storage. Use `*scalar_storage` to read/write its scalar value. Direct rebinding of BSS/data is rejected; use a typed pointer or field. `compiler.ts:2776-2789,2863-2866`; BIOS demonstrates `*bios_dma_completion_sequence` at `machine/bios/kernel/dma.lua:14-21`.

## 4. Typed views, address units and restrictions

- A local typed view stores type metadata in compiler binding `structView`; the runtime register still carries the initialized value/address. The annotation does not allocate a struct/table/buffer or change the underlying integer address. `toolchain/ts/lua/compiler.ts:3979-4007,5065-5085`.
- `local p: *T` is a view, not ownership. Ordinary numeric addition to that register is ordinary byte-address arithmetic; typed `p[i]` multiplies index by element byte size. Concrete mutable byte-pointer traversal is BIOS `machine/bios/string/utf8.lua:10-18`; indexed word use is `machine/bios/math/sin.lua:46-56`.
- Array indexing is zero-based: effective byte offset is `index * elementType.size` with no subtraction of 1. Multidimensional indexing drops one dimension and uses the remaining array size as stride. Declared array lengths do not produce an index bounds check in the inspected lowering. A statically known noninteger index rejects compilation; no corresponding runtime integer/bounds check is emitted by this lowering. `compiler.ts:4982-5023`.
- Roots (BSS/data/rodata identifiers and typed locals) allow pointer indexing even if type is scalar/struct; after indexing, dereferencing or selecting a field, pointer-index permission clears unless the result is actually an array. Nested field names add known byte offsets. `compiler.ts:1673-1687,4982-5004,5025-5120`.
- Dereference does not strip an array dimension or read an address stored in a field: it retains the selected type and clears pointer-index permission. Scalar value use then requires scalar access metadata. Whole structs/arrays are address ranges, not first-class copied aggregate values; errors request `&` or a scalar field. `compiler.ts:5105-5120,5170-5189`.
- `addr` fields read numeric addresses only. The inspected resolver does not infer a pointed-to struct from an `addr` field; create an explicitly annotated local view of that numeric value before selecting its target layout. `struct_types.ts:53`; `compiler.ts:1673-1676,5065-5085`.
- `&typed_selection` materializes base address plus byte offset, without a memory read of the selected value. A bare storage identifier already yields the same base address. `compiler.ts:2776-2789,5192-5205,5248-5252`.
- Direct rodata selections propagate `readOnly`; assignment rejects. Whole-struct/array assignment rejects. Static string-reference assignment rejects. Local view resolution sets `readOnly: false`, so a local typed view does NOT carry rodata provenance or const-pointer protection. `<const>` makes the local binding immutable, not the pointed-at storage immutable. `compiler.ts:4062-4077,5053-5085`; concrete BIOS `<const>` pointer stores: `machine/bios/kernel/dma.lua:4-8,28-32`.
- `#` static-array count recognition inspects static identifiers/module exports, not arbitrary typed local view expressions or selected fields. Do not promise `#p` as pointer capacity. `compiler.ts:5127-5168,5296-5302`; `static_constants.ts:128-143`.
- Address instructions use byte offsets in compiler ownership; aligned nonnegative encodable offsets may lower to displaced opcodes with offset shifted right 2. CPU shifts encoded displacement left 2; no programmer-visible change to units. `compiler.ts:5208-5245`; `machine/ts/machine/cpu/cpu.ts:2992-3001`; `machine/cpp/machine/cpu/cpu_dispatch.inl:554-556,579-581`.

## 5. Paired runtime boundary and side effects (bounded)

TS/C++ match for the inspected six access-kind values, alignments and CPU dispatch choices. No owner/spec/mirror disagreement was found within this inspected subset; this is not an all-runtime parity claim.

| Boundary | Exact behavior | TS / C++ sources |
|---|---|---|
| Effective address | Numeric register/RK address converted to unsigned 32 bits; displaced form adds encoded displacement times 4 | `machine/ts/machine/cpu/cpu.ts:2992-2998,3080-3084,3117-3121`; `machine/cpp/machine/cpu/cpu_dispatch.inl:554-555,579-580,621-623,646-648` |
| Alignment | U8 any byte; U16 2-byte; Word/U32/F32/F64 4-byte. Misaligned load/store enters synchronous address exception before mapped access. F64 is not 8-byte-aligned by this ABI. | `machine/ts/spec/blua32/memory_access_kind.ts:10`; `machine/cpp/spec/blua32/memory_access_kind.h:17-24`; `cpu.ts:3084-3087,3121-3124`; `cpu_dispatch.inl:623-626,648-651` |
| Mapped write readiness | Store checks mappedWriteReady and blocks before writing if not ready | `cpu.ts:3125-3128`; `cpu_dispatch.inl:652-655` |
| Bus fault | CPU records sequence before access; changed sequence produces synchronous data-bus exception. Failed load does not set destination register. | `cpu.ts:3088-3115,3129-3153`; `cpu_dispatch.inl:627-643,656-669` |
| MMIO words | Word/U32 mapped reads/writes go through mapped bus/IO slot handler, not inert RAM. Read-only slots fault; writes invoke owning handler. | `machine/ts/machine/memory/memory.ts:426-435,524-525,544-550,627-656`; `machine/cpp/machine/memory/memory.cpp:316-325,414-415,434-435,522-550` |
| Narrow MMIO | U8 read at an aligned IO slot reads its handler then masks low byte; other byte positions fault. Mapped U8 writes in IO region fault. U16 mapped reads/writes in IO region fault. Do not recommend byte/halfword MMIO just because struct field access permits it elsewhere. | `memory.ts:442-451,466-469,503-507,603-607`; `memory.cpp:332-341,356-360,393-397,498-502` |
| Float32 | Mapped U32 bits are reinterpreted as F32; stores convert numeric F32 to its bits then mapped U32 write | `memory.ts:573-575,659-661`; `memory.cpp:463-467,553-556` |
| Float64 | Low word then high word at +4; second access is skipped if first faults. Two mapped words are not a promised atomic transaction; the first write can already have occurred if the second faults. | `memory.ts:578-588,664-671`; `memory.cpp:470-480,559-567` |
| Static string field | U32LE load produces constant index, then LOADKR returns referenced image constant; stored word is not an asset byte pointer | `toolchain/ts/lua/compiler.ts:5181-5189` (LOADKR CPU implementation itself not inspected) |

Actual BIOS hardware example: `machine/bios/kernel/dma.lua:26-33` writes source address, destination address, transfer word count, control word, then trigger through typed `*word` locals. The language view does not rescale the explicitly named `word_count`; that device-register unit comes from the BIOS/device contract, not pointer indexing. Do not infer a complete DMA API/bitfield contract from this packet.

## 6. Practical actual BIOS pointers by principal covered form

| Principal form | Verified actual BIOS example | What it demonstrates |
|---|---|---|
| Scalar BSS + star load/store | `machine/bios/kernel/dma.lua:14-21,26-33` | Static completion sequence and explicit dereferenced scalar updates |
| BSS byte array + typed local + zero-based indexed store | `machine/bios/tty/console.lua:15-30` | `bss console_history: u8[history_capacity]`; `local history<const>: *u8 = console_history`; ring-buffer byte write |
| BSS byte array + indexed load | `machine/bios/tty/console.lua:54-64` | Iterative `history[read_index]` byte reads |
| Read-only word array + integer initializer + typed indexed reads | `machine/bios/math/sin.lua:1-8,43-56` | `rodata sin_quarter_lut: word[257]`, `local lut<const>: *word = sin_quarter_lut`, indices `index` and `index + 1` |
| Mutable local byte view + dereference + byte address arithmetic | `machine/bios/string/utf8.lua:8-18,23-28` | Packed UTF-8 bytes cross into BLua strings at an explicit decoder; `source = source + 1` |
| MMIO pointer declaration + scalar stores | `machine/bios/kernel/dma.lua:4-8,28-32` | Actual mapped register addresses from BIOS; `<const>` pointer binding still permits store-through |
| MMIO character output | `machine/bios/tty/console.lua:6-7,32,51` | `*word` writes to print/flush devices |

No actual BIOS struct declaration/field-layout use, `data` declaration, `sizeof`, `offsetof`, unary address-of-storage or static-array `#` example was established in this finite pass. Do not label the owner-derived sample above as BIOS evidence. Search results for ampersands included bitwise operators, which are not unary address-of evidence.

## 7. Exact gaps / do not generalize

- No build, compiler invocation, cartridge execution or runtime test was performed. Derived examples are source-supported syntax/arithmetic, not validated example outputs.
- No new ABI, helper, fallback, signed conversion, type validation, address constant or proposed fix is supplied.
- No general Lua exposition/comparison, BIOS-library catalogue, full DMA/GPU/TTY specification, memory-map enumeration or complete CPU/device audit.
- No claim that the guest-resident compiler in `machine/bios/compiler/` implements the same extension set: that parser/compiler was not inspected for extension parity. This packet is the cartridge toolchain compiler/parser implementation.
- Raw mem-family names/semantics belong to sibling intrinsics extraction. Narrow MMIO warnings above are only the direct consequences observed at the memory access boundary.
- Initial extractor did not inspect LOADKR implementation. Independent review then verified generic constant selection, not a String-enforcing read: TS `machine/ts/machine/cpu/cpu.ts:2802-2809,3524-3528`; C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:719-721`. Initializer-owned String production remains `toolchain/ts/lua/compiler.ts:3788-3797`. Invalid-index behavior, ROM-write protection and malformed runtime values remain uninspected. Do not turn local compiler readOnly metadata into a global hardware-protection guarantee.
- Static storage declarations nested in arbitrary functions/branches, cross-module struct exports, module lifetime/init-repeat behavior and IDE Hot Resume behavior were not traced end-to-end. The static collector inspected at `toolchain/ts/lua/compiler/passes/static_storage.ts:17-54` walks chunk-level statements; semantic syntax indexing inspected at `toolchain/ts/lua/semantic/static_declarations.ts:70-99` walks AST nodes. No general placement restriction or guarantee is asserted from these distinct responsibilities.
- Initializer expression folding has two compiler evaluators: `static_constants.ts` used for dimension/layout constants and compiler's full expression evaluator used by encoded scalar initialization. No universal expression whitelist is claimed; the hard requirements above are the checked shape/type restrictions at `compiler.ts:3736-3817`.
- Finite static type owner inventory inspected: 11 primitive names, arrays, nested nonrecursive structs; no union/bitfield/packed/pointer-field declaration form appears in the inspected grammar/type owner. Do not infer an alternate guest ABI from absent forms.
