export type Layer2D = 0 | 1 | 2;

export const LAYER_2D_WORLD: Layer2D = 0;
export const LAYER_2D_UI: Layer2D = 1;
export const LAYER_2D_IDE: Layer2D = 2;

export type VdpAtlasSource = {
	atlasId: number;
	u: number;
	v: number;
	w: number;
	h: number;
};

export const VDP_MFU_WEIGHT_COUNT = 64;
export const VDP_JTU_MATRIX_WORDS = 16;
export const VDP_JTU_MATRIX_COUNT = 32;
export const VDP_JTU_REGISTER_WORDS = VDP_JTU_MATRIX_WORDS * VDP_JTU_MATRIX_COUNT;

export const VDP_RD_SURFACE_FRAMEBUFFER = 0;
export const VDP_RD_SURFACE_COUNT = 1;
export const VDP_RD_MODE_RGBA8888 = 0;
export const VDP_RD_STATUS_READY = 1 << 0;
export const VDP_RD_STATUS_OVERFLOW = 1 << 1;
export const VDP_FIFO_CTRL_SEAL = 1 << 0;
export const VDP_STATUS_VBLANK = 1 << 0;
export const VDP_STATUS_SUBMIT_BUSY = 1 << 1;
export const VDP_STATUS_SUBMIT_REJECTED = 1 << 2;
export const VDP_STATUS_FAULT = 1 << 3;
export const VDP_FAULT_NONE = 0;
export const VDP_FAULT_RD_UNSUPPORTED_MODE = 0x0001;
export const VDP_FAULT_RD_SURFACE = 0x0002;
export const VDP_FAULT_RD_OOB = 0x0003;
export const VDP_FAULT_MODE_UNSUPPORTED = 0x0004;
export const VDP_FAULT_VRAM_WRITE_UNMAPPED = 0x0101;
export const VDP_FAULT_VRAM_WRITE_UNINITIALIZED = 0x0102;
export const VDP_FAULT_VRAM_WRITE_OOB = 0x0103;
export const VDP_FAULT_VRAM_WRITE_UNALIGNED = 0x0104;
export const VDP_FAULT_VRAM_SURFACE_DIM = 0x0105;
export const VDP_FAULT_STREAM_BAD_PACKET = 0x0201;
export const VDP_FAULT_SUBMIT_STATE = 0x0202;
export const VDP_FAULT_CMD_BAD_DOORBELL = 0x0203;
export const VDP_FAULT_SUBMIT_BUSY = 0x0204;
export const VDP_FAULT_DEX_INVALID_SCALE = 0x0301;
export const VDP_FAULT_DEX_INVALID_LINE_WIDTH = 0x0302;
export const VDP_FAULT_DEX_SOURCE_SLOT = 0x0303;
export const VDP_FAULT_DEX_SOURCE_OOB = 0x0304;
export const VDP_FAULT_DEX_OVERFLOW = 0x0305;
export const VDP_FAULT_DEX_UNSUPPORTED_DRAW_CTRL = 0x0306;
export const VDP_FAULT_DEX_CMD_NO_BATCH = 0x0307;
export const VDP_FAULT_BLITTER_OOM_BATCH = 0x0308;
export const VDP_FRAMEBUFFER_PAGE_RENDER = 0;
export const VDP_FRAMEBUFFER_PAGE_DISPLAY = 1;
export type VdpFrameBufferPage = typeof VDP_FRAMEBUFFER_PAGE_RENDER | typeof VDP_FRAMEBUFFER_PAGE_DISPLAY;
