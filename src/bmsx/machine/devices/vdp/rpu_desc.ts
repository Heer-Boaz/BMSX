// Descriptor struct byte offsets and sizes for VDP RPU descriptor-in-memory model.
// All structs are packed, little-endian. All addr fields are VDP-local u32.

// RpuSurfaceDesc (16 bytes)
export const RPU_SURFACE_DESC_BASE_ADDR_OFFSET  = 0;   // u32: VDP-local addr of pixel data
export const RPU_SURFACE_DESC_PITCH_BYTES_OFFSET = 4;  // u16: row stride in bytes
export const RPU_SURFACE_DESC_WIDTH_OFFSET       = 6;  // u16
export const RPU_SURFACE_DESC_HEIGHT_OFFSET      = 8;  // u16
export const RPU_SURFACE_DESC_FORMAT_OFFSET      = 10; // u8: RPU_SURFACE_FORMAT_*
export const RPU_SURFACE_DESC_FLAGS_OFFSET       = 11; // u8
export const RPU_SURFACE_DESC_SIZE               = 16;

// RpuStreamDesc (12 bytes)
export const RPU_STREAM_DESC_VRAM_ADDR_OFFSET    = 0;  // u32: VDP-local addr of vertex data
export const RPU_STREAM_DESC_BYTE_LENGTH_OFFSET  = 4;  // u32: declared fetch window
export const RPU_STREAM_DESC_LAYOUT_ID_OFFSET    = 8;  // u16: stream layout spec index
export const RPU_STREAM_DESC_SLOT_OFFSET         = 10; // u8: vertex attribute slot
export const RPU_STREAM_DESC_STEP_RATE_OFFSET    = 11; // u8: 0=per-vertex, N=per-N-instances
export const RPU_STREAM_DESC_SIZE                = 12;

// RpuConstantDesc (12 bytes)
export const RPU_CONSTANT_DESC_VRAM_ADDR_OFFSET  = 0;  // u32: VDP-local addr of constant words
export const RPU_CONSTANT_DESC_BYTE_LENGTH_OFFSET = 4; // u32: declared fetch window (word_count * 4)
export const RPU_CONSTANT_DESC_SLOT_OFFSET       = 8;  // u8: constant bank slot
export const RPU_CONSTANT_DESC_SIZE              = 12;

// RpuTextureDesc (8 bytes)
export const RPU_TEXTURE_DESC_SURFACE_DESC_ADDR_OFFSET = 0; // u32: VDP-local addr of RpuSurfaceDesc
export const RPU_TEXTURE_DESC_SLOT_OFFSET               = 4; // u8: texture unit slot
export const RPU_TEXTURE_DESC_FLAGS_OFFSET              = 5; // u8
export const RPU_TEXTURE_DESC_SIZE                      = 8;

// RpuDrawDesc (44 bytes)
export const RPU_DRAW_DESC_SHADER_VARIANT_OFFSET    = 0;  // u16
export const RPU_DRAW_DESC_PRIMITIVE_OFFSET         = 2;  // u8
export const RPU_DRAW_DESC_PIPELINE_WORD_OFFSET     = 4;  // u32
export const RPU_DRAW_DESC_VERTEX_COUNT_OFFSET      = 8;  // u32
export const RPU_DRAW_DESC_INSTANCE_COUNT_OFFSET    = 12; // u32
export const RPU_DRAW_DESC_INDEX_VRAM_ADDR_OFFSET   = 16; // u32: absolute VDP-local addr of first index (0=non-indexed)
export const RPU_DRAW_DESC_INDEX_COUNT_OFFSET       = 20; // u32
export const RPU_DRAW_DESC_INDEX_TYPE_OFFSET        = 24; // u8
export const RPU_DRAW_DESC_STREAM_COUNT_OFFSET      = 25; // u8
export const RPU_DRAW_DESC_CONSTANT_COUNT_OFFSET    = 26; // u8
export const RPU_DRAW_DESC_TEXTURE_COUNT_OFFSET     = 27; // u8
export const RPU_DRAW_DESC_STREAM_DESCS_ADDR_OFFSET   = 28; // u32: VDP-local addr of RpuStreamDesc[stream_count]
export const RPU_DRAW_DESC_CONSTANT_DESCS_ADDR_OFFSET = 32; // u32: VDP-local addr of RpuConstantDesc[constant_count]
export const RPU_DRAW_DESC_TEXTURE_DESCS_ADDR_OFFSET  = 36; // u32: VDP-local addr of RpuTextureDesc[texture_count]
export const RPU_DRAW_DESC_SIZE                     = 44;

// RpuPassDesc (36 bytes)
export const RPU_PASS_DESC_COLOR_SURFACE_DESC_ADDR_OFFSET = 0;  // u32: VDP-local addr of RpuSurfaceDesc (0=default fb)
export const RPU_PASS_DESC_DEPTH_SURFACE_DESC_ADDR_OFFSET = 4;  // u32: VDP-local addr of RpuSurfaceDesc (0=default depth)
export const RPU_PASS_DESC_VIEWPORT_XY_OFFSET       = 8;  // u32: packed x:16 y:16
export const RPU_PASS_DESC_VIEWPORT_WH_OFFSET       = 12; // u32: packed w:16 h:16
export const RPU_PASS_DESC_OPS_OFFSET               = 16; // u32: clear flags + load/store ops
export const RPU_PASS_DESC_CLEAR_COLOR_OFFSET       = 20; // u32
export const RPU_PASS_DESC_CLEAR_DEPTH_WORD_OFFSET  = 24; // u32
export const RPU_PASS_DESC_DRAW_DESCS_ADDR_OFFSET   = 28; // u32: VDP-local addr of RpuDrawDesc[draw_count]
export const RPU_PASS_DESC_DRAW_COUNT_OFFSET        = 32; // u16
export const RPU_PASS_DESC_SIZE                     = 36;

export function readRpuDescU16(vram: Uint8Array, offset: number): number {
	return vram[offset]! | (vram[offset + 1]! << 8);
}

export function readRpuDescU32(vram: Uint8Array, offset: number): number {
	return (
		vram[offset]!
		| (vram[offset + 1]! << 8)
		| (vram[offset + 2]! << 16)
		| (vram[offset + 3]! << 24)
	) >>> 0;
}
