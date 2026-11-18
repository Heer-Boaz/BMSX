import { GX_GPU_GP0_COMMAND_BUFFER_WORDS } from '../../../spec/gx/gp0';

export const GX_GPU_COMMAND_DRAW_POLYGON = 1;
export const GX_GPU_COMMAND_DRAW_LINE = 2;
export const GX_GPU_COMMAND_DRAW_POLYLINE = 3;
export const GX_GPU_COMMAND_DRAW_RECTANGLE = 4;
export const GX_GPU_COMMAND_FILL_RECTANGLE = 5;
export const GX_GPU_COMMAND_COPY_VRAM_TO_VRAM = 6;
export const GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM = 7;
export const GX_GPU_COMMAND_READ_VRAM_TO_CPU = 8;
export const GX_GPU_SKIPPED_LINE_NONE = 2;
export const GX_GPU_DRAW_MODE_MASK = 0x00003fff;
export const GX_GPU_TEXTURE_WINDOW_MASK = 0x000fffff;
export const GX_GPU_DRAWING_AREA_MASK = 0x000fffff;
export const GX_GPU_DRAWING_OFFSET_MASK = 0x003fffff;
export const GX_GPU_MASK_BIT_MODE_MASK = 0x3;

export type GxGpuDrawState = {
	drawModeWord: number;
	vramYAddressExtensionWord: number;
	textureWindowWord: number;
	drawingAreaTopLeftWord: number;
	drawingAreaBottomRightWord: number;
	drawingOffsetWord: number;
	maskBitModeWord: number;
	/** Projected state carries beam parity, independent of E1 draw-to-field. */
	skippedLineParity: number;
};

export class GxGpuPacket {
	public readonly words = new Uint32Array(GX_GPU_GP0_COMMAND_BUFFER_WORDS);
	public kind = 0;
	public opcode = 0;
	public wordCount = 0;
	public vertexCount = 0;
	public positionStride = 1;
	public colorStride = 0;
	public sizeOffset = 0;
	public controlWord = 0;
	public textureAttribute = 0;
	public ticks = 0;
	/** Packet state carries the effective parity used by timing and emission. */
	public readonly drawState: GxGpuDrawState = {
		drawModeWord: 0, vramYAddressExtensionWord: 0, textureWindowWord: 0,
		drawingAreaTopLeftWord: 0, drawingAreaBottomRightWord: 0,
		drawingOffsetWord: 0, maskBitModeWord: 0, skippedLineParity: GX_GPU_SKIPPED_LINE_NONE,
	};
}
