import type { Value } from '../../cpu/cpu';
import { IO_GX_GPU_GP0, IO_GX_GPU_GP1, IRQ_GPU } from '../../bus/io';
import type { Memory } from '../../memory/memory';
import type { DeviceScheduler } from '../../scheduler/device';
import { DEVICE_SERVICE_GPU } from '../../scheduler/device';
import type { DmaController } from '../dma/controller';
import type { IrqController } from '../irq/controller';
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
	GX_GPU_READBACK_IDLE,
	GX_GPU_READBACK_READY,
	GX_GPU_VRAM_BYTE_COUNT,
	GX_GPU_DRAW_MODE_TEXTURE_DISABLE,
	GxGpuCommandBuffer,
	type GxGpuCommandBufferState,
	gxGpuInterlacedRenderWord,
	gxGpuPolygonDrawModeWord,
	gxGpuPolygonTexturePageWordIndex,
	gxGpuTextureAttribute,
	gxGpuTransferHeight,
	gxGpuTransferWidth,
} from './gpu_command_buffer';
import {
	GX_GPU_COMMAND_FIFO_WORD_CAPACITY,
	GxGpuCommandFifo,
} from './gpu_command_fifo';
import {
	GX_GPU_COMMAND_TICKS_PER_CPU_CYCLE,
	gxGpuCommandTicks,
} from './gpu_command_timing';
import {
	GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD,
	GX_GPU_RESET_DISPLAY_MODE_WORD,
	GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD,
	gxGpuDisplayStartY,
} from './gpu_display';
import { initializeGxGpuVramPowerOn } from './vram_power_on';

let gxGpuNextVramSnapshotSerial = 0n;

export {
	GX_GPU_DRAW_MODE_DITHER_ENABLED,
	GX_GPU_DRAW_MODE_TEXTURE_DISABLE,
	GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP,
	GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP,
} from './gpu_command_buffer';

export const GX_GPU_GP1_RESET = 0x00;
export const GX_GPU_GP1_CLEAR_FIFO = 0x01;
export const GX_GPU_GP1_ACK_INTERRUPT = 0x02;
export const GX_GPU_GP1_DISPLAY_DISABLE = 0x03;
export const GX_GPU_GP1_DMA_DIRECTION = 0x04;
export const GX_GPU_GP1_DISPLAY_START = 0x05;
export const GX_GPU_GP1_HORIZONTAL_DISPLAY_RANGE = 0x06;
export const GX_GPU_GP1_VERTICAL_DISPLAY_RANGE = 0x07;
export const GX_GPU_GP1_DISPLAY_MODE = 0x08;
export const GX_GPU_GP1_ALLOW_TEXTURE_DISABLE = 0x09;
export const GX_GPU_GP1_GET_GPU_INFO = 0x10;
export const GX_GPU_GP1_GET_GPU_INFO_LAST = 0x1f;
export const GX_GPU_GP1_OPCODE_SHIFT = 24;
export const GX_GPU_GP1_PARAM_MASK = 0x00ffffff;
export const GX_GPU_GP1_OPCODE_MASK = 0x3f;
export const GX_GPU_GP1_GET_GPU_INFO_INDEX_MASK = 0x0f;
export const GX_GPU_INFO_GPU_TYPE_208PIN = 0x00000002;

export const GX_GPU_GP0_DRAW_MODE = 0xe1;
export const GX_GPU_GP0_TEXTURE_WINDOW = 0xe2;
export const GX_GPU_GP0_DRAWING_AREA_TOP_LEFT = 0xe3;
export const GX_GPU_GP0_DRAWING_AREA_BOTTOM_RIGHT = 0xe4;
export const GX_GPU_GP0_DRAWING_OFFSET = 0xe5;
export const GX_GPU_GP0_MASK_BIT = 0xe6;
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

export const GX_GPU_DISPLAY_START_MASK = 0x0007fffe;
export const GX_GPU_DISPLAY_MODE_MASK = 0x000000ff;
export const GX_GPU_HORIZONTAL_DISPLAY_RANGE_MASK = 0x00ffffff;
export const GX_GPU_VERTICAL_DISPLAY_RANGE_MASK = 0x000fffff;
export const GX_GPU_DRAW_MODE_MASK = 0x00003fff;
export const GX_GPU_DRAW_MODE_GPUSTAT_MASK = 0x000007ff;
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
export const GX_GPU_STATUS_DISPLAY_LINE_LSB = 0x80000000;
export const GX_GPU_STATUS_COMMAND_STATE_MASK = GX_GPU_STATUS_GPU_IDLE
	| GX_GPU_STATUS_READY_TO_SEND_VRAM
	| GX_GPU_STATUS_READY_TO_RECEIVE_DMA;
export const GX_GPU_STATUS_RESET_WORD = GX_GPU_STATUS_INTERLACED_FIELD
	| GX_GPU_STATUS_DISPLAY_DISABLE
	| GX_GPU_STATUS_GPU_IDLE
	| GX_GPU_STATUS_READY_TO_RECEIVE_DMA;
export const GX_GPU_STATUS_SCANOUT_MASK = GX_GPU_STATUS_INTERLACED_FIELD | GX_GPU_STATUS_DISPLAY_LINE_LSB;
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
	gp0CommandWordCount: number;
	gp0CommandTargetWordCount: number;
	gp0CommandWords: number[];
	gp0FifoWordCount: number;
	gp0FifoWords: number[];
	pendingCommandCycles: number;
	pendingCommandTargetCount: number;
	gp0ImageLoadWordsRemaining: number;
	gp0ImageLoadCommandWordStart: number;
	gp0ImageLoadCommandWordCount: number;
	gp0ImageLoadCommandOpcode: number;
	gp0PolylineWordsPerVertex: number;
	gp0PolylinePayloadPhase: number;
	gp0PolylineCommandWordStart: number;
	gp0PolylineCommandWordCount: number;
	gp0PolylineCommandOpcode: number;
	gpuReadWord: number;
	drawModeWord: number;
	textureWindowWord: number;
	drawingAreaTopLeftWord: number;
	drawingAreaBottomRightWord: number;
	drawingOffsetWord: number;
	maskBitModeWord: number;
	displayStartWord: number;
	horizontalDisplayRangeWord: number;
	verticalDisplayRangeWord: number;
	textureDisableAllowedWord: number;
	scanoutInterlacedField: number;
	scanoutInterlacedDisplayField: number;
	scanoutActiveLineLsb: number;
	presentStatusWord: number;
	presentDisplayModeWord: number;
	presentDisplayStartWord: number;
	presentHorizontalDisplayRangeWord: number;
	presentVerticalDisplayRangeWord: number;
	commandBuffer: GxGpuCommandBufferState;
};

export type GxGpuSaveState = GxGpuState & {
	vramBytes: Uint8Array;
};

export class GxGpu {
	private gp0Word = 0;
	private gp1Word = 0;
	private displayModeWord = GX_GPU_RESET_DISPLAY_MODE_WORD;
	private statusWord = GX_GPU_STATUS_RESET_WORD;
	private readonly commandBuffer: GxGpuCommandBuffer;
	private readonly gp0CommandWords = new Uint32Array(GX_GPU_GP0_COMMAND_BUFFER_WORDS);
	private readonly gp0Fifo = new GxGpuCommandFifo();
	private gp0CommandWordCount = 0;
	private gp0CommandTargetWordCount = 0;
	private pendingCommandCompletionCycle = 0;
	private pendingCommandTargetCount = 0;
	private gp0ImageLoadWordsRemaining = 0;
	private gp0ImageLoadCommandWordStart = 0;
	private gp0ImageLoadCommandWordCount = 0;
	private gp0ImageLoadCommandOpcode = 0;
	private gp0PolylineWordsPerVertex = 0;
	private gp0PolylinePayloadPhase = 0;
	private gp0PolylineCommandWordStart = 0;
	private gp0PolylineCommandWordCount = 0;
	private gp0PolylineCommandOpcode = 0;
	private gpuReadWord = 0;
	private drawModeWord = 0;
	private textureWindowWord = 0;
	private drawingAreaTopLeftWord = 0;
	private drawingAreaBottomRightWord = 0;
	private drawingOffsetWord = 0;
	private maskBitModeWord = 0;
	private displayStartWord = 0;
	private horizontalDisplayRangeWord = GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD;
	private verticalDisplayRangeWord = GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD;
	private textureDisableAllowedWord = 0;
	private presentStatusWord = GX_GPU_STATUS_RESET_WORD;
	private presentDisplayModeWord = GX_GPU_RESET_DISPLAY_MODE_WORD;
	private presentDisplayStartWord = 0;
	private presentHorizontalDisplayRangeWord = GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD;
	private presentVerticalDisplayRangeWord = GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD;
	private scanoutVblankActive = false;
	private scanoutInterlacedField = 0;
	private scanoutInterlacedDisplayField = 0;
	private scanoutActiveLineLsb = 0;
	private scanoutFrameStartCycle = 0;
	private scanoutCyclesPerFrame = 1;
	private scanoutTotalScanlines = 313;
	private m_lastFrameCommitted = false;
	private readonly vramSnapshotBytes = new Uint8Array(GX_GPU_VRAM_BYTE_COUNT);
	private vramSnapshotSerial = 0n;
	private readonly deviceOutput: { -readonly [Key in keyof GxGpuDeviceOutput]: GxGpuDeviceOutput[Key] };

	public constructor(
		private readonly memory: Memory,
		private readonly irq: IrqController,
		private readonly scheduler: DeviceScheduler,
		private readonly dmaController: DmaController,
	) {
		this.commandBuffer = new GxGpuCommandBuffer(dmaController);
		this.deviceOutput = {
			commandBuffer: this.commandBuffer,
			readbackPort: this.commandBuffer.readback,
			statusWord: GX_GPU_STATUS_RESET_WORD,
			displayModeWord: GX_GPU_RESET_DISPLAY_MODE_WORD,
			displayStartWord: 0,
			horizontalDisplayRangeWord: GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD,
			verticalDisplayRangeWord: GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD,
			vramSnapshotBytes: this.vramSnapshotBytes,
			vramSnapshotSerial: 0n,
		};
		this.memory.mapIoRead(IO_GX_GPU_GP0, this, GxGpu.readGp0Thunk);
		this.memory.mapIoWrite(IO_GX_GPU_GP0, this, GxGpu.writeGp0Thunk);
		this.memory.mapIoWriteReady(IO_GX_GPU_GP0, GxGpu.gp0WriteReadyThunk);
		this.memory.mapIoRead(IO_GX_GPU_GP1, this, GxGpu.readStatusThunk);
		this.memory.mapIoWrite(IO_GX_GPU_GP1, this, GxGpu.writeGp1Thunk);
	}

	public reset(): void {
		this.textureDisableAllowedWord = 0;
		this.gpuReadWord = 0;
		this.commandBuffer.reset();
		initializeGxGpuVramPowerOn(this.vramSnapshotBytes);
		this.publishVramSnapshotRevision();
		this.clearGp0CommandState();
		this.resetGpuRegisters();
	}

	private resetGpuRegisters(): void {
		this.gp0Word = 0;
		this.gp1Word = 0;
		this.displayModeWord = GX_GPU_RESET_DISPLAY_MODE_WORD;
		this.statusWord = GX_GPU_STATUS_RESET_WORD;
		this.dmaController.setGxGpuDmaDirection(GX_GPU_DMA_DIRECTION_OFF);
		this.drawModeWord = 0;
		this.textureWindowWord = 0;
		this.drawingAreaTopLeftWord = 0;
		this.drawingAreaBottomRightWord = 0;
		this.drawingOffsetWord = 0;
		this.maskBitModeWord = 0;
		this.displayStartWord = 0;
		this.horizontalDisplayRangeWord = GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD;
		this.verticalDisplayRangeWord = GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD;
		this.presentStatusWord = GX_GPU_STATUS_RESET_WORD;
		this.presentDisplayModeWord = GX_GPU_RESET_DISPLAY_MODE_WORD;
		this.presentDisplayStartWord = 0;
		this.presentHorizontalDisplayRangeWord = GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD;
		this.presentVerticalDisplayRangeWord = GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD;
		this.scanoutVblankActive = false;
		this.scanoutInterlacedField = 0;
		this.scanoutInterlacedDisplayField = 0;
		this.scanoutActiveLineLsb = 0;
		this.scanoutFrameStartCycle = 0;
		this.scanoutCyclesPerFrame = 1;
		this.scanoutTotalScanlines = 313;
		this.m_lastFrameCommitted = false;
		this.updateDisplayModeStatusBits();
		this.updateScanoutStatusBits();
		this.updateDmaRequestStatusBit();
		this.memory.writeIoValue(IO_GX_GPU_GP0, this.gpuReadWord);
		this.writeStatusIo();
	}

	public captureState(): GxGpuState {
		const nowCycles = this.scheduler.currentNowCycles();
		this.synchronizeCommandTiming(nowCycles);
		this.updateDynamicStatusBits();
		const gp0FifoWordCount = this.gp0Fifo.count();
		const gp0FifoWords = new Array<number>(gp0FifoWordCount);
		for (let index = 0; index < gp0FifoWordCount; index += 1) {
			gp0FifoWords[index] = this.gp0Fifo.peek(index);
		}
		return {
			gp0Word: this.gp0Word,
			gp1Word: this.gp1Word,
			displayModeWord: this.displayModeWord,
			statusWord: this.statusWord,
			gp0CommandWordCount: this.gp0CommandWordCount,
			gp0CommandTargetWordCount: this.gp0CommandTargetWordCount,
			gp0CommandWords: Array.from(this.gp0CommandWords.subarray(0, this.gp0CommandWordCount)),
			gp0FifoWordCount,
			gp0FifoWords,
			pendingCommandCycles: this.pendingCommandCompletionCycle === 0
				? 0
				: this.pendingCommandCompletionCycle - nowCycles,
			pendingCommandTargetCount: this.pendingCommandTargetCount,
			gp0ImageLoadWordsRemaining: this.gp0ImageLoadWordsRemaining,
			gp0ImageLoadCommandWordStart: this.gp0ImageLoadCommandWordStart,
			gp0ImageLoadCommandWordCount: this.gp0ImageLoadCommandWordCount,
			gp0ImageLoadCommandOpcode: this.gp0ImageLoadCommandOpcode,
			gp0PolylineWordsPerVertex: this.gp0PolylineWordsPerVertex,
			gp0PolylinePayloadPhase: this.gp0PolylinePayloadPhase,
			gp0PolylineCommandWordStart: this.gp0PolylineCommandWordStart,
			gp0PolylineCommandWordCount: this.gp0PolylineCommandWordCount,
			gp0PolylineCommandOpcode: this.gp0PolylineCommandOpcode,
			gpuReadWord: this.gpuReadWord,
			drawModeWord: this.drawModeWord,
			textureWindowWord: this.textureWindowWord,
			drawingAreaTopLeftWord: this.drawingAreaTopLeftWord,
			drawingAreaBottomRightWord: this.drawingAreaBottomRightWord,
			drawingOffsetWord: this.drawingOffsetWord,
			maskBitModeWord: this.maskBitModeWord,
			displayStartWord: this.displayStartWord,
			horizontalDisplayRangeWord: this.horizontalDisplayRangeWord,
			verticalDisplayRangeWord: this.verticalDisplayRangeWord,
			textureDisableAllowedWord: this.textureDisableAllowedWord,
			scanoutInterlacedField: this.scanoutInterlacedField,
			scanoutInterlacedDisplayField: this.scanoutInterlacedDisplayField,
			scanoutActiveLineLsb: this.scanoutActiveLineLsb,
			presentStatusWord: this.presentStatusWord,
			presentDisplayModeWord: this.presentDisplayModeWord,
			presentDisplayStartWord: this.presentDisplayStartWord,
			presentHorizontalDisplayRangeWord: this.presentHorizontalDisplayRangeWord,
			presentVerticalDisplayRangeWord: this.presentVerticalDisplayRangeWord,
			commandBuffer: this.commandBuffer.captureState(),
		};
	}

	public restoreState(state: GxGpuState): void {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_GPU);
		this.gp0Word = state.gp0Word >>> 0;
		this.gp1Word = state.gp1Word >>> 0;
		this.displayModeWord = state.displayModeWord >>> 0;
		this.statusWord = state.statusWord >>> 0;
		this.dmaController.setGxGpuDmaDirection(
			(this.statusWord & GX_GPU_STATUS_DMA_DIRECTION_MASK) >>> GX_GPU_STATUS_DMA_DIRECTION_SHIFT,
		);
		this.gp0CommandWordCount = state.gp0CommandWordCount >>> 0;
		this.gp0CommandTargetWordCount = state.gp0CommandTargetWordCount >>> 0;
		this.gp0CommandWords.set(state.gp0CommandWords, 0);
		this.gp0Fifo.reset();
		for (let index = 0; index < state.gp0FifoWordCount; index += 1) {
			this.gp0Fifo.push(state.gp0FifoWords[index]!);
		}
		this.pendingCommandCompletionCycle = state.pendingCommandCycles === 0
			? 0
			: this.scheduler.currentNowCycles() + state.pendingCommandCycles;
		this.pendingCommandTargetCount = state.pendingCommandTargetCount >>> 0;
		this.gp0ImageLoadWordsRemaining = state.gp0ImageLoadWordsRemaining >>> 0;
		this.gp0ImageLoadCommandWordStart = state.gp0ImageLoadCommandWordStart >>> 0;
		this.gp0ImageLoadCommandWordCount = state.gp0ImageLoadCommandWordCount >>> 0;
		this.gp0ImageLoadCommandOpcode = state.gp0ImageLoadCommandOpcode >>> 0;
		this.gp0PolylineWordsPerVertex = state.gp0PolylineWordsPerVertex >>> 0;
		this.gp0PolylinePayloadPhase = state.gp0PolylinePayloadPhase >>> 0;
		this.gp0PolylineCommandWordStart = state.gp0PolylineCommandWordStart >>> 0;
		this.gp0PolylineCommandWordCount = state.gp0PolylineCommandWordCount >>> 0;
		this.gp0PolylineCommandOpcode = state.gp0PolylineCommandOpcode >>> 0;
		this.gpuReadWord = state.gpuReadWord >>> 0;
		this.drawModeWord = state.drawModeWord >>> 0;
		this.textureWindowWord = state.textureWindowWord >>> 0;
		this.drawingAreaTopLeftWord = state.drawingAreaTopLeftWord >>> 0;
		this.drawingAreaBottomRightWord = state.drawingAreaBottomRightWord >>> 0;
		this.drawingOffsetWord = state.drawingOffsetWord >>> 0;
		this.maskBitModeWord = state.maskBitModeWord >>> 0;
		this.displayStartWord = state.displayStartWord >>> 0;
		this.horizontalDisplayRangeWord = state.horizontalDisplayRangeWord >>> 0;
		this.verticalDisplayRangeWord = state.verticalDisplayRangeWord >>> 0;
		this.textureDisableAllowedWord = state.textureDisableAllowedWord >>> 0;
		this.scanoutInterlacedField = state.scanoutInterlacedField >>> 0;
		this.scanoutInterlacedDisplayField = state.scanoutInterlacedDisplayField >>> 0;
		this.scanoutActiveLineLsb = state.scanoutActiveLineLsb >>> 0;
		this.presentStatusWord = state.presentStatusWord >>> 0;
		this.presentDisplayModeWord = state.presentDisplayModeWord >>> 0;
		this.presentDisplayStartWord = state.presentDisplayStartWord >>> 0;
		this.presentHorizontalDisplayRangeWord = state.presentHorizontalDisplayRangeWord >>> 0;
		this.presentVerticalDisplayRangeWord = state.presentVerticalDisplayRangeWord >>> 0;
		this.commandBuffer.restoreState(state.commandBuffer);
		this.m_lastFrameCommitted = false;
		if (this.pendingCommandCompletionCycle !== 0) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_GPU, this.pendingCommandCompletionCycle);
		}
		this.memory.writeIoValue(IO_GX_GPU_GP0, this.gp0Word);
		this.writeStatusIo();
	}

	public captureSaveState(): GxGpuSaveState {
		return {
			...this.captureState(),
			vramBytes: this.vramSnapshotBytes.slice(),
		};
	}

	public restoreSaveState(state: GxGpuSaveState): void {
		this.restoreState(state);
		this.replaceVramSnapshotBytes(state.vramBytes);
	}

	public replaceVramSnapshotBytes(bytes: Uint8Array): void {
		this.vramSnapshotBytes.set(bytes);
		this.publishVramSnapshotRevision();
	}

	public commitRenderedVramSnapshotBytes(bytes: Uint8Array): bigint {
		this.vramSnapshotBytes.set(bytes);
		this.publishVramSnapshotRevision();
		this.retirePresentedCommands();
		return this.vramSnapshotSerial;
	}

	private publishVramSnapshotRevision(): void {
		gxGpuNextVramSnapshotSerial = BigInt.asUintN(64, gxGpuNextVramSnapshotSerial + 1n);
		this.vramSnapshotSerial = gxGpuNextVramSnapshotSerial;
	}

	public readVramSnapshotBytes(): Uint8Array {
		return this.vramSnapshotBytes;
	}

	public readVramSnapshotSerial(): bigint {
		return this.vramSnapshotSerial;
	}

	public readGp0(): number {
		const nowCycles = this.scheduler.currentNowCycles();
		this.synchronizeCommandTiming(nowCycles);
		if (this.commandBuffer.readback.phase === GX_GPU_READBACK_READY) {
			this.gpuReadWord = this.commandBuffer.readback.readWord();
			this.processGp0Fifo(nowCycles);
			this.memory.writeIoValue(IO_GX_GPU_GP0, this.gpuReadWord);
		}
		this.updateDynamicStatusBits();
		return this.gpuReadWord;
	}

	public writeGp0(word: number): void {
		const nowCycles = this.scheduler.currentNowCycles();
		this.synchronizeCommandTiming(nowCycles);
		this.gp0Word = word >>> 0;
		this.memory.writeIoValue(IO_GX_GPU_GP0, this.gp0Word);
		this.gp0Fifo.push(this.gp0Word);
		this.processGp0Fifo(nowCycles);
		this.updateDynamicStatusBits();
	}

	private processGp0Fifo(nowCycles: number): void {
		while (this.pendingCommandCompletionCycle === 0
			&& this.commandBuffer.readback.phase === GX_GPU_READBACK_IDLE
			&& !this.gp0Fifo.empty()) {
			if (this.gp0ImageLoadWordsRemaining !== 0) {
				this.consumeImageLoadWord(this.gp0Fifo.pop(), nowCycles);
				continue;
			}
			if (this.gp0PolylineWordsPerVertex !== 0) {
				this.consumeGp0PolylinePayloadWord(this.gp0Fifo.pop(), nowCycles);
				continue;
			}
			if (this.gp0CommandTargetWordCount === 0) {
				this.gp0CommandTargetWordCount = this.gp0CommandWordCountForOpcode(this.gp0Fifo.peek() >>> GX_GPU_GP0_OPCODE_SHIFT);
			}
			while (this.gp0CommandWordCount < this.gp0CommandTargetWordCount && !this.gp0Fifo.empty()) {
				this.gp0CommandWords[this.gp0CommandWordCount] = this.gp0Fifo.pop();
				this.gp0CommandWordCount += 1;
			}
			if (this.gp0CommandWordCount !== this.gp0CommandTargetWordCount) {
				return;
			}
			this.executeGp0Command(nowCycles);
		}
	}

	private executeGp0Command(nowCycles: number): void {
		const opcode = this.gp0CommandWords[0] >>> GX_GPU_GP0_OPCODE_SHIFT;
		const commandWordCount = this.gp0CommandWordCount;
		this.gp0CommandWordCount = 0;
		this.gp0CommandTargetWordCount = 0;

		switch (opcode) {
			case GX_GPU_GP0_FILL_RECTANGLE:
				this.emitFixedGp0Command(GX_GPU_COMMAND_FILL_RECTANGLE, opcode, commandWordCount, nowCycles);
				break;
			case GX_GPU_GP0_IRQ_REQUEST:
				if ((this.statusWord & GX_GPU_STATUS_INTERRUPT_REQUEST) === 0) {
					this.statusWord = (this.statusWord | GX_GPU_STATUS_INTERRUPT_REQUEST) >>> 0;
					this.irq.raise(IRQ_GPU);
				}
				this.writeStatusIo();
				this.startCommandTiming(1, this.commandBuffer.commandCount, nowCycles);
				break;
			case GX_GPU_GP0_DRAW_MODE:
				this.writeDrawModeWord(this.gp0CommandWords[0] & GX_GPU_GP0_PARAM_MASK);
				this.startCommandTiming(1, this.commandBuffer.commandCount, nowCycles);
				break;
			case GX_GPU_GP0_TEXTURE_WINDOW:
				this.textureWindowWord = this.gp0CommandWords[0] & GX_GPU_TEXTURE_WINDOW_MASK;
				this.startCommandTiming(1, this.commandBuffer.commandCount, nowCycles);
				break;
			case GX_GPU_GP0_DRAWING_AREA_TOP_LEFT:
				this.drawingAreaTopLeftWord = this.gp0CommandWords[0] & GX_GPU_DRAWING_AREA_MASK;
				this.startCommandTiming(1, this.commandBuffer.commandCount, nowCycles);
				break;
			case GX_GPU_GP0_DRAWING_AREA_BOTTOM_RIGHT:
				this.drawingAreaBottomRightWord = this.gp0CommandWords[0] & GX_GPU_DRAWING_AREA_MASK;
				this.startCommandTiming(1, this.commandBuffer.commandCount, nowCycles);
				break;
			case GX_GPU_GP0_DRAWING_OFFSET:
				this.drawingOffsetWord = this.gp0CommandWords[0] & GX_GPU_DRAWING_OFFSET_MASK;
				this.startCommandTiming(1, this.commandBuffer.commandCount, nowCycles);
				break;
			case GX_GPU_GP0_MASK_BIT:
				this.writeMaskBitModeWord(this.gp0CommandWords[0] & GX_GPU_GP0_PARAM_MASK);
				this.startCommandTiming(1, this.commandBuffer.commandCount, nowCycles);
				break;
			default:
				if (opcode >= GX_GPU_GP0_POLYGON_FIRST && opcode <= GX_GPU_GP0_POLYGON_LAST) {
					if ((opcode & GX_GPU_GP0_RENDER_TEXTURE_BIT) !== 0) {
						const texturePageWord = this.gp0CommandWords[gxGpuPolygonTexturePageWordIndex(opcode)];
						this.writeDrawModeWord(gxGpuPolygonDrawModeWord(this.drawModeWord, gxGpuTextureAttribute(texturePageWord)));
					}
					this.emitFixedGp0Command(GX_GPU_COMMAND_DRAW_POLYGON, opcode, commandWordCount, nowCycles);
				} else if (opcode >= GX_GPU_GP0_LINE_FIRST && opcode <= GX_GPU_GP0_LINE_LAST) {
					if ((opcode & GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT) !== 0) {
						this.beginPolylinePayload(opcode, commandWordCount);
					} else {
						this.emitFixedGp0Command(GX_GPU_COMMAND_DRAW_LINE, opcode, commandWordCount, nowCycles);
					}
				} else if (opcode >= GX_GPU_GP0_RECTANGLE_FIRST && opcode <= GX_GPU_GP0_RECTANGLE_LAST) {
					this.emitFixedGp0Command(GX_GPU_COMMAND_DRAW_RECTANGLE, opcode, commandWordCount, nowCycles);
				} else if (opcode >= GX_GPU_GP0_VRAM_TO_VRAM_FIRST && opcode <= GX_GPU_GP0_VRAM_TO_VRAM_LAST) {
					this.emitFixedGp0Command(GX_GPU_COMMAND_COPY_VRAM_TO_VRAM, opcode, commandWordCount, nowCycles);
				} else if (opcode >= GX_GPU_GP0_CPU_TO_VRAM_FIRST && opcode <= GX_GPU_GP0_CPU_TO_VRAM_LAST) {
					this.beginImageLoadToVram(opcode, commandWordCount);
				} else if (opcode >= GX_GPU_GP0_VRAM_TO_CPU_FIRST && opcode <= GX_GPU_GP0_VRAM_TO_CPU_LAST) {
					this.emitFixedGp0Command(GX_GPU_COMMAND_READ_VRAM_TO_CPU, opcode, commandWordCount, nowCycles);
				} else {
					this.startCommandTiming(1, this.commandBuffer.commandCount, nowCycles);
				}
				break;
		}
	}

	private startCommandTiming(ticks: number, commandTargetCount: number, startCycle: number): void {
		this.pendingCommandTargetCount = commandTargetCount;
		this.pendingCommandCompletionCycle = startCycle + ((ticks + GX_GPU_COMMAND_TICKS_PER_CPU_CYCLE - 1) >> 1);
		this.scheduler.scheduleDeviceService(DEVICE_SERVICE_GPU, this.pendingCommandCompletionCycle);
	}

	private synchronizeCommandTiming(nowCycles: number): void {
		while (this.pendingCommandCompletionCycle !== 0 && nowCycles >= this.pendingCommandCompletionCycle) {
			const completionCycle = this.pendingCommandCompletionCycle;
			const completedCommandCount = this.pendingCommandTargetCount;
			this.pendingCommandCompletionCycle = 0;
			this.pendingCommandTargetCount = 0;
			this.scheduler.cancelDeviceService(DEVICE_SERVICE_GPU);
			if (completedCommandCount > this.commandBuffer.executedCommandCount) {
				this.commandBuffer.completeCommandExecution(completedCommandCount);
			}
			if (this.commandBuffer.readback.phase === GX_GPU_READBACK_IDLE) {
				this.processGp0Fifo(completionCycle);
			}
		}
	}

	public onService(nowCycles: number): void {
		this.synchronizeCommandTiming(nowCycles);
		this.updateDynamicStatusBits();
		this.memory.writeIoValue(IO_GX_GPU_GP1, this.statusWord);
	}

	public readStatus(): number {
		this.synchronizeCommandTiming(this.scheduler.currentNowCycles());
		this.updateScanoutStatusBits();
		this.updateDynamicStatusBits();
		return this.statusWord;
	}

	public writeGp1(word: number): number {
		const nowCycles = this.scheduler.currentNowCycles();
		this.synchronizeCommandTiming(nowCycles);
		const command = word >>> 0;
		this.gp1Word = command;
		const opcode = (command >>> GX_GPU_GP1_OPCODE_SHIFT) & GX_GPU_GP1_OPCODE_MASK;
		switch (opcode) {
			case GX_GPU_GP1_RESET:
				this.clearGp0Fifo(nowCycles);
				this.resetGpuRegisters();
				break;
			case GX_GPU_GP1_CLEAR_FIFO:
				this.clearGp0Fifo(nowCycles);
				this.writeStatusIo();
				break;
			case GX_GPU_GP1_ACK_INTERRUPT:
				this.statusWord = (this.statusWord & ~GX_GPU_STATUS_INTERRUPT_REQUEST) >>> 0;
				this.writeStatusIo();
				break;
			case GX_GPU_GP1_DISPLAY_DISABLE:
				this.writeDisplayDisableWord(command);
				break;
			case GX_GPU_GP1_DMA_DIRECTION:
				this.writeDmaDirectionWord(command);
				break;
			case GX_GPU_GP1_DISPLAY_START:
				this.displayStartWord = command & GX_GPU_DISPLAY_START_MASK;
				this.updateScanoutStatusBits();
				this.writeStatusIo();
				break;
			case GX_GPU_GP1_HORIZONTAL_DISPLAY_RANGE:
				this.horizontalDisplayRangeWord = command & GX_GPU_HORIZONTAL_DISPLAY_RANGE_MASK;
				this.writeStatusIo();
				break;
			case GX_GPU_GP1_VERTICAL_DISPLAY_RANGE:
				this.verticalDisplayRangeWord = command & GX_GPU_VERTICAL_DISPLAY_RANGE_MASK;
				this.writeStatusIo();
				break;
			case GX_GPU_GP1_DISPLAY_MODE:
				this.writeDisplayModeWord(command & GX_GPU_DISPLAY_MODE_MASK);
				break;
			case GX_GPU_GP1_ALLOW_TEXTURE_DISABLE:
				this.textureDisableAllowedWord = command & 0x1;
				this.writeStatusIo();
				break;
			case GX_GPU_GP1_GET_GPU_INFO:
				this.writeGpuInfoQuery(command);
				break;
			default:
				if (opcode >= GX_GPU_GP1_GET_GPU_INFO && opcode <= GX_GPU_GP1_GET_GPU_INFO_LAST) {
					this.writeGpuInfoQuery(command);
				} else {
					this.writeStatusIo();
				}
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

	public setScanoutTiming(vblankActive: boolean, cyclesIntoFrame: number, cyclesPerFrame: number, totalScanlines: number): void {
		if (!this.scanoutVblankActive && vblankActive) {
			this.scanoutInterlacedDisplayField = this.gpuStatInInterleaved480iMode() ? this.scanoutInterlacedField ^ 1 : 0;
		}
		if (this.scanoutVblankActive && !vblankActive) {
			if ((this.statusWord & GX_GPU_STATUS_VERTICAL_INTERLACE) !== 0) {
				this.scanoutInterlacedField ^= 1;
			} else {
				this.scanoutInterlacedField = 0;
			}
		}
		this.scanoutVblankActive = vblankActive;
		this.scanoutFrameStartCycle = this.scheduler.currentNowCycles() - cyclesIntoFrame;
		this.scanoutCyclesPerFrame = cyclesPerFrame;
		this.scanoutTotalScanlines = totalScanlines;
		this.updateScanoutStatusBits();
		this.writeStatusIo();
	}

	public readGpuReadWord(): number {
		return this.gpuReadWord;
	}

	public readDeviceOutput(): GxGpuDeviceOutput {
		this.synchronizeCommandTiming(this.scheduler.currentNowCycles());
		this.updateScanoutStatusBits();
		this.updateDynamicStatusBits();
		this.deviceOutput.statusWord = this.presentStatusWord;
		this.deviceOutput.displayModeWord = this.presentDisplayModeWord;
		this.deviceOutput.displayStartWord = this.presentDisplayStartWord;
		this.deviceOutput.horizontalDisplayRangeWord = this.presentHorizontalDisplayRangeWord;
		this.deviceOutput.verticalDisplayRangeWord = this.presentVerticalDisplayRangeWord;
		this.deviceOutput.vramSnapshotSerial = this.vramSnapshotSerial;
		return this.deviceOutput;
	}

	public presentReadyFrameOnVblankEdge(): void {
		this.synchronizeCommandTiming(this.scheduler.currentNowCycles());
		this.updateScanoutStatusBits();
		this.updateDynamicStatusBits();
		// A field edge exposes the other retained scanout field even when no GP0 work completed.
		const visibleStatusMask = GX_GPU_STATUS_DISPLAY_DISABLE | GX_GPU_STATUS_INTERLACED_FIELD;
		const visibleStatusWord = this.statusWord & visibleStatusMask;
		const scanoutStateChanged = (this.presentStatusWord & visibleStatusMask) !== visibleStatusWord
			|| this.presentDisplayModeWord !== this.displayModeWord
			|| this.presentDisplayStartWord !== this.displayStartWord
			|| this.presentHorizontalDisplayRangeWord !== this.horizontalDisplayRangeWord
			|| this.presentVerticalDisplayRangeWord !== this.verticalDisplayRangeWord;
		this.presentStatusWord = this.statusWord;
		this.presentDisplayModeWord = this.displayModeWord;
		this.presentDisplayStartWord = this.displayStartWord;
		this.presentHorizontalDisplayRangeWord = this.horizontalDisplayRangeWord;
		this.presentVerticalDisplayRangeWord = this.verticalDisplayRangeWord;
		this.commandBuffer.sealCommandsForPresentation();
		this.m_lastFrameCommitted = this.commandBuffer.hasUnretiredPresentCommands() || scanoutStateChanged;
	}

	public lastFrameCommitted(): boolean {
		return this.m_lastFrameCommitted;
	}

	public retirePresentedCommands(): void {
		const retiredCommands = this.commandBuffer.presentCommandCount;
		const retiredWords = this.commandBuffer.retireCommandsPreservingVram();
		if (this.pendingCommandTargetCount !== 0) {
			this.pendingCommandTargetCount -= retiredCommands;
		}
		if (retiredWords !== 0) {
			if (this.gp0ImageLoadCommandWordCount !== 0) {
				this.gp0ImageLoadCommandWordStart -= retiredWords;
			}
			if (this.gp0PolylineCommandWordCount !== 0) {
				this.gp0PolylineCommandWordStart -= retiredWords;
			}
		}
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

	public readTextureDisableAllowedWord(): number {
		return this.textureDisableAllowedWord;
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
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_GPU);
		this.gp0Fifo.reset();
		this.pendingCommandCompletionCycle = 0;
		this.pendingCommandTargetCount = 0;
		this.gp0CommandWords.fill(0);
		this.gp0CommandWordCount = 0;
		this.gp0CommandTargetWordCount = 0;
		this.clearImageLoadState();
		this.clearPolylineState();
	}

	private clearGp0Fifo(nowCycles: number): void {
		this.gp0Fifo.reset();
		this.flushImageLoadToVram(nowCycles);
		if (this.gp0PolylineCommandWordCount !== 0) {
			this.commandBuffer.wordCount = this.gp0PolylineCommandWordStart;
		}
		this.commandBuffer.abortReadbackAndQueuedCommands();
		// A removed C0 marker leaves no command for its device deadline to complete.
		if (this.pendingCommandTargetCount > this.commandBuffer.commandCount) {
			this.scheduler.cancelDeviceService(DEVICE_SERVICE_GPU);
			this.pendingCommandCompletionCycle = 0;
			this.pendingCommandTargetCount = 0;
		}
		this.gp0CommandWords.fill(0);
		this.gp0CommandWordCount = 0;
		this.gp0CommandTargetWordCount = 0;
		this.clearImageLoadState();
		this.clearPolylineState();
	}

	private clearPolylineState(): void {
		this.gp0PolylineWordsPerVertex = 0;
		this.gp0PolylinePayloadPhase = 0;
		this.gp0PolylineCommandWordStart = 0;
		this.gp0PolylineCommandWordCount = 0;
		this.gp0PolylineCommandOpcode = 0;
	}

	private clearImageLoadState(): void {
		this.gp0ImageLoadWordsRemaining = 0;
		this.gp0ImageLoadCommandWordStart = 0;
		this.gp0ImageLoadCommandWordCount = 0;
		this.gp0ImageLoadCommandOpcode = 0;
	}

	private finishImageLoadToVram(nowCycles: number): void {
		this.pushGpuCommand(
			GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
			this.gp0ImageLoadCommandOpcode,
			this.gp0ImageLoadCommandWordStart,
			this.gp0ImageLoadCommandWordCount,
			nowCycles,
		);
		this.clearImageLoadState();
	}

	private flushImageLoadToVram(nowCycles: number): void {
		if (this.gp0ImageLoadCommandWordCount === 0) {
			return;
		}
		if (this.gp0ImageLoadCommandWordCount > 3) {
			this.finishImageLoadToVram(nowCycles);
		} else {
			this.commandBuffer.wordCount = this.gp0ImageLoadCommandWordStart;
			this.clearImageLoadState();
		}
	}

	private consumeImageLoadWord(word: number, nowCycles: number): void {
		this.commandBuffer.appendWord(word);
		this.gp0ImageLoadCommandWordCount += 1;
		this.gp0ImageLoadWordsRemaining -= 1;
		if (this.gp0ImageLoadWordsRemaining === 0) {
			this.finishImageLoadToVram(nowCycles);
		}
	}

	private consumeGp0PolylinePayloadWord(word: number, nowCycles: number): void {
		if (this.gp0PolylinePayloadPhase === 0 && (word & 0xf000f000) === 0x50005000) {
			this.pushGpuCommand(
				GX_GPU_COMMAND_DRAW_POLYLINE,
				this.gp0PolylineCommandOpcode,
				this.gp0PolylineCommandWordStart,
				this.gp0PolylineCommandWordCount,
				nowCycles,
			);
			this.clearPolylineState();
			return;
		}
		this.commandBuffer.appendWord(word);
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
		return gouraudLineWordCount;
	}

	private gp0RectangleWordCount(opcode: number): number {
		const textureWordCount = (opcode & GX_GPU_GP0_RENDER_TEXTURE_BIT) >>> 2;
		const sizeWordCount = (opcode & GX_GPU_GP0_RECTANGLE_SIZE_MASK) === 0 ? 1 : 0;
		return 2 + textureWordCount + sizeWordCount;
	}

	private emitFixedGp0Command(kind: number, opcode: number, commandWordCount: number, nowCycles: number): void {
		const wordStart = this.commandBuffer.appendWords(this.gp0CommandWords, commandWordCount);
		this.pushGpuCommand(kind, opcode, wordStart, commandWordCount, nowCycles);
	}

	private pushGpuCommand(kind: number, opcode: number, wordStart: number, commandWordCount: number, nowCycles: number): void {
		const interlacedRenderWord = gxGpuInterlacedRenderWord(this.statusWord, this.scanoutActiveLineLsb);
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
			interlacedRenderWord,
		);
		this.startCommandTiming(
			gxGpuCommandTicks(
				kind,
				opcode,
				this.commandBuffer.words,
				wordStart,
				commandWordCount,
				this.drawModeWord,
				this.drawingAreaTopLeftWord,
				this.drawingAreaBottomRightWord,
				this.drawingOffsetWord,
				this.maskBitModeWord,
				interlacedRenderWord,
			),
			this.commandBuffer.commandCount,
			nowCycles,
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
		if (this.textureDisableAllowedWord === 0) {
			this.drawModeWord = (this.drawModeWord & ~GX_GPU_DRAW_MODE_TEXTURE_DISABLE) >>> 0;
		}
		this.updateDrawModeStatusBits();
		this.writeStatusIo();
	}

	private updateDrawModeStatusBits(): void {
		const textureDisable = (this.drawModeWord & GX_GPU_DRAW_MODE_TEXTURE_DISABLE) !== 0
			? GX_GPU_STATUS_TEXTURE_DISABLE
			: 0;
		this.statusWord = ((this.statusWord & ~(GX_GPU_DRAW_MODE_GPUSTAT_MASK | GX_GPU_STATUS_TEXTURE_DISABLE))
			| (this.drawModeWord & GX_GPU_DRAW_MODE_GPUSTAT_MASK)
			| textureDisable) >>> 0;
	}

	private writeMaskBitModeWord(word: number): void {
		this.maskBitModeWord = word & GX_GPU_MASK_BIT_MODE_MASK;
		this.statusWord = ((this.statusWord & ~((1 << 11) | (1 << 12))) | (this.maskBitModeWord << 11)) >>> 0;
		this.writeStatusIo();
	}

	private writeGpuInfoQuery(word: number): void {
		switch (word & GX_GPU_GP1_GET_GPU_INFO_INDEX_MASK) {
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
			case 0x07:
				this.gpuReadWord = GX_GPU_INFO_GPU_TYPE_208PIN;
				break;
			case 0x08:
				this.gpuReadWord = 0;
				break;
		}
		this.memory.writeIoValue(IO_GX_GPU_GP0, this.gpuReadWord);
		this.writeStatusIo();
	}

	private writeDmaDirectionWord(word: number): void {
		const dmaDirection = word & 0x3;
		const dmaDirectionBits = dmaDirection << GX_GPU_STATUS_DMA_DIRECTION_SHIFT;
		this.statusWord = ((this.statusWord & ~GX_GPU_STATUS_DMA_DIRECTION_MASK) | dmaDirectionBits) >>> 0;
		this.dmaController.setGxGpuDmaDirection(dmaDirection);
		this.writeStatusIo();
	}

	private updateCommandStatusBits(): void {
		let commandStatusBits = 0;
		const readbackIdle = this.commandBuffer.readback.phase === GX_GPU_READBACK_IDLE;
		const fifoWordCount = this.gp0Fifo.count();
		let readyToReceive = false;
		if (readbackIdle && fifoWordCount < GX_GPU_COMMAND_FIFO_WORD_CAPACITY) {
			if (this.gp0ImageLoadWordsRemaining !== 0 || this.gp0PolylineWordsPerVertex !== 0 || fifoWordCount === 0) {
				readyToReceive = true;
			} else {
				readyToReceive = fifoWordCount < this.gp0CommandWordCountForOpcode(this.gp0Fifo.peek() >>> GX_GPU_GP0_OPCODE_SHIFT);
			}
		}
		if (readyToReceive) {
			commandStatusBits |= GX_GPU_STATUS_READY_TO_RECEIVE_DMA;
		}
		if (this.commandBuffer.readback.phase === GX_GPU_READBACK_READY) {
			commandStatusBits |= GX_GPU_STATUS_READY_TO_SEND_VRAM;
		}
		if (readbackIdle
			&& this.pendingCommandCompletionCycle === 0
			&& fifoWordCount === 0
			&& this.gp0CommandWordCount === 0
			&& this.gp0ImageLoadWordsRemaining === 0
			&& this.gp0PolylineWordsPerVertex === 0) {
			commandStatusBits |= GX_GPU_STATUS_GPU_IDLE;
		}
		this.statusWord = ((this.statusWord & ~GX_GPU_STATUS_COMMAND_STATE_MASK) | commandStatusBits) >>> 0;
		// CPU stores need one physical FIFO slot; DMA packet acceptance is a
		// separate, stricter GPUSTAT line while a command is being assembled.
		this.dmaController.setGxGpuCpuWriteReady(fifoWordCount < GX_GPU_COMMAND_FIFO_WORD_CAPACITY);
		this.dmaController.setGxGpuDmaWriteReady(readyToReceive);
	}

	private updateDynamicStatusBits(): void {
		this.updateCommandStatusBits();
		this.updateDmaRequestStatusBit();
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

	private gpuStatInInterleaved480iMode(): boolean {
		return (this.statusWord & (GX_GPU_STATUS_VERTICAL_RESOLUTION | GX_GPU_STATUS_VERTICAL_INTERLACE)) === (GX_GPU_STATUS_VERTICAL_RESOLUTION | GX_GPU_STATUS_VERTICAL_INTERLACE);
	}

	private scanoutLine(): number {
		const cyclesIntoFrame = (this.scheduler.currentNowCycles() - this.scanoutFrameStartCycle) % this.scanoutCyclesPerFrame;
		const numerator = cyclesIntoFrame * this.scanoutTotalScanlines;
		return (numerator - numerator % this.scanoutCyclesPerFrame) / this.scanoutCyclesPerFrame;
	}

	private updateScanoutStatusBits(): void {
		let scanoutBits = 0;
		const displayStartY = gxGpuDisplayStartY(this.displayStartWord);
		if (this.gpuStatInInterleaved480iMode()) {
			this.scanoutActiveLineLsb = (displayStartY + this.scanoutInterlacedDisplayField) & 1;
			const displayedField = this.scanoutVblankActive ? 0 : this.scanoutInterlacedDisplayField;
			if (((displayStartY + displayedField) & 1) !== 0) {
				scanoutBits |= GX_GPU_STATUS_DISPLAY_LINE_LSB;
			}
		} else {
			this.scanoutActiveLineLsb = 0;
			this.scanoutInterlacedDisplayField = 0;
			if (((displayStartY + this.scanoutLine()) & 1) !== 0) {
				scanoutBits |= GX_GPU_STATUS_DISPLAY_LINE_LSB;
			}
		}
		if ((this.statusWord & GX_GPU_STATUS_VERTICAL_INTERLACE) === 0 || this.scanoutInterlacedField === 0) {
			scanoutBits |= GX_GPU_STATUS_INTERLACED_FIELD;
		}
		this.statusWord = ((this.statusWord & ~GX_GPU_STATUS_SCANOUT_MASK) | scanoutBits) >>> 0;
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
		this.updateScanoutStatusBits();
	}

	private writeStatusIo(): void {
		this.updateDynamicStatusBits();
		this.memory.writeIoValue(IO_GX_GPU_GP1, this.statusWord);
	}

	private gp0WriteReady(): boolean {
		this.synchronizeCommandTiming(this.scheduler.currentNowCycles());
		this.updateDynamicStatusBits();
		return this.dmaController.isGxGpuCpuPortWriteReady();
	}

	// disable-next-line single_line_method_pattern -- MMIO read thunk is the Memory-owned device callback ABI for GP0.
	private static readGp0Thunk(context: GxGpu, _addr: number): Value {
		return context.readGp0();
	}

	// disable-next-line single_line_method_pattern -- MMIO write thunk is the Memory-owned device callback ABI for GP0.
	private static writeGp0Thunk(context: GxGpu, _addr: number, value: Value): void {
		context.writeGp0(value as number);
	}

	private static gp0WriteReadyThunk(context: GxGpu, _addr: number): boolean {
		return context.gp0WriteReady();
	}

	// disable-next-line single_line_method_pattern -- MMIO read thunk is the Memory-owned device callback ABI for GPUSTAT.
	private static readStatusThunk(context: GxGpu, _addr: number): Value {
		return context.readStatus();
	}

	// disable-next-line single_line_method_pattern -- MMIO write thunk is the Memory-owned device callback ABI for GP1.
	private static writeGp1Thunk(context: GxGpu, _addr: number, value: Value): void {
		context.writeGp1(value as number);
	}
}
