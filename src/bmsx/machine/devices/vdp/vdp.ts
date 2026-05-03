import type { color } from '../../../common/color';
import {
	type Layer2D,
	type VdpFrameBufferSize,
	type VdpVramSurface,
	SKYBOX_FACE_COUNT,
	SKYBOX_FACE_H_WORD,
	SKYBOX_FACE_SLOT_WORD,
	SKYBOX_FACE_U_WORD,
	SKYBOX_FACE_V_WORD,
	SKYBOX_FACE_W_WORD,
	SKYBOX_FACE_WORD_COUNT,
	VDP_SBX_CONTROL_ENABLE,
	VDP_PMU_BANK_WORD_COUNT,
	VDP_RD_SURFACE_COUNT,
	VDP_RD_SURFACE_SYSTEM,
	VDP_RD_SURFACE_FRAMEBUFFER,
	VDP_RD_SURFACE_PRIMARY,
	VDP_RD_SURFACE_SECONDARY,
} from './contracts';
import {
	VDP_RENDER_ALPHA_COST_MULTIPLIER,
	VDP_RENDER_CLEAR_COST,
	VDP_RENDER_BILLBOARD_COST,
	blitAreaBucket,
	blitSpanBucket,
	computeClippedLineSpan,
	computeClippedRect,
} from './budget';
import {
	presentVdpFrameBufferPages,
	readVdpDisplayFrameBufferPixels,
	readVdpRenderFrameBufferPixels,
	writeVdpDisplayFrameBufferPixels,
	writeVdpRenderFrameBufferPixels,
	writeVdpRenderFrameBufferPixelRegion,
} from '../../../render/vdp/framebuffer';
import {
	IO_VDP_DITHER,
	IO_VDP_CAMERA_COMMIT,
	IO_VDP_CAMERA_EYE,
	IO_VDP_CAMERA_PROJ,
	IO_VDP_CAMERA_VIEW,
	IO_VDP_FAULT_CODE,
	IO_VDP_FAULT_DETAIL,
	IO_VDP_CMD,
	IO_VDP_FIFO,
	IO_VDP_FIFO_CTRL,
	IO_VDP_PMU_BANK,
	IO_VDP_PMU_CTRL,
	IO_VDP_PMU_SCALE_X,
	IO_VDP_PMU_SCALE_Y,
	IO_VDP_PMU_X,
	IO_VDP_PMU_Y,
	IO_VDP_REG0,
	IO_VDP_SLOT_PRIMARY_ATLAS,
	IO_VDP_SLOT_SECONDARY_ATLAS,
	IO_VDP_SBX_COMMIT,
	IO_VDP_SBX_CONTROL,
	IO_VDP_SBX_FACE0,
	IO_VDP_RD_DATA,
	IO_VDP_RD_MODE,
	IO_VDP_RD_STATUS,
	IO_VDP_RD_SURFACE,
	IO_VDP_RD_X,
	IO_VDP_RD_Y,
	IO_VDP_STATUS,
	VDP_FIFO_CTRL_SEAL,
	VDP_CAMERA_COMMIT_WRITE,
	VDP_FAULT_NONE,
	VDP_FAULT_RD_OOB,
	VDP_FAULT_RD_SURFACE,
	VDP_FAULT_RD_UNSUPPORTED_MODE,
	VDP_FAULT_VRAM_WRITE_OOB,
	VDP_FAULT_VRAM_WRITE_UNALIGNED,
	VDP_FAULT_VRAM_WRITE_UNINITIALIZED,
	VDP_FAULT_VRAM_WRITE_UNMAPPED,
	VDP_RD_MODE_RGBA8888,
	VDP_RD_STATUS_OVERFLOW,
	VDP_RD_STATUS_READY,
	VDP_SLOT_ATLAS_NONE,
	VDP_SLOT_PRIMARY,
	VDP_SLOT_SECONDARY,
	VDP_SLOT_SYSTEM,
	VDP_STATUS_SUBMIT_BUSY,
	VDP_STATUS_SUBMIT_REJECTED,
	VDP_STATUS_FAULT,
	VDP_STATUS_VBLANK,
	VDP_SBX_COMMIT_WRITE,
} from '../../bus/io';
import type { VramWriteSink } from '../../memory/memory';
import { Memory } from '../../memory/memory';
import type { Value } from '../../cpu/cpu';
import { cyclesUntilBudgetUnits } from '../../scheduler/budget';
import { DEVICE_SERVICE_VDP, type DeviceScheduler } from '../../scheduler/device';
import {
	VRAM_SYSTEM_SLOT_SIZE,
	VRAM_SYSTEM_SLOT_BASE,
	VRAM_PRIMARY_SLOT_SIZE,
	VRAM_PRIMARY_SLOT_BASE,
	VRAM_FRAMEBUFFER_SIZE,
	VRAM_FRAMEBUFFER_BASE,
	VRAM_SECONDARY_SLOT_BASE,
	VRAM_SECONDARY_SLOT_SIZE,
	VRAM_STAGING_BASE,
	VRAM_STAGING_SIZE,
	VDP_STREAM_BUFFER_SIZE,
	VDP_STREAM_CAPACITY_WORDS,
	IO_WORD_SIZE,
} from '../../memory/map';
import { vdpFault, vdpStreamFault } from './fault';
import { syncVdpSlotTextures } from '../../../render/vdp/slot_textures';
import {
	VdpPmuRegister,
	VdpPmuUnit,
} from './pmu';
import {
	VdpSbxUnit,
	VDP_SBX_PACKET_KIND,
	VDP_SBX_PACKET_PAYLOAD_WORDS,
	readSkyboxFaceSource,
} from './sbx';
import {
	type VdpBbuPacket,
	VdpBbuFrameBuffer,
	VdpBbuUnit,
	VDP_BBU_PACKET_KIND,
	VDP_BBU_PACKET_PAYLOAD_WORDS,
} from './bbu';
import {
	copyVdpCameraSnapshot,
	createVdpCameraSnapshot,
	VdpCameraUnit,
	type VdpCameraState,
	type VdpCameraSnapshot,
} from './camera';
import { decodeSignedQ16_16 } from './fixed_point';
import { decodeVdpUnitPacketHeader } from './packet';
import { packedHigh16, packedLow16 } from '../../common/word';
import { f32BitsToNumber, numberToF32Bits } from '../../common/numeric';
import {
	VdpBlitterCommandBuffer,
	type VdpBlitterSource,
	type VdpBlitterSurfaceSize,
	type VdpResolvedBlitterSample,
	VDP_BLITTER_FIFO_CAPACITY,
	VDP_BLITTER_OPCODE_BLIT,
	VDP_BLITTER_OPCODE_CLEAR,
	VDP_BLITTER_OPCODE_COPY_RECT,
	VDP_BLITTER_OPCODE_DRAW_LINE,
	VDP_BLITTER_OPCODE_FILL_RECT,
	vdpColorAlphaByte,
} from './blitter';
import {
	type VdpBuildingFrameState,
	type VdpExecutionState,
	type VdpSubmittedFrameState,
	allocateSubmittedFrameSlot,
	copyResolvedBlitterSample,
	createResolvedBlitterSamples,
} from './frame';
import {
	VDP_CMD_BEGIN_FRAME,
	VDP_CMD_BLIT,
	VDP_CMD_CLEAR,
	VDP_CMD_COPY_RECT,
	VDP_CMD_DRAW_LINE,
	VDP_CMD_END_FRAME,
	VDP_CMD_FILL_RECT,
	VDP_CMD_NOP,
	VDP_PKT_CMD,
	VDP_PKT_END,
	VDP_PKT_KIND_MASK,
	VDP_PKT_REG1,
	VDP_PKT_REGN,
	VDP_PKT_RESERVED_MASK,
	VDP_Q16_ONE,
	VDP_REG_BG_COLOR,
	VDP_REG_DRAW_COLOR,
	VDP_REG_DRAW_CTRL,
	VDP_REG_DRAW_LAYER_PRIO,
	VDP_REG_DRAW_SCALE_X,
	VDP_REG_DRAW_SCALE_Y,
	VDP_REG_DST_X,
	VDP_REG_DST_Y,
	VDP_REG_GEOM_X0,
	VDP_REG_GEOM_X1,
	VDP_REG_GEOM_Y0,
	VDP_REG_GEOM_Y1,
	VDP_REG_LINE_WIDTH,
	VDP_REG_SLOT_DIM,
	VDP_REG_SLOT_INDEX,
	VDP_REG_SRC_SLOT,
	VDP_REG_SRC_UV,
	VDP_REG_SRC_WH,
	VDP_REGISTER_COUNT,
	decodeVdpDrawCtrl,
	decodeVdpLayerPriority,
	type VdpDrawCtrl,
	type VdpLatchedGeometry,
	type VdpLayerPriority,
} from './registers';
import {
	type VramGarbageStream,
	VRAM_GARBAGE_CHUNK_BYTES,
	VRAM_GARBAGE_SPACE_SALT,
	fillVramGarbageScratch,
} from './vram_garbage';

export type {
	VdpBlitterCommandBuffer as VdpBlitterCommand,
	VdpBlitterSource,
	VdpBlitterSurfaceSize,
	VdpResolvedBlitterSample,
} from './blitter';

export type VdpState = {
	camera: VdpCameraState;
	skyboxControl: number;
	skyboxFaceWords: number[];
	pmuSelectedBank: number;
	pmuBankWords: number[];
	ditherType: number;
	vdpStatus: number;
	vdpFaultCode: number;
	vdpFaultDetail: number;
};

export type VdpSurfacePixelsState = {
	surfaceId: number;
	pixels: Uint8Array;
};

export type VdpSaveState = VdpState & {
	vramStaging: Uint8Array;
	surfacePixels: VdpSurfacePixelsState[];
	displayFrameBufferPixels: Uint8Array;
};

export type VdpEntropySeeds = {
	machineSeed: number;
	bootSeed: number;
};

const DEFAULT_VDP_ENTROPY_SEEDS: VdpEntropySeeds = {
	machineSeed: 0x42564d58,
	bootSeed: 0x7652414d,
};
const VDP_OPEN_BUS_WORD = 0;
const VDP_SERVICE_BATCH_WORK_UNITS = 128;
const VDP_SLOT_SURFACE_BINDINGS = [
	{ slot: VDP_SLOT_SYSTEM, surfaceId: VDP_RD_SURFACE_SYSTEM },
	{ slot: VDP_SLOT_PRIMARY, surfaceId: VDP_RD_SURFACE_PRIMARY },
	{ slot: VDP_SLOT_SECONDARY, surfaceId: VDP_RD_SURFACE_SECONDARY },
] as const;
const BMSX_BASE_COLORS: color[] = [
	{ r: 0 / 255, g: 0 / 255, b: 0 / 255, a: 0 }, // 0 = Transparent
	{ r: 0 / 255, g: 0 / 255, b: 0 / 255, a: 1 }, // 1 = Black
	{ r: 0 / 255, g: 241 / 255, b: 20 / 255, a: 1 }, // 2 = Medium Green
	{ r: 68 / 255, g: 249 / 255, b: 86 / 255, a: 1 }, // 3 = Light Green
	{ r: 85 / 255, g: 79 / 255, b: 255 / 255, a: 1 }, // 4 = Dark Blue
	{ r: 128 / 255, g: 111 / 255, b: 255 / 255, a: 1 }, // 5 = Light Blue
	{ r: 250 / 255, g: 80 / 255, b: 51 / 255, a: 1 }, // 6 = Dark Red
	{ r: 12 / 255, g: 255 / 255, b: 255 / 255, a: 1 }, // 7 = Cyan
	{ r: 255 / 255, g: 81 / 255, b: 52 / 255, a: 1 }, // 8 = Medium Red
	{ r: 255 / 255, g: 115 / 255, b: 86 / 255, a: 1 }, // 9 = Light Red
	{ r: 226 / 255, g: 210 / 255, b: 4 / 255, a: 1 }, // 10 = Dark Yellow
	{ r: 242 / 255, g: 217 / 255, b: 71 / 255, a: 1 }, // 11 = Light Yellow
	{ r: 4 / 255, g: 212 / 255, b: 19 / 255, a: 1 }, // 12 = Dark Green
	{ r: 231 / 255, g: 80 / 255, b: 229 / 255, a: 1 }, // 13 = Magenta
	{ r: 208 / 255, g: 208 / 255, b: 208 / 255, a: 1 }, // 14 = Grey
	{ r: 255 / 255, g: 255 / 255, b: 255 / 255, a: 1 }, // 15 = White
];

function resolveVdpSlotSurfaceBinding(value: number, from: 'slot' | 'surfaceId', to: 'slot' | 'surfaceId', faultMessage: string): number {
	for (const binding of VDP_SLOT_SURFACE_BINDINGS) {
		if (binding[from] === value) {
			return binding[to];
		}
	}
	throw vdpFault(faultMessage);
}

export const BmsxColors: color[] = [
	...BMSX_BASE_COLORS,
	{ r: 222 / 255, g: 184 / 255, b: 135 / 255, a: 1 }, // 16 = Brown
	{ r: 0 / 255, g: 0 / 255, b: 64 / 255, a: 1 }, // 17 = Very dark blue
	{ r: 250 / 255, g: 250 / 255, b: 250 / 255, a: 1 }, // 18 = Soft white (#fafafa)
	{ r: 234 / 255, g: 234 / 255, b: 235 / 255, a: 1 }, // 19 = Panel grey (#eaeaeb)
	{ r: 219 / 255, g: 219 / 255, b: 220 / 255, a: 1 }, // 20 = Divider grey (#dbdbdc)
	{ r: 82 / 255, g: 111 / 255, b: 255 / 255, a: 1 }, // 21 = Accent blue (#526fff)
	{ r: 56 / 255, g: 58 / 255, b: 66 / 255, a: 1 }, // 22 = Deep text grey (#383a42)
	{ r: 18 / 255, g: 20 / 255, b: 23 / 255, a: 1 }, // 23 = Near black (#121417)
	{ r: 229 / 255, g: 229 / 255, b: 230 / 255, a: 1 }, // 24 = Light border grey (#e5e5e6)
	{ r: 157 / 255, g: 157 / 255, b: 159 / 255, a: 1 }, // 25 = Muted mid grey (#9d9d9f)
	{ r: 245 / 255, g: 245 / 255, b: 245 / 255, a: 1 }, // 26 = Gentle white (#f5f5f5)
	{ r: 175 / 255, g: 178 / 255, b: 187 / 255, a: 1 }, // 27 = Hint grey (#afb2bb)
	{ r: 66 / 255, g: 66 / 255, b: 67 / 255, a: 1 }, // 28 = Status text grey (#424243)
	{ r: 35 / 255, g: 35 / 255, b: 36 / 255, a: 1 }, // 29 = List text grey (#232324)
	{ r: 88 / 255, g: 113 / 255, b: 239 / 255, a: 1 }, // 30 = Button blue (#5871ef)
	{ r: 107 / 255, g: 131 / 255, b: 237 / 255, a: 1 }, // 31 = Button hover blue (#6b83ed)
	{ r: 59 / 255, g: 186 / 255, b: 84 / 255, a: 1 }, // 32 = Success green (#3bba54)
	{ r: 76 / 255, g: 194 / 255, b: 99 / 255, a: 1 }, // 33 = Success hover green (#4cc263)
	{ r: 0 / 255, g: 128 / 255, b: 155 / 255, a: 0.2 }, // 34 = Diff inserted translucent (#00809b33)
	{ r: 78 / 255, g: 86 / 255, b: 102 / 255, a: 0.5 }, // 35 = Scrollbar base (#4e566680)
	{ r: 90 / 255, g: 99 / 255, b: 117 / 255, a: 0.5 }, // 36 = Scrollbar hover (#5a637580)
	{ r: 116 / 255, g: 125 / 255, b: 145 / 255, a: 0.5 }, // 37 = Scrollbar active (#747d9180)
	{ r: 166 / 255, g: 38 / 255, b: 164 / 255, a: 1 }, // 38 = Keyword magenta (#a626a4)
	{ r: 80 / 255, g: 161 / 255, b: 79 / 255, a: 1 }, // 39 = String green (#50a14f)
	{ r: 152 / 255, g: 104 / 255, b: 1 / 255, a: 1 }, // 40 = Number brown (#986801)
	{ r: 1 / 255, g: 132 / 255, b: 188 / 255, a: 1 }, // 41 = Cyan blue (#0184bc)
	{ r: 228 / 255, g: 86 / 255, b: 73 / 255, a: 1 }, // 42 = Accent red (#e45649)
	{ r: 64 / 255, g: 120 / 255, b: 242 / 255, a: 1 }, // 43 = Function blue (#4078f2)
	{ r: 160 / 255, g: 161 / 255, b: 167 / 255, a: 1 }, // 44 = Comment grey (#a0a1a7)
	{ r: 191 / 255, g: 136 / 255, b: 3 / 255, a: 1 }, // 45 = Warning amber (#bf8803)
	{ r: 66 / 255, g: 173 / 255, b: 225 / 255, a: 1 }, // 46 = Info blue (#42ade1)
	{ r: 56 / 255, g: 58 / 255, b: 66 / 255, a: 0 }, // 47 = Line highlight overlay (#383a420c)
	{ r: 0 / 255, g: 0 / 255, b: 64 / 255, a: 1 }, // 48 = Selection overlay (#e5e5e6bf)
	{ r: 0.9, g: 0.35, b: 0.35, a: 0.38 }, // 49 = Search match overlay
	{ r: 1, g: 0.85, b: 0.25, a: 0.6 }, // 50 = Search match active overlay
	{ r: 0.25, g: 0.62, b: 0.95, a: 0.32 }, // 51 = References match overlay
	{ r: 0.18, g: 0.44, b: 0.9, a: 0.54 }, // 52 = References match active overlay
	{ r: 0.6, g: 0, b: 0, a: 1 }, // 53 = Error overlay background
	{ r: 0.75, g: 0.1, b: 0.1, a: 1 }, // 54 = Error overlay background hover
	{ r: 1, g: 1, b: 1, a: 0.18 }, // 55 = Error overlay line hover
	{ r: 0.95, g: 0.45, b: 0.1, a: 0.45 }, // 56 = Execution stop overlay
	{ r: 0.1, g: 0.1, b: 0.1, a: 0.9 }, // 57 = Hover tooltip background
	{ r: 0, g: 0, b: 0, a: 0.65 }, // 58 = Action overlay
];

export function resolvePaletteIndex(color: color | number): number {
	if (typeof color === 'number') {
		return color;
	}
	return BmsxColors.indexOf(color);
}

export function invertColorIndex(colorIndex: number): number {
	const color = BmsxColors[colorIndex];
	const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
	return luminance > 0.5 ? 0 : 15;
}

const VDP_RD_BUDGET_BYTES = 4096;
const VDP_RD_MAX_CHUNK_PIXELS = 256;
type VdpReadSurface = {
	surfaceId: number;
	registered: boolean;
};

type VdpReadCache = {
	x0: number;
	y: number;
	width: number;
	data: Uint8Array;
};

export type VdpSurfaceUploadSlot = {
	baseAddr: number;
	capacity: number;
	surfaceId: number;
	surfaceWidth: number;
	surfaceHeight: number;
	cpuReadback: Uint8Array;
	dirtyRowStart: number;
	dirtyRowEnd: number;
};

type VdpHostOutputState = {
	executionQueue: VdpBlitterCommandBuffer | null;
	executionBillboards: VdpBbuFrameBuffer;
	executionWritesFrameBuffer: boolean;
	ditherType: number;
	camera: VdpCameraSnapshot;
	skyboxEnabled: boolean;
	skyboxSamples: readonly VdpResolvedBlitterSample[];
	billboards: VdpBbuFrameBuffer;
	surfaceUploadSlots: readonly VdpSurfaceUploadSlot[];
	frameBufferWidth: number;
	frameBufferHeight: number;
	frameBufferRenderReadback: Uint8Array;
};

export type VdpHostOutput = Readonly<VdpHostOutputState>;

type VramSlot = VdpSurfaceUploadSlot;

function createReadSurfaceEntries(): VdpReadSurface[] {
	const entries: VdpReadSurface[] = [];
	for (let surfaceId = 0; surfaceId < VDP_RD_SURFACE_COUNT; surfaceId += 1) {
		entries.push({ surfaceId, registered: false });
	}
	return entries;
}

export class VDP implements VramWriteSink {
	private vramSlots: VramSlot[] = [];
	private vramStaging = new Uint8Array(VRAM_STAGING_SIZE);
	private readonly vramGarbageScratch = new Uint8Array(VRAM_GARBAGE_CHUNK_BYTES);
	private readonly vramSeedPixel = new Uint8Array(4);
	private vramMachineSeed = DEFAULT_VDP_ENTROPY_SEEDS.machineSeed;
	private vramBootSeed = DEFAULT_VDP_ENTROPY_SEEDS.bootSeed;
	private readSurfaces: VdpReadSurface[] = createReadSurfaceEntries();
	private readCaches: VdpReadCache[] = [];
	private readBudgetBytes = VDP_RD_BUDGET_BYTES;
	private readOverflow = false;
	private displayFrameBufferCpuReadback: Uint8Array = new Uint8Array(0);
	private readonly sbx = new VdpSbxUnit();
	private readonly sbxPacketFaceWords = new Uint32Array(SKYBOX_FACE_WORD_COUNT);
	private readonly sbxMmioFaceWords = new Uint32Array(SKYBOX_FACE_WORD_COUNT);
	private readonly camera = new VdpCameraUnit();
	private readonly cameraMmioView = new Float32Array(16);
	private readonly cameraMmioProj = new Float32Array(16);
	private readonly cameraMmioEye = new Float32Array(3);
	private readonly pmu = new VdpPmuUnit();
	private readonly bbu = new VdpBbuUnit();
	private liveDitherType = 0;
	private committedDitherType = 0;
	private _frameBufferWidth = 0;
	private _frameBufferHeight = 0;
	private readonly buildFrame: VdpBuildingFrameState = {
		queue: new VdpBlitterCommandBuffer(),
		billboards: new VdpBbuFrameBuffer(),
		open: false,
		cost: 0,
	};
	private readonly execution: VdpExecutionState = {
		queue: new VdpBlitterCommandBuffer(),
		pending: false,
	};
	private committedBillboards: VdpBbuFrameBuffer = new VdpBbuFrameBuffer();
	private readonly committedSkyboxSamples = createResolvedBlitterSamples();
	private readonly committedCamera = createVdpCameraSnapshot();
	private activeFrame: VdpSubmittedFrameState = allocateSubmittedFrameSlot();
	private pendingFrame: VdpSubmittedFrameState = allocateSubmittedFrameSlot();
	private readonly hostOutputState: VdpHostOutputState = {
		executionQueue: null,
		executionBillboards: this.activeFrame.billboards,
		executionWritesFrameBuffer: false,
		ditherType: 0,
		camera: this.committedCamera,
		skyboxEnabled: false,
		skyboxSamples: this.committedSkyboxSamples,
		billboards: this.committedBillboards,
		surfaceUploadSlots: this.vramSlots,
		frameBufferWidth: 0,
		frameBufferHeight: 0,
		frameBufferRenderReadback: this.displayFrameBufferCpuReadback,
	};
	private readonly clippedRectScratchA = { width: 0, height: 0, area: 0 };
	private readonly latchedSourceScratch: VdpBlitterSource = { surfaceId: 0, srcX: 0, srcY: 0, width: 0, height: 0 };
	private readonly latchedGeometryScratch: VdpLatchedGeometry = { x0: 0, y0: 0, x1: 0, y1: 0 };
	private readonly layerPriorityScratch: VdpLayerPriority = { layer: 0, priority: 0, z: 0 };
	private readonly drawCtrlScratch: VdpDrawCtrl = { flipH: false, flipV: false, blendMode: 0, pmuBank: 0, parallaxWeight: 0 };
	private blitterSequence = 0;
	private cpuHz: bigint = 1n;
	private workUnitsPerSec: bigint = 1n;
	private workCarry: bigint = 0n;
	private availableWorkUnits = 0;
	private vdpStatus = 0;
	private faultCode = VDP_FAULT_NONE;
	private faultDetail = 0;
	private dmaSubmitActive = false;
	private readonly vdpRegisters = new Uint32Array(VDP_REGISTER_COUNT);
	private readonly vdpFifoWordScratch = new Uint8Array(4);
	private vdpFifoWordByteCount = 0;
	private readonly vdpFifoStreamWords = new Uint32Array(VDP_STREAM_CAPACITY_WORDS);
	private vdpFifoStreamWordCount = 0;
	public lastFrameCommitted = true;
	public lastFrameCost = 0;
	public lastFrameHeld = false;
	public constructor(
		private readonly memory: Memory,
		private readonly scheduler: DeviceScheduler,
		private readonly configuredFrameBufferSize: VdpFrameBufferSize,
		entropySeeds: VdpEntropySeeds = DEFAULT_VDP_ENTROPY_SEEDS,
	) {
		this.vramMachineSeed = entropySeeds.machineSeed >>> 0;
		this.vramBootSeed = entropySeeds.bootSeed >>> 0;
		this.memory.setVramWriter(this);
		this.memory.mapIoRead(IO_VDP_RD_STATUS, this.readVdpStatus.bind(this));
		this.memory.mapIoRead(IO_VDP_RD_DATA, this.readVdpData.bind(this));
		this.memory.mapIoWrite(IO_VDP_DITHER, this.onVdpDitherWrite.bind(this));
		this.memory.mapIoWrite(IO_VDP_FIFO, this.onVdpFifoWrite.bind(this));
		this.memory.mapIoWrite(IO_VDP_FIFO_CTRL, this.onVdpFifoCtrlWrite.bind(this));
		this.memory.mapIoWrite(IO_VDP_CMD, this.onVdpCommandWrite.bind(this));
		for (let index = 0; index < VDP_REGISTER_COUNT; index += 1) {
			this.memory.mapIoWrite(IO_VDP_REG0 + index * IO_WORD_SIZE, this.onVdpRegisterIoWrite.bind(this));
		}
		const pmuRegisterWindowWrite = this.onVdpPmuRegisterWindowWrite.bind(this);
		this.memory.mapIoWrite(IO_VDP_PMU_BANK, pmuRegisterWindowWrite);
		this.memory.mapIoWrite(IO_VDP_PMU_X, pmuRegisterWindowWrite);
		this.memory.mapIoWrite(IO_VDP_PMU_Y, pmuRegisterWindowWrite);
		this.memory.mapIoWrite(IO_VDP_PMU_SCALE_X, pmuRegisterWindowWrite);
		this.memory.mapIoWrite(IO_VDP_PMU_SCALE_Y, pmuRegisterWindowWrite);
		this.memory.mapIoWrite(IO_VDP_PMU_CTRL, pmuRegisterWindowWrite);
		this.memory.mapIoWrite(IO_VDP_SBX_COMMIT, this.onVdpSbxCommitWrite.bind(this));
		this.memory.mapIoWrite(IO_VDP_CAMERA_COMMIT, this.onVdpCameraCommitWrite.bind(this));
		for (let index = 0; index < VDP_RD_SURFACE_COUNT; index += 1) {
			this.readCaches.push({ x0: 0, y: 0, width: 0, data: new Uint8Array(0) });
		}
	}

	public initializeVramSurfaces(): void {
		this.registerVramSurfaces([
			{
				surfaceId: VDP_RD_SURFACE_SYSTEM,
				baseAddr: VRAM_SYSTEM_SLOT_BASE,
				capacity: VRAM_SYSTEM_SLOT_SIZE,
				width: 1,
				height: 1,
			},
			{
				surfaceId: VDP_RD_SURFACE_PRIMARY,
				baseAddr: VRAM_PRIMARY_SLOT_BASE,
				capacity: VRAM_PRIMARY_SLOT_SIZE,
				width: 1,
				height: 1,
			},
			{
				surfaceId: VDP_RD_SURFACE_SECONDARY,
				baseAddr: VRAM_SECONDARY_SLOT_BASE,
				capacity: VRAM_SECONDARY_SLOT_SIZE,
				width: 1,
				height: 1,
			},
			{
				surfaceId: VDP_RD_SURFACE_FRAMEBUFFER,
				baseAddr: VRAM_FRAMEBUFFER_BASE,
				capacity: VRAM_FRAMEBUFFER_SIZE,
				width: this.configuredFrameBufferSize.width,
				height: this.configuredFrameBufferSize.height,
			},
		]);
	}

	public resetIngressState(): void {
		this.vdpFifoWordByteCount = 0;
		this.vdpFifoStreamWordCount = 0;
		this.dmaSubmitActive = false;
		this.refreshSubmitBusyStatus();
	}

	public resetStatus(): void {
		this.vdpStatus = 0;
		this.faultCode = VDP_FAULT_NONE;
		this.faultDetail = 0;
		this.memory.writeIoValue(IO_VDP_STATUS, this.vdpStatus);
		this.memory.writeIoValue(IO_VDP_FAULT_CODE, this.faultCode);
		this.memory.writeIoValue(IO_VDP_FAULT_DETAIL, this.faultDetail);
		this.refreshSubmitBusyStatus();
	}

	private raiseFault(code: number, detail: number): void {
		this.faultCode = code >>> 0;
		this.faultDetail = detail >>> 0;
		this.memory.writeIoValue(IO_VDP_FAULT_CODE, this.faultCode);
		this.memory.writeIoValue(IO_VDP_FAULT_DETAIL, this.faultDetail);
		this.setStatusFlag(VDP_STATUS_FAULT, true);
	}

	private resetVdpRegisters(): void {
		const primarySurface = this.readSurfaces[VDP_RD_SURFACE_PRIMARY];
		let slotDim = 1 | (1 << 16);
		if (primarySurface.registered) {
			const primarySlot = this.getVramSlotBySurfaceId(primarySurface.surfaceId);
			slotDim = (primarySlot.surfaceWidth & 0xffff) | ((primarySlot.surfaceHeight & 0xffff) << 16);
		}
		this.vdpRegisters.fill(0);
		this.vdpRegisters[VDP_REG_SRC_SLOT] = VDP_SLOT_PRIMARY;
		this.vdpRegisters[VDP_REG_LINE_WIDTH] = VDP_Q16_ONE;
		this.vdpRegisters[VDP_REG_DRAW_SCALE_X] = VDP_Q16_ONE;
		this.vdpRegisters[VDP_REG_DRAW_SCALE_Y] = VDP_Q16_ONE;
		this.vdpRegisters[VDP_REG_DRAW_COLOR] = 0xffffffff;
		this.vdpRegisters[VDP_REG_BG_COLOR] = 0xff000000;
		this.vdpRegisters[VDP_REG_SLOT_INDEX] = VDP_SLOT_PRIMARY;
		this.vdpRegisters[VDP_REG_SLOT_DIM] = slotDim >>> 0;
		for (let index = 0; index < VDP_REGISTER_COUNT; index += 1) {
			this.memory.writeIoValue(IO_VDP_REG0 + index * IO_WORD_SIZE, this.vdpRegisters[index]);
		}
	}

	public writeVdpRegister(index: number, value: number): void {
		if (index < 0 || index >= VDP_REGISTER_COUNT) {
			throw vdpFault(`VDP register ${index} is out of range.`);
		}
		const word = value >>> 0;
		switch (index) {
			case VDP_REG_SLOT_DIM:
				this.configureSelectedSlotDimension(word);
				break;
		}
		this.vdpRegisters[index] = word;
		this.memory.writeIoValue(IO_VDP_REG0 + index * IO_WORD_SIZE, word);
	}

	private onVdpRegisterIoWrite(addr: number): void {
		const index = ((addr - IO_VDP_REG0) / IO_WORD_SIZE) >>> 0;
		const previous = this.vdpRegisters[index];
		try {
			this.writeVdpRegister(index, this.memory.readIoU32(addr));
		} catch (error) {
			this.memory.writeIoValue(addr, previous);
			throw error;
		}
	}

	private onVdpDitherWrite(_addr: number, value: Value): void {
		this.liveDitherType = (value as number) | 0;
	}

	private writePmuBankSelect(value: number): void {
		this.pmu.selectBank(value);
		this.syncPmuRegisterWindow();
	}

	private onVdpPmuRegisterWindowWrite(addr: number): void {
		const word = this.memory.readIoU32(addr) >>> 0;
		switch (addr) {
			case IO_VDP_PMU_BANK:
				this.writePmuBankSelect(word);
				return;
			case IO_VDP_PMU_X:
				this.pmu.writeSelectedBankRegister(VdpPmuRegister.X, word);
				break;
			case IO_VDP_PMU_Y:
				this.pmu.writeSelectedBankRegister(VdpPmuRegister.Y, word);
				break;
			case IO_VDP_PMU_SCALE_X:
				this.pmu.writeSelectedBankRegister(VdpPmuRegister.ScaleX, word);
				break;
			case IO_VDP_PMU_SCALE_Y:
				this.pmu.writeSelectedBankRegister(VdpPmuRegister.ScaleY, word);
				break;
			case IO_VDP_PMU_CTRL:
				this.pmu.writeSelectedBankRegister(VdpPmuRegister.Control, word);
				break;
		}
		this.memory.writeIoValue(addr, word);
	}

	private syncPmuRegisterWindow(): void {
		const window = this.pmu.registerWindow();
		this.memory.writeIoValue(IO_VDP_PMU_BANK, window.bank);
		this.memory.writeIoValue(IO_VDP_PMU_X, window.x);
		this.memory.writeIoValue(IO_VDP_PMU_Y, window.y);
		this.memory.writeIoValue(IO_VDP_PMU_SCALE_X, window.scaleX);
		this.memory.writeIoValue(IO_VDP_PMU_SCALE_Y, window.scaleY);
		this.memory.writeIoValue(IO_VDP_PMU_CTRL, window.control);
	}

	private onVdpSbxCommitWrite(): void {
		if ((this.memory.readIoU32(IO_VDP_SBX_COMMIT) & VDP_SBX_COMMIT_WRITE) === 0) {
			return;
		}
		for (let index = 0; index < SKYBOX_FACE_WORD_COUNT; index += 1) {
			this.sbxMmioFaceWords[index] = this.memory.readIoU32(IO_VDP_SBX_FACE0 + index * IO_WORD_SIZE);
		}
		this.sbx.writePacket(this.memory.readIoU32(IO_VDP_SBX_CONTROL), this.sbxMmioFaceWords);
	}

	private onVdpCameraCommitWrite(): void {
		if ((this.memory.readIoU32(IO_VDP_CAMERA_COMMIT) & VDP_CAMERA_COMMIT_WRITE) === 0) {
			return;
		}
		for (let index = 0; index < 16; index += 1) {
			this.cameraMmioView[index] = f32BitsToNumber(this.memory.readIoU32(IO_VDP_CAMERA_VIEW + index * IO_WORD_SIZE));
			this.cameraMmioProj[index] = f32BitsToNumber(this.memory.readIoU32(IO_VDP_CAMERA_PROJ + index * IO_WORD_SIZE));
		}
		for (let index = 0; index < 3; index += 1) {
			this.cameraMmioEye[index] = f32BitsToNumber(this.memory.readIoU32(IO_VDP_CAMERA_EYE + index * IO_WORD_SIZE));
		}
		this.camera.writeCameraBank0(this.cameraMmioView, this.cameraMmioProj, this.cameraMmioEye[0], this.cameraMmioEye[1], this.cameraMmioEye[2]);
	}

	private syncSbxRegisterWindow(): void {
		const words = this.sbx.captureLiveFaceWords();
		this.memory.writeIoValue(IO_VDP_SBX_CONTROL, this.sbx.liveControlWord);
		for (let index = 0; index < SKYBOX_FACE_WORD_COUNT; index += 1) {
			this.memory.writeIoValue(IO_VDP_SBX_FACE0 + index * IO_WORD_SIZE, words[index]);
		}
		this.memory.writeIoValue(IO_VDP_SBX_COMMIT, 0);
	}

	private syncCameraRegisterWindow(): void {
		const state = this.camera.captureState();
		for (let index = 0; index < 16; index += 1) {
			this.memory.writeIoValue(IO_VDP_CAMERA_VIEW + index * IO_WORD_SIZE, numberToF32Bits(state.view[index]));
			this.memory.writeIoValue(IO_VDP_CAMERA_PROJ + index * IO_WORD_SIZE, numberToF32Bits(state.proj[index]));
		}
		for (let index = 0; index < 3; index += 1) {
			this.memory.writeIoValue(IO_VDP_CAMERA_EYE + index * IO_WORD_SIZE, numberToF32Bits(state.eye[index]));
		}
		this.memory.writeIoValue(IO_VDP_CAMERA_COMMIT, 0);
	}

	private configureSelectedSlotDimension(word: number): void {
		const width = packedLow16(word);
		const height = packedHigh16(word);
		if (width === 0 || height === 0) {
			throw vdpFault(`invalid VRAM surface dimensions ${width}x${height}.`);
		}
		this.configureVramSlotSurface(this.vdpRegisters[VDP_REG_SLOT_INDEX], width, height);
	}

	private readLatchedGeometry(target: VdpLatchedGeometry): VdpLatchedGeometry {
		target.x0 = decodeSignedQ16_16(this.vdpRegisters[VDP_REG_GEOM_X0]);
		target.y0 = decodeSignedQ16_16(this.vdpRegisters[VDP_REG_GEOM_Y0]);
		target.x1 = decodeSignedQ16_16(this.vdpRegisters[VDP_REG_GEOM_X1]);
		target.y1 = decodeSignedQ16_16(this.vdpRegisters[VDP_REG_GEOM_Y1]);
		return target;
	}


	// disable-next-line single_line_method_pattern -- VBLANK status is the public device pin; status register bit ownership stays here.
	public setVblankStatus(active: boolean): void {
		this.setStatusFlag(VDP_STATUS_VBLANK, active);
	}

	private setStatusFlag(mask: number, active: boolean): void {
		const nextStatus = active ? (this.vdpStatus | mask) : (this.vdpStatus & ~mask);
		if (nextStatus === this.vdpStatus) {
			return;
		}
		this.vdpStatus = nextStatus >>> 0;
		this.memory.writeIoValue(IO_VDP_STATUS, this.vdpStatus);
	}

	public canAcceptVdpSubmit(): boolean {
		return !this.hasBlockedSubmitPath();
	}

	public acceptSubmitAttempt(): void {
		this.setStatusFlag(VDP_STATUS_SUBMIT_REJECTED, false);
		this.refreshSubmitBusyStatus();
	}

	public rejectSubmitAttempt(): void {
		this.setStatusFlag(VDP_STATUS_SUBMIT_REJECTED, true);
		this.refreshSubmitBusyStatus();
	}

	public beginDmaSubmit(): void {
		this.dmaSubmitActive = true;
		this.acceptSubmitAttempt();
	}

	public endDmaSubmit(): void {
		this.dmaSubmitActive = false;
		this.refreshSubmitBusyStatus();
	}

	public sealDmaTransfer(src: number, byteLength: number): void {
		try {
			this.consumeSealedVdpStream(src, byteLength);
		} finally {
			this.endDmaSubmit();
		}
	}

	public writeVdpFifoBytes(bytes: Uint8Array): void {
		for (let index = 0; index < bytes.byteLength; index += 1) {
			this.vdpFifoWordScratch[this.vdpFifoWordByteCount] = bytes[index]!;
			this.vdpFifoWordByteCount += 1;
			if (this.vdpFifoWordByteCount !== 4) {
				continue;
			}
			const word = (
				this.vdpFifoWordScratch[0]
				| (this.vdpFifoWordScratch[1] << 8)
				| (this.vdpFifoWordScratch[2] << 16)
				| (this.vdpFifoWordScratch[3] << 24)
			) >>> 0;
			this.vdpFifoWordByteCount = 0;
			this.pushVdpFifoWord(word);
		}
		this.refreshSubmitBusyStatus();
	}

	private hasOpenDirectVdpFifoIngress(): boolean {
		return this.vdpFifoWordByteCount !== 0 || this.vdpFifoStreamWordCount !== 0;
	}

	private hasBlockedSubmitPath(): boolean {
		return this.hasOpenDirectVdpFifoIngress() || this.dmaSubmitActive || this.buildFrame.open || !this.canAcceptSubmittedFrame();
	}

	private refreshSubmitBusyStatus(): void {
		this.setStatusFlag(VDP_STATUS_SUBMIT_BUSY, this.hasBlockedSubmitPath());
	}

	private pushVdpFifoWord(word: number): void {
		if (this.vdpFifoStreamWordCount >= VDP_STREAM_CAPACITY_WORDS) {
			throw vdpStreamFault(`stream overflow (${this.vdpFifoStreamWordCount + 1} > ${VDP_STREAM_CAPACITY_WORDS}).`);
		}
		this.vdpFifoStreamWords[this.vdpFifoStreamWordCount] = word >>> 0;
		this.vdpFifoStreamWordCount += 1;
		this.refreshSubmitBusyStatus();
	}

	private consumeSealedVdpStream(baseAddr: number, byteLength: number): void {
		if ((byteLength & 3) !== 0) {
			throw vdpStreamFault('sealed stream length must be word-aligned.');
		}
		if (byteLength > VDP_STREAM_BUFFER_SIZE) {
			throw vdpStreamFault(`sealed stream overflow (${byteLength} > ${VDP_STREAM_BUFFER_SIZE}).`);
		}
		let cursor = baseAddr;
		const end = baseAddr + byteLength;
		this.beginSubmittedFrame();
		try {
			let ended = false;
			while (cursor < end) {
				const word = this.memory.readU32(cursor) >>> 0;
				cursor += IO_WORD_SIZE;
				if (word === VDP_PKT_END) {
					if (cursor !== end) {
						throw vdpStreamFault('stream has trailing words after PKT_END.');
					}
					ended = true;
					break;
				}
				cursor = this.consumeReplayPacketFromMemory(word, cursor, end);
			}
			if (!ended) {
				throw vdpStreamFault('stream ended without PKT_END.');
			}
			this.sealSubmittedFrame();
		} catch (error) {
			this.cancelSubmittedFrame();
			throw error;
		}
		this.refreshSubmitBusyStatus();
	}

	private consumeSealedVdpWordStream(wordCount: number): void {
		let cursor = 0;
		this.beginSubmittedFrame();
		try {
			let ended = false;
			while (cursor < wordCount) {
				const word = this.vdpFifoStreamWords[cursor] >>> 0;
				cursor += 1;
				if (word === VDP_PKT_END) {
					if (cursor !== wordCount) {
						throw vdpStreamFault('stream has trailing words after PKT_END.');
					}
					ended = true;
					break;
				}
				cursor = this.consumeReplayPacketFromWords(word, cursor, wordCount);
			}
			if (!ended) {
				throw vdpStreamFault('stream ended without PKT_END.');
			}
			this.sealSubmittedFrame();
		} catch (error) {
			this.cancelSubmittedFrame();
			throw error;
		}
		this.refreshSubmitBusyStatus();
	}

	private sealVdpFifoTransfer(): void {
		if (this.vdpFifoWordByteCount !== 0) {
			throw vdpStreamFault('FIFO transfer ended on a partial word.');
		}
		if (this.vdpFifoStreamWordCount === 0) {
			return;
		}
		this.consumeSealedVdpWordStream(this.vdpFifoStreamWordCount);
		this.resetIngressState();
	}

	private consumeReplayPacketFromMemory(word: number, cursor: number, end: number): number {
		const kind = word & VDP_PKT_KIND_MASK;
		switch (kind) {
			case VDP_PKT_CMD:
				this.consumeReplayCommandPacket(word);
				return cursor;
			case VDP_PKT_REG1: {
				const register = this.decodeReg1Packet(word);
				if (cursor + IO_WORD_SIZE > end) {
					throw vdpStreamFault('stream ended mid-REG1 payload.');
				}
				this.writeVdpRegister(register, this.memory.readU32(cursor));
				return cursor + IO_WORD_SIZE;
			}
			case VDP_PKT_REGN: {
				const packet = this.decodeRegnPacket(word);
				const byteCount = packet.count * IO_WORD_SIZE;
				const payloadEnd = cursor + byteCount;
				if (payloadEnd > end) {
					throw vdpStreamFault('stream ended mid-REGN payload.');
				}
				for (let offset = 0; offset < packet.count; offset += 1) {
					this.writeVdpRegister(packet.firstRegister + offset, this.memory.readU32(cursor + offset * IO_WORD_SIZE));
				}
				return payloadEnd;
			}
			case VDP_BBU_PACKET_KIND: {
				decodeVdpUnitPacketHeader('BILLBOARD', word, VDP_BBU_PACKET_PAYLOAD_WORDS);
				const byteCount = VDP_BBU_PACKET_PAYLOAD_WORDS * IO_WORD_SIZE;
				const payloadEnd = cursor + byteCount;
				if (payloadEnd > end) {
					throw vdpStreamFault('stream ended mid-BILLBOARD payload.');
				}
				this.latchBillboardPacket(this.bbu.decodePacket(
					this.memory.readU32(cursor),
					this.memory.readU32(cursor + IO_WORD_SIZE),
					this.memory.readU32(cursor + IO_WORD_SIZE * 2),
					this.memory.readU32(cursor + IO_WORD_SIZE * 3),
					this.memory.readU32(cursor + IO_WORD_SIZE * 4),
					this.memory.readU32(cursor + IO_WORD_SIZE * 5),
					this.memory.readU32(cursor + IO_WORD_SIZE * 6),
					this.memory.readU32(cursor + IO_WORD_SIZE * 7),
					this.memory.readU32(cursor + IO_WORD_SIZE * 8),
					this.memory.readU32(cursor + IO_WORD_SIZE * 9),
				));
				return payloadEnd;
			}
			case VDP_SBX_PACKET_KIND: {
				decodeVdpUnitPacketHeader('SKYBOX', word, VDP_SBX_PACKET_PAYLOAD_WORDS);
				const byteCount = VDP_SBX_PACKET_PAYLOAD_WORDS * IO_WORD_SIZE;
				const payloadEnd = cursor + byteCount;
				if (payloadEnd > end) {
					throw vdpStreamFault('stream ended mid-SKYBOX payload.');
				}
				const control = this.memory.readU32(cursor);
				for (let index = 0; index < SKYBOX_FACE_WORD_COUNT; index += 1) {
					this.sbxPacketFaceWords[index] = this.memory.readU32(cursor + IO_WORD_SIZE * (index + 1));
				}
				this.sbx.writePacket(control, this.sbxPacketFaceWords);
				return payloadEnd;
			}
			case 0:
				throw vdpStreamFault(`invalid zero-kind packet word ${word}.`);
			default:
				throw vdpStreamFault(`unknown VDP replay packet kind ${kind}.`);
		}
	}

	private consumeReplayPacketFromWords(word: number, cursor: number, wordCount: number): number {
		const kind = word & VDP_PKT_KIND_MASK;
		switch (kind) {
			case VDP_PKT_CMD:
				this.consumeReplayCommandPacket(word);
				return cursor;
			case VDP_PKT_REG1: {
				const register = this.decodeReg1Packet(word);
				if (cursor >= wordCount) {
					throw vdpStreamFault('stream ended mid-REG1 payload.');
				}
				this.writeVdpRegister(register, this.vdpFifoStreamWords[cursor]);
				return cursor + 1;
			}
			case VDP_PKT_REGN: {
				const packet = this.decodeRegnPacket(word);
				if (cursor + packet.count > wordCount) {
					throw vdpStreamFault('stream ended mid-REGN payload.');
				}
				for (let offset = 0; offset < packet.count; offset += 1) {
					this.writeVdpRegister(packet.firstRegister + offset, this.vdpFifoStreamWords[cursor + offset]);
				}
				return cursor + packet.count;
			}
			case VDP_BBU_PACKET_KIND:
				decodeVdpUnitPacketHeader('BILLBOARD', word, VDP_BBU_PACKET_PAYLOAD_WORDS);
				if (cursor + VDP_BBU_PACKET_PAYLOAD_WORDS > wordCount) {
					throw vdpStreamFault('stream ended mid-BILLBOARD payload.');
				}
				this.latchBillboardPacket(this.bbu.decodePacket(
					this.vdpFifoStreamWords[cursor],
					this.vdpFifoStreamWords[cursor + 1],
					this.vdpFifoStreamWords[cursor + 2],
					this.vdpFifoStreamWords[cursor + 3],
					this.vdpFifoStreamWords[cursor + 4],
					this.vdpFifoStreamWords[cursor + 5],
					this.vdpFifoStreamWords[cursor + 6],
					this.vdpFifoStreamWords[cursor + 7],
					this.vdpFifoStreamWords[cursor + 8],
					this.vdpFifoStreamWords[cursor + 9],
				));
				return cursor + VDP_BBU_PACKET_PAYLOAD_WORDS;
			case VDP_SBX_PACKET_KIND:
				decodeVdpUnitPacketHeader('SKYBOX', word, VDP_SBX_PACKET_PAYLOAD_WORDS);
				if (cursor + VDP_SBX_PACKET_PAYLOAD_WORDS > wordCount) {
					throw vdpStreamFault('stream ended mid-SKYBOX payload.');
				}
				for (let index = 0; index < SKYBOX_FACE_WORD_COUNT; index += 1) {
					this.sbxPacketFaceWords[index] = this.vdpFifoStreamWords[cursor + index + 1];
				}
				this.sbx.writePacket(this.vdpFifoStreamWords[cursor], this.sbxPacketFaceWords);
				return cursor + VDP_SBX_PACKET_PAYLOAD_WORDS;
			case 0:
				throw vdpStreamFault(`invalid zero-kind packet word ${word}.`);
			default:
				throw vdpStreamFault(`unknown VDP replay packet kind ${kind}.`);
		}
	}

	private decodeReg1Packet(word: number): number {
		if ((word & VDP_PKT_RESERVED_MASK) !== 0) {
			throw vdpStreamFault(`REG1 reserved bits are set (${word}).`);
		}
		const register = packedLow16(word);
		if (register >= VDP_REGISTER_COUNT) {
			throw vdpStreamFault(`REG1 register ${register} is out of range.`);
		}
		return register;
	}

	private decodeRegnPacket(word: number): { firstRegister: number; count: number } {
		const firstRegister = packedLow16(word);
		const count = (word >>> 16) & 0xff;
		if (count === 0 || count > VDP_REGISTER_COUNT) {
			throw vdpStreamFault(`REGN count ${count} is out of range.`);
		}
		if (firstRegister >= VDP_REGISTER_COUNT || firstRegister + count > VDP_REGISTER_COUNT) {
			throw vdpStreamFault(`REGN register range ${firstRegister}+${count} is out of range.`);
		}
		return { firstRegister, count };
	}

	private consumeReplayCommandPacket(word: number): void {
		if ((word & VDP_PKT_RESERVED_MASK) !== 0) {
			throw vdpStreamFault(`CMD reserved bits are set (${word}).`);
		}
		const command = packedLow16(word);
		if (command === VDP_CMD_BEGIN_FRAME || command === VDP_CMD_END_FRAME) {
			throw vdpStreamFault('BEGIN_FRAME and END_FRAME are not valid in FIFO replay.');
		}
		if (command === VDP_CMD_NOP) {
			return;
		}
		this.executeVdpDrawDoorbell(command);
	}

	public consumeDirectVdpCommand(command: number): void {
		if (command === VDP_CMD_NOP) {
			return;
		}
		if (command === VDP_CMD_BEGIN_FRAME) {
			if (this.buildFrame.open) {
				this.cancelSubmittedFrame();
				throw vdpFault('direct VDP frame is already open.');
			}
			this.beginSubmittedFrame();
			this.refreshSubmitBusyStatus();
			return;
		}
		if (command === VDP_CMD_END_FRAME) {
			if (!this.buildFrame.open) {
				this.rejectSubmitAttempt();
				throw vdpFault('no direct VDP frame is open.');
			}
			try {
				this.sealSubmittedFrame();
			} catch (error) {
				this.cancelSubmittedFrame();
				throw error;
			}
			this.refreshSubmitBusyStatus();
			return;
		}
		if (!this.buildFrame.open) {
			this.rejectSubmitAttempt();
			throw vdpFault('draw command requires an open direct VDP frame.');
		}
		try {
			this.executeVdpDrawDoorbell(command);
		} catch (error) {
			this.cancelSubmittedFrame();
			throw error;
		}
		this.refreshSubmitBusyStatus();
	}

	private executeVdpDrawDoorbell(command: number): void {
		switch (command) {
			case VDP_CMD_CLEAR:
				this.enqueueLatchedClear();
				break;
			case VDP_CMD_FILL_RECT:
				this.enqueueLatchedFillRect();
				break;
			case VDP_CMD_DRAW_LINE:
				this.enqueueLatchedDrawLine();
				break;
			case VDP_CMD_BLIT:
				this.enqueueLatchedBlit();
				break;
			case VDP_CMD_COPY_RECT:
				this.enqueueLatchedCopyRect();
				break;
			default:
				throw vdpFault(`unknown VDP command ${command}.`);
		}
	}

	private onVdpFifoWrite(): void {
		if (this.dmaSubmitActive || this.buildFrame.open || (!this.hasOpenDirectVdpFifoIngress() && !this.canAcceptSubmittedFrame())) {
			this.rejectSubmitAttempt();
			return;
		}
		this.acceptSubmitAttempt();
		this.pushVdpFifoWord(this.memory.readIoU32(IO_VDP_FIFO));
	}

	private onVdpFifoCtrlWrite(): void {
		if ((this.memory.readIoU32(IO_VDP_FIFO_CTRL) & VDP_FIFO_CTRL_SEAL) === 0) {
			return;
		}
		if (this.dmaSubmitActive) {
			this.rejectSubmitAttempt();
			return;
		}
		this.sealVdpFifoTransfer();
		this.refreshSubmitBusyStatus();
	}

	private onVdpCommandWrite(): void {
		const command = this.memory.readIoU32(IO_VDP_CMD);
		if (command === VDP_CMD_NOP) {
			return;
		}
		const directFrameCommand = command === VDP_CMD_BEGIN_FRAME || command === VDP_CMD_END_FRAME || this.buildFrame.open;
		if (!directFrameCommand && this.hasBlockedSubmitPath()) {
			this.rejectSubmitAttempt();
			return;
		}
		if (command === VDP_CMD_BEGIN_FRAME && !this.buildFrame.open && this.hasBlockedSubmitPath()) {
			this.rejectSubmitAttempt();
			return;
		}
		if (command !== VDP_CMD_BEGIN_FRAME && command !== VDP_CMD_END_FRAME && !this.buildFrame.open) {
			this.rejectSubmitAttempt();
		} else {
			this.acceptSubmitAttempt();
		}
		this.consumeDirectVdpCommand(command);
	}

	public setTiming(cpuHz: number, workUnitsPerSec: number, nowCycles: number): void {
		this.cpuHz = BigInt(cpuHz);
		this.workUnitsPerSec = BigInt(workUnitsPerSec);
		this.workCarry = 0n;
		this.availableWorkUnits = 0;
		this.scheduleNextService(nowCycles);
	}

	public accrueCycles(cycles: number, nowCycles: number): void {
		if (!this.hasPendingRenderWork() || cycles <= 0) {
			return;
		}
		const numerator = this.workUnitsPerSec * BigInt(cycles) + this.workCarry;
		const wholeUnits = numerator / this.cpuHz;
		this.workCarry = numerator % this.cpuHz;
		if (wholeUnits > 0n) {
			const remainingWork = this.getPendingRenderWorkUnits() - this.availableWorkUnits;
			const maxGrant = BigInt(remainingWork <= 0 ? 0 : remainingWork);
			const granted = wholeUnits > maxGrant ? maxGrant : wholeUnits;
			this.availableWorkUnits += Number(granted);
		}
		this.scheduleNextService(nowCycles);
	}

	public onService(nowCycles: number): void {
		if (this.needsImmediateSchedulerService()) {
			this.promotePendingFrame();
		}
		if (this.hasPendingRenderWork() && this.availableWorkUnits > 0) {
			const pendingBefore = this.getPendingRenderWorkUnits();
			this.advanceWork(this.availableWorkUnits);
			const pendingAfter = this.getPendingRenderWorkUnits();
			const consumed = pendingBefore - pendingAfter;
			if (consumed > 0) {
				this.availableWorkUnits -= consumed;
			}
		}
		this.scheduleNextService(nowCycles);
		this.refreshSubmitBusyStatus();
	}


	private enqueueLatchedClear(): void {
		const index = this.reserveBlitterCommand(VDP_BLITTER_OPCODE_CLEAR, VDP_RENDER_CLEAR_COST);
		this.buildFrame.queue.colorWord[index] = this.vdpRegisters[VDP_REG_BG_COLOR] >>> 0;
	}

	private enqueueLatchedFillRect(): void {
		const layerPriority = this.layerPriorityScratch;
		decodeVdpLayerPriority(this.vdpRegisters[VDP_REG_DRAW_LAYER_PRIO], layerPriority);
		const geometry = this.readLatchedGeometry(this.latchedGeometryScratch);
		const clipped = computeClippedRect(geometry.x0, geometry.y0, geometry.x1, geometry.y1, this._frameBufferWidth, this._frameBufferHeight, this.clippedRectScratchA);
		if (clipped.area === 0) {
			return;
		}
		const colorWord = this.vdpRegisters[VDP_REG_DRAW_COLOR] >>> 0;
		const index = this.reserveBlitterCommand(VDP_BLITTER_OPCODE_FILL_RECT, this.calculateVisibleRectCost(clipped.width, clipped.height) * this.calculateAlphaMultiplier(colorWord));
		const queue = this.buildFrame.queue;
		this.writeGeometryColorCommand(queue, index, layerPriority, geometry, colorWord);
	}

	private enqueueLatchedDrawLine(): void {
		const layerPriority = this.layerPriorityScratch;
		decodeVdpLayerPriority(this.vdpRegisters[VDP_REG_DRAW_LAYER_PRIO], layerPriority);
		const thickness = decodeSignedQ16_16(this.vdpRegisters[VDP_REG_LINE_WIDTH]);
		const geometry = this.readLatchedGeometry(this.latchedGeometryScratch);
		const span = computeClippedLineSpan(geometry.x0, geometry.y0, geometry.x1, geometry.y1, this._frameBufferWidth, this._frameBufferHeight);
		if (span === 0) {
			return;
		}
		const colorWord = this.vdpRegisters[VDP_REG_DRAW_COLOR] >>> 0;
		const thicknessMultiplier = thickness > 1 ? 2 : 1;
		const index = this.reserveBlitterCommand(VDP_BLITTER_OPCODE_DRAW_LINE, blitSpanBucket(span) * thicknessMultiplier * this.calculateAlphaMultiplier(colorWord));
		const queue = this.buildFrame.queue;
		this.writeGeometryColorCommand(queue, index, layerPriority, geometry, colorWord);
		queue.thickness[index] = thickness;
	}

	private enqueueLatchedBlit(): void {
		const layerPriority = this.layerPriorityScratch;
		decodeVdpLayerPriority(this.vdpRegisters[VDP_REG_DRAW_LAYER_PRIO], layerPriority);
		const drawCtrl = this.drawCtrlScratch;
		decodeVdpDrawCtrl(this.vdpRegisters[VDP_REG_DRAW_CTRL], drawCtrl);
		const slot = this.vdpRegisters[VDP_REG_SRC_SLOT];
		const u = packedLow16(this.vdpRegisters[VDP_REG_SRC_UV]);
		const v = packedHigh16(this.vdpRegisters[VDP_REG_SRC_UV]);
		const w = packedLow16(this.vdpRegisters[VDP_REG_SRC_WH]);
		const h = packedHigh16(this.vdpRegisters[VDP_REG_SRC_WH]);
		const source = this.latchedSourceScratch;
		this.resolveBlitterSourceWordsInto(slot, u, v, w, h, source);
		const scaleX = decodeSignedQ16_16(this.vdpRegisters[VDP_REG_DRAW_SCALE_X]);
		const scaleY = decodeSignedQ16_16(this.vdpRegisters[VDP_REG_DRAW_SCALE_Y]);
		const dstX = decodeSignedQ16_16(this.vdpRegisters[VDP_REG_DST_X]);
		const dstY = decodeSignedQ16_16(this.vdpRegisters[VDP_REG_DST_Y]);
		const resolved = this.pmu.resolveBlit(dstX, dstY, scaleX, scaleY, drawCtrl.pmuBank, drawCtrl.parallaxWeight);
		const dstWidth = source.width * resolved.scaleX;
		const dstHeight = source.height * resolved.scaleY;
		const clipped = computeClippedRect(resolved.dstX, resolved.dstY, resolved.dstX + dstWidth, resolved.dstY + dstHeight, this._frameBufferWidth, this._frameBufferHeight, this.clippedRectScratchA);
		if (clipped.area === 0) {
			return;
		}
		const colorWord = this.vdpRegisters[VDP_REG_DRAW_COLOR] >>> 0;
		const index = this.reserveBlitterCommand(VDP_BLITTER_OPCODE_BLIT, this.calculateVisibleRectCost(clipped.width, clipped.height) * this.calculateAlphaMultiplier(colorWord));
		const queue = this.buildFrame.queue;
		queue.layer[index] = layerPriority.layer;
		queue.priority[index] = layerPriority.z;
		queue.sourceSurfaceId[index] = source.surfaceId;
		queue.sourceSrcX[index] = source.srcX;
		queue.sourceSrcY[index] = source.srcY;
		queue.sourceWidth[index] = source.width;
		queue.sourceHeight[index] = source.height;
		queue.dstX[index] = resolved.dstX;
		queue.dstY[index] = resolved.dstY;
		queue.scaleX[index] = resolved.scaleX;
		queue.scaleY[index] = resolved.scaleY;
		queue.flipH[index] = drawCtrl.flipH ? 1 : 0;
		queue.flipV[index] = drawCtrl.flipV ? 1 : 0;
		queue.colorWord[index] = colorWord;
		queue.parallaxWeight[index] = drawCtrl.parallaxWeight;
	}

	private enqueueLatchedCopyRect(): void {
		const layerPriority = this.layerPriorityScratch;
		decodeVdpLayerPriority(this.vdpRegisters[VDP_REG_DRAW_LAYER_PRIO], layerPriority);
		const srcX = packedLow16(this.vdpRegisters[VDP_REG_SRC_UV]);
		const srcY = packedHigh16(this.vdpRegisters[VDP_REG_SRC_UV]);
		const width = packedLow16(this.vdpRegisters[VDP_REG_SRC_WH]);
		const height = packedHigh16(this.vdpRegisters[VDP_REG_SRC_WH]);
		const dstX = (this.vdpRegisters[VDP_REG_DST_X] | 0) >> 16;
		const dstY = (this.vdpRegisters[VDP_REG_DST_Y] | 0) >> 16;
		this.enqueueCopyRectWords(srcX, srcY, width, height, dstX, dstY, layerPriority.z, layerPriority.layer);
	}

	private nextBlitterSequence(): number {
		return this.blitterSequence++;
	}

	private resetBuildFrameState(): void {
		this.buildFrame.queue.reset();
		this.buildFrame.billboards.reset();
		this.buildFrame.cost = 0;
		this.buildFrame.open = false;
	}

	private resetSubmittedFrameSlot(frame: VdpSubmittedFrameState): void {
		frame.queue.reset();
		frame.occupied = false;
		frame.hasCommands = false;
		frame.hasFrameBufferCommands = false;
		frame.ready = false;
		frame.cost = 0;
		frame.workRemaining = 0;
		frame.ditherType = 0;
		frame.skyboxControl = 0;
		frame.skyboxFaceWords.fill(0);
		frame.billboards.reset();
	}

	private resetQueuedFrameState(): void {
		this.resetBuildFrameState();
		this.clearActiveFrame();
		this.committedBillboards.reset();
		this.pendingFrame.queue.reset();
		this.pendingFrame.billboards.reset();
		this.workCarry = 0n;
		this.availableWorkUnits = 0;
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_VDP);
		this.resetSubmittedFrameSlot(this.pendingFrame);
	}

	private reserveBlitterCommand(opcode: number, renderCost: number): number {
		if (!this.buildFrame.open) {
			throw vdpFault('no submitted frame is open.');
		}
		const queue = this.buildFrame.queue;
		const index = queue.length;
		if (index >= VDP_BLITTER_FIFO_CAPACITY) {
			throw vdpFault(`blitter FIFO overflow (${VDP_BLITTER_FIFO_CAPACITY} commands).`);
		}
		queue.opcode[index] = opcode;
		queue.seq[index] = this.nextBlitterSequence();
		queue.renderCost[index] = renderCost;
		queue.length = index + 1;
		this.buildFrame.cost += renderCost;
		return index;
	}

	private writeGeometryColorCommand(queue: VdpBlitterCommandBuffer, index: number, layerPriority: VdpLayerPriority, geometry: VdpLatchedGeometry, colorWord: number): void {
		queue.layer[index] = layerPriority.layer;
		queue.priority[index] = layerPriority.z;
		queue.x0[index] = geometry.x0;
		queue.y0[index] = geometry.y0;
		queue.x1[index] = geometry.x1;
		queue.y1[index] = geometry.y1;
		queue.colorWord[index] = colorWord;
	}

	private calculateVisibleRectCost(width: number, height: number): number {
		const area = width * height;
		return blitAreaBucket(area);
	}

	private calculateAlphaMultiplier(colorWord: number): number {
		return vdpColorAlphaByte(colorWord) < 255 ? VDP_RENDER_ALPHA_COST_MULTIPLIER : 1;
	}

	private submittedFrameCost(queue: VdpBlitterCommandBuffer, baseCost: number): number {
		if (queue.length === 0 || queue.opcode[0] === VDP_BLITTER_OPCODE_CLEAR) {
			return baseCost;
		}
		return baseCost + VDP_RENDER_CLEAR_COST;
	}

	public swapFrameBufferReadbackPages(): void {
		const renderSlot = this.getVramSlotBySurfaceId(VDP_RD_SURFACE_FRAMEBUFFER);
		const displayReadback = this.displayFrameBufferCpuReadback;
		this.displayFrameBufferCpuReadback = renderSlot.cpuReadback;
		renderSlot.cpuReadback = displayReadback;
		this.invalidateReadCache(VDP_RD_SURFACE_FRAMEBUFFER);
	}

	// disable-next-line single_line_method_pattern -- render-side framebuffer writes invalidate the device read cache through this public pin.
	public invalidateFrameBufferReadCache(): void {
		this.invalidateReadCache(VDP_RD_SURFACE_FRAMEBUFFER);
	}

	public canAcceptSubmittedFrame(): boolean {
		return !this.pendingFrame.occupied;
	}

	public beginSubmittedFrame(): void {
		if (this.buildFrame.open) {
			throw vdpFault('submitted frame already open.');
		}
		this.resetBuildFrameState();
		this.blitterSequence = 0;
		this.buildFrame.open = true;
	}

	public cancelSubmittedFrame(): void {
		this.resetBuildFrameState();
		this.scheduleNextService(this.scheduler.currentNowCycles());
		this.refreshSubmitBusyStatus();
	}

	private assignBuildToSlot(slot: 'active' | 'pending'): void {
		if (!this.buildFrame.open) {
			throw vdpFault('no submitted frame is open.');
		}
		const frame = slot === 'active' ? this.activeFrame : this.pendingFrame;
		if (frame.queue.length !== 0) {
			throw vdpFault(`${slot} frame queue is not empty.`);
		}
		const buildQueue = this.buildFrame.queue;
			const buildBillboards = this.buildFrame.billboards;
		const frameHasFrameBufferCommands = buildQueue.length !== 0;
		const frameHasCommands = frameHasFrameBufferCommands || buildBillboards.length !== 0;
		const frameCost = this.submittedFrameCost(buildQueue, this.buildFrame.cost);
		frame.skyboxControl = this.sbx.latchFrame(frame.skyboxFaceWords);
		this.resolveSkyboxFrameSamples(frame.skyboxControl, frame.skyboxFaceWords, frame.skyboxSamples);
		this.camera.latchFrame(frame.camera);
		this.buildFrame.queue = frame.queue;
		frame.queue = buildQueue;
		this.buildFrame.billboards = frame.billboards;
		frame.billboards = buildBillboards;
		frame.occupied = true;
		frame.hasCommands = frameHasCommands;
		frame.hasFrameBufferCommands = frameHasFrameBufferCommands;
		frame.ready = frameCost === 0;
		frame.cost = frameCost;
		frame.workRemaining = frameCost;
		frame.ditherType = this.liveDitherType;
		this.buildFrame.queue.reset();
		this.buildFrame.billboards.reset();
		this.buildFrame.cost = 0;
		this.buildFrame.open = false;
		this.scheduleNextService(this.scheduler.currentNowCycles());
		this.refreshSubmitBusyStatus();
	}

	public sealSubmittedFrame(): void {
		if (!this.buildFrame.open) {
			throw vdpFault('no submitted frame is open.');
		}
		if (!this.activeFrame.occupied) {
			this.assignBuildToSlot('active');
			return;
		}
		if (!this.pendingFrame.occupied) {
			this.assignBuildToSlot('pending');
			return;
		}
		throw vdpFault('submit slot busy.');
	}

	private promotePendingFrame(): void {
		if (this.activeFrame.occupied || !this.pendingFrame.occupied) {
			return;
		}
		const emptyFrame = this.activeFrame;
		this.activeFrame = this.pendingFrame;
		this.pendingFrame = emptyFrame;
		this.resetSubmittedFrameSlot(this.pendingFrame);
		this.scheduleNextService(this.scheduler.currentNowCycles());
		this.refreshSubmitBusyStatus();
	}

	public advanceWork(workUnits: number): void {
		if (!this.activeFrame.occupied) {
			this.promotePendingFrame();
		}
		if (!this.activeFrame.occupied || this.activeFrame.ready || workUnits <= 0) {
			return;
		}
		if (workUnits >= this.activeFrame.workRemaining) {
			this.activeFrame.workRemaining = 0;
			const activeQueue = this.activeFrame.queue;
			this.activeFrame.queue = this.execution.queue;
			this.execution.queue = activeQueue;
			this.activeFrame.queue.reset();
			this.execution.pending = true;
			this.scheduleNextService(this.scheduler.currentNowCycles());
			return;
		}
		this.activeFrame.workRemaining -= workUnits;
	}

	public needsImmediateSchedulerService(): boolean {
		return !this.activeFrame.occupied && this.pendingFrame.occupied;
	}

	public hasPendingRenderWork(): boolean {
		if (!this.activeFrame.occupied) {
			return this.pendingFrame.occupied && this.pendingFrame.cost > 0;
		}
		return !this.activeFrame.ready && !this.execution.pending;
	}

	public getPendingRenderWorkUnits(): number {
		if (!this.activeFrame.occupied) {
			return this.pendingFrame.cost;
		}
		if (this.activeFrame.ready || this.execution.pending) {
			return 0;
		}
		return this.activeFrame.workRemaining;
	}

	private scheduleNextService(nowCycles: number): void {
		if (this.needsImmediateSchedulerService()) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_VDP, nowCycles);
			return;
		}
		if (!this.hasPendingRenderWork()) {
			this.scheduler.cancelDeviceService(DEVICE_SERVICE_VDP);
			return;
		}
		const pendingWork = this.getPendingRenderWorkUnits();
		const targetUnits = pendingWork < VDP_SERVICE_BATCH_WORK_UNITS ? pendingWork : VDP_SERVICE_BATCH_WORK_UNITS;
		if (this.availableWorkUnits >= targetUnits) {
			this.scheduler.scheduleDeviceService(DEVICE_SERVICE_VDP, nowCycles);
			return;
		}
		this.scheduler.scheduleDeviceService(DEVICE_SERVICE_VDP, nowCycles + cyclesUntilBudgetUnits(this.cpuHz, this.workUnitsPerSec, this.workCarry, targetUnits - this.availableWorkUnits));
	}

	private clearActiveFrame(): void {
		this.activeFrame.queue.reset();
		this.execution.queue.reset();
		this.execution.pending = false;
		this.resetSubmittedFrameSlot(this.activeFrame);
	}

	private commitActiveVisualState(): void {
		this.committedDitherType = this.activeFrame.ditherType;
		this.sbx.presentFrame(this.activeFrame.skyboxControl, this.activeFrame.skyboxFaceWords);
		copyVdpCameraSnapshot(this.committedCamera, this.activeFrame.camera);
		for (let index = 0; index < SKYBOX_FACE_COUNT; index += 1) {
			copyResolvedBlitterSample(this.committedSkyboxSamples[index]!, this.activeFrame.skyboxSamples[index]!);
		}
		const previousBillboards = this.committedBillboards;
		this.committedBillboards = this.activeFrame.billboards;
		this.activeFrame.billboards = previousBillboards;
		this.activeFrame.billboards.reset();
	}

	public presentReadyFrameOnVblankEdge(): void {
		if (!this.activeFrame.occupied) {
			this.lastFrameCommitted = false;
			this.lastFrameCost = 0;
			this.lastFrameHeld = false;
			this.promotePendingFrame();
			this.scheduleNextService(this.scheduler.currentNowCycles());
			this.refreshSubmitBusyStatus();
			return;
		}
		this.lastFrameCost = this.activeFrame.cost;
		if (!this.activeFrame.ready) {
			this.lastFrameCommitted = false;
			this.lastFrameHeld = true;
			return;
		}
		if (this.activeFrame.hasFrameBufferCommands) {
			presentVdpFrameBufferPages(this);
		}
		this.commitActiveVisualState();
		this.lastFrameCommitted = true;
		this.lastFrameHeld = false;
		this.clearActiveFrame();
		this.promotePendingFrame();
		this.scheduleNextService(this.scheduler.currentNowCycles());
		this.refreshSubmitBusyStatus();
	}

	private resolveBlitterSourceWordsInto(slot: number, u: number, v: number, w: number, h: number, target: VdpBlitterSource): void {
		const surfaceId = resolveVdpSlotSurfaceBinding(slot, 'slot', 'surfaceId', `source slot ${slot} is not a VDP blitter slot.`);
		target.surfaceId = surfaceId;
		target.srcX = u;
		target.srcY = v;
		target.width = w;
		target.height = h;
	}

	private resolveBlitterSurfaceForSource(source: VdpBlitterSource): VdpBlitterSurfaceSize {
		if (source.width === 0 || source.height === 0) {
			throw vdpFault('VDP source dimensions must be positive.');
		}
		const surface = this.resolveBlitterSurfaceSize(source.surfaceId);
		if (source.srcX + source.width > surface.width || source.srcY + source.height > surface.height) {
			throw vdpFault('VDP source rectangle exceeds configured slot dimensions.');
		}
		return surface;
	}

	private resolveBlitterSampleWordsInto(slot: number, u: number, v: number, w: number, h: number, target: VdpResolvedBlitterSample): void {
		const source = target.source;
		this.resolveBlitterSourceWordsInto(slot, u, v, w, h, source);
		const surface = this.resolveBlitterSurfaceForSource(source);
		target.surfaceWidth = surface.width;
		target.surfaceHeight = surface.height;
		target.slot = resolveVdpSlotSurfaceBinding(source.surfaceId, 'surfaceId', 'slot', `surface ${source.surfaceId} is not a VDP sample slot.`);
	}

	private latchBillboardPacket(packet: VdpBbuPacket): void {
		const source = this.latchedSourceScratch;
		this.resolveBlitterSourceWordsInto(packet.sourceRect.slot, packet.sourceRect.u, packet.sourceRect.v, packet.sourceRect.w, packet.sourceRect.h, source);
		const surface = this.resolveBlitterSurfaceForSource(source);
		const slot = resolveVdpSlotSurfaceBinding(source.surfaceId, 'surfaceId', 'slot', `surface ${source.surfaceId} is not a VDP sample slot.`);
		this.bbu.latchBillboard(this.buildFrame.billboards, packet, this.nextBlitterSequence(), source.surfaceId, source.srcX, source.srcY, source.width, source.height, surface.width, surface.height, slot);
		this.buildFrame.cost += VDP_RENDER_BILLBOARD_COST;
	}

	private resolveSkyboxFrameSamples(control: number, faceWords: Uint32Array, samples: VdpResolvedBlitterSample[]): void {
		if ((control & VDP_SBX_CONTROL_ENABLE) === 0) {
			return;
		}
		for (let index = 0; index < SKYBOX_FACE_COUNT; index += 1) {
			this.resolveBlitterSampleWordsInto(
				readSkyboxFaceSource(faceWords, index, SKYBOX_FACE_SLOT_WORD),
				readSkyboxFaceSource(faceWords, index, SKYBOX_FACE_U_WORD),
				readSkyboxFaceSource(faceWords, index, SKYBOX_FACE_V_WORD),
				readSkyboxFaceSource(faceWords, index, SKYBOX_FACE_W_WORD),
				readSkyboxFaceSource(faceWords, index, SKYBOX_FACE_H_WORD),
				samples[index]!,
			);
		}
	}

	private enqueueCopyRectWords(srcX: number, srcY: number, width: number, height: number, dstX: number, dstY: number, z: number, layer: Layer2D): void {
		const clipped = computeClippedRect(dstX, dstY, dstX + width, dstY + height, this._frameBufferWidth, this._frameBufferHeight, this.clippedRectScratchA);
		if (clipped.area === 0) {
			return;
		}
		const index = this.reserveBlitterCommand(VDP_BLITTER_OPCODE_COPY_RECT, this.calculateVisibleRectCost(clipped.width, clipped.height));
		const queue = this.buildFrame.queue;
		queue.layer[index] = layer;
		queue.priority[index] = z;
		queue.srcX[index] = srcX;
		queue.srcY[index] = srcY;
		queue.width[index] = width;
		queue.height[index] = height;
		queue.dstX[index] = dstX;
		queue.dstY[index] = dstY;
	}

	public resolveBlitterSurfaceSize(surfaceId: number): VdpBlitterSurfaceSize {
		const surface = this.getReadSurface(surfaceId);
		return {
			width: surface.surfaceWidth,
			height: surface.surfaceHeight,
		};
	}

	public get frameBufferWidth(): number {
		return this._frameBufferWidth;
	}

	public get frameBufferHeight(): number {
		return this._frameBufferHeight;
	}

	public get frameBufferRenderReadback(): Uint8Array {
		return this.getVramSlotBySurfaceId(VDP_RD_SURFACE_FRAMEBUFFER).cpuReadback;
	}

	public get frameBufferDisplayReadback(): Uint8Array {
		return this.displayFrameBufferCpuReadback;
	}

	// start repeated-sequence-acceptable -- VRAM row streaming keeps read/write loops direct; callback helpers would add hot-path overhead.
	public writeVram(addr: number, bytes: Uint8Array): void {
		if (addr >= VRAM_STAGING_BASE && addr + bytes.byteLength <= VRAM_STAGING_BASE + VRAM_STAGING_SIZE) {
			const offset = addr - VRAM_STAGING_BASE;
			this.vramStaging.set(bytes, offset);
			return;
		}
		const slot = this.findMappedVramSlot(addr, bytes.byteLength);
		if (slot === null) {
			this.raiseFault(VDP_FAULT_VRAM_WRITE_UNMAPPED, addr);
			return;
		}
		const offset = addr - slot.baseAddr;
		if ((offset & 3) !== 0 || (bytes.byteLength & 3) !== 0) {
			this.raiseFault(VDP_FAULT_VRAM_WRITE_UNALIGNED, addr);
			return;
		}
		if (slot.surfaceWidth === 0 || slot.surfaceHeight === 0) {
			this.raiseFault(VDP_FAULT_VRAM_WRITE_UNINITIALIZED, addr);
			return;
		}
		const stride = slot.surfaceWidth * 4;
		const rowCount = slot.surfaceHeight;
		const totalBytes = rowCount * stride;
		if (offset + bytes.byteLength > totalBytes) {
			this.raiseFault(VDP_FAULT_VRAM_WRITE_OOB, addr);
			return;
		}
		let remaining = bytes.byteLength;
		let cursor = 0;
		let row = (offset / stride) >>> 0;
		let rowOffset = offset - row * stride;
		while (remaining > 0) {
			const rowAvailable = stride - rowOffset;
			const rowBytes = remaining < rowAvailable ? remaining : rowAvailable;
			const x = rowOffset / 4;
			const width = rowBytes / 4;
			const slice = bytes.subarray(cursor, cursor + rowBytes);
			if (slot.surfaceId === VDP_RD_SURFACE_FRAMEBUFFER) {
				writeVdpRenderFrameBufferPixelRegion(slice, width, 1, x, row);
			} else {
				this.markVramSlotDirty(slot, row, 1);
				this.updateCpuReadback(slot, slice, x, row);
			}
			this.invalidateReadCache(slot.surfaceId);
			remaining -= rowBytes;
			cursor += rowBytes;
			row += 1;
			rowOffset = 0;
		}
	}

	public readVram(addr: number, out: Uint8Array): void {
		if (addr >= VRAM_STAGING_BASE && addr + out.byteLength <= VRAM_STAGING_BASE + VRAM_STAGING_SIZE) {
			const offset = addr - VRAM_STAGING_BASE;
			out.set(this.vramStaging.subarray(offset, offset + out.byteLength));
			return;
		}
		const slot = this.findVramSlot(addr, out.byteLength);
		if (slot.surfaceWidth === 0 || slot.surfaceHeight === 0) {
			out.fill(0);
			return;
		}
		const offset = addr - slot.baseAddr;
		const stride = slot.surfaceWidth * 4;
		const totalBytes = slot.surfaceHeight * stride;
		if (offset + out.byteLength > totalBytes) {
			throw vdpFault('VRAM read out of bounds.');
		}
		let remaining = out.byteLength;
		let cursor = 0;
		let row = (offset / stride) >>> 0;
		let rowOffset = offset - row * stride;
		const buffer = slot.cpuReadback;
		while (remaining > 0) {
			const rowAvailable = stride - rowOffset;
			const rowBytes = remaining < rowAvailable ? remaining : rowAvailable;
			const srcOffset = row * stride + rowOffset;
			out.set(buffer.subarray(srcOffset, srcOffset + rowBytes), cursor);
			remaining -= rowBytes;
			cursor += rowBytes;
			row += 1;
			rowOffset = 0;
		}
	}
	// end repeated-sequence-acceptable

	public beginFrame(): void {
		this.readBudgetBytes = VDP_RD_BUDGET_BYTES;
		this.readOverflow = false;
		this.scheduleNextService(this.scheduler.currentNowCycles());
	}

	public readVdpStatus(): number {
		let status = 0;
		if (this.readBudgetBytes >= 4) {
			status |= VDP_RD_STATUS_READY;
		}
		if (this.readOverflow) {
			status |= VDP_RD_STATUS_OVERFLOW;
		}
		return status;
	}

	public readVdpData(): number {
		const surfaceId = this.memory.readIoU32(IO_VDP_RD_SURFACE);
		const x = this.memory.readIoU32(IO_VDP_RD_X);
		const y = this.memory.readIoU32(IO_VDP_RD_Y);
		const mode = this.memory.readIoU32(IO_VDP_RD_MODE);
		if (mode !== VDP_RD_MODE_RGBA8888) {
			this.raiseFault(VDP_FAULT_RD_UNSUPPORTED_MODE, mode);
			return VDP_OPEN_BUS_WORD;
		}
		if (surfaceId >= VDP_RD_SURFACE_COUNT) {
			this.raiseFault(VDP_FAULT_RD_SURFACE, surfaceId);
			return VDP_OPEN_BUS_WORD;
		}
		const readSurface = this.readSurfaces[surfaceId]!;
		if (!readSurface.registered) {
			this.raiseFault(VDP_FAULT_RD_SURFACE, surfaceId);
			return VDP_OPEN_BUS_WORD;
		}
		const surface = this.getVramSlotBySurfaceId(readSurface.surfaceId);
		const width = surface.surfaceWidth;
		const height = surface.surfaceHeight;
		if (x >= width || y >= height) {
			this.raiseFault(VDP_FAULT_RD_OOB, (x | (y << 16)) >>> 0);
			return VDP_OPEN_BUS_WORD;
		}
		if (this.readBudgetBytes < 4) {
			this.readOverflow = true;
			return 0;
		}
		const cache = this.getReadCache(surfaceId, surface, x, y);
		const localX = x - cache.x0;
		const byteIndex = localX * 4;
		const r = cache.data[byteIndex];
		const g = cache.data[byteIndex + 1];
		const b = cache.data[byteIndex + 2];
		const a = cache.data[byteIndex + 3];
		this.readBudgetBytes -= 4;
		let nextX = x + 1;
		let nextY = y;
		if (nextX >= width) {
			nextX = 0;
			nextY = y + 1;
		}
		this.memory.writeValue(IO_VDP_RD_X, nextX);
		this.memory.writeValue(IO_VDP_RD_Y, nextY);
		return (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
	}

	public initializeRegisters(): void {
		const dither = 0;
		const frameBufferSurface = this.readSurfaces[VDP_RD_SURFACE_FRAMEBUFFER];
		if (frameBufferSurface.registered) {
			const frameBufferSlot = this.getVramSlotBySurfaceId(frameBufferSurface.surfaceId);
			this._frameBufferWidth = frameBufferSlot.surfaceWidth;
			this._frameBufferHeight = frameBufferSlot.surfaceHeight;
		} else {
			this._frameBufferWidth = this.configuredFrameBufferSize.width;
			this._frameBufferHeight = this.configuredFrameBufferSize.height;
		}
		this.resetQueuedFrameState();
		this.blitterSequence = 0;
		this.resetIngressState();
		this.resetStatus();
		this.memory.writeIoValue(IO_VDP_RD_SURFACE, VDP_RD_SURFACE_SYSTEM);
		this.memory.writeIoValue(IO_VDP_RD_X, 0);
		this.memory.writeIoValue(IO_VDP_RD_Y, 0);
		this.memory.writeIoValue(IO_VDP_RD_MODE, VDP_RD_MODE_RGBA8888);
		this.memory.writeIoValue(IO_VDP_DITHER, dither);
		this.memory.writeIoValue(IO_VDP_SLOT_PRIMARY_ATLAS, VDP_SLOT_ATLAS_NONE);
		this.memory.writeIoValue(IO_VDP_SLOT_SECONDARY_ATLAS, VDP_SLOT_ATLAS_NONE);
		this.memory.writeIoValue(IO_VDP_CMD, 0);
		this.resetVdpRegisters();
		this.pmu.reset();
		this.syncPmuRegisterWindow();
		this.camera.reset();
		this.liveDitherType = dither;
		this.committedDitherType = dither;
		this.sbx.reset();
		this.syncSbxRegisterWindow();
		this.syncCameraRegisterWindow();
		this.lastFrameCommitted = true;
		this.lastFrameCost = 0;
		this.lastFrameHeld = false;
	}

	public captureState(): VdpState {
		return {
			camera: this.camera.captureState(),
			skyboxControl: this.sbx.liveControlWord,
			skyboxFaceWords: this.sbx.captureLiveFaceWords(),
			pmuSelectedBank: this.pmu.selectedBankIndex,
			pmuBankWords: this.pmu.captureBankWords(),
			ditherType: this.liveDitherType,
			vdpStatus: this.vdpStatus,
			vdpFaultCode: this.faultCode,
			vdpFaultDetail: this.faultDetail,
		};
	}

	public captureSaveState(): VdpSaveState {
		const displayBytes = this._frameBufferWidth * this._frameBufferHeight * 4;
		return {
			...this.captureState(),
			vramStaging: this.vramStaging.slice(),
			surfacePixels: this.captureSurfacePixels(),
			displayFrameBufferPixels: readVdpDisplayFrameBufferPixels(0, 0, this._frameBufferWidth, this._frameBufferHeight, new Uint8Array(displayBytes)),
		};
	}

	public restoreState(state: VdpState): void {
		if (state.skyboxFaceWords.length !== SKYBOX_FACE_WORD_COUNT) {
			throw vdpFault(`SBX state requires ${SKYBOX_FACE_WORD_COUNT} face words.`);
		}
		this.camera.writeCameraBank0(state.camera.view, state.camera.proj, state.camera.eye[0], state.camera.eye[1], state.camera.eye[2]);
		this.sbx.restoreLiveState(state.skyboxControl, state.skyboxFaceWords);
		if (state.pmuBankWords.length !== VDP_PMU_BANK_WORD_COUNT) {
			throw vdpFault(`PMU state requires ${VDP_PMU_BANK_WORD_COUNT} bank words.`);
		}
		this.pmu.restoreBankWords(state.pmuSelectedBank, state.pmuBankWords);
		this.syncPmuRegisterWindow();
		this.syncSbxRegisterWindow();
		this.syncCameraRegisterWindow();
		this.memory.writeValue(IO_VDP_DITHER, state.ditherType);
		this.vdpStatus = state.vdpStatus >>> 0;
		this.faultCode = state.vdpFaultCode >>> 0;
		this.faultDetail = state.vdpFaultDetail >>> 0;
		this.memory.writeIoValue(IO_VDP_STATUS, this.vdpStatus);
		this.memory.writeIoValue(IO_VDP_FAULT_CODE, this.faultCode);
		this.memory.writeIoValue(IO_VDP_FAULT_DETAIL, this.faultDetail);
		this.commitLiveVisualState();
	}

	public restoreSaveState(state: VdpSaveState): void {
		this.restoreState(state);
		this.vramStaging.set(state.vramStaging);
		for (let index = 0; index < state.surfacePixels.length; index += 1) {
			this.restoreSurfacePixels(state.surfacePixels[index]);
		}
		syncVdpSlotTextures(this);
		this.displayFrameBufferCpuReadback.set(state.displayFrameBufferPixels);
		writeVdpDisplayFrameBufferPixels(state.displayFrameBufferPixels, this._frameBufferWidth, this._frameBufferHeight);
	}

	public readHostOutput(): VdpHostOutput {
		const output = this.hostOutputState;
		output.executionQueue = this.execution.pending ? this.execution.queue : null;
		output.executionBillboards = this.activeFrame.billboards;
		output.executionWritesFrameBuffer = this.activeFrame.hasFrameBufferCommands;
		output.ditherType = this.committedDitherType;
		output.camera = this.committedCamera;
		output.skyboxEnabled = this.sbx.visibleEnabled;
		output.skyboxSamples = this.committedSkyboxSamples;
		output.billboards = this.committedBillboards;
		output.surfaceUploadSlots = this.vramSlots;
		output.frameBufferWidth = this._frameBufferWidth;
		output.frameBufferHeight = this._frameBufferHeight;
		output.frameBufferRenderReadback = this.frameBufferRenderReadback;
		return output;
	}

	public completeHostExecution(output: VdpHostOutput): void {
		const queue = output.executionQueue;
		if (!this.execution.pending || queue !== this.execution.queue) {
			throw vdpFault('no active frame execution pending.');
		}
		if (output.executionWritesFrameBuffer) {
			this.invalidateFrameBufferReadCache();
		}
		this.execution.pending = false;
		this.activeFrame.ready = true;
		this.execution.queue.reset();
		this.hostOutputState.executionQueue = null;
	}

	public clearSurfaceUploadDirty(surfaceId: number): void {
		const slot = this.getVramSlotBySurfaceId(surfaceId);
		slot.dirtyRowStart = 0;
		slot.dirtyRowEnd = 0;
	}

	private commitLiveVisualState(): void {
		this.committedDitherType = this.liveDitherType;
		this.committedBillboards.reset();
		this.sbx.presentLiveState();
		this.camera.latchFrame(this.committedCamera);
		this.resolveSkyboxFrameSamples(this.sbx.liveControlWord, this.sbx.visibleFaceState, this.committedSkyboxSamples);
	}

	private captureSurfacePixels(): VdpSurfacePixelsState[] {
		const surfaces = new Array<VdpSurfacePixelsState>(this.vramSlots.length);
		for (let index = 0; index < this.vramSlots.length; index += 1) {
			const slot = this.vramSlots[index];
			const pixels = slot.surfaceId === VDP_RD_SURFACE_FRAMEBUFFER
				? readVdpRenderFrameBufferPixels(0, 0, slot.surfaceWidth, slot.surfaceHeight, new Uint8Array(slot.surfaceWidth * slot.surfaceHeight * 4))
				: slot.cpuReadback.slice();
			surfaces[index] = {
				surfaceId: slot.surfaceId,
				pixels,
			};
		}
		return surfaces;
	}

	private restoreSurfacePixels(state: VdpSurfacePixelsState): void {
		const slot = this.getVramSlotBySurfaceId(state.surfaceId);
		slot.cpuReadback.set(state.pixels);
		this.invalidateReadCache(state.surfaceId);
		if (state.surfaceId === VDP_RD_SURFACE_FRAMEBUFFER) {
			writeVdpRenderFrameBufferPixels(slot.cpuReadback, slot.surfaceWidth, slot.surfaceHeight);
			return;
		}
		this.markVramSlotDirty(slot, 0, slot.surfaceHeight);
	}

	public registerVramSurfaces(surfaces: readonly VdpVramSurface[]): void {
		this.resetQueuedFrameState();
		this.vramSlots = [];
		this.readSurfaces = createReadSurfaceEntries();
		for (let index = 0; index < this.readCaches.length; index += 1) {
			this.readCaches[index].width = 0;
		}
		this.displayFrameBufferCpuReadback = new Uint8Array(0);
		this.sbx.reset();
		this.syncSbxRegisterWindow();
		this.committedDitherType = this.liveDitherType;
		this.seedVramStaging();
		for (let index = 0; index < surfaces.length; index += 1) {
			this.registerVramSlot(surfaces[index]);
		}
	}

	private setVramSlotLogicalDimensions(slot: VramSlot, width: number, height: number): void {
		const byteLength = width * height * 4;
		if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || byteLength > slot.capacity) {
			throw vdpFault(`invalid VRAM surface dimensions ${width}x${height} for surface ${slot.surfaceId}.`);
		}
		if (slot.surfaceWidth === width && slot.surfaceHeight === height) {
			return;
		}
		const previous = slot.cpuReadback;
		slot.surfaceWidth = width;
		slot.surfaceHeight = height;
		slot.cpuReadback = new Uint8Array(byteLength);
		this.invalidateReadCache(slot.surfaceId);
		if (slot.surfaceId === VDP_RD_SURFACE_FRAMEBUFFER) {
			this._frameBufferWidth = width;
			this._frameBufferHeight = height;
			this.displayFrameBufferCpuReadback = new Uint8Array(byteLength);
		}
		if (slot.surfaceId === VDP_RD_SURFACE_SYSTEM) {
			slot.dirtyRowStart = 0;
			slot.dirtyRowEnd = 0;
			return;
		}
		this.seedVramSlotTexture(slot);
		const copyBytes = previous.byteLength < slot.cpuReadback.byteLength ? previous.byteLength : slot.cpuReadback.byteLength;
		slot.cpuReadback.set(previous.subarray(0, copyBytes));
	}

	public setDecodedVramSurfaceDimensions(baseAddr: number, width: number, height: number): void {
		const slot = this.findVramSlot(baseAddr, 1);
		this.setVramSlotLogicalDimensions(slot, width, height);
	}

	public configureVramSlotSurface(slotId: number, width: number, height: number): void {
		if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
			throw vdpFault(`invalid VRAM surface dimensions ${width}x${height}.`);
		}
		const surfaceId = resolveVdpSlotSurfaceBinding(slotId, 'slot', 'surfaceId', `source slot ${slotId} is not a VDP blitter slot.`);
		const slot = this.getVramSlotBySurfaceId(surfaceId);
		const byteLength = width * height * 4;
		if (byteLength > slot.capacity) {
			throw vdpFault(`VRAM surface ${width}x${height} exceeds slot capacity ${slot.capacity}.`);
		}
		this.setVramSlotLogicalDimensions(slot, width, height);
	}

	private invalidateReadCache(surfaceId: number): void {
		this.readCaches[surfaceId].width = 0;
	}

	private markVramSlotDirty(slot: VramSlot, startRow: number, rowCount: number): void {
		const endRow = startRow + rowCount;
		if (slot.dirtyRowStart >= slot.dirtyRowEnd) {
			slot.dirtyRowStart = startRow;
			slot.dirtyRowEnd = endRow;
			return;
		}
		if (startRow < slot.dirtyRowStart) {
			slot.dirtyRowStart = startRow;
		}
		if (endRow > slot.dirtyRowEnd) {
			slot.dirtyRowEnd = endRow;
		}
	}

	private registerReadSurface(slot: VramSlot): void {
		this.readSurfaces[slot.surfaceId].surfaceId = slot.surfaceId;
		this.readSurfaces[slot.surfaceId].registered = true;
		this.invalidateReadCache(slot.surfaceId);
	}

	private getReadSurface(surfaceId: number): VramSlot {
		const surface = this.readSurfaces[surfaceId];
		if (!surface.registered) {
			throw vdpFault(`read surface ${surfaceId} is not registered.`);
		}
		return this.getVramSlotBySurfaceId(surface.surfaceId);
	}

	private getReadCache(surfaceId: number, surface: VramSlot, x: number, y: number): VdpReadCache {
		const cache = this.readCaches[surfaceId];
		if (cache.width === 0 || cache.y !== y || x < cache.x0 || x >= cache.x0 + cache.width) {
			this.prefetchReadCache(cache, surface, x, y);
		}
		return cache;
	}

	private prefetchReadCache(cache: VdpReadCache, surface: VramSlot, x: number, y: number): void {
		const width = surface.surfaceWidth;
		const maxPixelsByBudget = this.readBudgetBytes >>> 2;
		if (maxPixelsByBudget <= 0) {
			this.readOverflow = true;
			cache.width = 0;
			return;
		}
		const remainingWidth = width - x;
		const chunkLimit = VDP_RD_MAX_CHUNK_PIXELS < remainingWidth ? VDP_RD_MAX_CHUNK_PIXELS : remainingWidth;
		const chunkW = chunkLimit < maxPixelsByBudget ? chunkLimit : maxPixelsByBudget;
		const data = this.readSurfacePixels(cache, surface, x, y, chunkW, 1);
		cache.x0 = x;
		cache.y = y;
		cache.width = chunkW;
		cache.data = data;
	}

	private readSurfacePixels(cache: VdpReadCache, surface: VramSlot, x: number, y: number, width: number, height: number): Uint8Array {
		if (surface.surfaceId === VDP_RD_SURFACE_FRAMEBUFFER) {
			const byteLength = width * height * 4;
			const out = cache.data.byteLength < byteLength ? (cache.data = new Uint8Array(byteLength)) : cache.data;
			return readVdpRenderFrameBufferPixels(x, y, width, height, out);
		}
		return this.readCpuReadback(cache, surface, x, y, width, height);
	}

	private readCpuReadback(cache: VdpReadCache, surface: VramSlot, x: number, y: number, width: number, height: number): Uint8Array {
		const buffer = surface.cpuReadback;
		const stride = surface.surfaceWidth * 4;
		const rowBytes = width * 4;
		const byteLength = rowBytes * height;
		const out = cache.data.byteLength < byteLength ? (cache.data = new Uint8Array(byteLength)) : cache.data;
		for (let row = 0; row < height; row += 1) {
			const srcOffset = (y + row) * stride + x * 4;
			const dstOffset = row * rowBytes;
			out.set(buffer.subarray(srcOffset, srcOffset + rowBytes), dstOffset);
		}
		return out;
	}

	private updateCpuReadback(surface: VramSlot, slice: Uint8Array, x: number, y: number): void {
		const buffer = surface.cpuReadback;
		const stride = surface.surfaceWidth * 4;
		const offset = y * stride + x * 4;
		buffer.set(slice, offset);
	}

	public get trackedUsedVramBytes(): number {
		let usedBytes = 0;
		for (let index = 0; index < this.vramSlots.length; index += 1) {
			const slot = this.vramSlots[index];
			usedBytes += slot.surfaceWidth * slot.surfaceHeight * 4;
		}
		return usedBytes;
	}

	public get trackedTotalVramBytes(): number {
		return VRAM_SYSTEM_SLOT_SIZE + VRAM_PRIMARY_SLOT_SIZE + VRAM_SECONDARY_SLOT_SIZE + VRAM_FRAMEBUFFER_SIZE + VRAM_STAGING_SIZE;
	}

	private registerVramSlot(surface: VdpVramSurface): void {
		const isSystemSlot = surface.surfaceId === VDP_RD_SURFACE_SYSTEM;
		const byteLength = surface.width * surface.height * 4;
		if (surface.width <= 0 || surface.height <= 0 || byteLength > surface.capacity) {
			throw vdpFault(`VRAM surface ${surface.surfaceId} has invalid dimensions.`);
		}
		const stream = this.makeVramGarbageStream(surface.baseAddr >>> 0);
		fillVramGarbageScratch(this.vramSeedPixel, stream);
		const slot: VramSlot = {
			baseAddr: surface.baseAddr,
			capacity: surface.capacity,
			surfaceId: surface.surfaceId,
			surfaceWidth: surface.width,
			surfaceHeight: surface.height,
			cpuReadback: new Uint8Array(byteLength),
			dirtyRowStart: 0,
			dirtyRowEnd: 0,
		};
		if (slot.surfaceId === VDP_RD_SURFACE_FRAMEBUFFER) {
			this._frameBufferWidth = surface.width;
			this._frameBufferHeight = surface.height;
			this.displayFrameBufferCpuReadback = new Uint8Array(byteLength);
		}
		this.vramSlots.push(slot);
		this.registerReadSurface(slot);
		if (!isSystemSlot) {
			this.seedVramSlotTexture(slot);
		}
	}

	private getVramSlotBySurfaceId(surfaceId: number): VramSlot {
		const slot = this.findRegisteredVramSlotBySurfaceId(surfaceId);
		if (slot !== null) {
			return slot;
		}
		throw vdpFault(`VRAM slot not registered for surface ${surfaceId}.`);
	}

	private findRegisteredVramSlotBySurfaceId(surfaceId: number): VramSlot | null {
		for (let index = 0; index < this.vramSlots.length; index += 1) {
			const slot = this.vramSlots[index];
			if (slot.surfaceId === surfaceId) {
				return slot;
			}
		}
		return null;
	}

	private makeVramGarbageStream(addr: number): VramGarbageStream {
		return {
			machineSeed: this.vramMachineSeed,
			bootSeed: this.vramBootSeed,
			slotSalt: VRAM_GARBAGE_SPACE_SALT >>> 0,
			addr: addr >>> 0,
		};
	}

	private seedVramStaging(): void {
		const stream = this.makeVramGarbageStream(VRAM_STAGING_BASE >>> 0);
		fillVramGarbageScratch(this.vramStaging, stream);
	}

	private seedVramSlotTexture(slot: VramSlot): void {
		const width = slot.surfaceWidth;
		const height = slot.surfaceHeight;
		const rowPixels = width;
		const maxPixels = this.vramGarbageScratch.byteLength >>> 2;
		const stream = this.makeVramGarbageStream(slot.baseAddr >>> 0);
		const frameBufferSlot = slot.surfaceId === VDP_RD_SURFACE_FRAMEBUFFER;
		if (rowPixels <= maxPixels) {
			const rowsPerChunk = (maxPixels / rowPixels) >>> 0;
			for (let y = 0; y < height;) {
				const rowsRemaining = height - y;
				const rows = rowsPerChunk < rowsRemaining ? rowsPerChunk : rowsRemaining;
				const chunkBytes = rowPixels * rows * 4;
				const chunk = this.vramGarbageScratch.subarray(0, chunkBytes);
				fillVramGarbageScratch(chunk, stream);
				if (!frameBufferSlot) {
					this.markVramSlotDirty(slot, y, rows);
				}
				for (let row = 0; row < rows; row += 1) {
					const rowOffset = row * rowPixels * 4;
					const slice = chunk.subarray(rowOffset, rowOffset + rowPixels * 4);
					this.updateCpuReadback(slot, slice, 0, y + row);
				}
				y += rows;
			}
		} else {
			for (let y = 0; y < height; y += 1) {
				for (let x = 0; x < width;) {
					const widthRemaining = width - x;
					const segmentWidth = maxPixels < widthRemaining ? maxPixels : widthRemaining;
					const segmentBytes = segmentWidth * 4;
					const segment = this.vramGarbageScratch.subarray(0, segmentBytes);
					fillVramGarbageScratch(segment, stream);
					if (!frameBufferSlot) {
						this.markVramSlotDirty(slot, y, 1);
					}
					this.updateCpuReadback(slot, segment, x, y);
					x += segmentWidth;
				}
			}
		}
		this.invalidateReadCache(slot.surfaceId);
	}

	private findVramSlot(addr: number, length: number): VramSlot {
		const slot = this.findMappedVramSlot(addr, length);
		if (slot !== null) {
			return slot;
		}
		throw vdpFault(`VRAM write has no mapped slot (addr=${addr}, len=${length}).`);
	}

	private findMappedVramSlot(addr: number, length: number): VramSlot | null {
		for (let index = 0; index < this.vramSlots.length; index += 1) {
			const slot = this.vramSlots[index];
			if (addr >= slot.baseAddr && addr + length <= slot.baseAddr + slot.capacity) {
				return slot;
			}
		}
		return null;
	}

}
