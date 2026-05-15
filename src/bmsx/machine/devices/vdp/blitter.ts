import type { Layer2D, VdpSlotSource } from './contracts';

export type VdpBlitterSource = {
	surfaceId: number;
	srcX: number;
	srcY: number;
	width: number;
	height: number;
};

export type VdpResolvedBlitterSample = {
	source: VdpBlitterSource;
	surfaceWidth: number;
	surfaceHeight: number;
	slot: number;
};

export const VDP_BLITTER_OPCODE_CLEAR = 1;
export const VDP_BLITTER_OPCODE_BLIT = 2;
export const VDP_BLITTER_OPCODE_COPY_RECT = 3;
export const VDP_BLITTER_OPCODE_FILL_RECT = 4;
export const VDP_BLITTER_OPCODE_DRAW_LINE = 5;
export const VDP_BLITTER_OPCODE_BATCH_BLIT = 6;

export type VdpBlitterOpcode =
	| typeof VDP_BLITTER_OPCODE_CLEAR
	| typeof VDP_BLITTER_OPCODE_BLIT
	| typeof VDP_BLITTER_OPCODE_COPY_RECT
	| typeof VDP_BLITTER_OPCODE_FILL_RECT
	| typeof VDP_BLITTER_OPCODE_DRAW_LINE
	| typeof VDP_BLITTER_OPCODE_BATCH_BLIT;

export const VDP_BLITTER_FIFO_CAPACITY = 4096;
export const VDP_BLITTER_RUN_ENTRY_CAPACITY = 16384;
export const VDP_BLITTER_WHITE = 0xffffffff;
export const VDP_BLITTER_IMPLICIT_CLEAR = 0xff000000;

export class VdpBlitterCommandBuffer {
	public length = 0;
	public batchBlitEntryCount = 0;

	public readonly opcode = new Uint8Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly seq = new Uint32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly renderCost = new Int32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly layer = new Uint8Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly priority = new Float32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly sourceSurfaceId = new Uint32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly sourceSrcX = new Uint32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly sourceSrcY = new Uint32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly sourceWidth = new Uint32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly sourceHeight = new Uint32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly dstX = new Float32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly dstY = new Float32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly scaleX = new Float32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly scaleY = new Float32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly flipH = new Uint8Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly flipV = new Uint8Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly color = new Uint32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly parallaxWeight = new Float32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly srcX = new Int32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly srcY = new Int32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly width = new Int32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly height = new Int32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly x0 = new Float32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly y0 = new Float32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly x1 = new Float32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly y1 = new Float32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly thickness = new Float32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly backgroundColor = new Uint32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly hasBackgroundColor = new Uint8Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly lineHeight = new Uint32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly batchBlitFirstEntry = new Uint32Array(VDP_BLITTER_FIFO_CAPACITY);
	public readonly batchBlitItemCount = new Uint32Array(VDP_BLITTER_FIFO_CAPACITY);

	public readonly batchBlitSurfaceId = new Uint32Array(VDP_BLITTER_RUN_ENTRY_CAPACITY);
	public readonly batchBlitSrcX = new Uint32Array(VDP_BLITTER_RUN_ENTRY_CAPACITY);
	public readonly batchBlitSrcY = new Uint32Array(VDP_BLITTER_RUN_ENTRY_CAPACITY);
	public readonly batchBlitWidth = new Uint32Array(VDP_BLITTER_RUN_ENTRY_CAPACITY);
	public readonly batchBlitHeight = new Uint32Array(VDP_BLITTER_RUN_ENTRY_CAPACITY);
	public readonly batchBlitDstX = new Float32Array(VDP_BLITTER_RUN_ENTRY_CAPACITY);
	public readonly batchBlitDstY = new Float32Array(VDP_BLITTER_RUN_ENTRY_CAPACITY);
	public readonly batchBlitAdvance = new Uint32Array(VDP_BLITTER_RUN_ENTRY_CAPACITY);

	public reset(): void {
		this.length = 0;
		this.batchBlitEntryCount = 0;
	}

	public writeClear(index: number, clearColor: number): void {
		this.color[index] = clearColor;
	}

	public writeGeometryColor(index: number, layer: Layer2D, priority: number, x0: number, y0: number, x1: number, y1: number, drawColor: number): void {
		this.layer[index] = layer;
		this.priority[index] = priority;
		this.x0[index] = x0;
		this.y0[index] = y0;
		this.x1[index] = x1;
		this.y1[index] = y1;
		this.color[index] = drawColor;
	}

	public writeGeometryColorThickness(index: number, layer: Layer2D, priority: number, x0: number, y0: number, x1: number, y1: number, drawColor: number, thicknessValue: number): void {
		this.writeGeometryColor(index, layer, priority, x0, y0, x1, y1, drawColor);
		this.thickness[index] = thicknessValue;
	}

	public writeBlit(index: number, layer: Layer2D, priority: number, source: VdpBlitterSource, dstX: number, dstY: number, scaleX: number, scaleY: number, flipH: boolean, flipV: boolean, drawColor: number, parallax: number): void {
		this.layer[index] = layer;
		this.priority[index] = priority;
		this.sourceSurfaceId[index] = source.surfaceId;
		this.sourceSrcX[index] = source.srcX;
		this.sourceSrcY[index] = source.srcY;
		this.sourceWidth[index] = source.width;
		this.sourceHeight[index] = source.height;
		this.dstX[index] = dstX;
		this.dstY[index] = dstY;
		this.scaleX[index] = scaleX;
		this.scaleY[index] = scaleY;
		this.flipH[index] = flipH ? 1 : 0;
		this.flipV[index] = flipV ? 1 : 0;
		this.color[index] = drawColor;
		this.parallaxWeight[index] = parallax;
	}

	public writeCopyRect(index: number, layer: Layer2D, priority: number, srcXValue: number, srcYValue: number, widthValue: number, heightValue: number, dstXValue: number, dstYValue: number): void {
		this.layer[index] = layer;
		this.priority[index] = priority;
		this.srcX[index] = srcXValue;
		this.srcY[index] = srcYValue;
		this.width[index] = widthValue;
		this.height[index] = heightValue;
		this.dstX[index] = dstXValue;
		this.dstY[index] = dstYValue;
	}


	public writeBatchBlitBegin(index: number, drawColor: number, blendMode: number, layer: Layer2D, priority: number, pmuBank: number, parallax: number): void {
		this.priority[index] = priority;
		this.layer[index] = layer;
		this.color[index] = drawColor;
		this.blendMode[index] = blendMode;
		this.pmuBank[index] = pmuBank;
		this.parallax[index] = parallax;
		this.batchBlitFirstEntry[index] = this.batchBlitEntryCount;
		this.batchBlitItemCount[index] = 0;
	}

	public writeBatchBlitItem(index: number, surfaceId: number, srcX: number, srcY: number, width: number, height: number, dstX: number, dstY: number, advance: number): boolean {
		if (this.batchBlitEntryCount >= VDP_BLITTER_RUN_ENTRY_CAPACITY) {
			return false;
		}
		const entryIndex = this.batchBlitEntryCount++;
		this.batchBlitSurfaceId[entryIndex] = surfaceId;
		this.batchBlitSrcX[entryIndex] = srcX;
		this.batchBlitSrcY[entryIndex] = srcY;
		this.batchBlitWidth[entryIndex] = width;
		this.batchBlitHeight[entryIndex] = height;
		this.batchBlitDstX[entryIndex] = dstX;
		this.batchBlitDstY[entryIndex] = dstY;
		this.batchBlitAdvance[entryIndex] = advance;
		this.batchBlitItemCount[index]++;
		return true;
	}

	public beginCommandSlot(opcode: VdpBlitterOpcode, seq: number): number {
		const index = this.length;
		if (index >= VDP_BLITTER_FIFO_CAPACITY) {
			return -1;
		}
		this.opcode[index] = opcode;
		this.seq[index] = seq;
		this.renderCost[index] = 0;
		return index;
	}

	public commitCommandSlot(index: number, renderCost: number): void {
		this.renderCost[index] = renderCost;
		this.length = index + 1;
	}

	public reserve(opcode: VdpBlitterOpcode, seq: number, renderCost: number): number {
		const index = this.beginCommandSlot(opcode, seq);
		if (index < 0) {
			return -1;
		}
		this.commitCommandSlot(index, renderCost);
		return index;
	}
}

export type VdpBlitterCommand = VdpBlitterCommandBuffer;

export function frameBufferColorByte(value: number): number {
	return (value * 255 + 0.5) | 0;
}

export function packFrameBufferColor(source: { r: number; g: number; b: number; a: number }): number {
	return (
		(frameBufferColorByte(source.a) << 24)
		| (frameBufferColorByte(source.r) << 16)
		| (frameBufferColorByte(source.g) << 8)
		| frameBufferColorByte(source.b)
	) >>> 0;
}

export function vdpColorAlphaByte(color: number): number {
	return (color >>> 24) & 0xff;
}
