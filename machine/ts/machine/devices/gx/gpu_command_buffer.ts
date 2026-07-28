import { DMA_REQUEST_GX_READ } from '../../../spec/bmsx/io';
import type { DmaController } from '../dma/controller';
import {
	GX_GPU_TRANSFER_MAX_BYTE_COUNT,
	gxGpuTransferHeight,
	gxGpuTransferWidth,
} from '../../../spec/gx/gp0';
import { GX_GPU_VRAM_WIDTH, gxGpuVramYAddress } from '../../../spec/gx/vram';

export const GX_GPU_COMMAND_CAPACITY = 4096;
export const GX_GPU_COMMAND_WORD_CAPACITY = 0x80000;
export const GX_GPU_SKIPPED_LINE_NONE = 2;

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
	commandVramYAddressExtensionWord: number[];
	commandTextureWindowWord: number[];
	commandDrawingAreaTopLeftWord: number[];
	commandDrawingAreaBottomRightWord: number[];
	commandDrawingOffsetWord: number[];
	commandMaskBitModeWord: number[];
	commandSkippedLineParity: number[];
	words: number[];
	readbackPhase: number;
	readbackFenceCommandCount: number;
	readbackX: number;
	readbackY: number;
	readbackVramYAddressExtensionWord: number;
	readbackWidth: number;
	readbackHeight: number;
	readbackPixelCursor: number;
	readbackPixelBytes: Uint8Array;
};

export type GxGpuCommandBufferView = {
	readonly serial: number;
	readonly commandCount: number;
	readonly executedCommandCount: number;
	readonly presentCommandCount: number;
	readonly wordCount: number;
	readonly commandKind: ArrayLike<number>;
	readonly commandOpcode: ArrayLike<number>;
	readonly commandWordStart: ArrayLike<number>;
	readonly commandWordCount: ArrayLike<number>;
	readonly commandDrawModeWord: ArrayLike<number>;
	readonly commandVramYAddressExtensionWord: ArrayLike<number>;
	readonly commandTextureWindowWord: ArrayLike<number>;
	readonly commandDrawingAreaTopLeftWord: ArrayLike<number>;
	readonly commandDrawingAreaBottomRightWord: ArrayLike<number>;
	readonly commandDrawingOffsetWord: ArrayLike<number>;
	readonly commandMaskBitModeWord: ArrayLike<number>;
	readonly commandSkippedLineParity: ArrayLike<number>;
	readonly words: Uint32Array;
	readonly wordBytes: Uint8Array;
};

export type GxGpuReadbackView = {
	readonly phase: number;
	readonly fenceCommandCount: number;
	readonly x: number;
	readonly y: number;
	readonly vramYAddressExtensionWord: number;
	readonly width: number;
	readonly height: number;
	readonly pixelCursor: number;
	readonly pixelBytes: Uint8Array;
	readonly token: number;
};

export type GxGpuReadbackPortView = GxGpuReadbackView & {
	claimReadback(executedCommandCount: number): boolean;
	completeReadback(token: number): void;
};

class GxGpuReadbackPort implements GxGpuReadbackPortView {
	public phase = GX_GPU_READBACK_IDLE;
	public fenceCommandCount = 0;
	public x = 0;
	public y = 0;
	public vramYAddressExtensionWord = 0;
	public width = 0;
	public height = 0;
	public pixelCursor = 0;
	public readonly pixelBytes = new Uint8Array(GX_GPU_TRANSFER_MAX_BYTE_COUNT);
	public token = 0;
	private dmaReadEnabled = false;

	public constructor(private readonly dmaController: DmaController) {
	}

	public setDmaReadEnabled(enabled: boolean): void {
		this.dmaReadEnabled = enabled;
		this.updateDmaRequest();
	}

	/** @internal Command-buffer owner transition; excluded from GxGpuReadbackPortView. */
	public activate(positionWord: number, sizeWord: number, fenceCommandCount: number, vramYAddressExtensionWord: number): void {
		this.x = positionWord & (GX_GPU_VRAM_WIDTH - 1);
		this.vramYAddressExtensionWord = vramYAddressExtensionWord;
		this.y = gxGpuVramYAddress(positionWord >>> 16, vramYAddressExtensionWord);
		this.width = gxGpuTransferWidth(sizeWord);
		this.height = gxGpuTransferHeight(sizeWord);
		this.pixelCursor = 0;
		this.fenceCommandCount = fenceCommandCount;
		this.token = (this.token + 1) >>> 0;
		this.phase = GX_GPU_READBACK_PENDING;
		this.updateDmaRequest();
	}

	/** @internal Command-buffer owner transition; excluded from GxGpuReadbackPortView. */
	public reset(): void {
		this.phase = GX_GPU_READBACK_IDLE;
		this.fenceCommandCount = 0;
		this.x = 0;
		this.y = 0;
		this.vramYAddressExtensionWord = 0;
		this.width = 0;
		this.height = 0;
		this.pixelCursor = 0;
		this.token = (this.token + 1) >>> 0;
		this.updateDmaRequest();
	}

	public claimReadback(executedCommandCount: number): boolean {
		if (this.phase !== GX_GPU_READBACK_PENDING || executedCommandCount !== this.fenceCommandCount) {
			return false;
		}
		this.phase = GX_GPU_READBACK_SUBMITTED;
		return true;
	}

	public completeReadback(token: number): void {
		if (this.phase === GX_GPU_READBACK_SUBMITTED && this.token === token) {
			this.phase = GX_GPU_READBACK_READY;
			this.updateDmaRequest();
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
			this.vramYAddressExtensionWord = 0;
			this.width = 0;
			this.height = 0;
			this.pixelCursor = 0;
			this.updateDmaRequest();
		}
		return word >>> 0;
	}

	private updateDmaRequest(): void {
		const requestBit = 1 << DMA_REQUEST_GX_READ;
		this.dmaController.setRequestLines(
			requestBit,
			this.dmaReadEnabled && this.phase === GX_GPU_READBACK_READY ? requestBit : 0,
		);
	}
}

let gxGpuCommandBufferNextSerial = 0;
const gxGpuEmptyReadbackPixelBytes = new Uint8Array(0);

export class GxGpuCommandBuffer implements GxGpuCommandBufferView {
	private publishRevision(): void {
		gxGpuCommandBufferNextSerial = (gxGpuCommandBufferNextSerial + 1) >>> 0;
		this.serial = gxGpuCommandBufferNextSerial;
	}

	private activateReadback(commandIndex: number): void {
		const wordStart = this.commandWordStart[commandIndex];
		this.readback.activate(this.words[wordStart + 1], this.words[wordStart + 2], commandIndex + 1, this.commandVramYAddressExtensionWord[commandIndex]);
	}

	private clearCommandState(): void {
		this.commandCount = 0;
		this.executedCommandCount = 0;
		this.presentCommandCount = 0;
		this.wordCount = 0;
		this.readback.reset();
	}

	public serial = 0;
	public commandCount = 0;
	public executedCommandCount = 0;
	public presentCommandCount = 0;
	public wordCount = 0;
	public readonly commandKind = new Uint8Array(GX_GPU_COMMAND_CAPACITY);
	public readonly commandOpcode = new Uint8Array(GX_GPU_COMMAND_CAPACITY);
	public readonly commandWordStart = new Uint32Array(GX_GPU_COMMAND_CAPACITY);
	public readonly commandWordCount = new Uint32Array(GX_GPU_COMMAND_CAPACITY);
	public readonly commandDrawModeWord = new Uint32Array(GX_GPU_COMMAND_CAPACITY);
	public readonly commandVramYAddressExtensionWord = new Uint8Array(GX_GPU_COMMAND_CAPACITY);
	public readonly commandTextureWindowWord = new Uint32Array(GX_GPU_COMMAND_CAPACITY);
	public readonly commandDrawingAreaTopLeftWord = new Uint32Array(GX_GPU_COMMAND_CAPACITY);
	public readonly commandDrawingAreaBottomRightWord = new Uint32Array(GX_GPU_COMMAND_CAPACITY);
	public readonly commandDrawingOffsetWord = new Uint32Array(GX_GPU_COMMAND_CAPACITY);
	public readonly commandMaskBitModeWord = new Uint32Array(GX_GPU_COMMAND_CAPACITY);
	public readonly commandSkippedLineParity = new Uint8Array(GX_GPU_COMMAND_CAPACITY);
	public readonly words = new Uint32Array(GX_GPU_COMMAND_WORD_CAPACITY);
	public readonly wordBytes = new Uint8Array(this.words.buffer);
	public readonly readback: GxGpuReadbackPort;

	public constructor(dmaController: DmaController) {
		this.readback = new GxGpuReadbackPort(dmaController);
	}

	public reset(): void {
		this.publishRevision();
		this.clearCommandState();
	}

	public abortReadbackAndQueuedCommands(): void {
		if (this.readback.phase === GX_GPU_READBACK_IDLE) {
			// C0 is retained before its execution deadline activates the readback port.
			const commandIndex = this.executedCommandCount;
			if (commandIndex === this.commandCount || this.commandKind[commandIndex] !== GX_GPU_COMMAND_READ_VRAM_TO_CPU) {
				return;
			}
			this.commandCount = commandIndex;
			this.wordCount = this.commandWordStart[commandIndex];
			if (this.presentCommandCount > commandIndex) {
				this.presentCommandCount = commandIndex;
			}
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
		this.publishRevision();
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
			commandVramYAddressExtensionWord: Array.from(this.commandVramYAddressExtensionWord.subarray(0, commandCount)),
			commandTextureWindowWord: Array.from(this.commandTextureWindowWord.subarray(0, commandCount)),
			commandDrawingAreaTopLeftWord: Array.from(this.commandDrawingAreaTopLeftWord.subarray(0, commandCount)),
			commandDrawingAreaBottomRightWord: Array.from(this.commandDrawingAreaBottomRightWord.subarray(0, commandCount)),
			commandDrawingOffsetWord: Array.from(this.commandDrawingOffsetWord.subarray(0, commandCount)),
			commandMaskBitModeWord: Array.from(this.commandMaskBitModeWord.subarray(0, commandCount)),
			commandSkippedLineParity: Array.from(this.commandSkippedLineParity.subarray(0, commandCount)),
			words: Array.from(this.words.subarray(0, wordCount)),
			readbackPhase: this.readback.phase === GX_GPU_READBACK_SUBMITTED ? GX_GPU_READBACK_PENDING : this.readback.phase,
			readbackFenceCommandCount: this.readback.fenceCommandCount,
			readbackX: this.readback.x,
			readbackY: this.readback.y,
			readbackVramYAddressExtensionWord: this.readback.vramYAddressExtensionWord,
			readbackWidth: this.readback.width,
			readbackHeight: this.readback.height,
			readbackPixelCursor: this.readback.pixelCursor,
			readbackPixelBytes: this.readback.phase === GX_GPU_READBACK_READY
				? this.readback.pixelBytes.slice(0, this.readback.width * this.readback.height * 2)
				: gxGpuEmptyReadbackPixelBytes,
		};
	}

	public restoreState(state: GxGpuCommandBufferState): void {
		this.publishRevision();
		this.commandCount = state.commandCount;
		this.executedCommandCount = state.executedCommandCount;
		this.presentCommandCount = state.presentCommandCount;
		this.wordCount = state.wordCount;
		this.commandKind.set(state.commandKind, 0);
		this.commandOpcode.set(state.commandOpcode, 0);
		this.commandWordStart.set(state.commandWordStart, 0);
		this.commandWordCount.set(state.commandWordCount, 0);
		this.commandDrawModeWord.set(state.commandDrawModeWord, 0);
		this.commandVramYAddressExtensionWord.set(state.commandVramYAddressExtensionWord, 0);
		this.commandTextureWindowWord.set(state.commandTextureWindowWord, 0);
		this.commandDrawingAreaTopLeftWord.set(state.commandDrawingAreaTopLeftWord, 0);
		this.commandDrawingAreaBottomRightWord.set(state.commandDrawingAreaBottomRightWord, 0);
		this.commandDrawingOffsetWord.set(state.commandDrawingOffsetWord, 0);
		this.commandMaskBitModeWord.set(state.commandMaskBitModeWord, 0);
		this.commandSkippedLineParity.set(state.commandSkippedLineParity, 0);
		this.words.set(state.words, 0);
		this.readback.phase = state.readbackPhase;
		this.readback.fenceCommandCount = state.readbackFenceCommandCount;
		this.readback.x = state.readbackX;
		this.readback.y = state.readbackY;
		this.readback.vramYAddressExtensionWord = state.readbackVramYAddressExtensionWord;
		this.readback.width = state.readbackWidth;
		this.readback.height = state.readbackHeight;
		this.readback.pixelCursor = state.readbackPixelCursor;
		this.readback.pixelBytes.set(state.readbackPixelBytes, 0);
		this.readback.token = (this.readback.token + 1) >>> 0;
	}

	public retireCommandsPreservingVram(retiredCommands: number): number {
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
		this.commandVramYAddressExtensionWord.copyWithin(0, retiredCommands, oldCommandCount);
		this.commandTextureWindowWord.copyWithin(0, retiredCommands, oldCommandCount);
		this.commandDrawingAreaTopLeftWord.copyWithin(0, retiredCommands, oldCommandCount);
		this.commandDrawingAreaBottomRightWord.copyWithin(0, retiredCommands, oldCommandCount);
		this.commandDrawingOffsetWord.copyWithin(0, retiredCommands, oldCommandCount);
		this.commandMaskBitModeWord.copyWithin(0, retiredCommands, oldCommandCount);
		this.commandSkippedLineParity.copyWithin(0, retiredCommands, oldCommandCount);
		for (let commandIndex = 0; commandIndex < remainingCommands; commandIndex += 1) {
			this.commandWordStart[commandIndex] -= retiredWords;
		}
		this.words.copyWithin(0, retiredWords, oldWordCount);
		this.commandCount = remainingCommands;
		this.executedCommandCount -= retiredCommands;
		this.presentCommandCount = retiredCommands < this.presentCommandCount
			? this.presentCommandCount - retiredCommands
			: 0;
		this.wordCount = remainingWords;
		this.readback.fenceCommandCount = retiredCommands < this.readback.fenceCommandCount
			? this.readback.fenceCommandCount - retiredCommands
			: 0;
		this.publishRevision();
		return retiredWords;
	}

	public sealCommandsForPresentation(): void {
		if (this.readback.phase !== GX_GPU_READBACK_IDLE) {
			this.presentCommandCount = this.readback.fenceCommandCount;
		} else {
			this.presentCommandCount = this.executedCommandCount;
		}
	}

	public hasUnretiredPresentCommands(): boolean {
		return this.presentCommandCount !== 0;
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
		vramYAddressExtensionWord: number,
		textureWindowWord: number,
		drawingAreaTopLeftWord: number,
		drawingAreaBottomRightWord: number,
		drawingOffsetWord: number,
		maskBitModeWord: number,
		skippedLineParity: number,
	): void {
		const commandIndex = this.commandCount;
		this.commandKind[commandIndex] = kind;
		this.commandOpcode[commandIndex] = opcode;
		this.commandWordStart[commandIndex] = wordStart;
		this.commandWordCount[commandIndex] = wordCount;
		this.commandDrawModeWord[commandIndex] = drawModeWord >>> 0;
		this.commandVramYAddressExtensionWord[commandIndex] = vramYAddressExtensionWord;
		this.commandTextureWindowWord[commandIndex] = textureWindowWord >>> 0;
		this.commandDrawingAreaTopLeftWord[commandIndex] = drawingAreaTopLeftWord >>> 0;
		this.commandDrawingAreaBottomRightWord[commandIndex] = drawingAreaBottomRightWord >>> 0;
		this.commandDrawingOffsetWord[commandIndex] = drawingOffsetWord >>> 0;
		this.commandMaskBitModeWord[commandIndex] = maskBitModeWord >>> 0;
		this.commandSkippedLineParity[commandIndex] = skippedLineParity;
		this.commandCount = commandIndex + 1;
	}
}
