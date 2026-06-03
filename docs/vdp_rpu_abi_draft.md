# VDP RPU ABI Draft

This draft defines the data contract for the Render Processing Unit (RPU). The RPU is a memory machine: it consumes raw VDP-local addresses, byte counts, word counts, and fixed record layouts from its own local memory. It does not consume host graphics objects, renderer resource IDs, validated high-level draw commands, or memory snapshots.

**Machine invariant:** The VDP consumes raw VDP-local addresses, byte counts, and fixed record layouts. It does not consume host graphics objects, resource IDs, or validated high-level draw commands.

## VDP-Local Address Space

```
VDP-local address: 0 .. VDP_RPU_PARAM_MEM_SIZE-1   (u32, 4MB range)
System bus alias:  VRAM_STAGING_BASE + vdp_local_addr
```

Cart DMA pattern: the cart writes descriptor structs and vertex/constant data to the VDP's local memory using the system DMA unit with a destination in the VRAM_STAGING range. The FIFO then refers to these records by VDP-local address.

```lua
-- DMA destination uses system bus address:
mem[sys_dma_dst] = VRAM_STAGING_BASE + pass_desc_offset
-- EXEC_PASS_LIST uses VDP-local address:
rpu_fifo(VDP_RPU_OP_EXEC_PASS_LIST | (pass_count << 8), pass_desc_offset)
```

If a descriptor field contains a system bus address instead of a VDP-local address, the VDP raises a device fetch fault at fetch time. There is no admission validation; faults occur when the out-of-range address is actually fetched.

**SEAL_FRAME timing:** VDP-local memory is live. `SEAL_FRAME` commits the decoded command state, not a memory snapshot. Writes to VDP VRAM after `SEAL_FRAME` but before render completion may affect output. The cart must use status poll or IRQ to wait for RPU idle before updating live descriptors.

## Host output shape

```ts
export type VdpDeviceOutput = Readonly<{
	ditherType: number;
	scanoutPhase: number;
	scanoutX: number;
	scanoutY: number;
	frameBufferWidth: number;
	frameBufferHeight: number;
	rpu: VdpRpuFrameOutput;
}>;

export type VdpRpuFrameOutput = Readonly<{
	commands: VdpRpuCommandBuffer;
	vdpVram: Uint8Array;
}>;
```

`VdpRpuCommandBuffer` is a backend decode cache, not the ABI surface. It is produced from VDP-local descriptors by `EXEC_PASS_LIST`. It does not own resources, pin ranges, validate renderer state, or snapshot bytes.

## Descriptor Struct Layouts

All structs are packed, little-endian. All `addr` fields are VDP-local u32.

### RpuSurfaceDesc (16 bytes)

```
+0  u32 base_addr      — VDP-local byte address of pixel data
+4  u16 pitch_bytes    — row stride in bytes
+6  u16 width
+8  u16 height
+10 u8  format         — pixel format enum (RPU_SURFACE_FORMAT_*)
+11 u8  flags
+12 u32 _pad
```

### RpuStreamDesc (12 bytes)

```
+0  u32 vram_addr      — VDP-local byte address of vertex data
+4  u32 byte_length    — declared fetch window; reads beyond → fetch fault
+8  u16 layout_id      — stream layout spec index
+10 u8  slot           — vertex attribute slot
+11 u8  step_rate      — 0=per-vertex, N=per-N-instances
```

### RpuConstantDesc (12 bytes)

```
+0  u32 vram_addr      — VDP-local byte address of constant words
+4  u32 byte_length    — declared fetch window (word_count * 4)
+8  u8  slot           — constant bank slot
+9  u8  _pad[3]
```

### RpuTextureDesc (8 bytes)

```
+0  u32 surface_desc_addr — VDP-local addr of RpuSurfaceDesc
+4  u8  slot              — texture unit slot
+5  u8  flags
+6  u16 _pad
```

### RpuDrawDesc (44 bytes)

```
+0  u16 shader_variant
+2  u8  primitive
+3  u8  _pad
+4  u32 pipeline_word
+8  u32 vertex_count
+12 u32 instance_count
+16 u32 index_vram_addr    — absolute VDP-local addr of first index (0 = non-indexed)
+20 u32 index_count
+24 u8  index_type
+25 u8  stream_count
+26 u8  constant_count
+27 u8  texture_count
+28 u32 stream_descs_addr   — VDP-local addr of RpuStreamDesc[stream_count]
+32 u32 constant_descs_addr — VDP-local addr of RpuConstantDesc[constant_count]
+36 u32 texture_descs_addr  — VDP-local addr of RpuTextureDesc[texture_count]
+40 u32 _pad
```

### RpuPassDesc (36 bytes)

```
+0  u32 color_surface_desc_addr — VDP-local addr of RpuSurfaceDesc (0 = default fb)
+4  u32 depth_surface_desc_addr — VDP-local addr of RpuSurfaceDesc (0 = default depth)
+8  u32 viewport_xy             — packed x:16 y:16
+12 u32 viewport_wh             — packed w:16 h:16
+16 u32 ops                     — clear flags + load/store ops
+20 u32 clear_color
+24 u32 clear_depth_word
+28 u32 draw_descs_addr         — VDP-local addr of RpuDrawDesc[draw_count]
+32 u16 draw_count
+34 u8  _pad[2]
```

## Fixed capacities

```ts
export const VDP_RPU_PASS_CAPACITY = 64;
export const VDP_RPU_DRAW_CAPACITY = 4096;
export const VDP_RPU_STREAM_BINDING_CAPACITY = 8192;
export const VDP_RPU_CONSTANT_BINDING_CAPACITY = 8192;
export const VDP_RPU_TEXTURE_BINDING_CAPACITY = 4096;

export const VDP_RPU_PARAM_MEM_SIZE = 0x00400000;  // 4MB VDP-local memory
```

## Backend feature contract

The RPU is a GPU draw ABI. The WebGL/GLES2 backend must either support the required feature set or reject the RPU backend.

```ts
export const VDP_RPU_FEATURE_INSTANCED_ARRAYS = 1 << 0;
export const VDP_RPU_FEATURE_UINT_INDEX = 1 << 1;
export const VDP_RPU_FEATURE_DEPTH_TEXTURE = 1 << 2;

export const VDP_RPU_REQUIRED_FEATURES = VDP_RPU_FEATURE_INSTANCED_ARRAYS | VDP_RPU_FEATURE_UINT_INDEX;
```

## FIFO Command Encoding

FIFO command word encoding:
```
word 0:
  bits  0..7   opcode
  bits  8..23  count (for EXEC_PASS_LIST; 0 for SEAL_FRAME)
  bits 24..31  flags/reserved (must be 0)

word 1 (EXEC_PASS_LIST only):
  VDP-local byte address of first RpuPassDesc
```

```ts
export const VDP_RPU_OP_EXEC_PASS_LIST = 64;
export const VDP_RPU_OP_SEAL_FRAME     = 65;

export const VDP_RPU_EXEC_PASS_LIST_WORDS = 2; // payload: op_word + addr_word
export const VDP_RPU_SEAL_FRAME_WORDS     = 1; // payload: op_word
```

Old opcodes (removed from execution path, numeric values preserved for reference):
```ts
// VDP_RPU_OP_BUFFER_DEFINE          = 1   // removed
// VDP_RPU_OP_BUFFER_UPLOAD_DMA      = 2   // removed
// VDP_RPU_OP_BUFFER_UPLOAD_INLINE   = 3   // removed
// VDP_RPU_OP_BUFFER_DISCARD         = 4   // removed
// VDP_RPU_OP_SURFACE_DEFINE         = 8   // removed
// VDP_RPU_OP_CONSTANT_BANK_DEFINE   = 16  // removed
// VDP_RPU_OP_CONSTANT_UPLOAD_DMA    = 17  // removed
// VDP_RPU_OP_CONSTANT_UPLOAD_INLINE = 18  // removed
// VDP_RPU_OP_CONSTANT_UPLOAD_DEVICE = 19  // removed
// VDP_RPU_OP_BEGIN_PASS             = 32  // removed
// VDP_RPU_OP_END_PASS               = 33  // removed
// VDP_RPU_OP_BEGIN_DRAW             = 40  // removed
// VDP_RPU_OP_BIND_STREAM            = 41  // removed
// VDP_RPU_OP_BIND_CONSTANTS         = 42  // removed
// VDP_RPU_OP_BIND_TEXTURE           = 43  // removed
// VDP_RPU_OP_END_DRAW               = 44  // removed
```

## Representable weird command buffers

The RPU is an emulated hardware unit, not a high-level host graphics API. After `EXEC_PASS_LIST` decodes a pass list from VDP-local memory, the resulting `VdpRpuCommandBuffer` is backend input as-is. The WebGL/GLES2 executor must not add a second semantic validation layer. Raw pipeline bits, primitive/index selector bits, color masks, usage bits, format bits, slot words, and unknown stream layout ids are decoded as programmed. Unknown enum values in blend/depth/cull/primitive/index fields do not fault merely because they are weird.

**Fetch fault rule:** If `EXEC_PASS_LIST` reads a descriptor field that contains an out-of-range VDP-local address (>= `VDP_RPU_PARAM_MEM_SIZE`) or that would cause a sub-descriptor read to go out of bounds, the VDP raises `VDP_FAULT_RPU_FETCH_OOB`. Decoded draws that were accumulated before the fault are discarded.

## Pass, pipeline, and primitive words

```ts
export const VDP_RPU_PASS_COLOR_CLEAR = 1 << 0;
export const VDP_RPU_PASS_DEPTH_CLEAR = 1 << 1;
export const VDP_RPU_PASS_COLOR_STORE = 1 << 2;
export const VDP_RPU_PASS_DEPTH_STORE = 1 << 3;

export const VDP_RPU_BLEND_NONE = 0;
export const VDP_RPU_BLEND_ALPHA = 1;
export const VDP_RPU_BLEND_ADD = 2;

export const VDP_RPU_DEPTH_NONE = 0;
export const VDP_RPU_DEPTH_LESS = 1;
export const VDP_RPU_DEPTH_LEQUAL = 2;

export const VDP_RPU_CULL_NONE = 0;
export const VDP_RPU_CULL_BACK = 1;
export const VDP_RPU_CULL_FRONT = 2;

export const VDP_RPU_PRIM_TRIANGLES = 0;
export const VDP_RPU_PRIM_TRIANGLE_STRIP = 1;
export const VDP_RPU_PRIM_LINES = 2;
export const VDP_RPU_PRIM_POINTS = 3;

export const VDP_RPU_INDEX_NONE = 0;
export const VDP_RPU_INDEX_U16 = 1;
export const VDP_RPU_INDEX_U32 = 2;
```

## Surface formats

```ts
export const VDP_RPU_SURFACE_FORMAT_RGBA8 = 0;
export const VDP_RPU_SURFACE_FORMAT_DEPTH16 = 1;
```

## Stream layouts

```ts
export const VDP_RPU_LAYOUT_V2_C4 = 0;
export const VDP_RPU_LAYOUT_V2_T2_C4 = 1;
export const VDP_RPU_LAYOUT_V3_C4 = 2;
export const VDP_RPU_LAYOUT_V3_T2_C4 = 3;
export const VDP_RPU_LAYOUT_V3_N3_C4 = 4;
export const VDP_RPU_LAYOUT_V3_N3_T2_C4 = 5;
export const VDP_RPU_LAYOUT_V3_N3_T2_C4_J4_W4 = 6;
export const VDP_RPU_LAYOUT_I_AFFINE2_TRECT_C4 = 32;
export const VDP_RPU_LAYOUT_I_MAT4_C4 = 33;
```

`layoutId` is the sole owner of stream layout. Shader variants do not carry a second vertex or instance layout owner. `stepRate` is decoded as an 8-bit stream divisor: zero pins per-vertex data, and nonzero pins `ceil(instanceCount / stepRate)` elements using integer datapath arithmetic.

## Shader variants

```ts
export const VDP_RPU_SHADER_V2_C4 = 0;
export const VDP_RPU_SHADER_V2_T2_C4 = 1;
export const VDP_RPU_SHADER_V3_C4_C0 = 2;
export const VDP_RPU_SHADER_V3_T2_C4_C0 = 3;
export const VDP_RPU_SHADER_V3_N3_T2_C4_C0_C1 = 4;
export const VDP_RPU_SHADER_V3_N3_T2_C4_J4_W4_C0_C1 = 5;
export const VDP_RPU_SHADER_V2_T2_C4_I_AFFINE2 = 6;
export const VDP_RPU_SHADER_V3_C4_I_MAT4 = 7;
export const VDP_RPU_SHADER_VARIANT_MASK = 0x00000007;
```

`shader_variant` in `RpuDrawDesc` is retained as a low-16-bit shader word. The fixed shader selector is `shaderWord & VDP_RPU_SHADER_VARIANT_MASK`. Feature bits MORPH (bit 3) and T1 (bit 4) remain visible to the backend.

## Retained command buffer (backend decode cache)

`VdpRpuCommandBuffer` is NOT the VDP ABI. It is a backend decode/cache structure produced from VDP-local descriptors by `EXEC_PASS_LIST`. It does not own resources, pin ranges, validate renderer state, or snapshot bytes.

Field name mapping from old (renderer API) to new (decode cache):

| Old field | New field | Notes |
|---|---|---|
| `passColorSurfaceRef: Uint16Array` | `passColorSurfaceDescAddr: Uint32Array` | VDP-local addr of RpuSurfaceDesc |
| `passDepthSurfaceRef: Uint16Array` | `passDepthSurfaceDescAddr: Uint32Array` | VDP-local addr of RpuSurfaceDesc |
| `drawIndexBufferRef: Uint16Array` | `drawIndexVramAddr: Uint32Array` | Absolute VDP-local addr of first index |
| `drawIndexByteOffset: Uint32Array` | (removed) | Subsumed by absolute vramAddr |
| `streamBufferRef: Uint16Array` | `streamVramAddr: Uint32Array` | Absolute VDP-local addr of vertex data |
| `streamByteOffset: Uint32Array` | (removed) | Subsumed by absolute vramAddr |
| `streamByteLength` | `streamByteLength: Uint32Array` | (new — was computed from stride×count) |
| `constantBank: Uint16Array` | `constantVramAddr: Uint32Array` | Absolute VDP-local addr of constants |
| `constantFirstWord: Uint16Array` | (removed) | Subsumed by absolute vramAddr |
| `constantWordCount: Uint16Array` | `constantByteLength: Uint32Array` | byte_length from RpuConstantDesc |
| `textureSurfaceRef: Uint16Array` | `textureSurfaceDescAddr: Uint32Array` | VDP-local addr of RpuSurfaceDesc |

## Fault model

```ts
export const VDP_FAULT_RPU_BAD_PACKET           = 0x0700;
export const VDP_FAULT_RPU_FETCH_OOB            = 0x0701;  // new: descriptor fetch out of VDP-local bounds
export const VDP_FAULT_RPU_BAD_STREAM_LAYOUT    = 0x0702;
export const VDP_FAULT_RPU_COMMAND_OVERFLOW     = 0x0708;
export const VDP_FAULT_RPU_BAD_STATE            = 0x0709;
```

## Frame handoff ownership

On `SEAL_FRAME`, the VDP swaps the decoded `VdpRpuCommandBuffer` into the submitted frame. On present, VOUT swaps the submitted frame into the visible payload. The previous visible payload is reset by clearing only used-prefix counts; array storage is retained. `vdpVram` is a live reference — the backend reads from whatever bytes are currently in VDP-local memory.

## Stream layouts (closed table)

```ts
export const VDP_RPU_STREAM_LAYOUTS: readonly VdpRpuStreamLayoutSpec[] = [
    { id: VDP_RPU_LAYOUT_V2_C4, byteStride: 12, ... },
    { id: VDP_RPU_LAYOUT_V2_T2_C4, byteStride: 20, ... },
    { id: VDP_RPU_LAYOUT_V3_C4, byteStride: 16, ... },
    { id: VDP_RPU_LAYOUT_V3_T2_C4, byteStride: 24, ... },
    { id: VDP_RPU_LAYOUT_V3_N3_C4, byteStride: 28, ... },
    { id: VDP_RPU_LAYOUT_V3_N3_T2_C4, byteStride: 36, ... },
    { id: VDP_RPU_LAYOUT_V3_N3_T2_C4_J4_W4, byteStride: 44, ... },
    { id: VDP_RPU_LAYOUT_I_AFFINE2_TRECT_C4, byteStride: 48, ... },
    { id: VDP_RPU_LAYOUT_I_MAT4_C4, byteStride: 68, ... },
];
```

## Files to modify in implementation phase

- `machine/ts/src/machine/devices/vdp/rpu_desc.ts` — descriptor byte-offset constants (new)
- `machine/cpp/src/machine/devices/vdp/rpu_desc.h` — C++ descriptor byte offsets (new)
- `machine/ts/src/machine/devices/vdp/rpu.ts` — VdpRpuUnit, VdpRpuCommandBuffer, new opcodes
- `machine/cpp/src/machine/devices/vdp/rpu.h` / `rpu.cpp` — C++ mirror
- `machine/ts/src/render/backend/webgl/vdp_rpu.ts` — read from vdpVram
- `machine/cpp/src/render/backend/gles2/vdp_rpu.cpp` — read from vdpVram
- `machine/cpp/src/render/backend/software/vdp_rpu.cpp` — read from vdpVram
- `carts/bare_metal_cart/cart.lua` — descriptor-in-memory model
- `tests/cpp/vdp_ingress_test.cpp`, `tests/lua/vdp_ingress.test.ts` — new test cases
