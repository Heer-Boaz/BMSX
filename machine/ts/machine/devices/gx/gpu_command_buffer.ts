export const GX_GPU_COMMAND_CAPACITY = 4096;
export const GX_GPU_COMMAND_WORD_CAPACITY = 0x80000;
export const GX_GPU_VRAM_WIDTH = 1024;
export const GX_GPU_VRAM_HEIGHT = 512;
export const GX_GPU_MAX_PRIMITIVE_WIDTH = 1024;
export const GX_GPU_MAX_PRIMITIVE_HEIGHT = 512;
export const GX_GPU_DRAW_MODE_POLYGON_TEXPAGE_MASK = 0x09ff;
export const GX_GPU_DRAW_MODE_DITHER_ENABLED = 1 << 9;
export const GX_GPU_DRAW_MODE_TEXTURE_DISABLE = 1 << 11;
export const GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP = 1 << 12;
export const GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP = 1 << 13;
export const GX_GPU_INTERLACED_RENDER_ENABLE = 0x01;
export const GX_GPU_INTERLACED_RENDER_ACTIVE_LINE_LSB = 0x02;
export const GX_GPU_TEXTURE_MODE_PALETTE4 = 0;
export const GX_GPU_TEXTURE_MODE_PALETTE8 = 1;
export const GX_GPU_TEXTURE_MODE_DIRECT16 = 2;
export const GX_GPU_BLEND_MODE_HALF_BACKGROUND_HALF_FOREGROUND = 0;
export const GX_GPU_BLEND_MODE_BACKGROUND_PLUS_FOREGROUND = 1;
export const GX_GPU_BLEND_MODE_BACKGROUND_MINUS_FOREGROUND = 2;
export const GX_GPU_BLEND_MODE_BACKGROUND_PLUS_QUARTER_FOREGROUND = 3;
export const GX_GPU_DOT_CLOCK_DIVIDER_256 = 10;
export const GX_GPU_DOT_CLOCK_DIVIDER_320 = 8;
export const GX_GPU_DOT_CLOCK_DIVIDER_512 = 5;
export const GX_GPU_DOT_CLOCK_DIVIDER_640 = 4;
export const GX_GPU_DOT_CLOCK_DIVIDER_368 = 7;

export const GX_GPU_COMMAND_DRAW_POLYGON = 1;
export const GX_GPU_COMMAND_DRAW_LINE = 2;
export const GX_GPU_COMMAND_DRAW_POLYLINE = 3;
export const GX_GPU_COMMAND_DRAW_RECTANGLE = 4;
export const GX_GPU_COMMAND_FILL_RECTANGLE = 5;
export const GX_GPU_COMMAND_COPY_VRAM_TO_VRAM = 6;
export const GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM = 7;
export const GX_GPU_COMMAND_READ_VRAM_TO_CPU = 8;

export function gxGpuSigned11(word: number): number {
	const value = word & 0x7ff;
	return (value & 0x400) !== 0 ? value - 0x800 : value;
}

export function gxGpuVertexX(word: number): number {
	return gxGpuSigned11(word);
}

export function gxGpuVertexY(word: number): number {
	return gxGpuSigned11(word >>> 16);
}

export function gxGpuDisplayStartX(word: number): number {
	return word & 0x3ff;
}

export function gxGpuDisplayStartY(word: number): number {
	return (word >>> 10) & 0x1ff;
}

export function gxGpuDisplayModeScreenWidth(displayModeWord: number): number {
	const horizontalResolution1 = displayModeWord & 0x03;
	const horizontalResolution2 = (displayModeWord & 0x40) !== 0;
	if (horizontalResolution1 === 0) {
		return horizontalResolution2 ? 368 : 256;
	}
	if (horizontalResolution1 === 1) {
		return horizontalResolution2 ? 384 : 320;
	}
	if (horizontalResolution1 === 2) {
		return 512;
	}
	return 640;
}

export function gxGpuDisplayModeDotClockDivider(displayModeWord: number): number {
	if ((displayModeWord & 0x40) !== 0) {
		return GX_GPU_DOT_CLOCK_DIVIDER_368;
	}
	const horizontalResolution1 = displayModeWord & 0x03;
	if (horizontalResolution1 === 0) {
		return GX_GPU_DOT_CLOCK_DIVIDER_256;
	}
	if (horizontalResolution1 === 1) {
		return GX_GPU_DOT_CLOCK_DIVIDER_320;
	}
	if (horizontalResolution1 === 2) {
		return GX_GPU_DOT_CLOCK_DIVIDER_512;
	}
	return GX_GPU_DOT_CLOCK_DIVIDER_640;
}

export function gxGpuHorizontalDisplayRangeStart(horizontalDisplayRangeWord: number): number {
	return horizontalDisplayRangeWord & 0xfff;
}

export function gxGpuHorizontalDisplayRangeEnd(horizontalDisplayRangeWord: number): number {
	return (horizontalDisplayRangeWord >>> 12) & 0xfff;
}

export function gxGpuHorizontalVisibleColumns(horizontalDisplayRangeWord: number, displayModeWord: number): number {
	const rangeCycles = gxGpuHorizontalDisplayRangeEnd(horizontalDisplayRangeWord) - gxGpuHorizontalDisplayRangeStart(horizontalDisplayRangeWord);
	return (((rangeCycles / gxGpuDisplayModeDotClockDivider(displayModeWord)) + 2) | 0) & ~0x03;
}

export function gxGpuDrawingOffsetX(word: number): number {
	return gxGpuSigned11(word);
}

export function gxGpuDrawingOffsetY(word: number): number {
	return gxGpuSigned11(word >>> 11);
}

export function gxGpuCommandRawTextureEnabled(opcode: number): boolean {
	return (opcode & 0x01) !== 0;
}

export function gxGpuCommandSemiTransparencyEnabled(opcode: number): boolean {
	return (opcode & 0x02) !== 0;
}

export function gxGpuCommandTextureEnabled(opcode: number): boolean {
	return (opcode & 0x04) !== 0;
}

export function gxGpuDrawModeTextureDisableEnabled(drawModeWord: number): boolean {
	return (drawModeWord & GX_GPU_DRAW_MODE_TEXTURE_DISABLE) !== 0;
}

export function gxGpuCommandDrawsTexture(opcode: number, drawModeWord: number): boolean {
	return gxGpuCommandTextureEnabled(opcode) && !gxGpuDrawModeTextureDisableEnabled(drawModeWord);
}

export function gxGpuDrawModeDitherEnabled(drawModeWord: number): boolean {
	return (drawModeWord & GX_GPU_DRAW_MODE_DITHER_ENABLED) !== 0;
}

export function gxGpuDrawModeTextureRectangleXFlip(drawModeWord: number): boolean {
	return (drawModeWord & GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP) !== 0;
}

export function gxGpuDrawModeTextureRectangleYFlip(drawModeWord: number): boolean {
	return (drawModeWord & GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP) !== 0;
}

export function gxGpuSkipDrawingToActiveField(statusWord: number): boolean {
	const mask = (1 << 19) | (1 << 22) | (1 << 10);
	const active = (1 << 19) | (1 << 22);
	return (statusWord & mask) === active;
}

export function gxGpuInterlacedRenderWord(statusWord: number, activeLineLsb: number): number {
	return gxGpuSkipDrawingToActiveField(statusWord)
		? GX_GPU_INTERLACED_RENDER_ENABLE | ((activeLineLsb & 1) << 1)
		: 0;
}

export function gxGpuTextureRectangleEdge0(textureCoord: number, flip: boolean): number {
	return textureCoord + (flip ? 1 : 0);
}

export function gxGpuTextureRectangleEdge1(textureEdge0: number, size: number, flip: boolean): number {
	return textureEdge0 + (flip ? -size : size);
}

export function gxGpuSegmentExceedsPrimitiveSize(x0: number, y0: number, x1: number, y1: number): boolean {
	const left = x0 < x1 ? x0 : x1;
	const right = x0 > x1 ? x0 : x1;
	const top = y0 < y1 ? y0 : y1;
	const bottom = y0 > y1 ? y0 : y1;
	return right - left + 1 > GX_GPU_MAX_PRIMITIVE_WIDTH || bottom - top + 1 > GX_GPU_MAX_PRIMITIVE_HEIGHT;
}

export function gxGpuTriangleExceedsPrimitiveSize(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): boolean {
	const min12x = x1 < x2 ? x1 : x2;
	const max12x = x1 > x2 ? x1 : x2;
	const min12y = y1 < y2 ? y1 : y2;
	const max12y = y1 > y2 ? y1 : y2;
	const left = x0 < min12x ? x0 : min12x;
	const right = x0 > max12x ? x0 : max12x;
	const top = y0 < min12y ? y0 : min12y;
	const bottom = y0 > max12y ? y0 : max12y;
	return right - left + 1 > GX_GPU_MAX_PRIMITIVE_WIDTH || bottom - top + 1 > GX_GPU_MAX_PRIMITIVE_HEIGHT;
}

export function gxGpuCommandQuadPolygon(opcode: number): boolean {
	return (opcode & 0x08) !== 0;
}

export function gxGpuCommandGouraud(opcode: number): boolean {
	return (opcode & 0x10) !== 0;
}

export function gxGpuDitheredPolygon(drawModeWord: number, opcode: number): boolean {
	return gxGpuDrawModeDitherEnabled(drawModeWord)
		&& (gxGpuCommandDrawsTexture(opcode, drawModeWord)
			? !gxGpuCommandRawTextureEnabled(opcode)
			: gxGpuCommandGouraud(opcode));
}

export function gxGpuTextureModulationPreDither(texture5: number, vertex8: number): number {
	return (texture5 * vertex8) >>> 4;
}

export function gxGpuTextureModulationChannel5(texture5: number, vertex8: number, ditherOffset: number): number {
	const dithered = gxGpuTextureModulationPreDither(texture5, vertex8) + ditherOffset;
	if (dithered < 0) {
		return 0;
	}
	const channel5 = dithered >> 3;
	return channel5 < 31 ? channel5 : 31;
}

export function gxGpuCommandRectangleWidth(opcode: number, sizeWord: number): number {
	switch (opcode & 0x18) {
		case 0x08:
			return 1;
		case 0x10:
			return 8;
		case 0x18:
			return 16;
		default:
			return sizeWord & 0x3ff;
	}
}

export function gxGpuCommandRectangleHeight(opcode: number, sizeWord: number): number {
	switch (opcode & 0x18) {
		case 0x08:
			return 1;
		case 0x10:
			return 8;
		case 0x18:
			return 16;
		default:
			return (sizeWord >>> 16) & 0x1ff;
	}
}

export function gxGpuFillX(xyWord: number): number {
	return xyWord & 0x3f0;
}

export function gxGpuFillWidth(sizeWord: number): number {
	return ((sizeWord & 0x3ff) + 0x0f) & ~0x0f;
}

export function gxGpuFillHeight(sizeWord: number): number {
	return (sizeWord >>> 16) & 0x1ff;
}

export function gxGpuVramWrappedWidth(x: number, width: number): number {
	const edgeWidth = GX_GPU_VRAM_WIDTH - x;
	return width <= edgeWidth ? width : edgeWidth;
}

export function gxGpuVramWrappedHeight(y: number, height: number): number {
	const edgeHeight = GX_GPU_VRAM_HEIGHT - y;
	return height <= edgeHeight ? height : edgeHeight;
}

export function gxGpuSpansOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
	return startA < endB && startB < endA;
}

export function gxGpuVramCopyNeedsChunking(sourceX: number, sourceY: number, targetX: number, targetY: number, width: number, height: number): boolean {
	return sourceX !== targetX
		&& sourceY !== targetY
		&& gxGpuSpansOverlap(sourceX, sourceX + width, targetX, targetX + width)
		&& gxGpuSpansOverlap(sourceY, sourceY + height, targetY, targetY + height);
}

export function gxGpuVramCopyChunkHeight(sourceY: number, targetY: number, height: number): number {
	const rowDistance = sourceY > targetY ? sourceY - targetY : targetY - sourceY;
	return rowDistance < height ? rowDistance : height;
}

export function gxGpuTransferX(xyWord: number): number {
	return xyWord & 0x3ff;
}

export function gxGpuTransferY(xyWord: number): number {
	return (xyWord >>> 16) & 0x1ff;
}

export function gxGpuTransferWidth(sizeWord: number): number {
	return (((sizeWord & 0xffff) - 1) & 0x3ff) + 1;
}

export function gxGpuTransferHeight(sizeWord: number): number {
	return ((((sizeWord >>> 16) & 0xffff) - 1) & 0x1ff) + 1;
}

export function gxGpuTransferPixelWord(payloadWord: number, pixelIndex: number): number {
	return (pixelIndex & 1) === 0 ? payloadWord & 0xffff : payloadWord >>> 16;
}

export function gxGpuTransferPayloadPixelCount(commandWordCount: number): number {
	return (commandWordCount - 3) << 1;
}

export function gxGpuTransferEmittedPixelCount(width: number, height: number, commandWordCount: number): number {
	const areaPixels = width * height;
	const payloadPixels = gxGpuTransferPayloadPixelCount(commandWordCount);
	return payloadPixels < areaPixels ? payloadPixels : areaPixels;
}

export function gxGpuTextureU(textureWord: number): number {
	return textureWord & 0xff;
}

export function gxGpuTextureV(textureWord: number): number {
	return (textureWord >>> 8) & 0xff;
}

export function gxGpuTextureAttribute(textureWord: number): number {
	return (textureWord >>> 16) & 0xffff;
}

export function gxGpuTextureClutBaseX(textureWord: number): number {
	return (gxGpuTextureAttribute(textureWord) & 0x3f) << 4;
}

export function gxGpuTextureClutBaseY(textureWord: number): number {
	return (gxGpuTextureAttribute(textureWord) >>> 6) & 0x1ff;
}

export function gxGpuDrawModeTexturePageBaseX(drawModeWord: number): number {
	return (drawModeWord & 0x0f) << 6;
}

export function gxGpuDrawModeTexturePageBaseY(drawModeWord: number): number {
	return ((drawModeWord >>> 4) & 0x01) << 8;
}

export function gxGpuDrawModeTextureMode(drawModeWord: number): number {
	return (drawModeWord >>> 7) & 0x03;
}

export function gxGpuDrawModeTransparencyMode(drawModeWord: number): number {
	return (drawModeWord >>> 5) & 0x03;
}

export function gxGpuPolygonTexturePageWordIndex(opcode: number): number {
	return gxGpuCommandGouraud(opcode) ? 5 : 4;
}

export function gxGpuPolygonDrawModeWord(drawModeWord: number, textureAttribute: number): number {
	return ((textureAttribute & GX_GPU_DRAW_MODE_POLYGON_TEXPAGE_MASK) | (drawModeWord & ~GX_GPU_DRAW_MODE_POLYGON_TEXPAGE_MASK)) >>> 0;
}

export function gxGpuTextureWindowAndX(textureWindowWord: number): number {
	return (~((textureWindowWord & 0x1f) << 3)) & 0xff;
}

export function gxGpuTextureWindowAndY(textureWindowWord: number): number {
	return (~(((textureWindowWord >>> 5) & 0x1f) << 3)) & 0xff;
}

export function gxGpuTextureWindowOrX(textureWindowWord: number): number {
	return (((textureWindowWord >>> 10) & 0x1f) & (textureWindowWord & 0x1f)) << 3;
}

export function gxGpuTextureWindowOrY(textureWindowWord: number): number {
	return (((textureWindowWord >>> 15) & 0x1f) & ((textureWindowWord >>> 5) & 0x1f)) << 3;
}

export function gxGpuMaskBitSetWhileDrawing(maskBitModeWord: number): boolean {
	return (maskBitModeWord & 0x01) !== 0;
}

export function gxGpuMaskBitCheckBeforeDraw(maskBitModeWord: number): boolean {
	return (maskBitModeWord & 0x02) !== 0;
}

export function gxGpuDrawingAreaX(word: number): number {
	return word & 0x3ff;
}

export function gxGpuDrawingAreaY(word: number): number {
	return (word >>> 10) & 0x3ff;
}

export function gxGpuDrawingAreaLeft(topLeftWord: number, bottomRightWord: number): number {
	const left = gxGpuDrawingAreaX(topLeftWord);
	const right = gxGpuDrawingAreaX(bottomRightWord);
	return left > right ? 0 : left;
}

export function gxGpuDrawingAreaTop(topLeftWord: number, bottomRightWord: number): number {
	const top = gxGpuDrawingAreaY(topLeftWord);
	const bottom = gxGpuDrawingAreaY(bottomRightWord);
	if (top > bottom) {
		return 0;
	}
	const bottomBound = bottom < GX_GPU_VRAM_HEIGHT ? bottom : GX_GPU_VRAM_HEIGHT - 1;
	return top < bottomBound ? top : bottomBound;
}

export function gxGpuDrawingAreaRightExclusive(topLeftWord: number, bottomRightWord: number): number {
	const left = gxGpuDrawingAreaX(topLeftWord);
	const right = gxGpuDrawingAreaX(bottomRightWord);
	if (left > right) {
		return 0;
	}
	const rightExclusive = right + 1;
	return rightExclusive < GX_GPU_VRAM_WIDTH ? rightExclusive : GX_GPU_VRAM_WIDTH;
}

export function gxGpuDrawingAreaBottomExclusive(topLeftWord: number, bottomRightWord: number): number {
	const top = gxGpuDrawingAreaY(topLeftWord);
	const bottom = gxGpuDrawingAreaY(bottomRightWord);
	if (top > bottom) {
		return 0;
	}
	const bottomExclusive = bottom + 1;
	return bottomExclusive < GX_GPU_VRAM_HEIGHT ? bottomExclusive : GX_GPU_VRAM_HEIGHT;
}

export type GxGpuCommandBufferView = {
	readonly serial: number;
	readonly commandCount: number;
	readonly wordCount: number;
	readonly commandKind: ArrayLike<number>;
	readonly commandOpcode: ArrayLike<number>;
	readonly commandWordStart: ArrayLike<number>;
	readonly commandWordCount: ArrayLike<number>;
	readonly commandDrawModeWord: ArrayLike<number>;
	readonly commandTextureWindowWord: ArrayLike<number>;
	readonly commandDrawingAreaTopLeftWord: ArrayLike<number>;
	readonly commandDrawingAreaBottomRightWord: ArrayLike<number>;
	readonly commandDrawingOffsetWord: ArrayLike<number>;
	readonly commandMaskBitModeWord: ArrayLike<number>;
	readonly commandInterlacedRenderWord: ArrayLike<number>;
	readonly words: ArrayLike<number>;
};

export class GxGpuCommandBuffer implements GxGpuCommandBufferView {
	public serial = 0;
	public commandCount = 0;
	public wordCount = 0;
	public readonly commandKind = new Uint8Array(GX_GPU_COMMAND_CAPACITY);
	public readonly commandOpcode = new Uint8Array(GX_GPU_COMMAND_CAPACITY);
	public readonly commandWordStart = new Uint32Array(GX_GPU_COMMAND_CAPACITY);
	public readonly commandWordCount = new Uint32Array(GX_GPU_COMMAND_CAPACITY);
	public readonly commandDrawModeWord = new Uint32Array(GX_GPU_COMMAND_CAPACITY);
	public readonly commandTextureWindowWord = new Uint32Array(GX_GPU_COMMAND_CAPACITY);
	public readonly commandDrawingAreaTopLeftWord = new Uint32Array(GX_GPU_COMMAND_CAPACITY);
	public readonly commandDrawingAreaBottomRightWord = new Uint32Array(GX_GPU_COMMAND_CAPACITY);
	public readonly commandDrawingOffsetWord = new Uint32Array(GX_GPU_COMMAND_CAPACITY);
	public readonly commandMaskBitModeWord = new Uint32Array(GX_GPU_COMMAND_CAPACITY);
	public readonly commandInterlacedRenderWord = new Uint8Array(GX_GPU_COMMAND_CAPACITY);
	public readonly words = new Uint32Array(GX_GPU_COMMAND_WORD_CAPACITY);

	public reset(): void {
		this.serial = (this.serial + 1) >>> 0;
		this.commandCount = 0;
		this.wordCount = 0;
	}

	public appendWord(word: number): void {
		this.words[this.wordCount] = word >>> 0;
		this.wordCount += 1;
	}

	public appendWords(words: Uint32Array, wordCount: number): number {
		const wordStart = this.wordCount;
		for (let index = 0; index < wordCount; index += 1) {
			this.words[this.wordCount] = words[index];
			this.wordCount += 1;
		}
		return wordStart;
	}

	public pushCommand(
		kind: number,
		opcode: number,
		wordStart: number,
		wordCount: number,
		drawModeWord: number,
		textureWindowWord: number,
		drawingAreaTopLeftWord: number,
		drawingAreaBottomRightWord: number,
		drawingOffsetWord: number,
		maskBitModeWord: number,
		interlacedRenderWord: number,
	): void {
		const commandIndex = this.commandCount;
		this.commandKind[commandIndex] = kind;
		this.commandOpcode[commandIndex] = opcode;
		this.commandWordStart[commandIndex] = wordStart;
		this.commandWordCount[commandIndex] = wordCount;
		this.commandDrawModeWord[commandIndex] = drawModeWord >>> 0;
		this.commandTextureWindowWord[commandIndex] = textureWindowWord >>> 0;
		this.commandDrawingAreaTopLeftWord[commandIndex] = drawingAreaTopLeftWord >>> 0;
		this.commandDrawingAreaBottomRightWord[commandIndex] = drawingAreaBottomRightWord >>> 0;
		this.commandDrawingOffsetWord[commandIndex] = drawingOffsetWord >>> 0;
		this.commandMaskBitModeWord[commandIndex] = maskBitModeWord >>> 0;
		this.commandInterlacedRenderWord[commandIndex] = interlacedRenderWord;
		this.commandCount = commandIndex + 1;
	}
}
