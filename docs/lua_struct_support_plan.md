# BMSX Lua Struct Support Plan

## Target

Add first-class `struct` support to BMSX Lua so cart, BIOS, and engine code can describe packed machine records once and then fill RAM, read RAM/ROM, or submit contiguous record arrays through DMA without table objects, string blobs, packet-builder wrappers, or cart-local encoding helpers.

The feature is a compiler and ABI feature. A struct value is not a Lua table and does not allocate a runtime object. A struct reference is a typed address view over BMSX memory. Field reads and writes lower to existing memory loads and stores at deterministic byte offsets.

## Disease being removed

Current low-level VDP/RPU cart code manually orders packet words, repeats field offsets, and builds packet streams through ad-hoc Lua expressions. `string.pack` can create bytes, but it creates an intermediate string and still requires a copy into RAM before DMA can see the data. Wrapper functions only hide the ugliness; they do not make the RAM layout the owned representation.

The real representation should be the RAM or ROM record layout itself:

- producers write fields directly into that layout;
- DMA receives an address and byte count for that layout;
- consumers decode the raw words at device/datapath boundaries;
- weird but representable field bits remain deterministic hardware input.

## Non-goals

- Do not implement LuaJIT FFI, Terra, or a C parser.
- Do not make structs tables, userdata, metatables, or GC-managed objects.
- Do not use `string.pack` as the hot-path primitive representation.
- Do not add cart-local VDP/RPU ABI helpers to hide packet layout.
- Do not add runtime validation for internal compiler-emitted struct records.
- Do not add safe fallbacks for stale, corrupt, or weird but representable memory contents.
- Do not change VDP/RPU packet decoding into a high-level semantic API.

## Language model

### Declarations

Use a contextual `struct` declaration that defines a BMSX memory layout, not a host C type:

```lua
struct RpuDraw
	header: u32
	shader: u32
	primitive: u32
	pipeline: u32
	vertex_count: u32
end

struct VertexP3C4
	x: f32
	y: f32
	z: f32
	color: u32
end
```

The first implementation should support the field types needed for RAM/ROM records and RPU packets:

| Type | Size | Memory format |
| --- | ---: | --- |
| `u8` / `i8` | 1 | byte |
| `u16` / `i16` | 2 | little-endian |
| `u32` / `i32` | 4 | little-endian |
| `f32` | 4 | IEEE-754 little-endian |
| `f64` | 8 | IEEE-754 little-endian |
| `addr` | 4 | raw BMSX address word |
| `word` | 4 | raw u32 word alias for register/packet fields |

Arrays are part of the layout:

```lua
struct RpuTriangle
	header: word
	xy: word[3]
	color: word
end
```

### Layout rules

The layout must be deterministic and BMSX-owned, not inherited from the host compiler:

1. Default `struct` uses natural BMSX alignment: field alignment is the field size capped at 4 bytes.
2. `packed struct` can be added after the default path works; it removes padding for binary file formats and ROM blobs.
3. Struct size is rounded up to the struct alignment.
4. Arrays use `sizeof(element)` stride.
5. Nested structs are allowed only after field access, arrays, and DMA references are proven; initial implementation can reject nested structs at parse/semantic time.
6. `sizeof(T)` and `offsetof(T.field)` are compile-time constants.

### Typed memory views

A struct reference is a typed raw address. The register value is the address; the type exists in the compiler and diagnostics.

Proposed syntax:

```lua
local draw<const> = ref RpuDraw at rpu_draw_addr
draw.header = header
draw.shader = shader
draw.vertex_count = 3
```

Array view:

```lua
local draws<const> = ref RpuDraw[128] at display_list_addr
draws[i].header = header
draws[i].vertex_count = vertex_count
```

ROM view:

```lua
local mesh<const> = ref VertexP3C4[mesh_vertex_count] at mesh_rom_addr
local color<const> = mesh[0].color
```

The `ref Type at address` expression is the primary syntax for creating a
memory view. This keeps Lua 5.4 local attributes intact: `<const>` remains the
only local attribute used here, and the struct type lives in the expression that
creates the view.

```lua
local name<const> = ref StructName[array_count] at base_addr
```

The address expression stays visible and the compiler gets a typed view for
field lowering. `<const>` freezes the local binding; it does not make the
pointed RAM immutable. BMSX structs are address-backed only, so `ref` always
means memory view, not by-value struct storage.

The compiler resolves:

```lua
draws[i].vertex_count = vertex_count
```

into:

```lua
mem32le[display_list_addr + i * sizeof(RpuDraw) + offsetof(RpuDraw.vertex_count)] = vertex_count
```

without building a table, wrapper object, or temporary byte string.

### Address-of

Reuse `&` only where it names a real machine value:

```lua
local first_addr<const> = &draws[0]
local bytes<const> = sizeof(RpuDraw) * draw_count
```

`&struct_lvalue` returns the raw BMSX address of that struct element or field. Existing `&string` string-id behavior must remain distinct in semantic analysis; the compiler decides between string-id and address-of from the operand kind.

### Struct copies

Initial implementation should not support implicit whole-struct assignment:

```lua
-- reject initially; hidden copies are not the model
b = a
```

When needed, whole-record copy should be an explicit memory/DMA operation with an address and byte count. Field assignment remains direct and visible.

## RAM and ROM ownership

### RAM

RAM struct views are writable. Field stores use the existing memory access path:

- byte fields -> `mem8` / `STORE_MEM` U8;
- 16-bit fields -> `mem16le` / `STORE_MEM` U16LE;
- 32-bit word fields -> `mem32le` or `mem` where the ABI wants raw word semantics;
- float fields -> `memf32le` / `memf64le`.

Contiguous word field stores may be optimized into `STORE_MEM_WORDS` only when the compiler proves a contiguous word span. The optimization is optional and must not change the public representation.

### ROM

ROM struct views are readable. ROM writes should follow the existing bus/memory fault model; no struct-specific fallback or repair path is added.

Binary cart resources should expose address and length constants that can be bound to struct-array views:

```lua
local vertices<const> = ref VertexP3C4[rom_mesh_vertex_count] at rom_mesh_vertices_addr
```

This lets static assets be read by CPU or submitted by DMA without repacking into Lua strings.

## DMA model

Struct support should make DMA source/destination programming address-based:

```lua
local packets<const> = ref RpuTriangle[triangle_capacity] at sys_vdp_stream_base
packets[0].header = rpu_triangle_header
packets[0].xy[0] = xy0
packets[0].xy[1] = xy1
packets[0].xy[2] = xy2
packets[0].color = color

local src<const> = &packets[0]
local byte_count<const> = sizeof(RpuTriangle) * triangle_count
mem[sys_dma_src] = src
mem[sys_dma_dst] = sys_vdp_fifo
mem[sys_dma_len] = byte_count
mem[sys_dma_ctrl] = dma_ctrl_start
```

For ROM-to-device or RAM-to-device DMA, the DMA unit consumes raw addresses and byte counts. Struct typing never crosses into the device; the device receives bytes/words and decodes its own packet format.

## Compiler implementation plan

### Phase 0: Cart syntax dry run

This phase happens before parser or compiler work. It is an ergonomics gate, not
a runtime prototype.

Files likely touched:

- `docs/lua_struct_support_plan.md`
- optional throwaway sketch under `docs/` if the examples become too large

Work:

1. Pick one representative manual packet-writing section from
   `src/carts/bare_metal_cart/cart.lua`.
2. Rewrite that section as intended future Lua using `struct`, typed address
   bindings, field writes, `sizeof`, and `&struct_lvalue`.
3. Include the expected lowered memory operations next to the sketch.
4. Review whether the syntax still exposes the packet ABI clearly without
   repeating offsets, local encoding helpers, or wrapper calls.
5. If the sketch is awkward, change the language surface before Phase 1 starts.

Deliverable: an accepted cart-facing syntax sketch that is concrete enough to
judge the future `bare_metal_cart` migration before implementation cost is paid.

### Phase 1: Struct layout metadata

Files likely touched:

- `src/bmsx/lua/syntax/token.ts`
- `src/bmsx/lua/syntax/lexer.ts`
- `src/bmsx/lua/syntax/parser.ts`
- `src/bmsx/lua/semantic/model.ts`
- `src/bmsx/lua/semantic/frontend.ts`
- `src/bmsx/lua/semantic/diagnostics.ts`

Work:

1. Add contextual parsing for `struct Name ... end` and field declarations.
2. Add a typed memory-view expression: `ref Type at address`.
3. Add AST nodes for struct declarations, field declarations, type references,
   array lengths, and memory-view expressions.
4. Add a semantic struct table per file/module.
5. Compute `size`, `alignment`, field offsets, field memory access kind, and array stride during semantic analysis.
6. Reject duplicate field names, unknown field types, non-constant array lengths, and recursive layouts.
7. Emit diagnostics at compile time only; do not add runtime DTO validation.

Deliverable: parser/semantic tests that prove `sizeof`/`offsetof` and field offsets.

### Phase 2: Typed address flow

Files likely touched:

- `src/bmsx/machine/program/compile_value_flow.ts`
- `src/bmsx/machine/program/target_semantics.ts`
- `src/bmsx/machine/program/compiler.ts`

Work:

1. Add compiler value kinds for raw address, struct reference, struct array reference, and struct lvalue.
2. Resolve `ref T at expr` and `ref T[N] at expr` as typed address views.
3. Resolve `view.field`, `view[index]`, `view[index].field`, and fixed array fields such as `tri.xy[2]` to byte addresses.
4. Resolve `&view[index]` and `&view.field` to raw address values.
5. Keep the runtime register representation as a number; no object envelope.

Deliverable: compiled Lua tests that field reads/writes produce exact RAM bytes.

### Phase 3: Field load/store lowering

Files likely touched:

- `src/bmsx/machine/program/compiler.ts`
- `src/bmsx/machine/program/optimizer/index.ts`

Work:

1. Lower field reads to `LOAD_MEM` with the field's access kind.
2. Lower field writes to `STORE_MEM` with the field's access kind.
3. Lower runs of adjacent word fields to `STORE_MEM_WORDS` only as an optimization, not as a new semantic path.
4. Keep `memwrite` as the raw-word intrinsic and allow struct-derived addresses and compile-time sizes as inputs.
5. Do not add a new VM opcode unless an actual measured hot path requires it.

Deliverable: no CPU runtime change required for the first working slice.

### Phase 4: ROM resource integration

Files likely touched:

- `scripts/rompacker/rompacker.ts`
- `scripts/rompacker/rombuilder.ts`
- `system/romdir.lua`
- cart resource manifest generation

Work:

1. Expose binary resource base addresses and lengths as constants or ROM directory entries.
2. Allow those addresses to be bound to struct-array views.
3. Add tests that read known binary bytes from ROM through a struct view.
4. Keep binary resources binary; do not route them through Lua strings.

Deliverable: a ROM fixture containing a packed record array readable from Lua by direct addressing.

### Phase 5: DMA integration proof

Files likely touched:

- DMA register docs and tests
- VDP stream tests
- `docs/video_display_processor.md` if the public DMA/VDP submit contract needs clearer struct-array examples

Work:

1. Fill a RAM struct array from Lua.
2. Submit its address and byte count to DMA.
3. Verify the VDP stream decoder receives the exact same packet words as the FIFO path.
4. Add a ROM-to-VDP DMA test if the DMA device supports ROM sources.
5. Keep VDP decoding unchanged: packet words enter the existing stream ingress and RPU packet decoder.

Deliverable: focused VDP/RPU test that proves struct array -> DMA -> VDP packet decode.

### Phase 6: Cart migration slice

Files likely touched:

- `src/carts/bare_metal_cart/cart.lua`
- central BIOS/system RPU contract files, if they already own public constants

Work:

1. Define the first public RPU packet structs in the central RPU/VDP owner, not inside random cart files.
2. Replace one repeated manual packet-building section in `bare_metal_cart` with RAM struct-array writes.
3. Submit the same display list by DMA.
4. Keep raw constants and raw packet fields visible; do not introduce wrapper call chains.
5. Compare rendered/headless output against the existing demo path.

Deliverable: a small, reviewable cart change proving the syntax improves the primitive data path without hiding the ABI.

## Documentation updates

Add or update:

- `docs/lua_struct_support_plan.md` for this implementation plan.
- Lua language documentation for `struct`, `ref Type at address`, `sizeof`, `offsetof`, and `&` address-of behavior.
- `docs/video_display_processor.md` examples showing struct-array DMA into the VDP stream buffer after implementation.

The VDP/RPU hardware contract should still be written in packet/register terms. Struct definitions are a producer-side way to fill those packets; they are not the device contract itself.

## Validation menu

Use the smallest relevant checks while iterating, then the full slice gate before landing:

1. Phase 0 cart syntax sketch accepted before parser/compiler work starts.
2. Parser/semantic tests for struct declarations, memory-view expressions, field offsets, `sizeof`, and `offsetof`.
3. Compiled Lua CPU tests for RAM byte layout using `mem8`, `mem16le`, `mem32le`, `memf32le` reads after struct writes.
4. ROM fixture test for struct reads from a binary resource.
5. DMA/VDP integration test for struct-array packet submission.
6. `npm run build:game -- bare_metal_cart --force` after the cart migration slice.
7. Representative headless run for `bare_metal_cart`.
8. `npm run audit:core-parity` if any mirrored runtime/device path changes.
9. `git diff --check`.

## Acceptance criteria

The feature is ready when all of these are true:

- Struct field access compiles to direct memory loads/stores.
- Struct arrays are contiguous with deterministic BMSX-owned stride.
- `&struct_lvalue` returns the raw address usable by DMA/MMIO registers.
- ROM struct views can read static binary resources without Lua string packing.
- RAM struct views can fill DMA-visible records without tables or temporary strings.
- The first VDP/RPU demo path submits a struct-filled display list by DMA.
- The cart-facing syntax was reviewed before implementation and remained
  acceptable in the final migration.
- No random cart file owns local VDP/RPU encoding helpers.
- No runtime struct object, table facade, compatibility fallback, or defensive repair path is introduced.
