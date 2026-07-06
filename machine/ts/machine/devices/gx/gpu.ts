import type { Value } from '../../cpu/cpu';
import { IO_GX_GPU_GP0, IO_GX_GPU_GP1 } from '../../bus/io';
import type { Memory } from '../../memory/memory';
import { PSX_GPU_DISPLAY_MODE_PAL_WORD } from '../../model_registry';

export const GX_GPU_GP1_RESET = 0x00;
export const GX_GPU_GP1_CLEAR_FIFO = 0x01;
export const GX_GPU_GP1_ACK_INTERRUPT = 0x02;
export const GX_GPU_GP1_SET_DISPLAY_DISABLE = 0x03;
export const GX_GPU_GP1_SET_DMA_DIRECTION = 0x04;
export const GX_GPU_GP1_SET_DISPLAY_START = 0x05;
export const GX_GPU_GP1_SET_HORIZONTAL_DISPLAY_RANGE = 0x06;
export const GX_GPU_GP1_SET_VERTICAL_DISPLAY_RANGE = 0x07;
export const GX_GPU_GP1_SET_DISPLAY_MODE = 0x08;
export const GX_GPU_GP1_SET_TEXTURE_DISABLE_MASK = 0x09;
export const GX_GPU_GP1_OPCODE_SHIFT = 24;
export const GX_GPU_GP1_PARAM_MASK = 0x00ffffff;

export const GX_GPU_GP0_IRQ_REQUEST = 0x1f;
export const GX_GPU_GP0_OPCODE_SHIFT = 24;

export const GX_GPU_DISPLAY_START_MASK = 0x0007ffff;
export const GX_GPU_HORIZONTAL_DISPLAY_RANGE_MASK = 0x00ffffff;
export const GX_GPU_VERTICAL_DISPLAY_RANGE_MASK = 0x000fffff;

export const GX_GPU_DMA_DIRECTION_OFF = 0;
export const GX_GPU_DMA_DIRECTION_FIFO = 1;
export const GX_GPU_DMA_DIRECTION_CPU_TO_GP0 = 2;
export const GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU = 3;

export const GX_GPU_STATUS_INTERLACED_FIELD = 1 << 13;
export const GX_GPU_STATUS_REVERSE_FLAG = 1 << 14;
export const GX_GPU_STATUS_TEXTURE_DISABLE = 1 << 15;
export const GX_GPU_STATUS_HORIZONTAL_RESOLUTION_2 = 1 << 16;
export const GX_GPU_STATUS_HORIZONTAL_RESOLUTION_1_SHIFT = 17;
export const GX_GPU_STATUS_VERTICAL_RESOLUTION = 1 << 19;
export const GX_GPU_STATUS_PAL_MODE = 1 << 20;
export const GX_GPU_STATUS_DISPLAY_AREA_COLOR_DEPTH_24 = 1 << 21;
export const GX_GPU_STATUS_VERTICAL_INTERLACE = 1 << 22;
export const GX_GPU_STATUS_DISPLAY_DISABLE = 1 << 23;
export const GX_GPU_STATUS_INTERRUPT_REQUEST = 1 << 24;
export const GX_GPU_STATUS_DMA_DATA_REQUEST = 1 << 25;
export const GX_GPU_STATUS_GPU_IDLE = 1 << 26;
export const GX_GPU_STATUS_READY_TO_SEND_VRAM = 1 << 27;
export const GX_GPU_STATUS_READY_TO_RECEIVE_DMA = 1 << 28;
export const GX_GPU_STATUS_DMA_DIRECTION_SHIFT = 29;
export const GX_GPU_STATUS_DMA_DIRECTION_MASK = 0x3 << GX_GPU_STATUS_DMA_DIRECTION_SHIFT;
export const GX_GPU_STATUS_RESET_WORD = GX_GPU_STATUS_INTERLACED_FIELD
	| GX_GPU_STATUS_DISPLAY_DISABLE
	| GX_GPU_STATUS_GPU_IDLE
	| GX_GPU_STATUS_READY_TO_RECEIVE_DMA;
export const GX_GPU_STATUS_DISPLAY_MODE_MASK = GX_GPU_STATUS_REVERSE_FLAG
	| GX_GPU_STATUS_HORIZONTAL_RESOLUTION_2
	| (0x3 << GX_GPU_STATUS_HORIZONTAL_RESOLUTION_1_SHIFT)
	| GX_GPU_STATUS_VERTICAL_RESOLUTION
	| GX_GPU_STATUS_PAL_MODE
	| GX_GPU_STATUS_DISPLAY_AREA_COLOR_DEPTH_24
	| GX_GPU_STATUS_VERTICAL_INTERLACE;

export type GxGpuState = {
	gp0Word: number;
	gp1Word: number;
	displayModeWord: number;
	statusWord: number;
};

export class GxGpu {
	private gp0Word = 0;
	private gp1Word = 0;
	private displayModeWord = PSX_GPU_DISPLAY_MODE_PAL_WORD;
	private statusWord = GX_GPU_STATUS_RESET_WORD;
	private displayStartWord = 0;
	private horizontalDisplayRangeWord = 0x00c60260;
	private verticalDisplayRangeWord = 0x0003fc10;
	private textureDisableMaskWord = 0;

	public constructor(private readonly memory: Memory) {
		this.memory.mapIoRead(IO_GX_GPU_GP0, this, GxGpu.readGp0Thunk);
		this.memory.mapIoWrite(IO_GX_GPU_GP0, this, GxGpu.writeGp0Thunk);
		this.memory.mapIoRead(IO_GX_GPU_GP1, this, GxGpu.readStatusThunk);
		this.memory.mapIoWrite(IO_GX_GPU_GP1, this, GxGpu.writeGp1Thunk);
	}

	public reset(): void {
		this.gp0Word = 0;
		this.gp1Word = 0;
		this.displayModeWord = PSX_GPU_DISPLAY_MODE_PAL_WORD;
		this.statusWord = GX_GPU_STATUS_RESET_WORD;
		this.displayStartWord = 0;
		this.horizontalDisplayRangeWord = 0x00c60260;
		this.verticalDisplayRangeWord = 0x0003fc10;
		this.textureDisableMaskWord = 0;
		this.updateDisplayModeStatusBits();
		this.updateDmaRequestStatusBit();
		this.memory.writeIoValue(IO_GX_GPU_GP0, 0);
		this.writeStatusIo();
	}

	public captureState(): GxGpuState {
		return {
			gp0Word: this.gp0Word,
			gp1Word: this.gp1Word,
			displayModeWord: this.displayModeWord,
			statusWord: this.statusWord,
		};
	}

	public restoreState(state: GxGpuState): void {
		this.gp0Word = state.gp0Word >>> 0;
		this.gp1Word = state.gp1Word >>> 0;
		this.displayModeWord = state.displayModeWord >>> 0;
		this.statusWord = state.statusWord >>> 0;
		this.memory.writeIoValue(IO_GX_GPU_GP0, this.gp0Word);
		this.memory.writeIoValue(IO_GX_GPU_GP1, this.statusWord);
	}

	public readGp0(): number {
		return this.gp0Word;
	}

	public writeGp0(word: number): void {
		this.gp0Word = word >>> 0;
		this.memory.writeIoValue(IO_GX_GPU_GP0, this.gp0Word);
		if ((this.gp0Word >>> GX_GPU_GP0_OPCODE_SHIFT) === GX_GPU_GP0_IRQ_REQUEST) {
			this.statusWord = (this.statusWord | GX_GPU_STATUS_INTERRUPT_REQUEST) >>> 0;
			this.writeStatusIo();
		}
	}

	public readStatus(): number {
		return this.statusWord;
	}

	public writeGp1(word: number): number {
		const command = word >>> 0;
		this.gp1Word = command;
		const opcode = command >>> GX_GPU_GP1_OPCODE_SHIFT;
		switch (opcode) {
			case GX_GPU_GP1_RESET:
				this.reset();
				break;
			case GX_GPU_GP1_CLEAR_FIFO:
				this.writeStatusIo();
				break;
			case GX_GPU_GP1_ACK_INTERRUPT:
				this.statusWord = (this.statusWord & ~GX_GPU_STATUS_INTERRUPT_REQUEST) >>> 0;
				this.writeStatusIo();
				break;
			case GX_GPU_GP1_SET_DISPLAY_DISABLE:
				this.writeDisplayDisableWord(command);
				break;
			case GX_GPU_GP1_SET_DMA_DIRECTION:
				this.writeDmaDirectionWord(command);
				break;
			case GX_GPU_GP1_SET_DISPLAY_START:
				this.displayStartWord = command & GX_GPU_DISPLAY_START_MASK;
				this.writeStatusIo();
				break;
			case GX_GPU_GP1_SET_HORIZONTAL_DISPLAY_RANGE:
				this.horizontalDisplayRangeWord = command & GX_GPU_HORIZONTAL_DISPLAY_RANGE_MASK;
				this.writeStatusIo();
				break;
			case GX_GPU_GP1_SET_VERTICAL_DISPLAY_RANGE:
				this.verticalDisplayRangeWord = command & GX_GPU_VERTICAL_DISPLAY_RANGE_MASK;
				this.writeStatusIo();
				break;
			case GX_GPU_GP1_SET_DISPLAY_MODE:
				this.writeDisplayModeWord(command & GX_GPU_GP1_PARAM_MASK);
				break;
			case GX_GPU_GP1_SET_TEXTURE_DISABLE_MASK:
				this.textureDisableMaskWord = command & 0x1;
				this.writeStatusIo();
				break;
			default:
				this.writeStatusIo();
				break;
		}
		return opcode;
	}

	public readDisplayModeWord(): number {
		return this.displayModeWord;
	}

	public writeDisplayModeWord(word: number): void {
		this.displayModeWord = word >>> 0;
		this.updateDisplayModeStatusBits();
		this.writeStatusIo();
	}

	public readDisplayStartWord(): number {
		return this.displayStartWord;
	}

	public readHorizontalDisplayRangeWord(): number {
		return this.horizontalDisplayRangeWord;
	}

	public readVerticalDisplayRangeWord(): number {
		return this.verticalDisplayRangeWord;
	}

	public readTextureDisableMaskWord(): number {
		return this.textureDisableMaskWord;
	}

	private writeDisplayDisableWord(word: number): void {
		if ((word & 0x1) !== 0) {
			this.statusWord = (this.statusWord | GX_GPU_STATUS_DISPLAY_DISABLE) >>> 0;
		} else {
			this.statusWord = (this.statusWord & ~GX_GPU_STATUS_DISPLAY_DISABLE) >>> 0;
		}
		this.writeStatusIo();
	}

	private writeDmaDirectionWord(word: number): void {
		const dmaDirectionBits = (word & 0x3) << GX_GPU_STATUS_DMA_DIRECTION_SHIFT;
		this.statusWord = ((this.statusWord & ~GX_GPU_STATUS_DMA_DIRECTION_MASK) | dmaDirectionBits) >>> 0;
		this.updateDmaRequestStatusBit();
		this.writeStatusIo();
	}

	private updateDmaRequestStatusBit(): void {
		const dmaDirection = (this.statusWord & GX_GPU_STATUS_DMA_DIRECTION_MASK) >>> GX_GPU_STATUS_DMA_DIRECTION_SHIFT;
		let dmaRequest = 0;
		switch (dmaDirection) {
			case GX_GPU_DMA_DIRECTION_FIFO:
			case GX_GPU_DMA_DIRECTION_CPU_TO_GP0:
				dmaRequest = this.statusWord & GX_GPU_STATUS_READY_TO_RECEIVE_DMA;
				break;
			case GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU:
				dmaRequest = this.statusWord & GX_GPU_STATUS_READY_TO_SEND_VRAM;
				break;
		}
		if (dmaRequest !== 0) {
			this.statusWord = (this.statusWord | GX_GPU_STATUS_DMA_DATA_REQUEST) >>> 0;
		} else {
			this.statusWord = (this.statusWord & ~GX_GPU_STATUS_DMA_DATA_REQUEST) >>> 0;
		}
	}

	private updateDisplayModeStatusBits(): void {
		const displayMode = this.displayModeWord;
		const statusDisplayModeBits = ((displayMode & 0x03) << GX_GPU_STATUS_HORIZONTAL_RESOLUTION_1_SHIFT)
			| ((displayMode & 0x04) << 17)
			| ((displayMode & 0x08) << 17)
			| ((displayMode & 0x10) << 17)
			| ((displayMode & 0x20) << 17)
			| ((displayMode & 0x40) << 10)
			| ((displayMode & 0x80) << 7);
		this.statusWord = ((this.statusWord & ~GX_GPU_STATUS_DISPLAY_MODE_MASK) | statusDisplayModeBits) >>> 0;
	}

	private writeStatusIo(): void {
		this.memory.writeIoValue(IO_GX_GPU_GP1, this.statusWord);
	}

	private static readGp0Thunk(context: GxGpu, _addr: number): Value {
		return context.readGp0();
	}

	private static writeGp0Thunk(context: GxGpu, _addr: number, value: Value): void {
		context.writeGp0(value as number);
	}

	private static readStatusThunk(context: GxGpu, _addr: number): Value {
		return context.readStatus();
	}

	private static writeGp1Thunk(context: GxGpu, _addr: number, value: Value): void {
		context.writeGp1(value as number);
	}
}
