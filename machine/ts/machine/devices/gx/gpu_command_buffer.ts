export const GX_GPU_COMMAND_CAPACITY = 4096;
export const GX_GPU_COMMAND_WORD_CAPACITY = 0x80000;

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

export function gxGpuDrawingOffsetX(word: number): number {
	return gxGpuSigned11(word);
}

export function gxGpuDrawingOffsetY(word: number): number {
	return gxGpuSigned11(word >>> 11);
}

export function gxGpuCommandTextureEnabled(opcode: number): boolean {
	return (opcode & 0x04) !== 0;
}

export function gxGpuCommandQuadPolygon(opcode: number): boolean {
	return (opcode & 0x08) !== 0;
}

export function gxGpuCommandGouraud(opcode: number): boolean {
	return (opcode & 0x10) !== 0;
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
		this.commandCount = commandIndex + 1;
	}
}
