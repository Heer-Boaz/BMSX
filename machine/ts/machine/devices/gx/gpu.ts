import type { Value } from '../../cpu/cpu';
import { IO_GX_GPU_GP0, IO_GX_GPU_GP1 } from '../../bus/io';
import type { Memory } from '../../memory/memory';
import { PSX_GPU_DISPLAY_MODE_PAL_WORD } from '../../model_registry';
import type { GxGpuDeviceOutput } from './device_output';
import {
	GX_GPU_COMMAND_COPY_VRAM_TO_VRAM,
	GX_GPU_COMMAND_DRAW_LINE,
	GX_GPU_COMMAND_DRAW_POLYGON,
	GX_GPU_COMMAND_DRAW_POLYLINE,
	GX_GPU_COMMAND_DRAW_RECTANGLE,
	GX_GPU_COMMAND_FILL_RECTANGLE,
	GX_GPU_COMMAND_READ_VRAM_TO_CPU,
	GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
	GxGpuCommandBuffer,
	gxGpuPolygonDrawModeWord,
	gxGpuPolygonTexturePageWordIndex,
	gxGpuTextureAttribute,
	gxGpuTransferHeight,
	gxGpuTransferWidth,
} from './gpu_command_buffer';

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
export const GX_GPU_GP1_GET_GPU_INFO = 0x10;
export const GX_GPU_GP1_OPCODE_SHIFT = 24;
export const GX_GPU_GP1_PARAM_MASK = 0x00ffffff;
export const GX_GPU_GP1_OPCODE_MASK = 0x3f;

export const GX_GPU_GP0_SET_DRAW_MODE = 0xe1;
export const GX_GPU_GP0_SET_TEXTURE_WINDOW = 0xe2;
export const GX_GPU_GP0_SET_DRAWING_AREA_TOP_LEFT = 0xe3;
export const GX_GPU_GP0_SET_DRAWING_AREA_BOTTOM_RIGHT = 0xe4;
export const GX_GPU_GP0_SET_DRAWING_OFFSET = 0xe5;
export const GX_GPU_GP0_SET_MASK_BIT = 0xe6;
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
export const GX_GPU_VRAM_WIDTH_MASK = 0x3ff;
export const GX_GPU_VRAM_HEIGHT_MASK = 0x1ff;

export const GX_GPU_DISPLAY_START_MASK = 0x0007ffff;
export const GX_GPU_HORIZONTAL_DISPLAY_RANGE_MASK = 0x00ffffff;
export const GX_GPU_VERTICAL_DISPLAY_RANGE_MASK = 0x000fffff;
export const GX_GPU_DRAW_MODE_MASK = 0x00001fff;
export const GX_GPU_DRAW_MODE_GPUSTAT_MASK = 0x000007ff;
export const GX_GPU_DRAW_MODE_TEXTURE_DISABLE = 1 << 11;
export const GX_GPU_TEXTURE_WINDOW_MASK = 0x000fffff;
export const GX_GPU_DRAWING_AREA_MASK = 0x000fffff;
export const GX_GPU_DRAWING_OFFSET_MASK = 0x003fffff;
export const GX_GPU_MASK_BIT_MODE_MASK = 0x3;

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
	private readonly commandBuffer = new GxGpuCommandBuffer();
	private readonly deviceOutput: GxGpuDeviceOutput = {
		commandBuffer: this.commandBuffer,
	};
	private readonly gp0CommandWords = new Uint32Array(GX_GPU_GP0_COMMAND_BUFFER_WORDS);
	private gp0CommandWordCount = 0;
	private gp0CommandTargetWordCount = 0;
	private gp0ImageLoadWordsRemaining = 0;
	private gp0ImageLoadCommandWordStart = 0;
	private gp0ImageLoadCommandWordCount = 0;
	private gp0ImageLoadCommandOpcode = 0;
	private gp0PolylineWordsPerVertex = 0;
	private gp0PolylinePayloadPhase = 0;
	private gp0PolylineCommandWordStart = 0;
	private gp0PolylineCommandWordCount = 0;
	private gp0PolylineCommandOpcode = 0;
	private gpuReadWord = 0x00000400;
	private drawModeWord = 0;
	private textureWindowWord = 0;
	private drawingAreaTopLeftWord = 0;
	private drawingAreaBottomRightWord = 0;
	private drawingOffsetWord = 0;
	private maskBitModeWord = 0;
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
		this.commandBuffer.reset();
		this.clearGp0CommandState();
		this.gpuReadWord = 0x00000400;
		this.drawModeWord = 0;
		this.textureWindowWord = 0;
		this.drawingAreaTopLeftWord = 0;
		this.drawingAreaBottomRightWord = 0;
		this.drawingOffsetWord = 0;
		this.maskBitModeWord = 0;
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
		this.commandBuffer.reset();
		this.clearGp0CommandState();
		this.memory.writeIoValue(IO_GX_GPU_GP0, this.gp0Word);
		this.memory.writeIoValue(IO_GX_GPU_GP1, this.statusWord);
	}

	public readGp0(): number {
		return this.gpuReadWord;
	}

	public writeGp0(word: number): void {
		this.gp0Word = word >>> 0;
		this.memory.writeIoValue(IO_GX_GPU_GP0, this.gp0Word);

		if (this.gp0ImageLoadWordsRemaining !== 0) {
			this.consumeImageLoadWord();
			return;
		}

		if (this.gp0PolylineWordsPerVertex !== 0) {
			this.consumeGp0PolylinePayloadWord();
			return;
		}

		if (this.gp0CommandTargetWordCount === 0) {
			this.gp0CommandTargetWordCount = this.gp0CommandWordCountForOpcode(this.gp0Word >>> GX_GPU_GP0_OPCODE_SHIFT);
		}

		this.gp0CommandWords[this.gp0CommandWordCount] = this.gp0Word;
		this.gp0CommandWordCount += 1;
		if (this.gp0CommandWordCount === this.gp0CommandTargetWordCount) {
			this.executeGp0Command();
		}
	}

	private executeGp0Command(): void {
		const opcode = this.gp0CommandWords[0] >>> GX_GPU_GP0_OPCODE_SHIFT;
		const commandWordCount = this.gp0CommandWordCount;
		this.gp0CommandWordCount = 0;
		this.gp0CommandTargetWordCount = 0;

		switch (opcode) {
			case GX_GPU_GP0_FILL_RECTANGLE:
				this.emitFixedGp0Command(GX_GPU_COMMAND_FILL_RECTANGLE, opcode, commandWordCount);
				break;
			case GX_GPU_GP0_IRQ_REQUEST:
				this.statusWord = (this.statusWord | GX_GPU_STATUS_INTERRUPT_REQUEST) >>> 0;
				this.writeStatusIo();
				break;
			case GX_GPU_GP0_SET_DRAW_MODE:
				this.writeDrawModeWord(this.gp0Word & GX_GPU_GP0_PARAM_MASK);
				break;
			case GX_GPU_GP0_SET_TEXTURE_WINDOW:
				this.textureWindowWord = this.gp0Word & GX_GPU_TEXTURE_WINDOW_MASK;
				break;
			case GX_GPU_GP0_SET_DRAWING_AREA_TOP_LEFT:
				this.drawingAreaTopLeftWord = this.gp0Word & GX_GPU_DRAWING_AREA_MASK;
				break;
			case GX_GPU_GP0_SET_DRAWING_AREA_BOTTOM_RIGHT:
				this.drawingAreaBottomRightWord = this.gp0Word & GX_GPU_DRAWING_AREA_MASK;
				break;
			case GX_GPU_GP0_SET_DRAWING_OFFSET:
				this.drawingOffsetWord = this.gp0Word & GX_GPU_DRAWING_OFFSET_MASK;
				break;
			case GX_GPU_GP0_SET_MASK_BIT:
				this.writeMaskBitModeWord(this.gp0CommandWords[0] & GX_GPU_GP0_PARAM_MASK);
				break;
			default:
				if (opcode >= GX_GPU_GP0_POLYGON_FIRST && opcode <= GX_GPU_GP0_POLYGON_LAST) {
					if ((opcode & GX_GPU_GP0_RENDER_TEXTURE_BIT) !== 0) {
						const texturePageWord = this.gp0CommandWords[gxGpuPolygonTexturePageWordIndex(opcode)];
						this.writeDrawModeWord(gxGpuPolygonDrawModeWord(this.drawModeWord, gxGpuTextureAttribute(texturePageWord)));
					}
					this.emitFixedGp0Command(GX_GPU_COMMAND_DRAW_POLYGON, opcode, commandWordCount);
				} else if (opcode >= GX_GPU_GP0_LINE_FIRST && opcode <= GX_GPU_GP0_LINE_LAST) {
					if ((opcode & GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT) !== 0) {
						this.beginPolylinePayload(opcode, commandWordCount);
					} else {
						this.emitFixedGp0Command(GX_GPU_COMMAND_DRAW_LINE, opcode, commandWordCount);
					}
				} else if (opcode >= GX_GPU_GP0_RECTANGLE_FIRST && opcode <= GX_GPU_GP0_RECTANGLE_LAST) {
					this.emitFixedGp0Command(GX_GPU_COMMAND_DRAW_RECTANGLE, opcode, commandWordCount);
				} else if (opcode >= GX_GPU_GP0_VRAM_TO_VRAM_FIRST && opcode <= GX_GPU_GP0_VRAM_TO_VRAM_LAST) {
					this.emitFixedGp0Command(GX_GPU_COMMAND_COPY_VRAM_TO_VRAM, opcode, commandWordCount);
				} else if (opcode >= GX_GPU_GP0_CPU_TO_VRAM_FIRST && opcode <= GX_GPU_GP0_CPU_TO_VRAM_LAST) {
					this.beginImageLoadToVram(opcode, commandWordCount);
				} else if (opcode >= GX_GPU_GP0_VRAM_TO_CPU_FIRST && opcode <= GX_GPU_GP0_VRAM_TO_CPU_LAST) {
					this.emitFixedGp0Command(GX_GPU_COMMAND_READ_VRAM_TO_CPU, opcode, commandWordCount);
				}
				break;
		}
	}

	public readStatus(): number {
		return this.statusWord;
	}

	public writeGp1(word: number): number {
		const command = word >>> 0;
		this.gp1Word = command;
		const opcode = (command >>> GX_GPU_GP1_OPCODE_SHIFT) & GX_GPU_GP1_OPCODE_MASK;
		switch (opcode) {
			case GX_GPU_GP1_RESET:
				this.reset();
				break;
			case GX_GPU_GP1_CLEAR_FIFO:
				this.clearGp0CommandState();
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
				this.updateDrawModeStatusBits();
				this.writeStatusIo();
				break;
			case GX_GPU_GP1_GET_GPU_INFO:
				this.writeGpuInfoQuery(command);
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

	public readGpuReadWord(): number {
		return this.gpuReadWord;
	}

	public readDeviceOutput(): GxGpuDeviceOutput {
		return this.deviceOutput;
	}

	public readDrawModeWord(): number {
		return this.drawModeWord;
	}

	public readTextureWindowWord(): number {
		return this.textureWindowWord;
	}

	public readDrawingAreaTopLeftWord(): number {
		return this.drawingAreaTopLeftWord;
	}

	public readDrawingAreaBottomRightWord(): number {
		return this.drawingAreaBottomRightWord;
	}

	public readDrawingOffsetWord(): number {
		return this.drawingOffsetWord;
	}

	public readMaskBitModeWord(): number {
		return this.maskBitModeWord;
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

	private clearGp0CommandState(): void {
		this.gp0CommandWords.fill(0);
		this.gp0CommandWordCount = 0;
		this.gp0CommandTargetWordCount = 0;
		this.gp0ImageLoadWordsRemaining = 0;
		this.gp0ImageLoadCommandWordStart = 0;
		this.gp0ImageLoadCommandWordCount = 0;
		this.gp0ImageLoadCommandOpcode = 0;
		this.gp0PolylineWordsPerVertex = 0;
		this.gp0PolylinePayloadPhase = 0;
		this.gp0PolylineCommandWordStart = 0;
		this.gp0PolylineCommandWordCount = 0;
		this.gp0PolylineCommandOpcode = 0;
	}

	private consumeImageLoadWord(): void {
		this.commandBuffer.appendWord(this.gp0Word);
		this.gp0ImageLoadCommandWordCount += 1;
		this.gp0ImageLoadWordsRemaining -= 1;
		if (this.gp0ImageLoadWordsRemaining === 0) {
			this.pushGpuCommand(
				GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
				this.gp0ImageLoadCommandOpcode,
				this.gp0ImageLoadCommandWordStart,
				this.gp0ImageLoadCommandWordCount,
			);
			this.gp0ImageLoadCommandWordStart = 0;
			this.gp0ImageLoadCommandWordCount = 0;
			this.gp0ImageLoadCommandOpcode = 0;
		}
	}

	private consumeGp0PolylinePayloadWord(): void {
		if (this.gp0PolylinePayloadPhase === 0 && (this.gp0Word & 0xf000f000) === 0x50005000) {
			this.pushGpuCommand(
				GX_GPU_COMMAND_DRAW_POLYLINE,
				this.gp0PolylineCommandOpcode,
				this.gp0PolylineCommandWordStart,
				this.gp0PolylineCommandWordCount,
			);
			this.gp0PolylineWordsPerVertex = 0;
			this.gp0PolylinePayloadPhase = 0;
			this.gp0PolylineCommandWordStart = 0;
			this.gp0PolylineCommandWordCount = 0;
			this.gp0PolylineCommandOpcode = 0;
			return;
		}
		this.commandBuffer.appendWord(this.gp0Word);
		this.gp0PolylineCommandWordCount += 1;
		this.gp0PolylinePayloadPhase += 1;
		if (this.gp0PolylinePayloadPhase === this.gp0PolylineWordsPerVertex) {
			this.gp0PolylinePayloadPhase = 0;
		}
	}

	private beginPolylinePayload(opcode: number, commandWordCount: number): void {
		this.gp0PolylineCommandWordStart = this.commandBuffer.appendWords(this.gp0CommandWords, commandWordCount);
		this.gp0PolylineCommandWordCount = commandWordCount;
		this.gp0PolylineCommandOpcode = opcode;
		this.gp0PolylineWordsPerVertex = (opcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) !== 0 ? 2 : 1;
		this.gp0PolylinePayloadPhase = 0;
	}

	private gp0CommandWordCountForOpcode(opcode: number): number {
		if (opcode === GX_GPU_GP0_FILL_RECTANGLE) {
			return 3;
		}
		if (opcode >= GX_GPU_GP0_POLYGON_FIRST && opcode <= GX_GPU_GP0_POLYGON_LAST) {
			return this.gp0PolygonWordCount(opcode);
		}
		if (opcode >= GX_GPU_GP0_LINE_FIRST && opcode <= GX_GPU_GP0_LINE_LAST) {
			return this.gp0LineWordCount(opcode);
		}
		if (opcode >= GX_GPU_GP0_RECTANGLE_FIRST && opcode <= GX_GPU_GP0_RECTANGLE_LAST) {
			return this.gp0RectangleWordCount(opcode);
		}
		if (opcode >= GX_GPU_GP0_VRAM_TO_VRAM_FIRST && opcode <= GX_GPU_GP0_VRAM_TO_VRAM_LAST) {
			return 4;
		}
		if (opcode >= GX_GPU_GP0_CPU_TO_VRAM_FIRST && opcode <= GX_GPU_GP0_VRAM_TO_CPU_LAST) {
			return 3;
		}
		return 1;
	}

	private gp0PolygonWordCount(opcode: number): number {
		const wordsPerVertex = 1
			+ ((opcode & GX_GPU_GP0_RENDER_TEXTURE_BIT) >>> 2)
			+ ((opcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) >>> 4);
		const vertexCount = (opcode & GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT) !== 0 ? 4 : 3;
		const firstColorWord = (opcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) !== 0 ? 0 : 1;
		return wordsPerVertex * vertexCount + firstColorWord;
	}

	private gp0LineWordCount(opcode: number): number {
		const gouraudLineWordCount = (opcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) !== 0 ? 4 : 3;
		if ((opcode & GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT) !== 0) {
			return (opcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) !== 0 ? 3 : 4;
		}
		return gouraudLineWordCount;
	}

	private gp0RectangleWordCount(opcode: number): number {
		const textureWordCount = (opcode & GX_GPU_GP0_RENDER_TEXTURE_BIT) >>> 2;
		const sizeWordCount = (opcode & GX_GPU_GP0_RECTANGLE_SIZE_MASK) === 0 ? 1 : 0;
		return 2 + textureWordCount + sizeWordCount;
	}

	private emitFixedGp0Command(kind: number, opcode: number, commandWordCount: number): void {
		const wordStart = this.commandBuffer.appendWords(this.gp0CommandWords, commandWordCount);
		this.pushGpuCommand(kind, opcode, wordStart, commandWordCount);
	}

	private pushGpuCommand(kind: number, opcode: number, wordStart: number, commandWordCount: number): void {
		this.commandBuffer.pushCommand(
			kind,
			opcode,
			wordStart,
			commandWordCount,
			this.drawModeWord,
			this.textureWindowWord,
			this.drawingAreaTopLeftWord,
			this.drawingAreaBottomRightWord,
			this.drawingOffsetWord,
			this.maskBitModeWord,
		);
	}

	private beginImageLoadToVram(opcode: number, commandWordCount: number): void {
		const sizeWord = this.gp0CommandWords[2];
		const width = gxGpuTransferWidth(sizeWord);
		const height = gxGpuTransferHeight(sizeWord);
		this.gp0ImageLoadCommandWordStart = this.commandBuffer.appendWords(this.gp0CommandWords, commandWordCount);
		this.gp0ImageLoadCommandWordCount = commandWordCount;
		this.gp0ImageLoadCommandOpcode = opcode;
		this.gp0ImageLoadWordsRemaining = ((width * height) + 1) >>> 1;
	}

	private writeDrawModeWord(word: number): void {
		this.drawModeWord = word & GX_GPU_DRAW_MODE_MASK;
		this.updateDrawModeStatusBits();
		this.writeStatusIo();
	}

	private updateDrawModeStatusBits(): void {
		const textureDisableBit = this.textureDisableMaskWord !== 0 && (this.drawModeWord & GX_GPU_DRAW_MODE_TEXTURE_DISABLE) !== 0
			? GX_GPU_STATUS_TEXTURE_DISABLE
			: 0;
		this.statusWord = ((this.statusWord & ~(GX_GPU_DRAW_MODE_GPUSTAT_MASK | GX_GPU_STATUS_TEXTURE_DISABLE))
			| (this.drawModeWord & GX_GPU_DRAW_MODE_GPUSTAT_MASK)
			| textureDisableBit) >>> 0;
	}

	private writeMaskBitModeWord(word: number): void {
		this.maskBitModeWord = word & GX_GPU_MASK_BIT_MODE_MASK;
		this.statusWord = ((this.statusWord & ~((1 << 11) | (1 << 12))) | (this.maskBitModeWord << 11)) >>> 0;
		this.writeStatusIo();
	}

	private writeGpuInfoQuery(word: number): void {
		switch (word & 0x7) {
			case 0x02:
				this.gpuReadWord = this.textureWindowWord;
				break;
			case 0x03:
				this.gpuReadWord = this.drawingAreaTopLeftWord;
				break;
			case 0x04:
				this.gpuReadWord = this.drawingAreaBottomRightWord;
				break;
			case 0x05:
				this.gpuReadWord = this.drawingOffsetWord;
				break;
		}
		this.memory.writeIoValue(IO_GX_GPU_GP0, this.gpuReadWord);
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
