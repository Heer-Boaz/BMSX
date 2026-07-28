export const GX_GPU_GP0_DRAW_MODE = 0xe1;
export const GX_GPU_GP0_TEXTURE_WINDOW = 0xe2;
export const GX_GPU_GP0_DRAWING_AREA_TOP_LEFT = 0xe3;
export const GX_GPU_GP0_DRAWING_AREA_BOTTOM_RIGHT = 0xe4;
export const GX_GPU_GP0_DRAWING_OFFSET = 0xe5;
export const GX_GPU_GP0_MASK_BIT = 0xe6;
export const GX_GPU_GP0_IRQ_REQUEST = 0x1f;
export const GX_GPU_GP0_OPCODE_SHIFT = 24;
export const GX_GPU_GP0_PARAM_MASK = 0x00ffffff;
export const GX_GPU_GP0_FILL_RECTANGLE = 0x02;
export const GX_GPU_GP0_POLYGON_FIRST = 0x20;
export const GX_GPU_GP0_POLYGON_LAST = 0x3f;
export const GX_GPU_GP0_LINE_FIRST = 0x40;
export const GX_GPU_GP0_LINE_LAST = 0x5f;
export const GX_GPU_GP0_RECTANGLE_FIRST = 0x60;
export const GX_GPU_GP0_RECTANGLE_LAST = 0x7f;
export const GX_GPU_GP0_VRAM_TO_VRAM_FIRST = 0x80;
export const GX_GPU_GP0_VRAM_TO_VRAM_LAST = 0x9f;
export const GX_GPU_GP0_CPU_TO_VRAM_FIRST = 0xa0;
export const GX_GPU_GP0_CPU_TO_VRAM_LAST = 0xbf;
export const GX_GPU_GP0_VRAM_TO_CPU_FIRST = 0xc0;
export const GX_GPU_GP0_VRAM_TO_CPU_LAST = 0xdf;
export const GX_GPU_GP0_RENDER_TEXTURE_BIT = 0x04;
export const GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT = 0x08;
export const GX_GPU_GP0_RENDER_GOURAUD_BIT = 0x10;
export const GX_GPU_GP0_RECTANGLE_SIZE_MASK = 0x18;
export const GX_GPU_GP0_COMMAND_BUFFER_WORDS = 16;
import {
	GX_GPU_VRAM_WIDTH,
	gxGpuVramYAddress,
} from './vram';

export const GX_GPU_COMMAND_FIFO_WORD_CAPACITY = 16;
export const GX_GPU_DMA_INGRESS_WORD_CAPACITY = 16;
export const GX_GPU_CLUT_4BIT_WORDS = 16;
export const GX_GPU_CLUT_8BIT_WORDS = 256;
export const GX_GPU_CLUT_4BIT_SIZE_WORD = GX_GPU_CLUT_4BIT_WORDS | (1 << 16);

export const GX_GPU_DMA_DIRECTION_OFF = 0;
export const GX_GPU_DMA_DIRECTION_FIFO = 1;
export const GX_GPU_DMA_DIRECTION_CPU_TO_GP0 = 2;
export const GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU = 3;

export const GX_GPU_DRAW_MODE_POLYGON_TEXPAGE_MASK = 0x09ff;
export const GX_GPU_DRAW_MODE_DITHER_ENABLED = 1 << 9;
export const GX_GPU_DRAW_MODE_DRAW_TO_DISPLAYED_FIELD = 1 << 10;
export const GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_HIGH = 1 << 11;
export const GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP = 1 << 12;
export const GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP = 1 << 13;
export const GX_GPU_TEXTURE_MODE_PALETTE4 = 0;
export const GX_GPU_TEXTURE_MODE_PALETTE8 = 1;
export const GX_GPU_TEXTURE_MODE_DIRECT16 = 2;
export const GX_GPU_BLEND_MODE_HALF_BACKGROUND_HALF_FOREGROUND = 0;
export const GX_GPU_BLEND_MODE_BACKGROUND_PLUS_FOREGROUND = 1;
export const GX_GPU_BLEND_MODE_BACKGROUND_MINUS_FOREGROUND = 2;
export const GX_GPU_BLEND_MODE_BACKGROUND_PLUS_QUARTER_FOREGROUND = 3;
export const GX_GPU_TRANSFER_MAX_WIDTH = 1024;
export const GX_GPU_TRANSFER_MAX_HEIGHT = 512;
export const GX_GPU_TRANSFER_MAX_PIXEL_COUNT = GX_GPU_TRANSFER_MAX_WIDTH * GX_GPU_TRANSFER_MAX_HEIGHT;
export const GX_GPU_TRANSFER_MAX_BYTE_COUNT = GX_GPU_TRANSFER_MAX_PIXEL_COUNT * 2;

export function gxGpuSigned11(value: number): number {
	const raw = value & 0x7ff;
	return (raw & 0x400) !== 0 ? raw - 0x800 : raw;
}

export function gxGpuDrawingAreaLeft(topLeftWord: number, bottomRightWord: number): number {
	const left = topLeftWord & 0x3ff;
	return left <= (bottomRightWord & 0x3ff) ? left : 0;
}

export function gxGpuDrawingAreaTop(topLeftWord: number, bottomRightWord: number, vramYAddressExtensionWord: number): number {
	const top = gxGpuVramYAddress(topLeftWord >>> 10, vramYAddressExtensionWord);
	const bottom = gxGpuVramYAddress(bottomRightWord >>> 10, vramYAddressExtensionWord);
	return top <= bottom ? top : 0;
}

export function gxGpuDrawingAreaRightExclusive(topLeftWord: number, bottomRightWord: number): number {
	const left = topLeftWord & 0x3ff;
	const right = bottomRightWord & 0x3ff;
	if (left > right) return 0;
	return right < GX_GPU_VRAM_WIDTH - 1 ? right + 1 : GX_GPU_VRAM_WIDTH;
}

export function gxGpuDrawingAreaBottomExclusive(topLeftWord: number, bottomRightWord: number, vramYAddressExtensionWord: number): number {
	const top = gxGpuVramYAddress(topLeftWord >>> 10, vramYAddressExtensionWord);
	const bottom = gxGpuVramYAddress(bottomRightWord >>> 10, vramYAddressExtensionWord);
	return top <= bottom ? bottom + 1 : 0;
}

export function gxGpuTransferWidth(sizeWord: number): number {
	return (((sizeWord & 0xffff) - 1) & (GX_GPU_TRANSFER_MAX_WIDTH - 1)) + 1;
}

export function gxGpuTransferHeight(sizeWord: number): number {
	return ((((sizeWord >>> 16) & 0xffff) - 1) & (GX_GPU_TRANSFER_MAX_HEIGHT - 1)) + 1;
}

export function gxGpuTextureAttribute(textureWord: number): number {
	return (textureWord >>> 16) & 0xffff;
}

export function gxGpuPolygonTexturePageWordIndex(opcode: number): number {
	return (opcode & 0x10) !== 0 ? 5 : 4;
}

export function gxGpuPolygonDrawModeWord(drawModeWord: number, textureAttribute: number): number {
	return ((textureAttribute & GX_GPU_DRAW_MODE_POLYGON_TEXPAGE_MASK) | (drawModeWord & ~GX_GPU_DRAW_MODE_POLYGON_TEXPAGE_MASK)) >>> 0;
}
