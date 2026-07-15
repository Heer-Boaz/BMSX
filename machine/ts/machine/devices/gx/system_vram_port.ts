import {
	IO_GX_GPU_SYSTEM_VRAM_CONTROL,
	IO_GX_GPU_SYSTEM_VRAM_DATA,
	IO_GX_GPU_SYSTEM_VRAM_POSITION,
	IO_GX_GPU_SYSTEM_VRAM_SIZE,
	IO_GX_GPU_SYSTEM_VRAM_STATUS,
} from '../../bus/io';
import type { Value } from '../../cpu/cpu';
import { Memory } from '../../memory/memory';

export const GX_GPU_SYSTEM_VRAM_X = 512;
export const GX_GPU_SYSTEM_VRAM_Y = 0;
export const GX_GPU_SYSTEM_VRAM_WIDTH = 256;
export const GX_GPU_SYSTEM_VRAM_HEIGHT = 256;
export const GX_GPU_SYSTEM_VRAM_PORT_COMMAND_CAPACITY = 256;
export const GX_GPU_SYSTEM_VRAM_PORT_WORD_CAPACITY = 0x8000;
export const GX_GPU_SYSTEM_VRAM_PORT_CONTROL_START = 1 << 0;
export const GX_GPU_SYSTEM_VRAM_PORT_CONTROL_RESET = 1 << 1;
export const GX_GPU_SYSTEM_VRAM_PORT_STATUS_BUSY = 1 << 0;
export const GX_GPU_SYSTEM_VRAM_PORT_STATUS_WRITE_READY = 1 << 1;
export const GX_GPU_SYSTEM_VRAM_PORT_STATUS_OVERFLOW = 1 << 2;
export const GX_GPU_SYSTEM_VRAM_PORT_STATUS_PENDING = 1 << 3;
export const GX_GPU_SYSTEM_VRAM_PORT_STATUS_REMAINING_SHIFT = 8;

const gxGpuSystemVramUnmappedReadError = new Error('GX system VRAM port read handler received an unmapped register.');
const gxGpuSystemVramUnmappedWriteError = new Error('GX system VRAM port write handler received an unmapped register.');

export function gxGpuSystemVramX(positionWord: number): number {
	return GX_GPU_SYSTEM_VRAM_X + (positionWord & (GX_GPU_SYSTEM_VRAM_WIDTH - 1));
}

export function gxGpuSystemVramY(positionWord: number): number {
	return GX_GPU_SYSTEM_VRAM_Y + ((positionWord >>> 16) & (GX_GPU_SYSTEM_VRAM_HEIGHT - 1));
}

export function gxGpuSystemVramColumnX(positionWord: number, column: number): number {
	return GX_GPU_SYSTEM_VRAM_X + ((positionWord + column) & (GX_GPU_SYSTEM_VRAM_WIDTH - 1));
}

export function gxGpuSystemVramRowY(positionWord: number, row: number): number {
	return GX_GPU_SYSTEM_VRAM_Y + (((positionWord >>> 16) + row) & (GX_GPU_SYSTEM_VRAM_HEIGHT - 1));
}

export function gxGpuSystemVramWidth(sizeWord: number): number {
	return (((sizeWord & 0xff) - 1) & 0xff) + 1;
}

export function gxGpuSystemVramHeight(sizeWord: number): number {
	return ((((sizeWord >>> 16) & 0xff) - 1) & 0xff) + 1;
}

export type GxGpuSystemVramPortState = {
	positionWord: number;
	sizeWord: number;
	controlWord: number;
	dataWord: number;
	statusWord: number;
	commandCount: number;
	presentCommandCount: number;
	wordCount: number;
	activePositionWord: number;
	activeSizeWord: number;
	activeWordStart: number;
	activeWordsRemaining: number;
	commandPositionWord: number[];
	commandSizeWord: number[];
	commandWordStart: number[];
	words: number[];
};

export type GxGpuSystemVramPortView = Readonly<{
	serial: number;
	commandCount: number;
	presentCommandCount: number;
	wordCount: number;
	commandPositionWord: ArrayLike<number>;
	commandSizeWord: ArrayLike<number>;
	commandWordStart: ArrayLike<number>;
	words: ArrayLike<number>;
}>;

let gxGpuSystemVramNextSerial = 0;

export class GxGpuSystemVramPort implements GxGpuSystemVramPortView {
	public serial = 0;
	public commandCount = 0;
	public presentCommandCount = 0;
	public wordCount = 0;
	public readonly commandPositionWord = new Uint32Array(GX_GPU_SYSTEM_VRAM_PORT_COMMAND_CAPACITY);
	public readonly commandSizeWord = new Uint32Array(GX_GPU_SYSTEM_VRAM_PORT_COMMAND_CAPACITY);
	public readonly commandWordStart = new Uint32Array(GX_GPU_SYSTEM_VRAM_PORT_COMMAND_CAPACITY);
	public readonly words = new Uint32Array(GX_GPU_SYSTEM_VRAM_PORT_WORD_CAPACITY);

	private positionWord = 0;
	private sizeWord = 0;
	private controlWord = 0;
	private dataWord = 0;
	private statusWord = 0;
	private activePositionWord = 0;
	private activeSizeWord = 0;
	private activeWordStart = 0;
	private activeWordsRemaining = 0;

	public constructor(memory: Memory) {
		memory.mapIoRead(IO_GX_GPU_SYSTEM_VRAM_POSITION, this, GxGpuSystemVramPort.readRegister);
		memory.mapIoRead(IO_GX_GPU_SYSTEM_VRAM_SIZE, this, GxGpuSystemVramPort.readRegister);
		memory.mapIoRead(IO_GX_GPU_SYSTEM_VRAM_CONTROL, this, GxGpuSystemVramPort.readRegister);
		memory.mapIoRead(IO_GX_GPU_SYSTEM_VRAM_DATA, this, GxGpuSystemVramPort.readRegister);
		memory.mapIoRead(IO_GX_GPU_SYSTEM_VRAM_STATUS, this, GxGpuSystemVramPort.readRegister);
		memory.mapIoWrite(IO_GX_GPU_SYSTEM_VRAM_POSITION, this, GxGpuSystemVramPort.writeRegister);
		memory.mapIoWrite(IO_GX_GPU_SYSTEM_VRAM_SIZE, this, GxGpuSystemVramPort.writeRegister);
		memory.mapIoWrite(IO_GX_GPU_SYSTEM_VRAM_CONTROL, this, GxGpuSystemVramPort.writeRegister);
		memory.mapIoWrite(IO_GX_GPU_SYSTEM_VRAM_DATA, this, GxGpuSystemVramPort.writeRegister);
	}

	public reset(): void {
		this.positionWord = 0;
		this.sizeWord = 0;
		this.controlWord = 0;
		this.dataWord = 0;
		this.statusWord = 0;
		this.commandCount = 0;
		this.presentCommandCount = 0;
		this.wordCount = 0;
		this.activePositionWord = 0;
		this.activeSizeWord = 0;
		this.activeWordStart = 0;
		this.activeWordsRemaining = 0;
		this.publishRevision();
	}

	public captureState(): GxGpuSystemVramPortState {
		return {
			positionWord: this.positionWord,
			sizeWord: this.sizeWord,
			controlWord: this.controlWord,
			dataWord: this.dataWord,
			statusWord: this.statusWord,
			commandCount: this.commandCount,
			presentCommandCount: this.presentCommandCount,
			wordCount: this.wordCount,
			activePositionWord: this.activePositionWord,
			activeSizeWord: this.activeSizeWord,
			activeWordStart: this.activeWordStart,
			activeWordsRemaining: this.activeWordsRemaining,
			commandPositionWord: Array.from(this.commandPositionWord.subarray(0, this.commandCount)),
			commandSizeWord: Array.from(this.commandSizeWord.subarray(0, this.commandCount)),
			commandWordStart: Array.from(this.commandWordStart.subarray(0, this.commandCount)),
			words: Array.from(this.words.subarray(0, this.wordCount)),
		};
	}

	public restoreState(state: GxGpuSystemVramPortState): void {
		this.positionWord = state.positionWord >>> 0;
		this.sizeWord = state.sizeWord >>> 0;
		this.controlWord = state.controlWord >>> 0;
		this.dataWord = state.dataWord >>> 0;
		this.statusWord = state.statusWord >>> 0;
		this.commandCount = state.commandCount;
		this.presentCommandCount = state.presentCommandCount;
		this.wordCount = state.wordCount;
		this.activePositionWord = state.activePositionWord >>> 0;
		this.activeSizeWord = state.activeSizeWord >>> 0;
		this.activeWordStart = state.activeWordStart;
		this.activeWordsRemaining = state.activeWordsRemaining;
		this.commandPositionWord.set(state.commandPositionWord, 0);
		this.commandSizeWord.set(state.commandSizeWord, 0);
		this.commandWordStart.set(state.commandWordStart, 0);
		this.words.set(state.words, 0);
		this.publishRevision();
	}

	public sealForPresentation(): void {
		this.presentCommandCount = this.commandCount;
	}

	public hasUnretiredPresentCommands(): boolean {
		return this.presentCommandCount !== 0;
	}

	public retirePresentedCommands(): void {
		const retiredCommands = this.presentCommandCount;
		if (retiredCommands === 0) {
			return;
		}
		const oldCommandCount = this.commandCount;
		const oldWordCount = this.wordCount;
		const retiredWords = retiredCommands < oldCommandCount
			? this.commandWordStart[retiredCommands]
			: this.activeWordsRemaining !== 0 ? this.activeWordStart : oldWordCount;
		const remainingCommands = oldCommandCount - retiredCommands;
		this.commandPositionWord.copyWithin(0, retiredCommands, oldCommandCount);
		this.commandSizeWord.copyWithin(0, retiredCommands, oldCommandCount);
		this.commandWordStart.copyWithin(0, retiredCommands, oldCommandCount);
		for (let commandIndex = 0; commandIndex < remainingCommands; commandIndex += 1) {
			this.commandWordStart[commandIndex] -= retiredWords;
		}
		this.words.copyWithin(0, retiredWords, oldWordCount);
		this.commandCount = remainingCommands;
		this.presentCommandCount = 0;
		this.wordCount = oldWordCount - retiredWords;
		if (this.activeWordsRemaining !== 0) {
			this.activeWordStart -= retiredWords;
		}
		this.publishRevision();
		this.updateStatus();
	}

	private publishRevision(): void {
		gxGpuSystemVramNextSerial = (gxGpuSystemVramNextSerial + 1) >>> 0;
		this.serial = gxGpuSystemVramNextSerial;
	}

	private abortTransfers(): void {
		this.commandCount = 0;
		this.presentCommandCount = 0;
		this.wordCount = 0;
		this.activePositionWord = 0;
		this.activeSizeWord = 0;
		this.activeWordStart = 0;
		this.activeWordsRemaining = 0;
		this.statusWord = 0;
		this.publishRevision();
	}

	private beginTransfer(): void {
		if (this.activeWordsRemaining !== 0) {
			this.statusWord |= GX_GPU_SYSTEM_VRAM_PORT_STATUS_OVERFLOW;
			this.updateStatus();
			return;
		}
		const pixelCount = gxGpuSystemVramWidth(this.sizeWord) * gxGpuSystemVramHeight(this.sizeWord);
		const transferWordCount = (pixelCount + 1) >> 1;
		if (this.commandCount === GX_GPU_SYSTEM_VRAM_PORT_COMMAND_CAPACITY
			|| this.wordCount + transferWordCount > GX_GPU_SYSTEM_VRAM_PORT_WORD_CAPACITY) {
			this.statusWord |= GX_GPU_SYSTEM_VRAM_PORT_STATUS_OVERFLOW;
			this.updateStatus();
			return;
		}
		this.activeWordStart = this.wordCount;
		this.activePositionWord = this.positionWord;
		this.activeSizeWord = this.sizeWord;
		this.activeWordsRemaining = transferWordCount;
		this.updateStatus();
	}

	private writeData(word: number): void {
		this.dataWord = word;
		if (this.activeWordsRemaining === 0) {
			return;
		}
		this.words[this.wordCount] = word;
		this.wordCount += 1;
		this.activeWordsRemaining -= 1;
		if (this.activeWordsRemaining === 0) {
			const commandIndex = this.commandCount;
			this.commandPositionWord[commandIndex] = this.activePositionWord;
			this.commandSizeWord[commandIndex] = this.activeSizeWord;
			this.commandWordStart[commandIndex] = this.activeWordStart;
			this.commandCount = commandIndex + 1;
			this.activePositionWord = 0;
			this.activeSizeWord = 0;
			this.activeWordStart = 0;
		}
		this.updateStatus();
	}

	private updateStatus(): void {
		const retainedStatus = this.statusWord & GX_GPU_SYSTEM_VRAM_PORT_STATUS_OVERFLOW;
		this.statusWord = (retainedStatus
			| (this.activeWordsRemaining !== 0
				? GX_GPU_SYSTEM_VRAM_PORT_STATUS_BUSY | GX_GPU_SYSTEM_VRAM_PORT_STATUS_WRITE_READY
				: 0)
			| (this.commandCount !== 0 ? GX_GPU_SYSTEM_VRAM_PORT_STATUS_PENDING : 0)
			| (this.activeWordsRemaining << GX_GPU_SYSTEM_VRAM_PORT_STATUS_REMAINING_SHIFT)) >>> 0;
	}

	private static readRegister(context: GxGpuSystemVramPort, address: number): number {
		switch (address) {
			case IO_GX_GPU_SYSTEM_VRAM_POSITION:
				return context.positionWord;
			case IO_GX_GPU_SYSTEM_VRAM_SIZE:
				return context.sizeWord;
			case IO_GX_GPU_SYSTEM_VRAM_CONTROL:
				return context.controlWord;
			case IO_GX_GPU_SYSTEM_VRAM_DATA:
				return context.dataWord;
			case IO_GX_GPU_SYSTEM_VRAM_STATUS:
				return context.statusWord;
		}
		throw gxGpuSystemVramUnmappedReadError;
	}

	private static writeRegister(context: GxGpuSystemVramPort, address: number, value: Value): void {
		const word = (value as number) >>> 0;
		switch (address) {
			case IO_GX_GPU_SYSTEM_VRAM_POSITION:
				context.positionWord = word;
				return;
			case IO_GX_GPU_SYSTEM_VRAM_SIZE:
				context.sizeWord = word;
				return;
			case IO_GX_GPU_SYSTEM_VRAM_CONTROL:
				context.controlWord = word;
				if ((word & GX_GPU_SYSTEM_VRAM_PORT_CONTROL_RESET) !== 0) {
					context.abortTransfers();
				}
				if ((word & GX_GPU_SYSTEM_VRAM_PORT_CONTROL_START) !== 0) {
					context.beginTransfer();
				}
				return;
			case IO_GX_GPU_SYSTEM_VRAM_DATA:
				context.writeData(word);
				return;
		}
		throw gxGpuSystemVramUnmappedWriteError;
	}
}
