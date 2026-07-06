import type { Value } from '../../cpu/cpu';
import { IO_GX_GPU_GP0, IO_GX_GPU_GP1 } from '../../bus/io';
import type { Memory } from '../../memory/memory';
import { PSX_GPU_DISPLAY_MODE_PAL_WORD } from '../../model_registry';

export const GX_GPU_GP1_RESET = 0x00;
export const GX_GPU_GP1_SET_DISPLAY_MODE = 0x08;
export const GX_GPU_GP1_OPCODE_SHIFT = 24;
export const GX_GPU_GP1_PARAM_MASK = 0x00ffffff;

export const GX_GPU_STATUS_REVERSE_FLAG = 1 << 14;
export const GX_GPU_STATUS_HORIZONTAL_RESOLUTION_2 = 1 << 16;
export const GX_GPU_STATUS_HORIZONTAL_RESOLUTION_1_SHIFT = 17;
export const GX_GPU_STATUS_VERTICAL_RESOLUTION = 1 << 19;
export const GX_GPU_STATUS_PAL_MODE = 1 << 20;
export const GX_GPU_STATUS_DISPLAY_AREA_COLOR_DEPTH_24 = 1 << 21;
export const GX_GPU_STATUS_VERTICAL_INTERLACE = 1 << 22;
export const GX_GPU_STATUS_GPU_IDLE = 1 << 26;
export const GX_GPU_STATUS_READY_TO_SEND_VRAM = 1 << 27;
export const GX_GPU_STATUS_READY_TO_RECEIVE_DMA = 1 << 28;
export const GX_GPU_STATUS_READY_WORD = GX_GPU_STATUS_GPU_IDLE | GX_GPU_STATUS_READY_TO_SEND_VRAM | GX_GPU_STATUS_READY_TO_RECEIVE_DMA;
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
	private statusWord = GX_GPU_STATUS_READY_WORD;

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
		this.statusWord = GX_GPU_STATUS_READY_WORD;
		this.updateDisplayModeStatusBits();
		this.memory.writeIoValue(IO_GX_GPU_GP0, 0);
		this.memory.writeIoValue(IO_GX_GPU_GP1, this.statusWord);
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
			case GX_GPU_GP1_SET_DISPLAY_MODE:
				this.writeDisplayModeWord(command & GX_GPU_GP1_PARAM_MASK);
				break;
			default:
				this.memory.writeIoValue(IO_GX_GPU_GP1, this.statusWord);
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
		this.memory.writeIoValue(IO_GX_GPU_GP1, this.statusWord);
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
