import type { DmaController } from '../dma/controller';

export const GX_GPU_COMMAND_CAPACITY = 4096;
export const GX_GPU_COMMAND_WORD_CAPACITY = 0x80000;
export const GX_GPU_VRAM_WIDTH = 1024;
export const GX_GPU_VRAM_HEIGHT = 512;
export const GX_GPU_VRAM_WORD_COUNT = GX_GPU_VRAM_WIDTH * GX_GPU_VRAM_HEIGHT;
export const GX_GPU_VRAM_BYTE_COUNT = GX_GPU_VRAM_WORD_COUNT * 2;
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

export const GX_GPU_COMMAND_DRAW_POLYGON = 1;
export const GX_GPU_COMMAND_DRAW_LINE = 2;
export const GX_GPU_COMMAND_DRAW_POLYLINE = 3;
export const GX_GPU_COMMAND_DRAW_RECTANGLE = 4;
export const GX_GPU_COMMAND_FILL_RECTANGLE = 5;
export const GX_GPU_COMMAND_COPY_VRAM_TO_VRAM = 6;
export const GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM = 7;
export const GX_GPU_COMMAND_READ_VRAM_TO_CPU = 8;
export const GX_GPU_READBACK_IDLE = 0;
export const GX_GPU_READBACK_PENDING = 1;
export const GX_GPU_READBACK_SUBMITTED = 2;
export const GX_GPU_READBACK_READY = 3;

export function gxGpuSigned11(value: number): number {
	const raw = value & 0x7ff;
	return (raw & 0x400) !== 0 ? raw - 0x800 : raw;
}

export function gxGpuDrawingAreaLeft(topLeftWord: number, bottomRightWord: number): number {
	const left = topLeftWord & 0x3ff;
	return left <= (bottomRightWord & 0x3ff) ? left : 0;
}

export function gxGpuDrawingAreaTop(topLeftWord: number, bottomRightWord: number): number {
	const top = (topLeftWord >>> 10) & 0x3ff;
	const bottom = (bottomRightWord >>> 10) & 0x3ff;
	if (top > bottom) return 0;
	const bottomBound = bottom < GX_GPU_VRAM_HEIGHT ? bottom : GX_GPU_VRAM_HEIGHT - 1;
	return top < bottomBound ? top : bottomBound;
}

export function gxGpuDrawingAreaRightExclusive(topLeftWord: number, bottomRightWord: number): number {
	const left = topLeftWord & 0x3ff;
	const right = bottomRightWord & 0x3ff;
	if (left > right) return 0;
	return right < GX_GPU_VRAM_WIDTH - 1 ? right + 1 : GX_GPU_VRAM_WIDTH;
}

export function gxGpuDrawingAreaBottomExclusive(topLeftWord: number, bottomRightWord: number): number {
	const top = (topLeftWord >>> 10) & 0x3ff;
	const bottom = (bottomRightWord >>> 10) & 0x3ff;
	if (top > bottom) return 0;
	return bottom < GX_GPU_VRAM_HEIGHT - 1 ? bottom + 1 : GX_GPU_VRAM_HEIGHT;
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

export function gxGpuTransferWidth(sizeWord: number): number {
	return (((sizeWord & 0xffff) - 1) & 0x3ff) + 1;
}

export function gxGpuTransferHeight(sizeWord: number): number {
	return ((((sizeWord >>> 16) & 0xffff) - 1) & 0x1ff) + 1;
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

export type GxGpuCommandBufferState = {
	commandCount: number;
	executedCommandCount: number;
	presentCommandCount: number;
	wordCount: number;
	commandKind: number[];
	commandOpcode: number[];
	commandWordStart: number[];
	commandWordCount: number[];
	commandDrawModeWord: number[];
	commandTextureWindowWord: number[];
	commandDrawingAreaTopLeftWord: number[];
	commandDrawingAreaBottomRightWord: number[];
	commandDrawingOffsetWord: number[];
	commandMaskBitModeWord: number[];
	commandInterlacedRenderWord: number[];
	words: number[];
	readbackPhase: number;
	readbackFenceCommandCount: number;
	readbackX: number;
	readbackY: number;
	readbackWidth: number;
	readbackHeight: number;
	readbackPixelCursor: number;
	readbackPixelBytes: Uint8Array;
};

export type GxGpuCommandBufferView = {
	readonly serial: number;
	readonly vramClearSerial: number;
	readonly commandCount: number;
	readonly executedCommandCount: number;
	readonly presentCommandCount: number;
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

export type GxGpuReadbackView = {
	readonly phase: number;
	readonly fenceCommandCount: number;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly pixelCursor: number;
	readonly pixelBytes: Uint8Array;
	readonly token: number;
};

export type GxGpuReadbackPortView = GxGpuReadbackView & {
	claimReadback(presentCommandCount: number): boolean;
	completeReadback(token: number): void;
};

class GxGpuReadbackPort implements GxGpuReadbackPortView {
	public phase = GX_GPU_READBACK_IDLE;
	public fenceCommandCount = 0;
	public x = 0;
	public y = 0;
	public width = 0;
	public height = 0;
	public pixelCursor = 0;
	public readonly pixelBytes = new Uint8Array(GX_GPU_VRAM_BYTE_COUNT);
	public token = 0;

	public constructor(public readonly dmaController: DmaController) {
	}

	/** @internal Command-buffer owner transition; excluded from GxGpuReadbackPortView. */
	public activate(positionWord: number, sizeWord: number, fenceCommandCount: number): void {
		this.x = positionWord & (GX_GPU_VRAM_WIDTH - 1);
		this.y = (positionWord >>> 16) & (GX_GPU_VRAM_HEIGHT - 1);
		this.width = gxGpuTransferWidth(sizeWord);
		this.height = gxGpuTransferHeight(sizeWord);
		this.pixelCursor = 0;
		this.fenceCommandCount = fenceCommandCount;
		this.token = (this.token + 1) >>> 0;
		this.phase = GX_GPU_READBACK_PENDING;
		this.dmaController.setGxGpuReadReady(false);
	}

	/** @internal Command-buffer owner transition; excluded from GxGpuReadbackPortView. */
	public reset(): void {
		this.phase = GX_GPU_READBACK_IDLE;
		this.fenceCommandCount = 0;
		this.x = 0;
		this.y = 0;
		this.width = 0;
		this.height = 0;
		this.pixelCursor = 0;
		this.token = (this.token + 1) >>> 0;
		this.dmaController.setGxGpuReadReady(false);
	}

	public claimReadback(presentCommandCount: number): boolean {
		if (this.phase !== GX_GPU_READBACK_PENDING || presentCommandCount !== this.fenceCommandCount) {
			return false;
		}
		this.phase = GX_GPU_READBACK_SUBMITTED;
		return true;
	}

	public completeReadback(token: number): void {
		if (this.phase === GX_GPU_READBACK_SUBMITTED && this.token === token) {
			this.phase = GX_GPU_READBACK_READY;
			this.dmaController.setGxGpuReadReady(true);
		}
	}

	/** @internal GPU-device consume datapath; excluded from GxGpuReadbackPortView. */
	public readWord(): number {
		let byteIndex = this.pixelCursor << 1;
		let word = this.pixelBytes[byteIndex]! | (this.pixelBytes[byteIndex + 1]! << 8);
		this.pixelCursor += 1;
		const pixelCount = this.width * this.height;
		if (this.pixelCursor < pixelCount) {
			byteIndex = this.pixelCursor << 1;
			word |= (this.pixelBytes[byteIndex]! | (this.pixelBytes[byteIndex + 1]! << 8)) << 16;
			this.pixelCursor += 1;
		}
		if (this.pixelCursor === pixelCount) {
			this.phase = GX_GPU_READBACK_IDLE;
			this.fenceCommandCount = 0;
			this.x = 0;
			this.y = 0;
			this.width = 0;
			this.height = 0;
			this.pixelCursor = 0;
			this.dmaController.setGxGpuReadReady(false);
		}
		return word >>> 0;
	}
}

let gxGpuCommandBufferNextSerial = 0;
let gxGpuCommandBufferNextVramClearSerial = 0;
const gxGpuEmptyReadbackPixelBytes = new Uint8Array(0);

export class GxGpuCommandBuffer implements GxGpuCommandBufferView {
	private publishRevision(vramCleared: boolean): void {
		gxGpuCommandBufferNextSerial = (gxGpuCommandBufferNextSerial + 1) >>> 0;
		this.serial = gxGpuCommandBufferNextSerial;
		if (vramCleared) {
			gxGpuCommandBufferNextVramClearSerial = (gxGpuCommandBufferNextVramClearSerial + 1) >>> 0;
			this.vramClearSerial = gxGpuCommandBufferNextVramClearSerial;
		}
	}

	private activateReadback(commandIndex: number): void {
		const wordStart = this.commandWordStart[commandIndex];
		this.readback.activate(this.words[wordStart + 1], this.words[wordStart + 2], commandIndex + 1);
	}

	private clearCommandState(): void {
		this.commandCount = 0;
		this.executedCommandCount = 0;
		this.presentCommandCount = 0;
		this.wordCount = 0;
		this.readback.reset();
	}

	public serial = 0;
	public vramClearSerial = 0;
	public commandCount = 0;
	public executedCommandCount = 0;
	public presentCommandCount = 0;
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
	public readonly readback: GxGpuReadbackPort;

	public constructor(dmaController: DmaController) {
		this.readback = new GxGpuReadbackPort(dmaController);
	}

	public reset(): void {
		this.publishRevision(true);
		this.clearCommandState();
	}

	public abortReadbackAndQueuedCommands(): void {
		if (this.readback.phase === GX_GPU_READBACK_IDLE) {
			return;
		}
		if (this.readback.phase === GX_GPU_READBACK_PENDING && this.readback.fenceCommandCount !== 0) {
			this.commandCount = this.readback.fenceCommandCount - 1;
			this.wordCount = this.commandWordStart[this.commandCount];
			if (this.executedCommandCount > this.commandCount) {
				this.executedCommandCount = this.commandCount;
			}
			if (this.presentCommandCount > this.commandCount) {
				this.presentCommandCount = this.commandCount;
			}
			this.readback.reset();
			return;
		}
		this.publishRevision(false);
		this.clearCommandState();
	}

	public captureState(): GxGpuCommandBufferState {
		const commandCount = this.commandCount;
		const wordCount = this.wordCount;
		return {
			commandCount,
			executedCommandCount: this.executedCommandCount,
			presentCommandCount: this.presentCommandCount,
			wordCount,
			commandKind: Array.from(this.commandKind.subarray(0, commandCount)),
			commandOpcode: Array.from(this.commandOpcode.subarray(0, commandCount)),
			commandWordStart: Array.from(this.commandWordStart.subarray(0, commandCount)),
			commandWordCount: Array.from(this.commandWordCount.subarray(0, commandCount)),
			commandDrawModeWord: Array.from(this.commandDrawModeWord.subarray(0, commandCount)),
			commandTextureWindowWord: Array.from(this.commandTextureWindowWord.subarray(0, commandCount)),
			commandDrawingAreaTopLeftWord: Array.from(this.commandDrawingAreaTopLeftWord.subarray(0, commandCount)),
			commandDrawingAreaBottomRightWord: Array.from(this.commandDrawingAreaBottomRightWord.subarray(0, commandCount)),
			commandDrawingOffsetWord: Array.from(this.commandDrawingOffsetWord.subarray(0, commandCount)),
			commandMaskBitModeWord: Array.from(this.commandMaskBitModeWord.subarray(0, commandCount)),
			commandInterlacedRenderWord: Array.from(this.commandInterlacedRenderWord.subarray(0, commandCount)),
			words: Array.from(this.words.subarray(0, wordCount)),
			readbackPhase: this.readback.phase === GX_GPU_READBACK_SUBMITTED ? GX_GPU_READBACK_PENDING : this.readback.phase,
			readbackFenceCommandCount: this.readback.fenceCommandCount,
			readbackX: this.readback.x,
			readbackY: this.readback.y,
			readbackWidth: this.readback.width,
			readbackHeight: this.readback.height,
			readbackPixelCursor: this.readback.pixelCursor,
			readbackPixelBytes: this.readback.phase === GX_GPU_READBACK_READY
				? this.readback.pixelBytes.slice(0, this.readback.width * this.readback.height * 2)
				: gxGpuEmptyReadbackPixelBytes,
		};
	}

	public restoreState(state: GxGpuCommandBufferState): void {
		this.publishRevision(false);
		this.commandCount = state.commandCount;
		this.executedCommandCount = state.executedCommandCount;
		this.presentCommandCount = state.presentCommandCount;
		this.wordCount = state.wordCount;
		this.commandKind.set(state.commandKind, 0);
		this.commandOpcode.set(state.commandOpcode, 0);
		this.commandWordStart.set(state.commandWordStart, 0);
		this.commandWordCount.set(state.commandWordCount, 0);
		this.commandDrawModeWord.set(state.commandDrawModeWord, 0);
		this.commandTextureWindowWord.set(state.commandTextureWindowWord, 0);
		this.commandDrawingAreaTopLeftWord.set(state.commandDrawingAreaTopLeftWord, 0);
		this.commandDrawingAreaBottomRightWord.set(state.commandDrawingAreaBottomRightWord, 0);
		this.commandDrawingOffsetWord.set(state.commandDrawingOffsetWord, 0);
		this.commandMaskBitModeWord.set(state.commandMaskBitModeWord, 0);
		this.commandInterlacedRenderWord.set(state.commandInterlacedRenderWord, 0);
		this.words.set(state.words, 0);
		this.readback.phase = state.readbackPhase;
		this.readback.fenceCommandCount = state.readbackFenceCommandCount;
		this.readback.x = state.readbackX;
		this.readback.y = state.readbackY;
		this.readback.width = state.readbackWidth;
		this.readback.height = state.readbackHeight;
		this.readback.pixelCursor = state.readbackPixelCursor;
		this.readback.pixelBytes.set(state.readbackPixelBytes, 0);
		this.readback.token = (this.readback.token + 1) >>> 0;
		this.readback.dmaController.setGxGpuReadReady(this.readback.phase === GX_GPU_READBACK_READY);
	}

	public retireCommandsPreservingVram(): number {
		const retiredCommands = this.presentCommandCount;
		if (retiredCommands === 0) {
			return 0;
		}
		const oldCommandCount = this.commandCount;
		const oldWordCount = this.wordCount;
		const retiredWords = retiredCommands === oldCommandCount
			? this.commandWordStart[retiredCommands - 1] + this.commandWordCount[retiredCommands - 1]
			: this.commandWordStart[retiredCommands];
		const remainingCommands = oldCommandCount - retiredCommands;
		const remainingWords = oldWordCount - retiredWords;
		this.commandKind.copyWithin(0, retiredCommands, oldCommandCount);
		this.commandOpcode.copyWithin(0, retiredCommands, oldCommandCount);
		this.commandWordStart.copyWithin(0, retiredCommands, oldCommandCount);
		this.commandWordCount.copyWithin(0, retiredCommands, oldCommandCount);
		this.commandDrawModeWord.copyWithin(0, retiredCommands, oldCommandCount);
		this.commandTextureWindowWord.copyWithin(0, retiredCommands, oldCommandCount);
		this.commandDrawingAreaTopLeftWord.copyWithin(0, retiredCommands, oldCommandCount);
		this.commandDrawingAreaBottomRightWord.copyWithin(0, retiredCommands, oldCommandCount);
		this.commandDrawingOffsetWord.copyWithin(0, retiredCommands, oldCommandCount);
		this.commandMaskBitModeWord.copyWithin(0, retiredCommands, oldCommandCount);
		this.commandInterlacedRenderWord.copyWithin(0, retiredCommands, oldCommandCount);
		for (let commandIndex = 0; commandIndex < remainingCommands; commandIndex += 1) {
			this.commandWordStart[commandIndex] -= retiredWords;
		}
		this.words.copyWithin(0, retiredWords, oldWordCount);
		this.commandCount = remainingCommands;
		this.executedCommandCount -= retiredCommands;
		this.presentCommandCount = 0;
		this.wordCount = remainingWords;
		this.readback.fenceCommandCount = retiredCommands < this.readback.fenceCommandCount
			? this.readback.fenceCommandCount - retiredCommands
			: 0;
		this.publishRevision(false);
		return retiredWords;
	}

	public sealCommandsForPresentation(): void {
		if (this.readback.phase === GX_GPU_READBACK_PENDING) {
			this.presentCommandCount = this.readback.fenceCommandCount;
		} else if (this.readback.phase === GX_GPU_READBACK_IDLE) {
			this.presentCommandCount = this.executedCommandCount;
		} else {
			this.presentCommandCount = 0;
		}
	}

	public hasUnretiredPresentCommands(): boolean {
		return this.presentCommandCount !== 0
			|| (this.readback.phase === GX_GPU_READBACK_PENDING && this.presentCommandCount === this.readback.fenceCommandCount);
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

	public completeCommandExecution(commandCount: number): void {
		this.executedCommandCount = commandCount;
		const commandIndex = commandCount - 1;
		if (this.commandKind[commandIndex] === GX_GPU_COMMAND_READ_VRAM_TO_CPU) {
			this.activateReadback(commandIndex);
		}
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
