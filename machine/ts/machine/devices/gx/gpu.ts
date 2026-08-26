import type { CPU } from '../../cpu/cpu';
import {
	DMA_REQUEST_GX_WRITE,
	IO_GX_GPU_GP0,
	IO_GX_GPU_GP1,
	IO_GX_PCRTC_BASE,
	IO_GX_PCRTC_TIMING_BASE,
	IO_GX_PCRTC_WORD_COUNT,
	IRQ_GPU,
	IRQ_GX_PCRTC,
} from '../../../spec/bmsx/io';
import type { Memory } from '../../memory/memory';
import { IO_WORD_SIZE } from '../../../spec/bmsx/memory_map';
import {
	MAPPED_BUS_DMA_BLOCK_END,
	MAPPED_BUS_MASTER_CPU,
	MAPPED_BUS_MASTER_DMA,
	type MappedBusSignals,
} from '../../memory/bus_signals';
import type { DeviceScheduler } from '../../scheduler/device';
import { DEVICE_SERVICE_GPU, DEVICE_SERVICE_SYSTEM } from '../../scheduler/device';
import type { DmaController } from '../dma/controller';
import type { IrqController } from '../irq/controller';
import { WordFifo } from '../word_fifo';
import type { GxGpuDeviceOutput } from './device_output';
import {
	GX_GPU_DRAW_MODE_DRAW_TO_DISPLAYED_FIELD,
	GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_HIGH,
	gxGpuPolygonDrawModeWord,
	gxGpuPolygonTexturePageWordIndex,
	gxGpuTextureAttribute,
	gxGpuTransferHeight,
	gxGpuTransferWidth,
} from '../../../spec/gx/gp0';
import {
	GX_GPU_COMMAND_COPY_VRAM_TO_VRAM,
	GX_GPU_COMMAND_CAPACITY,
	GX_GPU_COMMAND_DRAW_LINE,
	GX_GPU_COMMAND_DRAW_POLYGON,
	GX_GPU_COMMAND_DRAW_POLYLINE,
	GX_GPU_COMMAND_DRAW_RECTANGLE,
	GX_GPU_COMMAND_FILL_RECTANGLE,
	GX_GPU_COMMAND_READ_VRAM_TO_CPU,
	GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
	GX_GPU_COMMAND_WORD_CAPACITY,
	GX_GPU_READBACK_IDLE,
	GX_GPU_READBACK_PENDING,
	GX_GPU_READBACK_READY,
	GX_GPU_READBACK_SUBMITTED,
	GX_GPU_SKIPPED_LINE_NONE,
	GxGpuCommandBuffer,
	type GxGpuCommandBufferState,
} from './gpu_command_buffer';
import {
	GX_GPU_COMMAND_TICKS_PER_CPU_CYCLE,
	gxGpuCommandTicks,
} from './gpu_command_timing';
import {
	GX_GPU_DMA_DIRECTION_CPU_TO_GP0,
	GX_GPU_DMA_DIRECTION_FIFO,
	GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU,
	GX_GPU_COMMAND_FIFO_WORD_CAPACITY,
	GX_GPU_DMA_INGRESS_WORD_CAPACITY,
	GX_GPU_GP0_COMMAND_BUFFER_WORDS,
	GX_GPU_GP0_CPU_TO_VRAM_FIRST,
	GX_GPU_GP0_CPU_TO_VRAM_LAST,
	GX_GPU_GP0_DRAWING_AREA_BOTTOM_RIGHT,
	GX_GPU_GP0_DRAWING_AREA_TOP_LEFT,
	GX_GPU_GP0_DRAWING_OFFSET,
	GX_GPU_GP0_DRAW_MODE,
	GX_GPU_GP0_FILL_RECTANGLE,
	GX_GPU_GP0_IRQ_REQUEST,
	GX_GPU_GP0_LINE_FIRST,
	GX_GPU_GP0_LINE_LAST,
	GX_GPU_GP0_MASK_BIT,
	GX_GPU_GP0_OPCODE_SHIFT,
	GX_GPU_GP0_PARAM_MASK,
	GX_GPU_GP0_POLYGON_FIRST,
	GX_GPU_GP0_POLYGON_LAST,
	GX_GPU_GP0_RECTANGLE_FIRST,
	GX_GPU_GP0_RECTANGLE_LAST,
	GX_GPU_GP0_RECTANGLE_SIZE_MASK,
	GX_GPU_GP0_RENDER_GOURAUD_BIT,
	GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT,
	GX_GPU_GP0_RENDER_TEXTURE_BIT,
	GX_GPU_GP0_TEXTURE_WINDOW,
	GX_GPU_GP0_VRAM_TO_CPU_FIRST,
	GX_GPU_GP0_VRAM_TO_CPU_LAST,
	GX_GPU_GP0_VRAM_TO_VRAM_FIRST,
	GX_GPU_GP0_VRAM_TO_VRAM_LAST,
} from '../../../spec/gx/gp0';
import {
	GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD,
	GX_GPU_RESET_DISPLAY_MODE_WORD,
	GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD,
	gxGpuDisplayStartY,
} from './gpu_display';
import { initializeGxGpuVramPowerOn } from './vram_power_on';
import {
	GX_GPU_PCRTC_COMPOSITION_WORD_COUNT,
	GX_GPU_PCRTC_CONFIG_WORD_COUNT,
	GX_GPU_PCRTC_CSR_FLUSH,
	GX_GPU_PCRTC_CSR_LOW,
	GX_GPU_PCRTC_CSR_RESET,
	GX_GPU_PCRTC_IMR_LOW,
	GX_GPU_PCRTC_RUNTIME_EDGE_NONE,
	GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN,
	GX_GPU_PCRTC_SERVICE_IRQ,
	GX_GPU_PCRTC_SERVICE_RUNTIME_EDGE_MASK,
	GX_GPU_PCRTC_WORD_COUNT,
	GxGpuPcrtc,
	gxGpuPcrtcRegisterAddress,
	type GxGpuPcrtcState,
	type GxGpuPcrtcTiming,
} from './gpu_pcrtc';

let gxGpuNextVramSnapshotSerial = 0n;
let gxGpuNextVramReplacementSerial = 0n;

export const GX_GPU_SERVICE_RUNTIME_EDGE_MASK = 0x3;
export const GX_GPU_SERVICE_TIMING_PUBLISHED = 1 << 2;

export const GX_GPU_GP0_INGRESS_COMMAND = 0;
export const GX_GPU_GP0_INGRESS_FIXED = 1;
export const GX_GPU_GP0_INGRESS_IMAGE_HEADER = 2;
export const GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD = 3;
export const GX_GPU_GP0_INGRESS_POLYLINE_HEADER = 4;
export const GX_GPU_GP0_INGRESS_POLYLINE_PAYLOAD = 5;

export const GX_GPU_GP1_RESET = 0x00;
export const GX_GPU_GP1_CLEAR_FIFO = 0x01;
export const GX_GPU_GP1_ACK_INTERRUPT = 0x02;
export const GX_GPU_GP1_DISPLAY_DISABLE = 0x03;
export const GX_GPU_GP1_DMA_DIRECTION = 0x04;
export const GX_GPU_GP1_DISPLAY_START = 0x05;
export const GX_GPU_GP1_HORIZONTAL_DISPLAY_RANGE = 0x06;
export const GX_GPU_GP1_VERTICAL_DISPLAY_RANGE = 0x07;
export const GX_GPU_GP1_DISPLAY_MODE = 0x08;
export const GX_GPU_GP1_VRAM_Y_ADDRESS_EXTENSION = 0x09;
export const GX_GPU_GP1_GET_GPU_INFO = 0x10;
export const GX_GPU_GP1_GET_GPU_INFO_LAST = 0x1f;
export const GX_GPU_GP1_OPCODE_SHIFT = 24;
export const GX_GPU_GP1_PARAM_MASK = 0x00ffffff;
export const GX_GPU_GP1_GET_GPU_INFO_INDEX_MASK = 0x0f;
export const GX_GPU_INFO_GPU_TYPE_V2 = 0x00000002;

function gxGpuGp0OpcodeIsNop(opcode: number): boolean {
	return opcode === 0x00
		|| (opcode >= 0x04 && opcode <= 0x1e)
		|| opcode === 0xe0
		|| (opcode >= 0xe7 && opcode <= 0xef);
}

export const GX_GPU_DISPLAY_START_MASK = 0x000ffffe;
export const GX_GPU_DISPLAY_MODE_MASK = 0x000000ff;
export const GX_GPU_HORIZONTAL_DISPLAY_RANGE_MASK = 0x00ffffff;
export const GX_GPU_VERTICAL_DISPLAY_RANGE_MASK = 0x000fffff;
export const GX_GPU_DRAW_MODE_MASK = 0x00003fff;
export const GX_GPU_DRAW_MODE_GPUSTAT_MASK = 0x000007ff;
export const GX_GPU_TEXTURE_WINDOW_MASK = 0x000fffff;
export const GX_GPU_DRAWING_AREA_MASK = 0x000fffff;
export const GX_GPU_DRAWING_OFFSET_MASK = 0x003fffff;
export const GX_GPU_MASK_BIT_MODE_MASK = 0x3;

export const GX_GPU_STATUS_INTERLACED_FIELD = 1 << 13;
export const GX_GPU_STATUS_REVERSE_FLAG = 1 << 14;
export const GX_GPU_STATUS_TEXTURE_PAGE_Y_HIGH = 1 << 15;
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
const GX_GPU_STATUS_SKIP_ACTIVE_FIELD_MASK = GX_GPU_STATUS_VERTICAL_RESOLUTION | GX_GPU_STATUS_VERTICAL_INTERLACE | GX_GPU_DRAW_MODE_DRAW_TO_DISPLAYED_FIELD;
const GX_GPU_STATUS_SKIP_ACTIVE_FIELD_WORD = GX_GPU_STATUS_VERTICAL_RESOLUTION | GX_GPU_STATUS_VERTICAL_INTERLACE;
export const GX_GPU_STATUS_DISPLAY_MODE_MASK = GX_GPU_STATUS_REVERSE_FLAG
	| GX_GPU_STATUS_HORIZONTAL_RESOLUTION_2
	| (0x3 << GX_GPU_STATUS_HORIZONTAL_RESOLUTION_1_SHIFT)
	| GX_GPU_STATUS_VERTICAL_RESOLUTION
	| GX_GPU_STATUS_PAL_MODE
	| GX_GPU_STATUS_DISPLAY_AREA_COLOR_DEPTH_24
	| GX_GPU_STATUS_VERTICAL_INTERLACE;

export type GxGpuRegisterContextState = {
	gp0Word: number;
	gp1Word: number;
	displayModeWord: number;
	statusWord: number;
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
	vramYAddressExtensionWord: number;
	presentStatusWord: number;
	presentDisplayModeWord: number;
	presentDisplayStartWord: number;
	presentVramYAddressExtensionWord: number;
	presentHorizontalDisplayRangeWord: number;
	presentVerticalDisplayRangeWord: number;
	pcrtcRegisterWords: number[];
	pcrtcPresentWords: number[];
	vramPresentationPending: boolean;
};

export type GxGpuIngressContextState = {
	gp0CommandTargetWordCount: number;
	gp0CommandWords: number[];
	gp0IngressPhase: number;
	gp0IngressWordsRemaining: number;
	gp0IngressPolylineWordsPerVertex: number;
	gp0IngressPolylinePayloadPhase: number;
	gp0ImageLoadWordsRemaining: number;
	gp0ImageLoadCommandWordStart: number;
	gp0ImageLoadCommandWordCount: number;
	gp0ImageLoadCommandOpcode: number;
	gp0PolylineWordsPerVertex: number;
	gp0PolylinePayloadPhase: number;
	gp0PolylineCommandWordStart: number;
	gp0PolylineCommandWordCount: number;
	gp0PolylineCommandOpcode: number;
	commandBufferWords: number[];
};

type GxGpuIngressContextBank = {
	gp0CommandTargetWordCount: number;
	gp0CommandWordCount: number;
	gp0CommandWords: Uint32Array;
	gp0IngressPhase: number;
	gp0IngressWordsRemaining: number;
	gp0IngressPolylineWordsPerVertex: number;
	gp0IngressPolylinePayloadPhase: number;
	gp0ImageLoadWordsRemaining: number;
	gp0ImageLoadCommandWordStart: number;
	gp0ImageLoadCommandWordCount: number;
	gp0ImageLoadCommandOpcode: number;
	gp0PolylineWordsPerVertex: number;
	gp0PolylinePayloadPhase: number;
	gp0PolylineCommandWordStart: number;
	gp0PolylineCommandWordCount: number;
	gp0PolylineCommandOpcode: number;
	commandBufferWordCount: number;
	commandBufferWords: Uint32Array;
};

export type GxGpuState = {
	gp0Word: number;
	gp1Word: number;
	displayModeWord: number;
	statusWord: number;
	gp0CommandWordCount: number;
	gp0CommandTargetWordCount: number;
	gp0CommandWords: number[];
	gp0FifoWords: number[];
	gp0DmaIngressWords: number[];
	gp0IngressPhase: number;
	gp0IngressWordsRemaining: number;
	gp0IngressPolylineWordsPerVertex: number;
	gp0IngressPolylinePayloadPhase: number;
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
	vramYAddressExtensionWord: number;
	presentStatusWord: number;
	presentDisplayModeWord: number;
	presentDisplayStartWord: number;
	presentVramYAddressExtensionWord: number;
	presentHorizontalDisplayRangeWord: number;
	presentVerticalDisplayRangeWord: number;
	pcrtc: GxGpuPcrtcState;
	pcrtcPresentationPending: boolean;
	vramPresentationPending: boolean;
	supervisorQuiesceRequested: boolean;
	supervisorIngressQuiesceRequested: boolean;
	supervisorIngressStopped: boolean;
	userContext: GxGpuRegisterContextState;
	userIngressContext: GxGpuIngressContextState;
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
	private readonly pcrtc: GxGpuPcrtc;
	private readonly gp0CommandWords = new Uint32Array(GX_GPU_GP0_COMMAND_BUFFER_WORDS);
	private readonly gp0Fifo = new WordFifo(GX_GPU_COMMAND_FIFO_WORD_CAPACITY);
	private readonly gp0DmaIngress = new WordFifo(GX_GPU_DMA_INGRESS_WORD_CAPACITY);
	private gp0IngressPhase = GX_GPU_GP0_INGRESS_COMMAND;
	private gp0IngressWordsRemaining = 0;
	private gp0IngressPolylineWordsPerVertex = 0;
	private gp0IngressPolylinePayloadPhase = 0;
	private gp0CommandWordCount = 0;
	private gp0CommandTargetWordCount = 0;
	private pendingCommandCompletionCycle = 0;
	private pendingCommandTargetCount = 0;
	private deviceServiceDeadlineCycle = -1;
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
	private vramYAddressExtensionWord = 0;
	private presentStatusWord = GX_GPU_STATUS_RESET_WORD;
	private presentDisplayModeWord = GX_GPU_RESET_DISPLAY_MODE_WORD;
	private presentDisplayStartWord = 0;
	private presentVramYAddressExtensionWord = 0;
	private presentHorizontalDisplayRangeWord = GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD;
	private presentVerticalDisplayRangeWord = GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD;
	private scanoutInterlacedField = 0;
	private scanoutInterlacedDisplayField = 0;
	private scanoutActiveLineLsb = 0;
	private skippedLineParity = GX_GPU_SKIPPED_LINE_NONE;
	private pcrtcTimingPublicationPending = false;
	private pcrtcPresentationPending = false;
	private m_lastFrameCommitted = false;
	private vramPresentationPending = false;
	private supervisorQuiesceRequested = false;
	private supervisorIngressQuiesceRequested = false;
	private supervisorIngressStopped = false;
	private readonly userContext: GxGpuRegisterContextState = {
		gp0Word: 0,
		gp1Word: 0,
		displayModeWord: GX_GPU_RESET_DISPLAY_MODE_WORD,
		statusWord: GX_GPU_STATUS_RESET_WORD,
		gpuReadWord: 0,
		drawModeWord: 0,
		textureWindowWord: 0,
		drawingAreaTopLeftWord: 0,
		drawingAreaBottomRightWord: 0,
		drawingOffsetWord: 0,
		maskBitModeWord: 0,
		displayStartWord: 0,
		horizontalDisplayRangeWord: GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD,
		verticalDisplayRangeWord: GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD,
		vramYAddressExtensionWord: 0,
		presentStatusWord: GX_GPU_STATUS_RESET_WORD,
		presentDisplayModeWord: GX_GPU_RESET_DISPLAY_MODE_WORD,
		presentDisplayStartWord: 0,
		presentVramYAddressExtensionWord: 0,
		presentHorizontalDisplayRangeWord: GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD,
		presentVerticalDisplayRangeWord: GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD,
		pcrtcRegisterWords: new Array<number>(GX_GPU_PCRTC_COMPOSITION_WORD_COUNT).fill(0),
		pcrtcPresentWords: new Array<number>(GX_GPU_PCRTC_COMPOSITION_WORD_COUNT).fill(0),
		vramPresentationPending: false,
	};
	private readonly userIngressContext: GxGpuIngressContextBank = {
		gp0CommandTargetWordCount: 0,
		gp0CommandWordCount: 0,
		gp0CommandWords: new Uint32Array(GX_GPU_GP0_COMMAND_BUFFER_WORDS),
		gp0IngressPhase: GX_GPU_GP0_INGRESS_COMMAND,
		gp0IngressWordsRemaining: 0,
		gp0IngressPolylineWordsPerVertex: 0,
		gp0IngressPolylinePayloadPhase: 0,
		gp0ImageLoadWordsRemaining: 0,
		gp0ImageLoadCommandWordStart: 0,
		gp0ImageLoadCommandWordCount: 0,
		gp0ImageLoadCommandOpcode: 0,
		gp0PolylineWordsPerVertex: 0,
		gp0PolylinePayloadPhase: 0,
		gp0PolylineCommandWordStart: 0,
		gp0PolylineCommandWordCount: 0,
		gp0PolylineCommandOpcode: 0,
		commandBufferWordCount: 0,
		commandBufferWords: new Uint32Array(GX_GPU_COMMAND_WORD_CAPACITY),
	};
	private readonly vramSnapshotBytes: Uint8Array;
	private vramSnapshotSerial = 0n;
	private vramReplacementSerial = 0n;
	private readonly deviceOutput: { -readonly [Key in keyof GxGpuDeviceOutput]: GxGpuDeviceOutput[Key] };

	public constructor(
		private readonly memory: Memory,
		private readonly cpu: CPU,
		private readonly irq: IrqController,
		private readonly scheduler: DeviceScheduler,
		private readonly dmaController: DmaController,
		gxGpuVramBytes: number,
	) {
		this.commandBuffer = new GxGpuCommandBuffer(dmaController);
		this.pcrtc = new GxGpuPcrtc();
		this.vramSnapshotBytes = new Uint8Array(gxGpuVramBytes);
		this.deviceOutput = {
			commandBuffer: this.commandBuffer,
			readbackPort: this.commandBuffer.readback,
			statusWord: GX_GPU_STATUS_RESET_WORD,
			displayModeWord: GX_GPU_RESET_DISPLAY_MODE_WORD,
			displayStartWord: 0,
			vramYAddressExtensionWord: 0,
			horizontalDisplayRangeWord: GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD,
			verticalDisplayRangeWord: GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD,
			pcrtcWords: this.pcrtc.presentWords,
			pcrtcTiming: this.pcrtc.timing,
			pcrtcScanout: this.pcrtc.scanout,
			vramSnapshotBytes: this.vramSnapshotBytes,
			vramSnapshotSerial: 0n,
			vramReplacementSerial: 0n,
		};
		this.memory.mapIoRead(IO_GX_GPU_GP0, this, GxGpu.readGp0Thunk);
		this.memory.mapIoWrite(IO_GX_GPU_GP0, this, GxGpu.writeGp0Thunk);
		this.memory.mapIoWriteReady(IO_GX_GPU_GP0, GxGpu.gp0WriteReadyThunk);
		this.memory.mapIoRead(IO_GX_GPU_GP1, this, GxGpu.readStatusThunk);
		this.memory.mapIoWrite(IO_GX_GPU_GP1, this, GxGpu.writeGp1Thunk);
		this.memory.mapIoWriteReady(IO_GX_GPU_GP1, GxGpu.gp1WriteReadyThunk);
		for (let index = 0; index < GX_GPU_PCRTC_WORD_COUNT; index += 1) {
			const address = gxGpuPcrtcRegisterAddress(index);
			this.memory.mapIoRead(address, this, GxGpu.readPcrtcThunk);
			this.memory.mapIoWrite(address, this, GxGpu.writePcrtcThunk);
		}
	}

	public reset(): void {
		this.deviceServiceDeadlineCycle = -1;
		this.pcrtc.reset(this.scheduler.currentNowCycles());
		this.pcrtcTimingPublicationPending = true;
		this.vramYAddressExtensionWord = 0;
		this.gpuReadWord = 0;
		this.commandBuffer.reset();
		initializeGxGpuVramPowerOn(this.vramSnapshotBytes);
		this.publishVramSnapshotRevision();
		this.publishVramReplacementRevision();
		this.clearGp0CommandState();
		this.scanoutInterlacedField = 0;
		this.scanoutInterlacedDisplayField = 0;
		this.scanoutActiveLineLsb = 0;
		this.resetGpuRegisters();
		this.latchPresentationRegisters();
		this.pcrtcPresentationPending = true;
		this.m_lastFrameCommitted = false;
		this.vramPresentationPending = false;
		this.supervisorQuiesceRequested = false;
		this.supervisorIngressQuiesceRequested = false;
		this.supervisorIngressStopped = false;
		this.clearRegisterContext(this.userContext);
		this.clearIngressContext(this.userIngressContext);
		this.rescheduleDeviceService(true);
	}

	private clearRegisterContext(context: GxGpuRegisterContextState): void {
		context.gp0Word = 0;
		context.gp1Word = 0;
		context.displayModeWord = GX_GPU_RESET_DISPLAY_MODE_WORD;
		context.statusWord = GX_GPU_STATUS_RESET_WORD;
		context.gpuReadWord = 0;
		context.drawModeWord = 0;
		context.textureWindowWord = 0;
		context.drawingAreaTopLeftWord = 0;
		context.drawingAreaBottomRightWord = 0;
		context.drawingOffsetWord = 0;
		context.maskBitModeWord = 0;
		context.displayStartWord = 0;
		context.horizontalDisplayRangeWord = GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD;
		context.verticalDisplayRangeWord = GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD;
		context.vramYAddressExtensionWord = 0;
		context.presentStatusWord = GX_GPU_STATUS_RESET_WORD;
		context.presentDisplayModeWord = GX_GPU_RESET_DISPLAY_MODE_WORD;
		context.presentDisplayStartWord = 0;
		context.presentVramYAddressExtensionWord = 0;
		context.presentHorizontalDisplayRangeWord = GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD;
		context.presentVerticalDisplayRangeWord = GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD;
		context.pcrtcRegisterWords.fill(0);
		context.pcrtcPresentWords.fill(0);
		context.vramPresentationPending = false;
	}

	private copyRegisterContext(target: GxGpuRegisterContextState, source: GxGpuRegisterContextState): void {
		target.gp0Word = source.gp0Word >>> 0;
		target.gp1Word = source.gp1Word >>> 0;
		target.displayModeWord = source.displayModeWord >>> 0;
		target.statusWord = source.statusWord >>> 0;
		target.gpuReadWord = source.gpuReadWord >>> 0;
		target.drawModeWord = source.drawModeWord >>> 0;
		target.textureWindowWord = source.textureWindowWord >>> 0;
		target.drawingAreaTopLeftWord = source.drawingAreaTopLeftWord >>> 0;
		target.drawingAreaBottomRightWord = source.drawingAreaBottomRightWord >>> 0;
		target.drawingOffsetWord = source.drawingOffsetWord >>> 0;
		target.maskBitModeWord = source.maskBitModeWord >>> 0;
		target.displayStartWord = source.displayStartWord >>> 0;
		target.horizontalDisplayRangeWord = source.horizontalDisplayRangeWord >>> 0;
		target.verticalDisplayRangeWord = source.verticalDisplayRangeWord >>> 0;
		target.vramYAddressExtensionWord = source.vramYAddressExtensionWord >>> 0;
		target.presentStatusWord = source.presentStatusWord >>> 0;
		target.presentDisplayModeWord = source.presentDisplayModeWord >>> 0;
		target.presentDisplayStartWord = source.presentDisplayStartWord >>> 0;
		target.presentVramYAddressExtensionWord = source.presentVramYAddressExtensionWord >>> 0;
		target.presentHorizontalDisplayRangeWord = source.presentHorizontalDisplayRangeWord >>> 0;
		target.presentVerticalDisplayRangeWord = source.presentVerticalDisplayRangeWord >>> 0;
		for (let index = 0; index < target.pcrtcRegisterWords.length; index += 1) {
			target.pcrtcRegisterWords[index] = source.pcrtcRegisterWords[index]! >>> 0;
			target.pcrtcPresentWords[index] = source.pcrtcPresentWords[index]! >>> 0;
		}
		target.vramPresentationPending = source.vramPresentationPending;
	}

	private clearIngressContext(context: GxGpuIngressContextBank): void {
		context.gp0CommandTargetWordCount = 0;
		context.gp0CommandWordCount = 0;
		context.gp0IngressPhase = GX_GPU_GP0_INGRESS_COMMAND;
		context.gp0IngressWordsRemaining = 0;
		context.gp0IngressPolylineWordsPerVertex = 0;
		context.gp0IngressPolylinePayloadPhase = 0;
		context.gp0ImageLoadWordsRemaining = 0;
		context.gp0ImageLoadCommandWordStart = 0;
		context.gp0ImageLoadCommandWordCount = 0;
		context.gp0ImageLoadCommandOpcode = 0;
		context.gp0PolylineWordsPerVertex = 0;
		context.gp0PolylinePayloadPhase = 0;
		context.gp0PolylineCommandWordStart = 0;
		context.gp0PolylineCommandWordCount = 0;
		context.gp0PolylineCommandOpcode = 0;
		context.commandBufferWordCount = 0;
	}

	private storeLiveIngressContext(context: GxGpuIngressContextBank): void {
		context.gp0CommandTargetWordCount = this.gp0CommandTargetWordCount;
		context.gp0CommandWordCount = this.gp0CommandWordCount;
		for (let index = 0; index < this.gp0CommandWordCount; index += 1) {
			context.gp0CommandWords[index] = this.gp0CommandWords[index];
		}
		context.gp0IngressPhase = this.gp0IngressPhase;
		context.gp0IngressWordsRemaining = this.gp0IngressWordsRemaining;
		context.gp0IngressPolylineWordsPerVertex = this.gp0IngressPolylineWordsPerVertex;
		context.gp0IngressPolylinePayloadPhase = this.gp0IngressPolylinePayloadPhase;
		context.gp0ImageLoadWordsRemaining = this.gp0ImageLoadWordsRemaining;
		context.gp0ImageLoadCommandWordStart = this.gp0ImageLoadCommandWordStart;
		context.gp0ImageLoadCommandWordCount = this.gp0ImageLoadCommandWordCount;
		context.gp0ImageLoadCommandOpcode = this.gp0ImageLoadCommandOpcode;
		context.gp0PolylineWordsPerVertex = this.gp0PolylineWordsPerVertex;
		context.gp0PolylinePayloadPhase = this.gp0PolylinePayloadPhase;
		context.gp0PolylineCommandWordStart = this.gp0PolylineCommandWordStart;
		context.gp0PolylineCommandWordCount = this.gp0PolylineCommandWordCount;
		context.gp0PolylineCommandOpcode = this.gp0PolylineCommandOpcode;
		context.commandBufferWordCount = this.commandBuffer.wordCount;
		for (let index = 0; index < this.commandBuffer.wordCount; index += 1) {
			context.commandBufferWords[index] = this.commandBuffer.words[index];
		}
	}

	private loadLiveIngressContext(context: GxGpuIngressContextBank): void {
		this.gp0CommandWordCount = context.gp0CommandWordCount;
		this.gp0CommandTargetWordCount = context.gp0CommandTargetWordCount;
		for (let index = 0; index < context.gp0CommandWordCount; index += 1) {
			this.gp0CommandWords[index] = context.gp0CommandWords[index];
		}
		this.gp0IngressPhase = context.gp0IngressPhase;
		this.gp0IngressWordsRemaining = context.gp0IngressWordsRemaining;
		this.gp0IngressPolylineWordsPerVertex = context.gp0IngressPolylineWordsPerVertex;
		this.gp0IngressPolylinePayloadPhase = context.gp0IngressPolylinePayloadPhase;
		this.gp0ImageLoadWordsRemaining = context.gp0ImageLoadWordsRemaining;
		this.gp0ImageLoadCommandWordStart = context.gp0ImageLoadCommandWordStart;
		this.gp0ImageLoadCommandWordCount = context.gp0ImageLoadCommandWordCount;
		this.gp0ImageLoadCommandOpcode = context.gp0ImageLoadCommandOpcode;
		this.gp0PolylineWordsPerVertex = context.gp0PolylineWordsPerVertex;
		this.gp0PolylinePayloadPhase = context.gp0PolylinePayloadPhase;
		this.gp0PolylineCommandWordStart = context.gp0PolylineCommandWordStart;
		this.gp0PolylineCommandWordCount = context.gp0PolylineCommandWordCount;
		this.gp0PolylineCommandOpcode = context.gp0PolylineCommandOpcode;
		this.commandBuffer.wordCount = context.commandBufferWordCount;
		for (let index = 0; index < context.commandBufferWordCount; index += 1) {
			this.commandBuffer.words[index] = context.commandBufferWords[index];
		}
	}

	private captureIngressContext(context: GxGpuIngressContextBank): GxGpuIngressContextState {
		return {
			gp0CommandTargetWordCount: context.gp0CommandTargetWordCount,
			gp0CommandWords: Array.from(context.gp0CommandWords.subarray(0, context.gp0CommandWordCount)),
			gp0IngressPhase: context.gp0IngressPhase,
			gp0IngressWordsRemaining: context.gp0IngressWordsRemaining,
			gp0IngressPolylineWordsPerVertex: context.gp0IngressPolylineWordsPerVertex,
			gp0IngressPolylinePayloadPhase: context.gp0IngressPolylinePayloadPhase,
			gp0ImageLoadWordsRemaining: context.gp0ImageLoadWordsRemaining,
			gp0ImageLoadCommandWordStart: context.gp0ImageLoadCommandWordStart,
			gp0ImageLoadCommandWordCount: context.gp0ImageLoadCommandWordCount,
			gp0ImageLoadCommandOpcode: context.gp0ImageLoadCommandOpcode,
			gp0PolylineWordsPerVertex: context.gp0PolylineWordsPerVertex,
			gp0PolylinePayloadPhase: context.gp0PolylinePayloadPhase,
			gp0PolylineCommandWordStart: context.gp0PolylineCommandWordStart,
			gp0PolylineCommandWordCount: context.gp0PolylineCommandWordCount,
			gp0PolylineCommandOpcode: context.gp0PolylineCommandOpcode,
			commandBufferWords: Array.from(context.commandBufferWords.subarray(0, context.commandBufferWordCount)),
		};
	}

	private restoreIngressContext(context: GxGpuIngressContextBank, state: GxGpuIngressContextState): void {
		context.gp0CommandTargetWordCount = state.gp0CommandTargetWordCount;
		context.gp0CommandWordCount = state.gp0CommandWords.length;
		context.gp0CommandWords.set(state.gp0CommandWords);
		context.gp0IngressPhase = state.gp0IngressPhase;
		context.gp0IngressWordsRemaining = state.gp0IngressWordsRemaining;
		context.gp0IngressPolylineWordsPerVertex = state.gp0IngressPolylineWordsPerVertex;
		context.gp0IngressPolylinePayloadPhase = state.gp0IngressPolylinePayloadPhase;
		context.gp0ImageLoadWordsRemaining = state.gp0ImageLoadWordsRemaining;
		context.gp0ImageLoadCommandWordStart = state.gp0ImageLoadCommandWordStart;
		context.gp0ImageLoadCommandWordCount = state.gp0ImageLoadCommandWordCount;
		context.gp0ImageLoadCommandOpcode = state.gp0ImageLoadCommandOpcode;
		context.gp0PolylineWordsPerVertex = state.gp0PolylineWordsPerVertex;
		context.gp0PolylinePayloadPhase = state.gp0PolylinePayloadPhase;
		context.gp0PolylineCommandWordStart = state.gp0PolylineCommandWordStart;
		context.gp0PolylineCommandWordCount = state.gp0PolylineCommandWordCount;
		context.gp0PolylineCommandOpcode = state.gp0PolylineCommandOpcode;
		context.commandBufferWordCount = state.commandBufferWords.length;
		context.commandBufferWords.set(state.commandBufferWords);
	}

	private storeLiveRegisterContext(context: GxGpuRegisterContextState): void {
		context.gp0Word = this.gp0Word;
		context.gp1Word = this.gp1Word;
		context.displayModeWord = this.displayModeWord;
		context.statusWord = this.statusWord;
		context.gpuReadWord = this.gpuReadWord;
		context.drawModeWord = this.drawModeWord;
		context.textureWindowWord = this.textureWindowWord;
		context.drawingAreaTopLeftWord = this.drawingAreaTopLeftWord;
		context.drawingAreaBottomRightWord = this.drawingAreaBottomRightWord;
		context.drawingOffsetWord = this.drawingOffsetWord;
		context.maskBitModeWord = this.maskBitModeWord;
		context.displayStartWord = this.displayStartWord;
		context.horizontalDisplayRangeWord = this.horizontalDisplayRangeWord;
		context.verticalDisplayRangeWord = this.verticalDisplayRangeWord;
		context.vramYAddressExtensionWord = this.vramYAddressExtensionWord;
		context.presentStatusWord = this.presentStatusWord;
		context.presentDisplayModeWord = this.presentDisplayModeWord;
		context.presentDisplayStartWord = this.presentDisplayStartWord;
		context.presentVramYAddressExtensionWord = this.presentVramYAddressExtensionWord;
		context.presentHorizontalDisplayRangeWord = this.presentHorizontalDisplayRangeWord;
		context.presentVerticalDisplayRangeWord = this.presentVerticalDisplayRangeWord;
		this.pcrtc.captureContext(context.pcrtcRegisterWords, context.pcrtcPresentWords);
		context.vramPresentationPending = this.vramPresentationPending;
	}

	private loadLiveRegisterContext(context: GxGpuRegisterContextState): void {
		this.commandBuffer.readback.setDmaReadEnabled(false);
		this.gp0Word = context.gp0Word;
		this.gp1Word = context.gp1Word;
		this.displayModeWord = context.displayModeWord;
		this.statusWord = context.statusWord;
		this.gpuReadWord = context.gpuReadWord;
		this.drawModeWord = context.drawModeWord;
		this.textureWindowWord = context.textureWindowWord;
		this.drawingAreaTopLeftWord = context.drawingAreaTopLeftWord;
		this.drawingAreaBottomRightWord = context.drawingAreaBottomRightWord;
		this.drawingOffsetWord = context.drawingOffsetWord;
		this.maskBitModeWord = context.maskBitModeWord;
		this.displayStartWord = context.displayStartWord;
		this.horizontalDisplayRangeWord = context.horizontalDisplayRangeWord;
		this.verticalDisplayRangeWord = context.verticalDisplayRangeWord;
		this.vramYAddressExtensionWord = context.vramYAddressExtensionWord;
		this.presentStatusWord = context.presentStatusWord;
		this.presentDisplayModeWord = context.presentDisplayModeWord;
		this.presentDisplayStartWord = context.presentDisplayStartWord;
		this.presentVramYAddressExtensionWord = context.presentVramYAddressExtensionWord;
		this.presentHorizontalDisplayRangeWord = context.presentHorizontalDisplayRangeWord;
		this.presentVerticalDisplayRangeWord = context.presentVerticalDisplayRangeWord;
		this.pcrtc.restoreContext(
			context.pcrtcRegisterWords,
			context.pcrtcPresentWords,
		);
		this.vramPresentationPending = context.vramPresentationPending;
		this.updateScanoutStatusBits();
		this.memory.writeIoU32(IO_GX_GPU_GP0, this.gp0Word);
		this.writeStatusIo();
		if (((this.statusWord & GX_GPU_STATUS_DMA_DIRECTION_MASK) >>> GX_GPU_STATUS_DMA_DIRECTION_SHIFT)
			=== GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU) {
			this.commandBuffer.readback.setDmaReadEnabled(true);
		}
	}

	private resetTransientContext(): void {
		this.commandBuffer.reset();
		this.clearGp0CommandState();
		this.gpuReadWord = 0;
		this.vramYAddressExtensionWord = 0;
		this.scanoutInterlacedField = 0;
		this.scanoutInterlacedDisplayField = 0;
		this.scanoutActiveLineLsb = 0;
		this.resetGpuRegisters();
		this.latchPresentationRegisters();
		this.m_lastFrameCommitted = false;
		this.vramPresentationPending = false;
	}

	private latchPresentationRegisters(): void {
		this.presentStatusWord = this.statusWord;
		this.presentDisplayModeWord = this.displayModeWord;
		this.presentDisplayStartWord = this.displayStartWord;
		this.presentVramYAddressExtensionWord = this.vramYAddressExtensionWord;
		this.presentHorizontalDisplayRangeWord = this.horizontalDisplayRangeWord;
		this.presentVerticalDisplayRangeWord = this.verticalDisplayRangeWord;
	}

	private resetGpuRegisters(): void {
		this.gp0Word = 0;
		this.gp1Word = 0;
		this.displayModeWord = GX_GPU_RESET_DISPLAY_MODE_WORD;
		this.statusWord = GX_GPU_STATUS_RESET_WORD;
		this.commandBuffer.readback.setDmaReadEnabled(false);
		this.drawModeWord = 0;
		this.textureWindowWord = 0;
		this.drawingAreaTopLeftWord = 0;
		this.drawingAreaBottomRightWord = 0;
		this.drawingOffsetWord = 0;
		this.maskBitModeWord = 0;
		this.displayStartWord = 0;
		this.horizontalDisplayRangeWord = GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD;
		this.verticalDisplayRangeWord = GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD;
		this.updateDisplayModeStatusBits();
		this.memory.writeIoU32(IO_GX_GPU_GP0, this.gpuReadWord);
		this.writeStatusIo();
	}

	public captureState(): GxGpuState {
		const nowCycles = this.scheduler.currentNowCycles();
		this.synchronizeCommandTiming(nowCycles);
		this.updateDynamicStatusBits();
		return {
			gp0Word: this.gp0Word,
			gp1Word: this.gp1Word,
			displayModeWord: this.displayModeWord,
			statusWord: this.statusWord,
			gp0CommandWordCount: this.gp0CommandWordCount,
			gp0CommandTargetWordCount: this.gp0CommandTargetWordCount,
			gp0CommandWords: Array.from(this.gp0CommandWords.subarray(0, this.gp0CommandWordCount)),
			gp0FifoWords: this.gp0Fifo.captureWords(),
			gp0DmaIngressWords: this.gp0DmaIngress.captureWords(),
			gp0IngressPhase: this.gp0IngressPhase,
			gp0IngressWordsRemaining: this.gp0IngressWordsRemaining,
			gp0IngressPolylineWordsPerVertex: this.gp0IngressPolylineWordsPerVertex,
			gp0IngressPolylinePayloadPhase: this.gp0IngressPolylinePayloadPhase,
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
			vramYAddressExtensionWord: this.vramYAddressExtensionWord,
			presentStatusWord: this.presentStatusWord,
			presentDisplayModeWord: this.presentDisplayModeWord,
			presentDisplayStartWord: this.presentDisplayStartWord,
			presentVramYAddressExtensionWord: this.presentVramYAddressExtensionWord,
			presentHorizontalDisplayRangeWord: this.presentHorizontalDisplayRangeWord,
			presentVerticalDisplayRangeWord: this.presentVerticalDisplayRangeWord,
			pcrtc: this.pcrtc.captureState(nowCycles),
			pcrtcPresentationPending: this.pcrtcPresentationPending,
			vramPresentationPending: this.vramPresentationPending,
			supervisorQuiesceRequested: this.supervisorQuiesceRequested,
			supervisorIngressQuiesceRequested: this.supervisorIngressQuiesceRequested,
			supervisorIngressStopped: this.supervisorIngressStopped,
			userContext: {
				...this.userContext,
				pcrtcRegisterWords: this.userContext.pcrtcRegisterWords.slice(),
				pcrtcPresentWords: this.userContext.pcrtcPresentWords.slice(),
			},
			userIngressContext: this.captureIngressContext(this.userIngressContext),
			commandBuffer: this.commandBuffer.captureState(),
		};
	}

	public restoreState(state: GxGpuState): void {
		this.commandBuffer.readback.setDmaReadEnabled(false);
		this.gp0Word = state.gp0Word >>> 0;
		this.gp1Word = state.gp1Word >>> 0;
		this.displayModeWord = state.displayModeWord >>> 0;
		this.statusWord = state.statusWord >>> 0;
		this.gp0CommandWordCount = state.gp0CommandWordCount >>> 0;
		this.gp0CommandTargetWordCount = state.gp0CommandTargetWordCount >>> 0;
		this.gp0CommandWords.set(state.gp0CommandWords, 0);
		this.gp0Fifo.restoreWords(state.gp0FifoWords);
		this.gp0DmaIngress.restoreWords(state.gp0DmaIngressWords);
		this.gp0IngressPhase = state.gp0IngressPhase >>> 0;
		this.gp0IngressWordsRemaining = state.gp0IngressWordsRemaining >>> 0;
		this.gp0IngressPolylineWordsPerVertex = state.gp0IngressPolylineWordsPerVertex >>> 0;
		this.gp0IngressPolylinePayloadPhase = state.gp0IngressPolylinePayloadPhase >>> 0;
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
		this.vramYAddressExtensionWord = state.vramYAddressExtensionWord >>> 0;
		this.presentStatusWord = state.presentStatusWord >>> 0;
		this.presentDisplayModeWord = state.presentDisplayModeWord >>> 0;
		this.presentDisplayStartWord = state.presentDisplayStartWord >>> 0;
		this.presentVramYAddressExtensionWord = state.presentVramYAddressExtensionWord >>> 0;
		this.presentHorizontalDisplayRangeWord = state.presentHorizontalDisplayRangeWord >>> 0;
		this.presentVerticalDisplayRangeWord = state.presentVerticalDisplayRangeWord >>> 0;
		this.pcrtc.restoreState(state.pcrtc, this.scheduler.currentNowCycles());
		this.pcrtcPresentationPending = state.pcrtcPresentationPending;
		this.vramPresentationPending = state.vramPresentationPending;
		this.supervisorQuiesceRequested = state.supervisorQuiesceRequested;
		this.supervisorIngressQuiesceRequested = state.supervisorIngressQuiesceRequested;
		this.supervisorIngressStopped = state.supervisorIngressStopped;
		this.copyRegisterContext(this.userContext, state.userContext);
		this.restoreIngressContext(this.userIngressContext, state.userIngressContext);
		this.commandBuffer.restoreState(state.commandBuffer);
		this.m_lastFrameCommitted = false;
		this.rescheduleDeviceService(true);
		this.updateScanoutStatusBits();
		this.memory.writeIoU32(IO_GX_GPU_GP0, this.gp0Word);
		this.writeStatusIo();
		if (((this.statusWord & GX_GPU_STATUS_DMA_DIRECTION_MASK) >>> GX_GPU_STATUS_DMA_DIRECTION_SHIFT)
			=== GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU) {
			this.commandBuffer.readback.setDmaReadEnabled(true);
		}
	}

	public beginSupervisorControlQuiesce(): void {
		this.supervisorQuiesceRequested = true;
		this.updateDynamicStatusBits();
	}

	public beginSupervisorQuiesce(): void {
		this.supervisorQuiesceRequested = true;
		this.supervisorIngressQuiesceRequested = true;
		if (!this.dmaController.hasAdmittedWriteBlock(IO_GX_GPU_GP0)) {
			this.supervisorIngressStopped = true;
		}
		this.updateDynamicStatusBits();
		this.notifySupervisorBoundary();
	}

	public supervisorQuiescent(): boolean {
		this.synchronizeCommandTiming(this.scheduler.currentNowCycles());
		if (this.supervisorIngressQuiesceRequested
			&& !this.supervisorIngressStopped
			&& !this.dmaController.hasAdmittedWriteBlock(IO_GX_GPU_GP0)) {
			this.supervisorIngressStopped = true;
			this.updateDynamicStatusBits();
		}
		return this.supervisorFenceReady();
	}

	private supervisorFenceReady(): boolean {
		return this.supervisorIngressQuiesceRequested
			&& this.supervisorIngressStopped
			&& this.pendingCommandCompletionCycle === 0
			&& this.gp0DmaIngress.empty()
			&& this.gp0Fifo.empty()
			&& this.commandBuffer.readback.phase === GX_GPU_READBACK_IDLE
			&& this.commandBuffer.commandCount === 0;
	}

	public enterSupervisorContext(): void {
		this.updateScanoutStatusBits();
		this.updateDynamicStatusBits();
		this.storeLiveRegisterContext(this.userContext);
		this.storeLiveIngressContext(this.userIngressContext);
		this.supervisorQuiesceRequested = false;
		this.supervisorIngressQuiesceRequested = false;
		this.supervisorIngressStopped = false;
		this.resetTransientContext();
		this.pcrtc.enterSupervisorContext(this.userContext.pcrtcPresentWords);
		this.pcrtcPresentationPending = true;
	}

	public leaveSupervisorContext(): void {
		this.supervisorQuiesceRequested = false;
		this.supervisorIngressQuiesceRequested = false;
		this.supervisorIngressStopped = false;
		this.resetTransientContext();
		this.loadLiveIngressContext(this.userIngressContext);
		this.loadLiveRegisterContext(this.userContext);
		this.pcrtcPresentationPending = true;
		this.clearRegisterContext(this.userContext);
		this.clearIngressContext(this.userIngressContext);
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
		this.publishVramReplacementRevision();
		this.vramPresentationPending = true;
	}

	public commitRenderedVramSnapshotBytes(bytes: Uint8Array, renderedCommandCount: number): bigint {
		this.vramSnapshotBytes.set(bytes);
		this.publishVramSnapshotRevision();
		if (renderedCommandCount !== 0) {
			this.retireCommandPrefix(renderedCommandCount);
			this.vramPresentationPending = true;
		}
		this.notifySupervisorBoundary();
		return this.vramSnapshotSerial;
	}

	private publishVramSnapshotRevision(): void {
		gxGpuNextVramSnapshotSerial = BigInt.asUintN(64, gxGpuNextVramSnapshotSerial + 1n);
		this.vramSnapshotSerial = gxGpuNextVramSnapshotSerial;
	}

	private publishVramReplacementRevision(): void {
		gxGpuNextVramReplacementSerial = BigInt.asUintN(64, gxGpuNextVramReplacementSerial + 1n);
		this.vramReplacementSerial = gxGpuNextVramReplacementSerial;
	}

	public readVramSnapshotBytes(): Uint8Array {
		return this.vramSnapshotBytes;
	}

	public readVramSnapshotSerial(): bigint {
		return this.vramSnapshotSerial;
	}

	public readVramReplacementSerial(): bigint {
		return this.vramReplacementSerial;
	}

	public readGp0(busSignals: MappedBusSignals = MAPPED_BUS_MASTER_CPU): number {
		const nowCycles = this.scheduler.currentNowCycles();
		this.synchronizeCommandTiming(nowCycles);
		const dmaRead = (busSignals & MAPPED_BUS_MASTER_DMA) !== 0;
		if ((dmaRead || !this.dmaController.ownsReadPort(IO_GX_GPU_GP0))
			&& this.commandBuffer.readback.phase === GX_GPU_READBACK_READY) {
			this.gpuReadWord = this.commandBuffer.readback.readWord();
			this.processGp0Pipeline(nowCycles);
			this.memory.writeIoU32(IO_GX_GPU_GP0, this.gpuReadWord);
		}
		this.updateDynamicStatusBits();
		this.notifySupervisorBoundary();
		return this.gpuReadWord;
	}

	public writeGp0(word: number, busSignals: MappedBusSignals = MAPPED_BUS_MASTER_CPU): void {
		const dmaWrite = (busSignals & MAPPED_BUS_MASTER_DMA) !== 0;
		if (dmaWrite) {
			this.gp0Word = word >>> 0;
			if (!this.gp0DmaIngress.full()) {
				this.gp0DmaIngress.writeWord(this.gp0Word);
			}
			if ((busSignals & MAPPED_BUS_DMA_BLOCK_END) === 0) {
				return;
			}
		}
		const nowCycles = this.scheduler.currentNowCycles();
		this.synchronizeCommandTiming(nowCycles);
		if (!dmaWrite) {
			this.gp0Word = word >>> 0;
			this.acceptGp0Word(this.gp0Word);
		}
		this.memory.writeIoU32(IO_GX_GPU_GP0, this.gp0Word);
		this.processGp0Pipeline(nowCycles);
		if (this.supervisorIngressQuiesceRequested
			&& this.gp0IngressPhase === GX_GPU_GP0_INGRESS_COMMAND
			&& !this.dmaController.hasAdmittedWriteBlock(IO_GX_GPU_GP0)) {
			this.supervisorIngressStopped = true;
		}
		this.updateDynamicStatusBits();
		this.notifySupervisorBoundary();
	}

	private acceptGp0Word(word: number): boolean {
		const phase = this.gp0IngressPhase;
		const opcode = word >>> GX_GPU_GP0_OPCODE_SHIFT;
		if (phase === GX_GPU_GP0_INGRESS_COMMAND) {
			if (gxGpuGp0OpcodeIsNop(opcode)) {
				return true;
			}
		}
		if (this.gp0Fifo.full()) {
			return false;
		}
		this.gp0Fifo.writeWord(word);
		switch (phase) {
			case GX_GPU_GP0_INGRESS_COMMAND:
				if (opcode >= GX_GPU_GP0_CPU_TO_VRAM_FIRST && opcode <= GX_GPU_GP0_CPU_TO_VRAM_LAST) {
					this.gp0IngressPhase = GX_GPU_GP0_INGRESS_IMAGE_HEADER;
					this.gp0IngressWordsRemaining = 2;
					return true;
				}
				if (opcode >= GX_GPU_GP0_LINE_FIRST
					&& opcode <= GX_GPU_GP0_LINE_LAST
					&& (opcode & GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT) !== 0) {
					this.gp0IngressPhase = GX_GPU_GP0_INGRESS_POLYLINE_HEADER;
					this.gp0IngressWordsRemaining = this.gp0LineWordCount(opcode) - 1;
					this.gp0IngressPolylineWordsPerVertex = (opcode & GX_GPU_GP0_RENDER_GOURAUD_BIT) !== 0 ? 2 : 1;
					this.gp0IngressPolylinePayloadPhase = 0;
					return true;
				}
				this.gp0IngressWordsRemaining = this.gp0CommandWordCountForOpcode(opcode) - 1;
				if (this.gp0IngressWordsRemaining !== 0) {
					this.gp0IngressPhase = GX_GPU_GP0_INGRESS_FIXED;
				}
				return true;
			case GX_GPU_GP0_INGRESS_FIXED:
				this.gp0IngressWordsRemaining -= 1;
				if (this.gp0IngressWordsRemaining === 0) {
					this.gp0IngressPhase = GX_GPU_GP0_INGRESS_COMMAND;
				}
				return true;
			case GX_GPU_GP0_INGRESS_IMAGE_HEADER:
				this.gp0IngressWordsRemaining -= 1;
				if (this.gp0IngressWordsRemaining === 0) {
					this.gp0IngressPhase = GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD;
					this.gp0IngressWordsRemaining = ((gxGpuTransferWidth(word) * gxGpuTransferHeight(word)) + 1) >>> 1;
				}
				return true;
			case GX_GPU_GP0_INGRESS_IMAGE_PAYLOAD:
				this.gp0IngressWordsRemaining -= 1;
				if (this.gp0IngressWordsRemaining === 0) {
					this.gp0IngressPhase = GX_GPU_GP0_INGRESS_COMMAND;
				}
				return true;
			case GX_GPU_GP0_INGRESS_POLYLINE_HEADER:
				this.gp0IngressWordsRemaining -= 1;
				if (this.gp0IngressWordsRemaining === 0) {
					this.gp0IngressPhase = GX_GPU_GP0_INGRESS_POLYLINE_PAYLOAD;
				}
				return true;
			case GX_GPU_GP0_INGRESS_POLYLINE_PAYLOAD:
				if (this.gp0IngressPolylinePayloadPhase === 0 && (word & 0xf000f000) === 0x50005000) {
					this.gp0IngressPhase = GX_GPU_GP0_INGRESS_COMMAND;
					this.gp0IngressPolylineWordsPerVertex = 0;
					this.gp0IngressPolylinePayloadPhase = 0;
					return true;
				}
				this.gp0IngressPolylinePayloadPhase += 1;
				if (this.gp0IngressPolylinePayloadPhase === this.gp0IngressPolylineWordsPerVertex) {
					this.gp0IngressPolylinePayloadPhase = 0;
				}
				return true;
		}
	}

	private processGp0Pipeline(nowCycles: number): void {
		while (true) {
			this.processGp0Fifo(nowCycles);
			let ingressAdvanced = false;
			while (!this.gp0DmaIngress.empty() && this.acceptGp0Word(this.gp0DmaIngress.peek())) {
				this.gp0DmaIngress.pop();
				ingressAdvanced = true;
			}
			if (!ingressAdvanced) return;
		}
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
		this.rescheduleDeviceService();
	}

	private synchronizeCommandTiming(nowCycles: number): void {
		let completed = false;
		while (this.pendingCommandCompletionCycle !== 0 && nowCycles >= this.pendingCommandCompletionCycle) {
			const completionCycle = this.pendingCommandCompletionCycle;
			const completedCommandCount = this.pendingCommandTargetCount;
			this.pendingCommandCompletionCycle = 0;
			this.pendingCommandTargetCount = 0;
			if (completedCommandCount > this.commandBuffer.executedCommandCount) {
				this.commandBuffer.completeCommandExecution(completedCommandCount);
			}
			if (this.commandBuffer.readback.phase === GX_GPU_READBACK_IDLE) {
				this.processGp0Pipeline(completionCycle);
			}
			completed = true;
		}
		if (completed) {
			this.rescheduleDeviceService();
			this.notifySupervisorBoundary();
		}
	}

	private rescheduleDeviceService(force = false): void {
		let deadline = this.pendingCommandCompletionCycle === 0 ? -1 : this.pendingCommandCompletionCycle;
		if (this.pcrtcTimingPublicationPending) {
			deadline = this.scheduler.currentNowCycles();
		} else {
			const pcrtcDeadline = this.pcrtc.nextDeadlineCycle();
			if (pcrtcDeadline >= 0 && (deadline < 0 || pcrtcDeadline < deadline)) {
				deadline = pcrtcDeadline;
			}
		}
		if (!force && deadline === this.deviceServiceDeadlineCycle) return;
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_GPU);
		this.deviceServiceDeadlineCycle = deadline;
		if (deadline >= 0) this.scheduler.scheduleDeviceService(DEVICE_SERVICE_GPU, deadline);
	}

	public onService(nowCycles: number): number {
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_GPU);
		this.deviceServiceDeadlineCycle = -1;
		let timingPublished = this.pcrtcTimingPublicationPending;
		this.pcrtcTimingPublicationPending = false;
		this.synchronizeCommandTiming(nowCycles);
		let runtimeEdge = GX_GPU_PCRTC_RUNTIME_EDGE_NONE;
		const pcrtcDeadline = this.pcrtc.nextDeadlineCycle();
		if (pcrtcDeadline >= 0 && pcrtcDeadline <= nowCycles) {
			const serviceResult = this.pcrtc.service(nowCycles);
			if ((serviceResult & GX_GPU_PCRTC_SERVICE_IRQ) !== 0) this.irq.raise(IRQ_GX_PCRTC);
			runtimeEdge = serviceResult & GX_GPU_PCRTC_SERVICE_RUNTIME_EDGE_MASK;
		}
		this.rescheduleDeviceService();
		this.updateDynamicStatusBits();
		this.memory.writeIoU32(IO_GX_GPU_GP1, this.statusWord);
		if (runtimeEdge === GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN) timingPublished = true;
		return runtimeEdge | (timingPublished ? GX_GPU_SERVICE_TIMING_PUBLISHED : 0);
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
		const opcode = command >>> GX_GPU_GP1_OPCODE_SHIFT;
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
			case GX_GPU_GP1_VRAM_Y_ADDRESS_EXTENSION:
				this.vramYAddressExtensionWord = command & 0x1;
				this.updateScanoutStatusBits();
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

	private writePcrtcRegister(index: number, word: number): void {
		const nowCycles = this.scheduler.currentNowCycles();
		if (index < GX_GPU_PCRTC_CONFIG_WORD_COUNT) {
			if (this.pcrtc.writeConfigWord(index, word, nowCycles)) {
				this.pcrtcTimingPublicationPending = true;
				this.rescheduleDeviceService(true);
			}
			return;
		}
		if (index === GX_GPU_PCRTC_CSR_LOW) {
			const actions = this.pcrtc.writeCsr(word, nowCycles);
			if ((actions & GX_GPU_PCRTC_CSR_RESET) !== 0) {
				this.clearGp0Fifo(nowCycles);
				this.resetGpuRegisters();
				this.pcrtc.reset(nowCycles);
				this.pcrtcTimingPublicationPending = true;
				this.latchPresentationRegisters();
				this.pcrtcPresentationPending = true;
			} else if ((actions & GX_GPU_PCRTC_CSR_FLUSH) !== 0) {
				this.clearGp0Fifo(nowCycles);
			}
			this.rescheduleDeviceService(true);
			return;
		}
		if (index === GX_GPU_PCRTC_IMR_LOW && this.pcrtc.writeImr(word)) {
			this.irq.raise(IRQ_GX_PCRTC);
		}
	}

	public readDisplayModeWord(): number {
		return this.displayModeWord;
	}

	public writeDisplayModeWord(word: number): void {
		this.displayModeWord = word >>> 0;
		this.updateDisplayModeStatusBits();
		this.writeStatusIo();
	}

	public setTiming(cpuHz: number, nowCycles: number): void {
		if (!this.pcrtc.setCpuHz(cpuHz, nowCycles)) return;
		this.pcrtcTimingPublicationPending = true;
		this.rescheduleDeviceService(true);
		this.updateScanoutStatusBits();
		this.writeStatusIo();
	}

	public readGpuReadWord(): number {
		return this.gpuReadWord;
	}

	public readPcrtcTiming(): GxGpuPcrtcTiming {
		return this.pcrtc.timing;
	}

	public readDeviceOutput(): GxGpuDeviceOutput {
		this.synchronizeCommandTiming(this.scheduler.currentNowCycles());
		this.updateScanoutStatusBits();
		this.updateDynamicStatusBits();
		this.deviceOutput.statusWord = this.presentStatusWord;
		this.deviceOutput.displayModeWord = this.presentDisplayModeWord;
		this.deviceOutput.displayStartWord = this.presentDisplayStartWord;
		this.deviceOutput.vramYAddressExtensionWord = this.presentVramYAddressExtensionWord;
		this.deviceOutput.horizontalDisplayRangeWord = this.presentHorizontalDisplayRangeWord;
		this.deviceOutput.verticalDisplayRangeWord = this.presentVerticalDisplayRangeWord;
		this.deviceOutput.vramSnapshotSerial = this.vramSnapshotSerial;
		this.deviceOutput.vramReplacementSerial = this.vramReplacementSerial;
		return this.deviceOutput;
	}

	public backendCommandDrainPending(): boolean {
		return this.commandBuffer.readback.phase === GX_GPU_READBACK_IDLE
			&& this.commandBuffer.commandCount === GX_GPU_COMMAND_CAPACITY;
	}

	public backendServicePending(): boolean {
		const phase = this.commandBuffer.readback.phase;
		if (phase === GX_GPU_READBACK_IDLE) {
			return this.commandBuffer.commandCount === GX_GPU_COMMAND_CAPACITY;
		}
		return phase === GX_GPU_READBACK_PENDING;
	}

	public backendServiceBlocksMachine(): boolean {
		const phase = this.commandBuffer.readback.phase;
		if (phase === GX_GPU_READBACK_IDLE) {
			return this.commandBuffer.commandCount === GX_GPU_COMMAND_CAPACITY;
		}
		return phase === GX_GPU_READBACK_PENDING || phase === GX_GPU_READBACK_SUBMITTED;
	}

	public presentReadyFrameOnVblankEdge(): void {
		this.synchronizeCommandTiming(this.scheduler.currentNowCycles());
		this.updateScanoutStatusBits();
		this.updateDynamicStatusBits();
		// A field edge exposes the other retained scanout field even when no GP0 work completed.
		const visibleStatusMask = GX_GPU_STATUS_DISPLAY_DISABLE | GX_GPU_STATUS_INTERLACED_FIELD;
		const visibleStatusWord = this.statusWord & visibleStatusMask;
		const pcrtcChanged = this.pcrtc.latchPresentationWords();
		const scanoutStateChanged = (this.presentStatusWord & visibleStatusMask) !== visibleStatusWord
			|| this.presentDisplayModeWord !== this.displayModeWord
			|| this.presentDisplayStartWord !== this.displayStartWord
			|| this.presentVramYAddressExtensionWord !== this.vramYAddressExtensionWord
			|| this.presentHorizontalDisplayRangeWord !== this.horizontalDisplayRangeWord
			|| this.presentVerticalDisplayRangeWord !== this.verticalDisplayRangeWord
			|| pcrtcChanged
			|| this.pcrtcPresentationPending;
		this.latchPresentationRegisters();
		this.commandBuffer.sealCommandsForPresentation();
		this.m_lastFrameCommitted = this.vramPresentationPending
			|| this.commandBuffer.hasUnretiredPresentCommands()
			|| scanoutStateChanged;
		this.pcrtcPresentationPending = false;
	}

	public lastFrameCommitted(): boolean {
		return this.m_lastFrameCommitted;
	}

	public retirePresentedCommands(): void {
		const retiredCommands = this.commandBuffer.presentCommandCount;
		this.retireCommandPrefix(retiredCommands);
		this.vramPresentationPending = false;
		this.notifySupervisorBoundary();
	}

	public retireExecutedCommands(): void {
		this.retireCommandPrefix(this.commandBuffer.executedCommandCount);
		this.vramPresentationPending = true;
		this.notifySupervisorBoundary();
	}

	private retireCommandPrefix(retiredCommands: number): void {
		const retiredWords = this.commandBuffer.retireCommandsPreservingVram(retiredCommands);
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

	public readVramYAddressExtensionWord(): number {
		return this.vramYAddressExtensionWord;
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
		this.gp0DmaIngress.reset();
		this.gp0Fifo.reset();
		this.clearGp0IngressState();
		this.pendingCommandCompletionCycle = 0;
		this.pendingCommandTargetCount = 0;
		this.gp0CommandWords.fill(0);
		this.gp0CommandWordCount = 0;
		this.gp0CommandTargetWordCount = 0;
		this.clearImageLoadState();
		this.clearPolylineState();
		this.rescheduleDeviceService();
	}

	private clearGp0Fifo(nowCycles: number): void {
		this.gp0DmaIngress.reset();
		this.gp0Fifo.reset();
		this.clearGp0IngressState();
		this.flushImageLoadToVram(nowCycles);
		if (this.gp0PolylineCommandWordCount !== 0) {
			this.commandBuffer.wordCount = this.gp0PolylineCommandWordStart;
		}
		this.commandBuffer.abortReadbackAndQueuedCommands();
		// GP1(01h) completes accepted raster/upload work, but not a C0 removed above.
		if (this.pendingCommandTargetCount > this.commandBuffer.executedCommandCount
			&& this.pendingCommandTargetCount <= this.commandBuffer.commandCount) {
			this.commandBuffer.completeCommandExecution(this.pendingCommandTargetCount);
		}
		this.pendingCommandCompletionCycle = 0;
		this.pendingCommandTargetCount = 0;
		this.gp0CommandWords.fill(0);
		this.gp0CommandWordCount = 0;
		this.gp0CommandTargetWordCount = 0;
		this.clearImageLoadState();
		this.clearPolylineState();
		this.rescheduleDeviceService();
	}

	private clearGp0IngressState(): void {
		this.gp0IngressPhase = GX_GPU_GP0_INGRESS_COMMAND;
		this.gp0IngressWordsRemaining = 0;
		this.gp0IngressPolylineWordsPerVertex = 0;
		this.gp0IngressPolylinePayloadPhase = 0;
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
		this.commandBuffer.pushCommand(
			kind,
			opcode,
			wordStart,
			commandWordCount,
			this.drawModeWord,
			this.vramYAddressExtensionWord,
			this.textureWindowWord,
			this.drawingAreaTopLeftWord,
			this.drawingAreaBottomRightWord,
			this.drawingOffsetWord,
			this.maskBitModeWord,
			this.skippedLineParity,
		);
		this.startCommandTiming(
			gxGpuCommandTicks(
				kind,
				opcode,
				this.commandBuffer.words,
				wordStart,
				commandWordCount,
				this.drawModeWord,
				this.vramYAddressExtensionWord,
				this.drawingAreaTopLeftWord,
				this.drawingAreaBottomRightWord,
				this.drawingOffsetWord,
				this.maskBitModeWord,
				this.skippedLineParity,
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
		this.updateDrawModeStatusBits();
		this.writeStatusIo();
	}

	private updateDrawModeStatusBits(): void {
		const texturePageYHigh = (this.drawModeWord & GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_HIGH) !== 0
			? GX_GPU_STATUS_TEXTURE_PAGE_Y_HIGH
			: 0;
		this.statusWord = ((this.statusWord & ~(GX_GPU_DRAW_MODE_GPUSTAT_MASK | GX_GPU_STATUS_TEXTURE_PAGE_Y_HIGH))
			| (this.drawModeWord & GX_GPU_DRAW_MODE_GPUSTAT_MASK)
			| texturePageYHigh) >>> 0;
		this.updateSkippedLineParity();
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
				this.gpuReadWord = GX_GPU_INFO_GPU_TYPE_V2;
				break;
			case 0x08:
				this.gpuReadWord = 0;
				break;
		}
		this.memory.writeIoU32(IO_GX_GPU_GP0, this.gpuReadWord);
		this.writeStatusIo();
	}

	private writeDmaDirectionWord(word: number): void {
		const previousDmaDirection = (this.statusWord & GX_GPU_STATUS_DMA_DIRECTION_MASK) >>> GX_GPU_STATUS_DMA_DIRECTION_SHIFT;
		const dmaDirection = word & 0x3;
		if (previousDmaDirection === GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU
			&& dmaDirection !== GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU) {
			this.commandBuffer.readback.setDmaReadEnabled(false);
		}
		const dmaDirectionBits = dmaDirection << GX_GPU_STATUS_DMA_DIRECTION_SHIFT;
		this.statusWord = ((this.statusWord & ~GX_GPU_STATUS_DMA_DIRECTION_MASK) | dmaDirectionBits) >>> 0;
		this.writeStatusIo();
		if (previousDmaDirection !== GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU
			&& dmaDirection === GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU) {
			this.commandBuffer.readback.setDmaReadEnabled(true);
		}
	}

	private updateCommandStatusBits(): void {
		let commandStatusBits = 0;
		const readbackIdle = this.commandBuffer.readback.phase === GX_GPU_READBACK_IDLE;
		const fifoWordCount = this.gp0Fifo.count();
		let readyToReceive = false;
		if (readbackIdle && !this.supervisorIngressStopped && this.gp0DmaIngress.empty()) {
			if (this.gp0ImageLoadWordsRemaining !== 0) {
				readyToReceive = fifoWordCount < GX_GPU_COMMAND_FIFO_WORD_CAPACITY;
			} else if (this.gp0PolylineWordsPerVertex !== 0) {
				readyToReceive = false;
			} else if (this.gp0CommandWordCount === 0 && fifoWordCount === 0) {
				readyToReceive = true;
			} else {
				const assemblingPacket = this.gp0CommandWordCount !== 0;
				const opcode = (assemblingPacket ? this.gp0CommandWords[0] : this.gp0Fifo.peek()) >>> GX_GPU_GP0_OPCODE_SHIFT;
				const packetWordCount = assemblingPacket ? this.gp0CommandWordCount : fifoWordCount;
				const packetTargetWordCount = assemblingPacket ? this.gp0CommandTargetWordCount : this.gp0CommandWordCountForOpcode(opcode);
				const polygonOrLinePacket = opcode >= GX_GPU_GP0_POLYGON_FIRST && opcode <= GX_GPU_GP0_LINE_LAST;
				readyToReceive = !polygonOrLinePacket && packetWordCount < packetTargetWordCount;
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
			&& this.gp0DmaIngress.empty()
			&& fifoWordCount === 0
			&& this.gp0CommandWordCount === 0
			&& this.gp0ImageLoadWordsRemaining === 0
			&& this.gp0PolylineWordsPerVertex === 0) {
			commandStatusBits |= GX_GPU_STATUS_GPU_IDLE;
		}
		this.statusWord = ((this.statusWord & ~GX_GPU_STATUS_COMMAND_STATE_MASK) | commandStatusBits) >>> 0;
		// CPU stores need one physical FIFO slot; DMA packet acceptance is a
		// separate, stricter GPUSTAT line while a command is being assembled.
		if (!this.supervisorIngressStopped
			&& this.gp0DmaIngress.empty()
			&& fifoWordCount < GX_GPU_COMMAND_FIFO_WORD_CAPACITY
			&& !this.dmaController.ownsWritePort(IO_GX_GPU_GP0)) {
			this.cpu.resumeMemoryWrite(IO_GX_GPU_GP0);
		}
	}

	private updateDynamicStatusBits(): void {
		this.updateCommandStatusBits();
		this.updateDmaRequestStatusBit();
	}

	private updateDmaRequestStatusBit(): void {
		const dmaDirection = (this.statusWord & GX_GPU_STATUS_DMA_DIRECTION_MASK) >>> GX_GPU_STATUS_DMA_DIRECTION_SHIFT;
		let dmaRequest = 0;
		if (dmaDirection === GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU) {
			dmaRequest = this.statusWord & GX_GPU_STATUS_READY_TO_SEND_VRAM;
		} else if (!this.supervisorIngressStopped) {
			switch (dmaDirection) {
				case GX_GPU_DMA_DIRECTION_FIFO:
					dmaRequest = this.gp0DmaIngress.empty()
						&& this.gp0Fifo.count() < GX_GPU_COMMAND_FIFO_WORD_CAPACITY
						? GX_GPU_STATUS_DMA_DATA_REQUEST
						: 0;
					break;
				case GX_GPU_DMA_DIRECTION_CPU_TO_GP0:
					dmaRequest = this.statusWord & GX_GPU_STATUS_READY_TO_RECEIVE_DMA;
					break;
			}
		}
		if (dmaRequest !== 0) {
			this.statusWord = (this.statusWord | GX_GPU_STATUS_DMA_DATA_REQUEST) >>> 0;
		} else {
			this.statusWord = (this.statusWord & ~GX_GPU_STATUS_DMA_DATA_REQUEST) >>> 0;
		}
		const writeRequestBit = 1 << DMA_REQUEST_GX_WRITE;
		let assertedRequests = 0;
		if ((dmaDirection === GX_GPU_DMA_DIRECTION_FIFO || dmaDirection === GX_GPU_DMA_DIRECTION_CPU_TO_GP0)
			&& dmaRequest !== 0) {
			assertedRequests = writeRequestBit;
		}
		this.dmaController.setRequestLines(
			writeRequestBit,
			assertedRequests,
		);
	}

	private gpuStatInInterleaved480iMode(): boolean {
		return (this.statusWord & (GX_GPU_STATUS_VERTICAL_RESOLUTION | GX_GPU_STATUS_VERTICAL_INTERLACE)) === (GX_GPU_STATUS_VERTICAL_RESOLUTION | GX_GPU_STATUS_VERTICAL_INTERLACE);
	}

	private scanoutLine(): number {
		const halfLine = this.pcrtc.currentHalfLine(this.scheduler.currentNowCycles());
		return (halfLine - halfLine % 2) / 2;
	}

	private updateScanoutStatusBits(): void {
		if (!this.pcrtc.timing.running) {
			this.updateSkippedLineParity();
			return;
		}
		this.scanoutInterlacedField = this.pcrtc.field();
		this.scanoutInterlacedDisplayField = this.scanoutInterlacedField;
		let scanoutBits = 0;
		const displayStartY = gxGpuDisplayStartY(this.displayStartWord, this.vramYAddressExtensionWord);
		if (this.gpuStatInInterleaved480iMode()) {
			this.scanoutActiveLineLsb = (displayStartY + this.scanoutInterlacedDisplayField) & 1;
			const displayedField = this.pcrtc.vblankActive() ? 0 : this.scanoutInterlacedDisplayField;
			if (((displayStartY + displayedField) & 1) !== 0) {
				scanoutBits |= GX_GPU_STATUS_DISPLAY_LINE_LSB;
			}
		} else {
			this.scanoutActiveLineLsb = 0;
			if (((displayStartY + this.scanoutLine()) & 1) !== 0) {
				scanoutBits |= GX_GPU_STATUS_DISPLAY_LINE_LSB;
			}
		}
		if ((this.statusWord & GX_GPU_STATUS_VERTICAL_INTERLACE) === 0 || this.scanoutInterlacedField === 0) {
			scanoutBits |= GX_GPU_STATUS_INTERLACED_FIELD;
		}
		this.statusWord = ((this.statusWord & ~GX_GPU_STATUS_SCANOUT_MASK) | scanoutBits) >>> 0;
		this.updateSkippedLineParity();
	}

	private updateSkippedLineParity(): void {
		this.skippedLineParity = (this.statusWord & GX_GPU_STATUS_SKIP_ACTIVE_FIELD_MASK) === GX_GPU_STATUS_SKIP_ACTIVE_FIELD_WORD
			? this.scanoutActiveLineLsb
			: GX_GPU_SKIPPED_LINE_NONE;
	}

	private updateDisplayModeStatusBits(): void {
		const displayMode = this.displayModeWord;
		const statusDisplayModeBits = ((displayMode & 0x03) << GX_GPU_STATUS_HORIZONTAL_RESOLUTION_1_SHIFT)
			| ((displayMode & 0x04) << 17)
			| ((displayMode & 0x08) << 17)
			| ((displayMode & 0x10) << 17)
			| ((displayMode & 0x20) << 17)
			| ((displayMode & 0x40) << 10);
		this.statusWord = ((this.statusWord & ~GX_GPU_STATUS_DISPLAY_MODE_MASK) | statusDisplayModeBits) >>> 0;
		this.updateScanoutStatusBits();
	}

	private writeStatusIo(): void {
		this.updateDynamicStatusBits();
		this.memory.writeIoU32(IO_GX_GPU_GP1, this.statusWord);
	}

	private gp0WriteReady(busSignals: MappedBusSignals): boolean {
		if ((busSignals & MAPPED_BUS_MASTER_DMA) !== 0) {
			return !this.supervisorIngressStopped;
		}
		this.synchronizeCommandTiming(this.scheduler.currentNowCycles());
		this.updateDynamicStatusBits();
		return !this.supervisorIngressStopped
			&& this.gp0DmaIngress.empty()
			&& this.gp0Fifo.count() < GX_GPU_COMMAND_FIFO_WORD_CAPACITY
			&& !this.dmaController.ownsWritePort(IO_GX_GPU_GP0);
	}

	private notifySupervisorBoundary(): void {
		if (this.supervisorFenceReady()) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_SYSTEM, this.scheduler.currentNowCycles());
		}
	}

	// disable-next-line single_line_method_pattern -- MMIO read thunk is the Memory-owned device callback ABI for GP0.
	private static readGp0Thunk(context: GxGpu, _addr: number, busSignals: MappedBusSignals): number {
		return context.readGp0(busSignals);
	}

	// disable-next-line single_line_method_pattern -- MMIO write thunk is the Memory-owned device callback ABI for GP0.
	private static writeGp0Thunk(context: GxGpu, _addr: number, value: number, busSignals: MappedBusSignals): void {
		context.writeGp0(value, busSignals);
	}

	private static gp0WriteReadyThunk(context: GxGpu, _addr: number, busSignals: MappedBusSignals): boolean {
		return context.gp0WriteReady(busSignals);
	}

	private static gp1WriteReadyThunk(context: GxGpu, _addr: number): boolean {
		return !context.supervisorQuiesceRequested;
	}

	// disable-next-line single_line_method_pattern -- MMIO read thunk is the Memory-owned device callback ABI for GPUSTAT.
	private static readStatusThunk(context: GxGpu, _addr: number): number {
		return context.readStatus();
	}

	// disable-next-line single_line_method_pattern -- MMIO write thunk is the Memory-owned device callback ABI for GP1.
	private static writeGp1Thunk(context: GxGpu, _addr: number, value: number): void {
		context.writeGp1(value);
	}

	private static readPcrtcThunk(context: GxGpu, address: number): number {
		const index = address < IO_GX_PCRTC_TIMING_BASE
			? ((address - IO_GX_PCRTC_BASE) / IO_WORD_SIZE) >>> 0
			: IO_GX_PCRTC_WORD_COUNT + (((address - IO_GX_PCRTC_TIMING_BASE) / IO_WORD_SIZE) >>> 0);
		return context.pcrtc.readRegisterWord(index);
	}

	private static writePcrtcThunk(context: GxGpu, address: number, value: number): void {
		const index = address < IO_GX_PCRTC_TIMING_BASE
			? ((address - IO_GX_PCRTC_BASE) / IO_WORD_SIZE) >>> 0
			: IO_GX_PCRTC_WORD_COUNT + (((address - IO_GX_PCRTC_TIMING_BASE) / IO_WORD_SIZE) >>> 0);
		context.writePcrtcRegister(index, value);
	}
}
