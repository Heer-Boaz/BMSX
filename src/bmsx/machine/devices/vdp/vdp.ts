import type { color } from '../../../common/color';
import {
	type Layer2D,
	type SkyboxFaceSources,
	type VdpFrameBufferSize,
	type VdpSlotSource,
	type VdpVramSurface,
	VDP_RD_SURFACE_COUNT,
	VDP_RD_SURFACE_SYSTEM,
	VDP_RD_SURFACE_FRAMEBUFFER,
	VDP_RD_SURFACE_PRIMARY,
	VDP_RD_SURFACE_SECONDARY,
} from './contracts';
import {
	VDP_RENDER_ALPHA_COST_MULTIPLIER,
	VDP_RENDER_CLEAR_COST,
	blitAreaBucket,
	blitSpanBucket,
	computeClippedLineSpan,
	computeClippedRect,
	tileRunCost,
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
	IO_VDP_CMD,
	IO_VDP_CMD_ARG0,
	IO_VDP_CMD_ARG_COUNT,
	IO_VDP_FIFO,
	IO_VDP_FIFO_CTRL,
	IO_VDP_SLOT_PRIMARY_ATLAS,
	IO_VDP_SLOT_SECONDARY_ATLAS,
	IO_VDP_RD_DATA,
	IO_VDP_RD_MODE,
	IO_VDP_RD_STATUS,
	IO_VDP_RD_SURFACE,
	IO_VDP_RD_X,
	IO_VDP_RD_Y,
	IO_VDP_STATUS,
	VDP_FIFO_CTRL_SEAL,
	VDP_RD_MODE_RGBA8888,
	VDP_RD_STATUS_OVERFLOW,
	VDP_RD_STATUS_READY,
	VDP_SLOT_ATLAS_NONE,
	VDP_SLOT_NONE,
	VDP_SLOT_PRIMARY,
	VDP_SLOT_SECONDARY,
	VDP_SLOT_SYSTEM,
	VDP_SYSTEM_ATLAS_ID,
	VDP_STATUS_SUBMIT_BUSY,
	VDP_STATUS_SUBMIT_REJECTED,
	VDP_STATUS_VBLANK,
} from '../../bus/io';
import type { VramWriteSink } from '../../memory/memory';
import { Memory } from '../../memory/memory';
import type { CPU } from '../../cpu/cpu';
import type { Api } from '../../firmware/api/api';
import { cyclesUntilBudgetUnits } from '../../scheduler/budget';
import { DEVICE_SERVICE_VDP, type DeviceScheduler } from '../../scheduler/device';
import type { BFont } from '../../../render/shared/bitmap_font';
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
	VDP_STREAM_PACKET_HEADER_WORDS,
	VDP_STREAM_PAYLOAD_CAPACITY_WORDS,
} from '../../memory/map';
import { fmix32, scramble32, signed8FromHash, xorshift32 } from '../../common/hash';
import { processVdpBufferedCommand, processVdpCommand } from './command_processor';
import { vdpFault, vdpStreamFault } from './fault';
import { getVdpPacketSchema } from './packet_schema';
import { syncVdpSlotTextures } from '../../../render/vdp/slot_textures';

export type VdpState = {
	skyboxFaceSources: SkyboxFaceSources | null;
	ditherType: number;
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

type VdpSubmittedFrameState = {
	queue: VdpBlitterCommand[];
	occupied: boolean;
	hasCommands: boolean;
	ready: boolean;
	cost: number;
	workRemaining: number;
	ditherType: number;
	hasSkybox: boolean;
	skyboxFaceSources: SkyboxFaceSources;
};

type VdpBuildingFrameState = {
	queue: VdpBlitterCommand[];
	open: boolean;
	cost: number;
};

type VdpExecutionState = {
	queue: VdpBlitterCommand[];
	pending: boolean;
};

const VDP_SERVICE_BATCH_WORK_UNITS = 128;
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

function resolveAtlasSlotFromMemory(memory: Memory, atlasId: number): number {
	if (atlasId === VDP_SYSTEM_ATLAS_ID) {
		return VDP_SLOT_SYSTEM;
	}
	if (memory.readIoU32(IO_VDP_SLOT_PRIMARY_ATLAS) === atlasId) {
		return VDP_SLOT_PRIMARY;
	}
	if (memory.readIoU32(IO_VDP_SLOT_SECONDARY_ATLAS) === atlasId) {
		return VDP_SLOT_SECONDARY;
	}
	throw vdpFault(`atlas ${atlasId} is not loaded in a VDP slot.`);
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
const VRAM_GARBAGE_CHUNK_BYTES = 64 * 1024;
const VRAM_GARBAGE_SPACE_SALT = 0x5652414d;
const VRAM_GARBAGE_WEIGHT_BLOCK = 1;
const VRAM_GARBAGE_WEIGHT_ROW = 2;
const VRAM_GARBAGE_WEIGHT_PAGE = 4;
const VRAM_GARBAGE_OCTAVES = [
	{ shift: 11, weight: 8, mul: 0x165667b1, mix: 0xd3a2646c },
	{ shift: 15, weight: 12, mul: 0x27d4eb2f, mix: 0x6c8e9cf5 },
	{ shift: 17, weight: 16, mul: 0x7f4a7c15, mix: 0x31415926 },
	{ shift: 19, weight: 20, mul: 0xa24baed5, mix: 0x9e3779b9 },
	{ shift: 21, weight: 24, mul: 0x6a09e667, mix: 0xbb67ae85 },
] as const;
const VRAM_GARBAGE_FORCE_T0 = 120;
const VRAM_GARBAGE_FORCE_T1 = 280;
const VRAM_GARBAGE_FORCE_T2 = 480;
const VRAM_GARBAGE_FORCE_T_DEN = 1000;

type VramGarbageStream = {
	machineSeed: number;
	bootSeed: number;
	slotSalt: number;
	addr: number;
};

type BlockGen = {
	forceMask: number;
	prefWord: number;
	weakMask: number;
	baseState: number;
	bootState: number;
	genWordPos: number;
};

type BiasConfig = {
	activeOctaves: number;
	threshold0: number;
	threshold1: number;
	threshold2: number;
};

function garbageForceThreshold(maxBias: number, threshold: number): number {
	return ((maxBias * threshold) / VRAM_GARBAGE_FORCE_T_DEN) | 0;
}

function makeBiasConfig(vramBytes: number): BiasConfig {
	const maxOctaveBytes = vramBytes >>> 1;
	let weightSum = VRAM_GARBAGE_WEIGHT_BLOCK + VRAM_GARBAGE_WEIGHT_ROW + VRAM_GARBAGE_WEIGHT_PAGE;
	let activeOctaves = 0;
	for (let i = 0; i < VRAM_GARBAGE_OCTAVES.length; i += 1) {
		const octave = VRAM_GARBAGE_OCTAVES[i];
		const octaveBytes = (1 << (octave.shift + 5)) >>> 0;
		if (octaveBytes > maxOctaveBytes) {
			break;
		}
		weightSum += octave.weight;
		activeOctaves = i + 1;
	}
	const maxBias = weightSum * 127;
	const threshold0 = garbageForceThreshold(maxBias, VRAM_GARBAGE_FORCE_T0);
	const threshold1 = garbageForceThreshold(maxBias, VRAM_GARBAGE_FORCE_T1);
	const threshold2 = garbageForceThreshold(maxBias, VRAM_GARBAGE_FORCE_T2);
	return {
		activeOctaves,
		threshold0,
		threshold1,
		threshold2,
	};
}

function frameBufferColorByte(value: number): number {
	return (value * 255 + 0.5) | 0;
}

function initBlockGen(biasSeed: number, bootSeedMix: number, blockIndex: number, biasConfig: BiasConfig): BlockGen {
	const pageIndex = blockIndex >>> 7;
	const rowIndex = blockIndex >>> 3;

	const pageH = fmix32((biasSeed ^ Math.imul(pageIndex, 0xc2b2ae35) ^ 0xa5a5a5a5) >>> 0);
	const rowH = fmix32((biasSeed ^ Math.imul(rowIndex, 0x85ebca6b) ^ 0x1b873593) >>> 0);
	const blkH = fmix32((biasSeed ^ Math.imul(blockIndex, 0x9e3779b9) ^ 0x85ebca77) >>> 0);

	let bias =
		signed8FromHash(pageH) * VRAM_GARBAGE_WEIGHT_PAGE +
		signed8FromHash(rowH) * VRAM_GARBAGE_WEIGHT_ROW +
		signed8FromHash(blkH) * VRAM_GARBAGE_WEIGHT_BLOCK;

	let macroH = pageH;
	for (let i = 0; i < biasConfig.activeOctaves; i += 1) {
		const octave = VRAM_GARBAGE_OCTAVES[i];
		const octaveIndex = blockIndex >>> octave.shift;
		const octaveH = fmix32((biasSeed ^ Math.imul(octaveIndex, octave.mul) ^ octave.mix) >>> 0);
		bias += signed8FromHash(octaveH) * octave.weight;
		macroH = octaveH;
	}

	const absBias = bias < 0 ? -bias : bias;

	const forceLevel =
		absBias < biasConfig.threshold0 ? 0 :
			absBias < biasConfig.threshold1 ? 1 :
				absBias < biasConfig.threshold2 ? 2 : 3;

	const jitterLevel = 3 - forceLevel;

	let ps = (blkH ^ rowH ^ 0xdeadbeef) >>> 0;
	ps |= 1;

	ps = xorshift32(ps); const m1 = scramble32(ps);
	ps = xorshift32(ps); const m2 = scramble32(ps);
	ps = xorshift32(ps);
	const prefWord = scramble32(macroH);
	ps = xorshift32(ps); const w1 = scramble32(ps);
	ps = xorshift32(ps); const w2 = scramble32(ps);
	ps = xorshift32(ps); const w3 = scramble32(ps);
	ps = xorshift32(ps); const w4 = scramble32(ps);

	let forceMask = 0;
	switch (forceLevel) {
		case 0: forceMask = 0; break;
		case 1: forceMask = (m1 & m2) >>> 0; break;
		case 2: forceMask = m1 >>> 0; break;
		default: forceMask = (m1 | m2) >>> 0; break;
	}

	let weak = (w1 & w2 & w3) >>> 0;
	if (jitterLevel <= 2) weak &= w4;
	if (jitterLevel <= 1) weak &= (weak >>> 1);
	if (jitterLevel <= 0) weak = 0;
	weak &= (~forceMask) >>> 0;

	const baseState = ((blkH ^ 0xa1b2c3d4) >>> 0) | 1;
	const bootState = (fmix32((bootSeedMix ^ Math.imul(blockIndex, 0x7f4a7c15) ^ 0x31415926) >>> 0) | 1) >>> 0;

	return {
		forceMask,
		prefWord,
		weakMask: weak >>> 0,
		baseState,
		bootState,
		genWordPos: 0,
	};
}

function nextWord(gen: BlockGen): number {
	gen.baseState = xorshift32(gen.baseState);
	gen.bootState = xorshift32(gen.bootState);
	gen.genWordPos += 1;

	const baseWord = scramble32(gen.baseState);
	const bootWord = scramble32(gen.bootState);

	let word = (baseWord & ~gen.forceMask) | (gen.prefWord & gen.forceMask);
	word ^= (bootWord & gen.weakMask);
	return word >>> 0;
}

function fillVramGarbageScratch(buffer: Uint8Array, s: VramGarbageStream): void {
	const total = buffer.byteLength;
	const startAddr = s.addr >>> 0;

	const biasSeed = (s.machineSeed ^ s.slotSalt) >>> 0;
	const bootSeedMix = (s.bootSeed ^ s.slotSalt) >>> 0;
	const vramBytes = (VRAM_SECONDARY_SLOT_BASE + VRAM_SECONDARY_SLOT_SIZE - VRAM_STAGING_BASE) >>> 0;
	const biasConfig = makeBiasConfig(vramBytes);

	const BLOCK_BYTES = 32;
	const BLOCK_SHIFT = 5;

	let out = 0;

	const aligned4 = (((startAddr | total) & 3) === 0);

	while (out < total) {
		const addr = (startAddr + out) >>> 0;
		const blockIndex = addr >>> BLOCK_SHIFT;
		const blockBase = (blockIndex << BLOCK_SHIFT) >>> 0;

		const startOff = (addr - blockBase) >>> 0;
		const blockRemaining = BLOCK_BYTES - startOff;
		const writeRemaining = total - out;
		const maxBytesThisBlock = blockRemaining < writeRemaining ? blockRemaining : writeRemaining;

		const gen = initBlockGen(biasSeed, bootSeedMix, blockIndex, biasConfig);

		if (aligned4 && startOff === 0 && maxBytesThisBlock === BLOCK_BYTES) {
			for (let w = 0; w < 8; w += 1) {
				const word = nextWord(gen);
				const p = out + (w << 2);
				buffer[p] = word & 0xff;
				buffer[p + 1] = (word >>> 8) & 0xff;
				buffer[p + 2] = (word >>> 16) & 0xff;
				buffer[p + 3] = (word >>> 24) & 0xff;
			}
		} else {
			const rangeStart = startOff;
			const rangeEnd = startOff + maxBytesThisBlock;

			for (let w = 0; w < 8; w += 1) {
				const word = nextWord(gen);
				const wordByteStart = w << 2;
				const wordByteEnd = wordByteStart + 4;
				const a0 = wordByteStart > rangeStart ? wordByteStart : rangeStart;
				const a1 = wordByteEnd < rangeEnd ? wordByteEnd : rangeEnd;
				if (a0 >= a1) {
					continue;
				}
				let tmp = word >>> ((a0 - wordByteStart) << 3);
				for (let k = a0; k < a1; k += 1) {
					buffer[out + (k - rangeStart)] = tmp & 0xff;
					tmp >>>= 8;
				}
			}
		}

		out += maxBytesThisBlock;
	}

	s.addr = (startAddr + total) >>> 0;
}

type VdpReadSurface = VdpSurfaceUploadSlot;

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

type VramSlot = VdpSurfaceUploadSlot;

export type VdpFrameBufferColor = {
	r: number;
	g: number;
	b: number;
	a: number;
};

export type VdpBlitterSource = {
	surfaceId: number;
	srcX: number;
	srcY: number;
	width: number;
	height: number;
};

export type VdpResolvedBlitterSample = {
	source: VdpBlitterSource;
	surfaceWidth: number;
	surfaceHeight: number;
	slot: number;
};

export type VdpBlitterSurfaceSize = {
	width: number;
	height: number;
};

export type VdpGlyphRunGlyph = VdpBlitterSource & {
	dstX: number;
	dstY: number;
	advance: number;
};

export type VdpTileRunBlit = VdpBlitterSource & {
	dstX: number;
	dstY: number;
};

export type VdpTileRunInputBase = {
	cols: number;
	rows: number;
	tile_w: number;
	tile_h: number;
	origin_x: number;
	origin_y: number;
	scroll_x: number;
	scroll_y: number;
	z: number;
	layer: Layer2D;
};

export type VdpSourceTileRunInput = VdpTileRunInputBase & {
	sources: Array<VdpSlotSource | false>;
};

export type VdpPayloadTileRunInput = VdpTileRunInputBase & {
	payload_base: number;
	tile_count: number;
};

export type VdpPayloadWordsTileRunInput = VdpTileRunInputBase & {
	payload_words: Uint32Array;
	payload_word_offset: number;
	tile_count: number;
};

type VdpTileRunInput = VdpSourceTileRunInput | VdpPayloadTileRunInput | VdpPayloadWordsTileRunInput;
const VDP_TILE_RUN_SOURCE_DIRECT = 0;
const VDP_TILE_RUN_SOURCE_PAYLOAD = 1;
const VDP_TILE_RUN_SOURCE_PAYLOAD_WORDS = 2;
type VdpTileRunSourceKind = typeof VDP_TILE_RUN_SOURCE_DIRECT | typeof VDP_TILE_RUN_SOURCE_PAYLOAD | typeof VDP_TILE_RUN_SOURCE_PAYLOAD_WORDS;

export type VdpBlitterClearCommand = {
	opcode: 'clear';
	seq: number;
	renderCost: number;
	color: VdpFrameBufferColor;
};

export type VdpBlitterBlitCommand = {
	opcode: 'blit';
	seq: number;
	renderCost: number;
	layer: Layer2D;
	z: number;
	source: VdpBlitterSource;
	dstX: number;
	dstY: number;
	scaleX: number;
	scaleY: number;
	flipH: boolean;
	flipV: boolean;
	color: VdpFrameBufferColor;
	parallaxWeight: number;
};

export type VdpBlitterCopyRectCommand = {
	opcode: 'copy_rect';
	seq: number;
	renderCost: number;
	layer: Layer2D;
	z: number;
	srcX: number;
	srcY: number;
	width: number;
	height: number;
	dstX: number;
	dstY: number;
};

export type VdpBlitterFillRectCommand = {
	opcode: 'fill_rect';
	seq: number;
	renderCost: number;
	layer: Layer2D;
	z: number;
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	color: VdpFrameBufferColor;
};

export type VdpBlitterDrawLineCommand = {
	opcode: 'draw_line';
	seq: number;
	renderCost: number;
	layer: Layer2D;
	z: number;
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	thickness: number;
	color: VdpFrameBufferColor;
};

export type VdpBlitterGlyphRunCommand = {
	opcode: 'glyph_run';
	seq: number;
	renderCost: number;
	layer: Layer2D;
	z: number;
	lineHeight: number;
	color: VdpFrameBufferColor;
	backgroundColor: VdpFrameBufferColor | null;
	glyphs: VdpGlyphRunGlyph[];
};

export type VdpBlitterTileRunCommand = {
	opcode: 'tile_run';
	seq: number;
	renderCost: number;
	layer: Layer2D;
	z: number;
	tiles: VdpTileRunBlit[];
};

export type VdpBlitterCommand =
	| VdpBlitterClearCommand
	| VdpBlitterBlitCommand
	| VdpBlitterCopyRectCommand
	| VdpBlitterFillRectCommand
	| VdpBlitterDrawLineCommand
	| VdpBlitterGlyphRunCommand
	| VdpBlitterTileRunCommand;

const BLITTER_FIFO_CAPACITY = 4096;

function createSkyboxFaceSources(): SkyboxFaceSources {
	return {
		posx: { slot: 0, u: 0, v: 0, w: 0, h: 0 },
		negx: { slot: 0, u: 0, v: 0, w: 0, h: 0 },
		posy: { slot: 0, u: 0, v: 0, w: 0, h: 0 },
		negy: { slot: 0, u: 0, v: 0, w: 0, h: 0 },
		posz: { slot: 0, u: 0, v: 0, w: 0, h: 0 },
		negz: { slot: 0, u: 0, v: 0, w: 0, h: 0 },
	};
}

function copyVdpSlotSource(target: VdpSlotSource, source: VdpSlotSource): void {
	target.slot = source.slot;
	target.u = source.u;
	target.v = source.v;
	target.w = source.w;
	target.h = source.h;
}

function copySkyboxFaceSources(target: SkyboxFaceSources, source: SkyboxFaceSources): void {
	copyVdpSlotSource(target.posx, source.posx);
	copyVdpSlotSource(target.negx, source.negx);
	copyVdpSlotSource(target.posy, source.posy);
	copyVdpSlotSource(target.negy, source.negy);
	copyVdpSlotSource(target.posz, source.posz);
	copyVdpSlotSource(target.negz, source.negz);
}

export class VDP implements VramWriteSink {
	private vramSlots: VramSlot[] = [];
	private vramStaging = new Uint8Array(VRAM_STAGING_SIZE);
	private readonly vramGarbageScratch = new Uint8Array(VRAM_GARBAGE_CHUNK_BYTES);
	private readonly vramSeedPixel = new Uint8Array(4);
	private vramMachineSeed = 0;
	private vramBootSeed = 0;
	private readSurfaces: Array<VdpReadSurface | null> = [null, null, null, null];
	private readCaches: VdpReadCache[] = [];
	private readBudgetBytes = VDP_RD_BUDGET_BYTES;
	private readOverflow = false;
	private displayFrameBufferCpuReadback: Uint8Array = new Uint8Array(0);
	private readonly skyboxFaceSources = createSkyboxFaceSources();
	private hasSkybox = false;
	private readonly committedSkyboxFaceSources = createSkyboxFaceSources();
	private committedHasSkybox = false;
	private lastDitherType = 0;
	private committedDitherType = 0;
	private _frameBufferWidth = 0;
	private _frameBufferHeight = 0;
	private readonly buildFrame: VdpBuildingFrameState = {
		queue: [],
		open: false,
		cost: 0,
	};
	private readonly execution: VdpExecutionState = {
		queue: [],
		pending: false,
	};
	private readonly activeFrame: VdpSubmittedFrameState = {
		queue: [],
		occupied: false,
		hasCommands: false,
		ready: false,
		cost: 0,
		workRemaining: 0,
		ditherType: 0,
		hasSkybox: false,
		skyboxFaceSources: createSkyboxFaceSources(),
	};
	private readonly pendingFrame: VdpSubmittedFrameState = {
		queue: [],
		occupied: false,
		hasCommands: false,
		ready: false,
		cost: 0,
		workRemaining: 0,
		ditherType: 0,
		hasSkybox: false,
		skyboxFaceSources: createSkyboxFaceSources(),
	};
	private readonly glyphBufferPool: VdpGlyphRunGlyph[][] = [];
	private readonly tileBufferPool: VdpTileRunBlit[][] = [];
	private readonly glyphEntryPool: VdpGlyphRunGlyph[] = [];
	private readonly tileEntryPool: VdpTileRunBlit[] = [];
	private readonly clippedRectScratchA = { width: 0, height: 0, area: 0 };
	private readonly clippedRectScratchB = { width: 0, height: 0, area: 0 };
	private blitterSequence = 0;
	private cpuHz: bigint = 1n;
	private workUnitsPerSec: bigint = 1n;
	private workCarry: bigint = 0n;
	private availableWorkUnits = 0;
	private vdpStatus = 0;
	private dmaSubmitActive = false;
	private readonly vdpFifoWordScratch = new Uint8Array(4);
	private vdpFifoWordByteCount = 0;
	private readonly vdpFifoStreamWords = new Uint32Array(VDP_STREAM_CAPACITY_WORDS);
	private vdpFifoStreamWordCount = 0;
	public lastFrameCommitted = true;
	public lastFrameCost = 0;
	public lastFrameHeld = false;
	public constructor(
		private readonly memory: Memory,
		private readonly cpu: CPU,
		private readonly api: Api,
		private readonly scheduler: DeviceScheduler,
		private readonly configuredFrameBufferSize: VdpFrameBufferSize,
	) {
		this.memory.setVramWriter(this);
		this.memory.mapIoRead(IO_VDP_RD_STATUS, this.readVdpStatus.bind(this));
		this.memory.mapIoRead(IO_VDP_RD_DATA, this.readVdpData.bind(this));
		this.memory.mapIoWrite(IO_VDP_FIFO, this.onVdpFifoWrite.bind(this));
		this.memory.mapIoWrite(IO_VDP_FIFO_CTRL, this.onVdpFifoCtrlWrite.bind(this));
		this.memory.mapIoWrite(IO_VDP_CMD, this.onVdpCommandWrite.bind(this));
		this.memory.mapIoWrite(IO_VDP_SLOT_PRIMARY_ATLAS, this.onSlotAtlasWrite.bind(this));
		this.memory.mapIoWrite(IO_VDP_SLOT_SECONDARY_ATLAS, this.onSlotAtlasWrite.bind(this));
		this.vramMachineSeed = this.nextVramMachineSeed();
		this.vramBootSeed = this.nextVramBootSeed();
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
		this.memory.writeValue(IO_VDP_STATUS, this.vdpStatus);
		this.refreshSubmitBusyStatus();
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
		this.memory.writeValue(IO_VDP_STATUS, this.vdpStatus);
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
		return this.hasOpenDirectVdpFifoIngress() || this.dmaSubmitActive || !this.canAcceptSubmittedFrame();
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
			while (cursor < end) {
				if (cursor + VDP_STREAM_PACKET_HEADER_WORDS * 4 > end) {
					throw vdpStreamFault('stream ended mid-packet header.');
				}
				const cmd = this.memory.readU32(cursor) >>> 0;
				const argWords = this.memory.readU32(cursor + 4) >>> 0;
				const payloadWords = this.memory.readU32(cursor + 8) >>> 0;
				if (payloadWords > VDP_STREAM_PAYLOAD_CAPACITY_WORDS) {
					throw vdpStreamFault(`submit payload overflow (${payloadWords} > ${VDP_STREAM_PAYLOAD_CAPACITY_WORDS}).`);
				}
				const packetWordCount = VDP_STREAM_PACKET_HEADER_WORDS + argWords + payloadWords;
				const packetByteCount = packetWordCount * 4;
				if (cursor + packetByteCount > end) {
					throw vdpStreamFault('stream ended mid-packet payload.');
				}
				this.syncRegisters();
				processVdpCommand(this, this.cpu, this.api, this.memory, {
					cmd,
					argWords,
					argsBase: cursor + VDP_STREAM_PACKET_HEADER_WORDS * 4,
					payloadBase: cursor + (VDP_STREAM_PACKET_HEADER_WORDS + argWords) * 4,
					payloadWords,
				});
				cursor += packetByteCount;
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
			while (cursor < wordCount) {
				if (cursor + VDP_STREAM_PACKET_HEADER_WORDS > wordCount) {
					throw vdpStreamFault('stream ended mid-packet header.');
				}
				const cmd = this.vdpFifoStreamWords[cursor] >>> 0;
				const argWords = this.vdpFifoStreamWords[cursor + 1] >>> 0;
				const payloadWords = this.vdpFifoStreamWords[cursor + 2] >>> 0;
				if (payloadWords > VDP_STREAM_PAYLOAD_CAPACITY_WORDS) {
					throw vdpStreamFault(`submit payload overflow (${payloadWords} > ${VDP_STREAM_PAYLOAD_CAPACITY_WORDS}).`);
				}
				const packetWordCount = VDP_STREAM_PACKET_HEADER_WORDS + argWords + payloadWords;
				if (cursor + packetWordCount > wordCount) {
					throw vdpStreamFault('stream ended mid-packet payload.');
				}
				this.syncRegisters();
				processVdpBufferedCommand(this, this.cpu, this.api, {
					cmd,
					argWords,
					argsWordOffset: cursor + VDP_STREAM_PACKET_HEADER_WORDS,
					payloadWordOffset: cursor + VDP_STREAM_PACKET_HEADER_WORDS + argWords,
					payloadWords,
					words: this.vdpFifoStreamWords,
				});
				cursor += packetWordCount;
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

	private consumeDirectVdpCommand(cmd: number): void {
		const schema = getVdpPacketSchema(cmd);
		this.beginSubmittedFrame();
		try {
			this.syncRegisters();
			processVdpCommand(this, this.cpu, this.api, this.memory, {
				cmd,
				argWords: schema.argWords,
				argsBase: IO_VDP_CMD_ARG0,
				payloadBase: 0,
				payloadWords: 0,
			});
			this.sealSubmittedFrame();
		} catch (error) {
			this.cancelSubmittedFrame();
			throw error;
		}
		this.refreshSubmitBusyStatus();
	}

	private onVdpFifoWrite(): void {
		if (this.dmaSubmitActive || (!this.hasOpenDirectVdpFifoIngress() && !this.canAcceptSubmittedFrame())) {
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
		if (command === 0) {
			return;
		}
		if (this.hasBlockedSubmitPath()) {
			this.rejectSubmitAttempt();
			return;
		}
		this.acceptSubmitAttempt();
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

	private packFrameBufferColor(source: color): VdpFrameBufferColor {
		return {
			r: frameBufferColorByte(source.r),
			g: frameBufferColorByte(source.g),
			b: frameBufferColorByte(source.b),
			a: frameBufferColorByte(source.a),
		};
	}

	private nextBlitterSequence(): number {
		return this.blitterSequence++;
	}

	private acquireGlyphBuffer(): VdpGlyphRunGlyph[] {
		const glyphs = this.glyphBufferPool.pop();
		if (glyphs) {
			return glyphs;
		}
		return [];
	}

	private acquireGlyphEntry(): VdpGlyphRunGlyph {
		const glyph = this.glyphEntryPool.pop();
		if (glyph) {
			return glyph;
		}
		return {
			surfaceId: 0,
			srcX: 0,
			srcY: 0,
			width: 0,
			height: 0,
			dstX: 0,
			dstY: 0,
			advance: 0,
		};
	}

	private acquireTileBuffer(): VdpTileRunBlit[] {
		const tiles = this.tileBufferPool.pop();
		if (tiles) {
			return tiles;
		}
		return [];
	}

	private acquireTileEntry(): VdpTileRunBlit {
		const tile = this.tileEntryPool.pop();
		if (tile) {
			return tile;
		}
		return {
			surfaceId: 0,
			srcX: 0,
			srcY: 0,
			width: 0,
			height: 0,
			dstX: 0,
			dstY: 0,
		};
	}

	private recycleBlitterBuffers(queue: VdpBlitterCommand[]): void {
		for (let index = 0; index < queue.length; index += 1) {
			const command = queue[index];
			if (command.opcode === 'glyph_run') {
				for (let glyphIndex = 0; glyphIndex < command.glyphs.length; glyphIndex += 1) {
					this.glyphEntryPool.push(command.glyphs[glyphIndex]);
				}
				command.glyphs.length = 0;
				this.glyphBufferPool.push(command.glyphs);
			} else if (command.opcode === 'tile_run') {
				for (let tileIndex = 0; tileIndex < command.tiles.length; tileIndex += 1) {
					this.tileEntryPool.push(command.tiles[tileIndex]);
				}
				command.tiles.length = 0;
				this.tileBufferPool.push(command.tiles);
			}
		}
		queue.length = 0;
	}

	private resetBuildFrameState(): void {
		this.recycleBlitterBuffers(this.buildFrame.queue);
		this.buildFrame.cost = 0;
		this.buildFrame.open = false;
	}

	private resetQueuedFrameState(): void {
		this.resetBuildFrameState();
		this.clearActiveFrame();
		this.recycleBlitterBuffers(this.pendingFrame.queue);
		this.workCarry = 0n;
		this.availableWorkUnits = 0;
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_VDP);
		this.pendingFrame.queue.length = 0;
		this.pendingFrame.occupied = false;
		this.pendingFrame.hasCommands = false;
		this.pendingFrame.ready = false;
		this.pendingFrame.cost = 0;
		this.pendingFrame.workRemaining = 0;
		this.pendingFrame.ditherType = 0;
		this.pendingFrame.hasSkybox = false;
	}

	private enqueueBlitterCommand(command: VdpBlitterCommand): void {
		if (!this.buildFrame.open) {
			throw vdpFault('no submitted frame is open.');
		}
		if (this.buildFrame.queue.length >= BLITTER_FIFO_CAPACITY) {
			throw vdpFault(`blitter FIFO overflow (${BLITTER_FIFO_CAPACITY} commands).`);
		}
		this.buildFrame.cost += command.renderCost;
		this.buildFrame.queue.push(command);
	}

	private calculateVisibleRectCost(width: number, height: number): number {
		const area = width * height;
		return blitAreaBucket(area);
	}

	private calculateAlphaMultiplier(color: VdpFrameBufferColor): number {
		return color.a < 255 ? VDP_RENDER_ALPHA_COST_MULTIPLIER : 1;
	}

	private submittedFrameCost(queue: readonly VdpBlitterCommand[], baseCost: number): number {
		if (queue.length === 0 || queue[0].opcode === 'clear') {
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
		const frameHasCommands = buildQueue.length !== 0;
		const frameCost = this.submittedFrameCost(buildQueue, this.buildFrame.cost);
		this.buildFrame.queue = frame.queue;
		frame.queue = buildQueue;
		frame.occupied = true;
		frame.hasCommands = frameHasCommands;
		frame.ready = frameCost === 0;
		frame.cost = frameCost;
		frame.workRemaining = frameCost;
		frame.ditherType = this.lastDitherType;
		frame.hasSkybox = this.hasSkybox;
		if (this.hasSkybox) {
			copySkyboxFaceSources(frame.skyboxFaceSources, this.skyboxFaceSources);
		}
		this.buildFrame.queue.length = 0;
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
		const activeFrame = this.activeFrame;
		const pendingFrame = this.pendingFrame;
		const activeQueue = activeFrame.queue;
		activeFrame.queue = pendingFrame.queue;
		pendingFrame.queue = activeQueue;
		pendingFrame.queue.length = 0;
		activeFrame.occupied = true;
		activeFrame.hasCommands = pendingFrame.hasCommands;
		activeFrame.ready = pendingFrame.cost === 0;
		activeFrame.cost = pendingFrame.cost;
		activeFrame.workRemaining = pendingFrame.cost;
		activeFrame.ditherType = pendingFrame.ditherType;
		activeFrame.hasSkybox = pendingFrame.hasSkybox;
		if (pendingFrame.hasSkybox) {
			copySkyboxFaceSources(activeFrame.skyboxFaceSources, pendingFrame.skyboxFaceSources);
		}
		pendingFrame.occupied = false;
		pendingFrame.hasCommands = false;
		pendingFrame.ready = false;
		pendingFrame.cost = 0;
		pendingFrame.workRemaining = 0;
		pendingFrame.ditherType = 0;
		pendingFrame.hasSkybox = false;
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
			this.activeFrame.queue.length = 0;
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
		this.recycleBlitterBuffers(this.activeFrame.queue);
		this.recycleBlitterBuffers(this.execution.queue);
		this.activeFrame.queue.length = 0;
		this.execution.pending = false;
		this.activeFrame.occupied = false;
		this.activeFrame.hasCommands = false;
		this.activeFrame.ready = false;
		this.activeFrame.cost = 0;
		this.activeFrame.workRemaining = 0;
		this.activeFrame.ditherType = 0;
		this.activeFrame.hasSkybox = false;
	}

	private commitActiveVisualState(): void {
		this.committedDitherType = this.activeFrame.ditherType;
		this.committedHasSkybox = this.activeFrame.hasSkybox;
		if (this.activeFrame.hasSkybox) {
			copySkyboxFaceSources(this.committedSkyboxFaceSources, this.activeFrame.skyboxFaceSources);
		}
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
		if (this.activeFrame.hasCommands) {
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

	private resolveSurfaceIdForSlot(slot: number): number {
		if (slot === VDP_SLOT_SYSTEM) {
			return VDP_RD_SURFACE_SYSTEM;
		}
		if (slot === VDP_SLOT_PRIMARY) {
			return VDP_RD_SURFACE_PRIMARY;
		}
		if (slot === VDP_SLOT_SECONDARY) {
			return VDP_RD_SURFACE_SECONDARY;
		}
		throw vdpFault(`source slot ${slot} is not a VDP blitter slot.`);
	}

	public resolveBlitterSource(source: VdpSlotSource): VdpBlitterSource {
		const surfaceId = this.resolveSurfaceIdForSlot(source.slot);
		return {
			surfaceId,
			srcX: source.u,
			srcY: source.v,
			width: source.w,
			height: source.h,
		};
	}

	public resolveBlitterSample(sourceRect: VdpSlotSource): VdpResolvedBlitterSample {
		const source = this.resolveBlitterSource(sourceRect);
		const surface = this.resolveBlitterSurfaceSize(source.surfaceId);
		return {
			source,
			surfaceWidth: surface.width,
			surfaceHeight: surface.height,
			slot: this.resolveSurfaceSlotBinding(source.surfaceId),
		};
	}

	public enqueueClear(colorValue: color): void {
		this.enqueueBlitterCommand({
			opcode: 'clear',
			seq: this.nextBlitterSequence(),
			renderCost: VDP_RENDER_CLEAR_COST,
			color: this.packFrameBufferColor(colorValue),
		});
	}

	public enqueueBlit(slot: number, u: number, v: number, w: number, h: number, x: number, y: number, z: number, layer: Layer2D, scaleX: number, scaleY: number, flipH: boolean, flipV: boolean, colorValue: color, parallaxWeight: number): void {
		const source = this.resolveBlitterSource({ slot, u, v, w, h });
		const dstWidth = source.width * Math.abs(scaleX);
		const dstHeight = source.height * Math.abs(scaleY);
		const clipped = computeClippedRect(x, y, x + dstWidth, y + dstHeight, this._frameBufferWidth, this._frameBufferHeight, this.clippedRectScratchA);
		if (clipped.area === 0) {
			return;
		}
		const color = this.packFrameBufferColor(colorValue);
		this.enqueueBlitterCommand({
			opcode: 'blit',
			seq: this.nextBlitterSequence(),
			renderCost: this.calculateVisibleRectCost(clipped.width, clipped.height) * this.calculateAlphaMultiplier(color),
			layer,
			z,
			source,
			dstX: x,
			dstY: y,
			scaleX,
			scaleY,
			flipH,
			flipV,
			color,
			parallaxWeight,
		});
	}

	public enqueueCopyRect(srcX: number, srcY: number, width: number, height: number, dstX: number, dstY: number, z: number, layer: Layer2D): void {
		const clipped = computeClippedRect(dstX, dstY, dstX + width, dstY + height, this._frameBufferWidth, this._frameBufferHeight, this.clippedRectScratchA);
		if (clipped.area === 0) {
			return;
		}
		this.enqueueBlitterCommand({
			opcode: 'copy_rect',
			seq: this.nextBlitterSequence(),
			renderCost: this.calculateVisibleRectCost(clipped.width, clipped.height),
			layer,
			z,
			srcX,
			srcY,
			width,
			height,
			dstX,
			dstY,
		});
	}

	public enqueueFillRect(x0: number, y0: number, x1: number, y1: number, z: number, layer: Layer2D, colorValue: color): void {
		const clipped = computeClippedRect(x0, y0, x1, y1, this._frameBufferWidth, this._frameBufferHeight, this.clippedRectScratchA);
		if (clipped.area === 0) {
			return;
		}
		const color = this.packFrameBufferColor(colorValue);
		this.enqueueBlitterCommand({
			opcode: 'fill_rect',
			seq: this.nextBlitterSequence(),
			renderCost: this.calculateVisibleRectCost(clipped.width, clipped.height) * this.calculateAlphaMultiplier(color),
			layer,
			z,
			x0,
			y0,
			x1,
			y1,
			color,
		});
	}

	public enqueueDrawLine(x0: number, y0: number, x1: number, y1: number, z: number, layer: Layer2D, colorValue: color, thickness: number): void {
		const span = computeClippedLineSpan(x0, y0, x1, y1, this._frameBufferWidth, this._frameBufferHeight);
		if (span === 0) {
			return;
		}
		const color = this.packFrameBufferColor(colorValue);
		const thicknessMultiplier = thickness > 1 ? 2 : 1;
		this.enqueueBlitterCommand({
			opcode: 'draw_line',
			seq: this.nextBlitterSequence(),
			renderCost: blitSpanBucket(span) * thicknessMultiplier * this.calculateAlphaMultiplier(color),
			layer,
			z,
			x0,
			y0,
			x1,
			y1,
			thickness,
			color,
		});
	}

	public enqueueDrawRect(x0: number, y0: number, x1: number, y1: number, z: number, layer: Layer2D, colorValue: color): void {
		this.enqueueDrawLine(x0, y0, x1, y0, z, layer, colorValue, 1);
		this.enqueueDrawLine(x0, y1, x1, y1, z, layer, colorValue, 1);
		this.enqueueDrawLine(x0, y0, x0, y1, z, layer, colorValue, 1);
		this.enqueueDrawLine(x1, y0, x1, y1, z, layer, colorValue, 1);
	}

	public enqueueDrawPoly(points: number[], z: number, colorValue: color, thickness: number, layer: Layer2D): void {
		for (let index = 0; index < points.length; index += 2) {
			const next = (index + 2) % points.length;
			this.enqueueDrawLine(points[index], points[index + 1], points[next], points[next + 1], z, layer, colorValue, thickness);
		}
	}

	public enqueueGlyphRun(text: string | string[], x: number, y: number, z: number, font: BFont, colorValue: color, backgroundColor: color | undefined, start: number, end: number, layer: Layer2D): void {
		const glyphs = this.acquireGlyphBuffer();
		const color = this.packFrameBufferColor(colorValue);
		const background = backgroundColor ? this.packFrameBufferColor(backgroundColor) : null;
		let renderCost = 0;
		let cursorY = y;

		const enqueueGlyphLine = (line: string, baseIndex: number, lineLength: number): void => {
			if (lineLength === 0) {
				cursorY += font.lineHeight;
				return;
			}
			let cursorX = x;
			for (let glyphIndex = start; glyphIndex < lineLength && glyphIndex < end; glyphIndex += 1) {
				const glyph = font.getGlyph(line.charAt(baseIndex + glyphIndex));
				const source = this.resolveBlitterSource({
					slot: resolveAtlasSlotFromMemory(this.memory, glyph.rect.atlasId),
					u: glyph.rect.u,
					v: glyph.rect.v,
					w: glyph.rect.w,
					h: glyph.rect.h,
				});
				const clipped = computeClippedRect(cursorX, cursorY, cursorX + source.width, cursorY + source.height, this._frameBufferWidth, this._frameBufferHeight, this.clippedRectScratchA);
				if (clipped.area > 0) {
					renderCost += this.calculateVisibleRectCost(clipped.width, clipped.height);
					if (background !== null) {
						const backgroundRect = computeClippedRect(cursorX, cursorY, cursorX + glyph.advance, cursorY + font.lineHeight, this._frameBufferWidth, this._frameBufferHeight, this.clippedRectScratchB);
						if (backgroundRect.area > 0) {
							renderCost += this.calculateVisibleRectCost(backgroundRect.width, backgroundRect.height) * this.calculateAlphaMultiplier(background);
						}
					}
					const glyphEntry = this.acquireGlyphEntry();
					glyphEntry.surfaceId = source.surfaceId;
					glyphEntry.srcX = source.srcX;
					glyphEntry.srcY = source.srcY;
					glyphEntry.width = source.width;
					glyphEntry.height = source.height;
					glyphEntry.dstX = cursorX;
					glyphEntry.dstY = cursorY;
					glyphEntry.advance = glyph.advance;
					glyphs.push(glyphEntry);
				}
				cursorX += glyph.advance;
			}
			cursorY += font.lineHeight;
		};

		if (Array.isArray(text)) {
			for (let lineIndex = 0; lineIndex < text.length; lineIndex += 1) {
				const line = text[lineIndex];
				enqueueGlyphLine(line, 0, line.length);
			}
		} else {
			let lineStart = 0;
			while (lineStart <= text.length) {
				const lineEnd = text.indexOf('\n', lineStart);
				if (lineEnd === -1) {
					enqueueGlyphLine(text, lineStart, text.length - lineStart);
					break;
				}
				enqueueGlyphLine(text, lineStart, lineEnd - lineStart);
				lineStart = lineEnd + 1;
			}
		}
		if (glyphs.length === 0) {
			this.glyphBufferPool.push(glyphs);
			return;
		}
		this.enqueueBlitterCommand({
			opcode: 'glyph_run',
			seq: this.nextBlitterSequence(),
			renderCost,
			layer,
			z,
			lineHeight: font.lineHeight,
			color,
			backgroundColor: background,
			glyphs,
		});
	}

	private requireTileRunCount(label: string, tileCount: number, cols: number, rows: number): void {
		const expected = cols * rows;
		if (tileCount !== expected) {
			throw vdpFault(`${label} size mismatch (${tileCount} != ${expected}).`);
		}
	}

	private enqueueTileRunInternal(desc: VdpTileRunInput, sourceKind: VdpTileRunSourceKind, mismatchLabel: string): void {
		const frameWidth = this._frameBufferWidth;
		const frameHeight = this._frameBufferHeight;
		const totalWidth = desc.cols * desc.tile_w;
		const totalHeight = desc.rows * desc.tile_h;
		let dstX = desc.origin_x - desc.scroll_x;
		let dstY = desc.origin_y - desc.scroll_y;
		let srcClipX = 0;
		let srcClipY = 0;
		let writeWidth = totalWidth;
		let writeHeight = totalHeight;
		if (dstX < 0) {
			srcClipX = -dstX;
			writeWidth += dstX;
			dstX = 0;
		}
		if (dstY < 0) {
			srcClipY = -dstY;
			writeHeight += dstY;
			dstY = 0;
		}
		const overflowX = (dstX + writeWidth) - frameWidth;
		if (overflowX > 0) {
			writeWidth -= overflowX;
		}
		const overflowY = (dstY + writeHeight) - frameHeight;
		if (overflowY > 0) {
			writeHeight -= overflowY;
		}
		if (writeWidth <= 0 || writeHeight <= 0) {
			return;
		}
		const tiles = this.acquireTileBuffer();
		let visibleRowCount = 0;
		let visibleNonEmptyTileCount = 0;
		for (let row = 0; row < desc.rows; row += 1) {
			const base = row * desc.cols;
			let rowHasVisibleTile = false;
			for (let col = 0; col < desc.cols; col += 1) {
				const index = base + col;
				let tileSource: VdpSlotSource | false;
				switch (sourceKind) {
					case VDP_TILE_RUN_SOURCE_DIRECT:
						tileSource = (desc as VdpSourceTileRunInput).sources[index]!;
						break;
					case VDP_TILE_RUN_SOURCE_PAYLOAD:
						tileSource = this.readPayloadTileSource((desc as VdpPayloadTileRunInput).payload_base + index * 20);
						break;
					case VDP_TILE_RUN_SOURCE_PAYLOAD_WORDS: {
						const payload = desc as VdpPayloadWordsTileRunInput;
						tileSource = this.readPayloadWordsTileSource(payload.payload_words, payload.payload_word_offset + index * 5);
						break;
					}
				}
				if (tileSource === false) {
					continue;
				}
				const source = this.resolveBlitterSource(tileSource);
				if (source.width !== desc.tile_w || source.height !== desc.tile_h) {
					throw new Error(`${mismatchLabel} (${source.width}x${source.height} != ${desc.tile_w}x${desc.tile_h}).`);
				}
				const tileX = dstX + (col * desc.tile_w) - srcClipX;
				const tileY = dstY + (row * desc.tile_h) - srcClipY;
				const clipped = computeClippedRect(tileX, tileY, tileX + desc.tile_w, tileY + desc.tile_h, frameWidth, frameHeight, this.clippedRectScratchA);
				if (clipped.area === 0) {
					continue;
				}
				visibleNonEmptyTileCount += 1;
				if (!rowHasVisibleTile) {
					rowHasVisibleTile = true;
					visibleRowCount += 1;
				}
				const tileEntry = this.acquireTileEntry();
				tileEntry.surfaceId = source.surfaceId;
				tileEntry.srcX = source.srcX;
				tileEntry.srcY = source.srcY;
				tileEntry.width = source.width;
				tileEntry.height = source.height;
				tileEntry.dstX = tileX;
				tileEntry.dstY = tileY;
				tiles.push(tileEntry);
			}
		}
		if (tiles.length === 0) {
			this.tileBufferPool.push(tiles);
			return;
		}
		this.enqueueBlitterCommand({
			opcode: 'tile_run',
			seq: this.nextBlitterSequence(),
			renderCost: tileRunCost(visibleRowCount, visibleNonEmptyTileCount),
			layer: desc.layer,
			z: desc.z,
			tiles,
		});
	}

	private readPayloadTileSource(base: number): VdpSlotSource | false {
		const slot = this.memory.readU32(base) >>> 0;
		if (slot === VDP_SLOT_NONE) {
			return false;
		}
		return {
			slot,
			u: this.memory.readU32(base + 4) >>> 0,
			v: this.memory.readU32(base + 8) >>> 0,
			w: this.memory.readU32(base + 12) >>> 0,
			h: this.memory.readU32(base + 16) >>> 0,
		};
	}

	private readPayloadWordsTileSource(words: Uint32Array, offset: number): VdpSlotSource | false {
		const slot = words[offset] >>> 0;
		if (slot === VDP_SLOT_NONE) {
			return false;
		}
		return {
			slot,
			u: words[offset + 1] >>> 0,
			v: words[offset + 2] >>> 0,
			w: words[offset + 3] >>> 0,
			h: words[offset + 4] >>> 0,
		};
	}

	public enqueueTileRun(desc: VdpSourceTileRunInput): void {
		this.enqueueTileRunInternal(desc, VDP_TILE_RUN_SOURCE_DIRECT, 'VDP fault: enqueueTileRun tile size mismatch');
	}

	public enqueuePayloadTileRun(desc: VdpPayloadTileRunInput): void {
		this.requireTileRunCount('enqueuePayloadTileRun', desc.tile_count, desc.cols, desc.rows);
		this.enqueueTileRunInternal(desc, VDP_TILE_RUN_SOURCE_PAYLOAD, 'VDP fault: enqueuePayloadTileRun tile size mismatch');
	}

	public enqueuePayloadTileRunWords(desc: VdpPayloadWordsTileRunInput): void {
		this.requireTileRunCount('enqueuePayloadTileRunWords', desc.tile_count, desc.cols, desc.rows);
		this.enqueueTileRunInternal(desc, VDP_TILE_RUN_SOURCE_PAYLOAD_WORDS, 'VDP fault: enqueuePayloadTileRunWords tile size mismatch');
	}

	public resolveBlitterSurfaceSize(surfaceId: number): VdpBlitterSurfaceSize {
		const surface = this.getReadSurface(surfaceId);
		return {
			width: surface.surfaceWidth,
			height: surface.surfaceHeight,
		};
	}

	private resolveSurfaceSlotBinding(surfaceId: number): number {
		if (surfaceId === VDP_RD_SURFACE_PRIMARY) {
			return VDP_SLOT_PRIMARY;
		}
		if (surfaceId === VDP_RD_SURFACE_SECONDARY) {
			return VDP_SLOT_SECONDARY;
		}
		if (surfaceId === VDP_RD_SURFACE_SYSTEM) {
			return VDP_SLOT_SYSTEM;
		}
		throw vdpFault(`surface ${surfaceId} cannot be sampled by the WebGL blitter.`);
	}

	public get frameBufferWidth(): number {
		return this._frameBufferWidth;
	}

	public get frameBufferHeight(): number {
		return this._frameBufferHeight;
	}

	public get frameBufferRenderReadback(): Uint8Array {
		return this.getCpuReadbackBuffer(VDP_RD_SURFACE_FRAMEBUFFER);
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
		const slot = this.findVramSlot(addr, bytes.byteLength);
		if (slot.surfaceWidth === 0 || slot.surfaceHeight === 0) {
			throw vdpFault('VRAM slot is not initialized.');
		}
		const offset = addr - slot.baseAddr;
		const stride = slot.surfaceWidth * 4;
		const rowCount = slot.surfaceHeight;
		const totalBytes = rowCount * stride;
		if (offset + bytes.byteLength > totalBytes) {
			throw vdpFault('VRAM write out of bounds.');
		}
		if ((offset & 3) !== 0 || (bytes.byteLength & 3) !== 0) {
			throw vdpFault('VRAM writes must be 32-bit aligned.');
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
				this.updateCpuReadback(slot.surfaceId, slice, x, row);
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
		const buffer = this.getCpuReadbackBuffer(slot.surfaceId);
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
			throw vdpFault(`unsupported VDP read mode ${mode}.`);
		}
		const surface = this.getReadSurface(surfaceId);
		const width = surface.surfaceWidth;
		const height = surface.surfaceHeight;
		if (x >= width || y >= height) {
			throw vdpFault(`VDP read out of bounds (${x}, ${y}) for surface ${surfaceId}.`);
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
		if (frameBufferSurface) {
			this._frameBufferWidth = frameBufferSurface.surfaceWidth;
			this._frameBufferHeight = frameBufferSurface.surfaceHeight;
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
		for (let index = 0; index < IO_VDP_CMD_ARG_COUNT; index += 1) {
			this.memory.writeIoValue(IO_VDP_CMD_ARG0 + index * 4, 0);
		}
		this.lastDitherType = dither;
		this.committedDitherType = dither;
		this.hasSkybox = false;
		this.committedHasSkybox = false;
		this.lastFrameCommitted = true;
		this.lastFrameCost = 0;
		this.lastFrameHeld = false;
	}

	public syncRegisters(): void {
		const dither = this.memory.readIoI32(IO_VDP_DITHER);
		if (dither !== this.lastDitherType) {
			this.lastDitherType = dither;
		}
	}

	private setDitherType(value: number): void {
		this.memory.writeValue(IO_VDP_DITHER, value);
		this.syncRegisters();
	}

	public captureState(): VdpState {
		return {
			skyboxFaceSources: this.hasSkybox ? this.skyboxFaceSources : null,
			ditherType: this.lastDitherType,
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
		if (state.skyboxFaceSources === null) {
			this.clearSkybox();
		} else {
			this.setSkyboxSources(state.skyboxFaceSources);
		}
		this.setDitherType(state.ditherType);
		this.syncAtlasSlotRegisters();
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

	public get committedViewDitherType(): number {
		return this.committedDitherType;
	}

	public get committedViewSkyboxFaceSources(): SkyboxFaceSources | null {
		return this.committedHasSkybox ? this.committedSkyboxFaceSources : null;
	}

	public takeReadyExecutionQueue(): readonly VdpBlitterCommand[] | null {
		if (!this.execution.pending) {
			return null;
		}
		return this.execution.queue;
	}

	public completeReadyExecution(queue: readonly VdpBlitterCommand[]): void {
		if (!this.execution.pending || queue !== this.execution.queue || this.execution.queue.length === 0) {
			throw vdpFault('no active frame execution pending.');
		}
		this.execution.pending = false;
		this.activeFrame.ready = true;
		this.recycleBlitterBuffers(this.execution.queue);
	}

	public get surfaceUploadSlots(): readonly VdpSurfaceUploadSlot[] {
		return this.vramSlots;
	}

	public clearSurfaceUploadDirty(surfaceId: number): void {
		const slot = this.getVramSlotBySurfaceId(surfaceId);
		slot.dirtyRowStart = 0;
		slot.dirtyRowEnd = 0;
	}

	private commitLiveVisualState(): void {
		this.committedDitherType = this.lastDitherType;
		this.committedHasSkybox = this.hasSkybox;
		if (this.hasSkybox) {
			copySkyboxFaceSources(this.committedSkyboxFaceSources, this.skyboxFaceSources);
		}
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

	public setSkyboxSources(sources: SkyboxFaceSources): void {
		copySkyboxFaceSources(this.skyboxFaceSources, sources);
		this.hasSkybox = true;
	}

	public clearSkybox(): void {
		this.hasSkybox = false;
	}

	public registerVramSurfaces(surfaces: readonly VdpVramSurface[]): void {
		this.resetQueuedFrameState();
		this.vramSlots = [];
		this.readSurfaces = [null, null, null, null];
		for (let index = 0; index < this.readCaches.length; index += 1) {
			this.readCaches[index].width = 0;
		}
		this.displayFrameBufferCpuReadback = new Uint8Array(0);
		this.hasSkybox = false;
		this.committedHasSkybox = false;
		this.committedDitherType = this.lastDitherType;
		this.vramBootSeed = this.nextVramBootSeed();
		this.seedVramStaging();
		for (let index = 0; index < surfaces.length; index += 1) {
			this.registerVramSlot(surfaces[index]);
		}
		this.syncAtlasSlotRegisters();
		this.syncRegisters();
	}

	private onSlotAtlasWrite(addr: number, value: unknown): void {
		const slot = addr === IO_VDP_SLOT_PRIMARY_ATLAS ? VDP_SLOT_PRIMARY : VDP_SLOT_SECONDARY;
		const atlasId = typeof value === 'number' ? (value >>> 0) : VDP_SLOT_ATLAS_NONE;
		this.syncAtlasSlotSurface(slot, atlasId);
	}

	private syncAtlasSlotRegisters(): void {
		this.syncAtlasSlotSurface(VDP_SLOT_PRIMARY, this.memory.readIoU32(IO_VDP_SLOT_PRIMARY_ATLAS));
		this.syncAtlasSlotSurface(VDP_SLOT_SECONDARY, this.memory.readIoU32(IO_VDP_SLOT_SECONDARY_ATLAS));
	}

	private syncAtlasSlotSurface(slotId: number, atlasId: number): void {
		const surfaceId = slotId === VDP_SLOT_PRIMARY ? VDP_RD_SURFACE_PRIMARY : VDP_RD_SURFACE_SECONDARY;
		const slot = this.findRegisteredVramSlotBySurfaceId(surfaceId);
		if (slot === null) {
			return;
		}
		if (atlasId === VDP_SLOT_ATLAS_NONE) {
			this.setVramSlotLogicalDimensions(slot, 1, 1);
			return;
		}
	}

	private setVramSlotLogicalDimensions(slot: VramSlot, width: number, height: number): void {
		const byteLength = width * height * 4;
		if (width <= 0 || height <= 0 || byteLength > slot.capacity) {
			return;
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
		this.readSurfaces[slot.surfaceId] = slot;
		this.invalidateReadCache(slot.surfaceId);
	}

	private getReadSurface(surfaceId: number): VdpReadSurface {
		const surface = this.readSurfaces[surfaceId];
		if (surface === null) {
			throw vdpFault(`read surface ${surfaceId} is not registered.`);
		}
		return surface;
	}

	private getReadCache(surfaceId: number, surface: VdpReadSurface, x: number, y: number): VdpReadCache {
		const cache = this.readCaches[surfaceId];
		if (cache.width === 0 || cache.y !== y || x < cache.x0 || x >= cache.x0 + cache.width) {
			this.prefetchReadCache(cache, surfaceId, surface, x, y);
		}
		return cache;
	}

	private prefetchReadCache(cache: VdpReadCache, surfaceId: number, surface: VdpReadSurface, x: number, y: number): void {
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
		const data = this.readSurfacePixels(cache, surfaceId, surface, x, y, chunkW, 1);
		cache.x0 = x;
		cache.y = y;
		cache.width = chunkW;
		cache.data = data;
	}

	private readSurfacePixels(cache: VdpReadCache, surfaceId: number, surface: VdpReadSurface, x: number, y: number, width: number, height: number): Uint8Array {
		if (surfaceId === VDP_RD_SURFACE_FRAMEBUFFER) {
			const byteLength = width * height * 4;
			const out = cache.data.byteLength < byteLength ? (cache.data = new Uint8Array(byteLength)) : cache.data;
			return readVdpRenderFrameBufferPixels(x, y, width, height, out);
		}
		return this.readCpuReadback(cache, surfaceId, surface, x, y, width, height);
	}

	private readCpuReadback(cache: VdpReadCache, surfaceId: number, surface: VdpReadSurface, x: number, y: number, width: number, height: number): Uint8Array {
		const buffer = this.getCpuReadbackBuffer(surfaceId);
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

	private updateCpuReadback(surfaceId: number, slice: Uint8Array, x: number, y: number): void {
		const surface = this.getReadSurface(surfaceId);
		const buffer = this.getVramSlotBySurfaceId(surfaceId).cpuReadback;
		const stride = surface.surfaceWidth * 4;
		const offset = y * stride + x * 4;
		buffer.set(slice, offset);
	}

	private getCpuReadbackBuffer(surfaceId: number): Uint8Array {
		return this.getVramSlotBySurfaceId(surfaceId).cpuReadback;
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

	private randomU32(): number {
		return (Math.random() * 0x100000000) >>> 0;
	}

	private nextVramMachineSeed(): number {
		const time = Date.now() >>> 0;
		const rand = this.randomU32();
		return (time ^ rand) >>> 0;
	}

	private nextVramBootSeed(): number {
		const time = Date.now() >>> 0;
		const rand = this.randomU32();
		const jitter = this.randomU32();
		return (time ^ rand ^ jitter) >>> 0;
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
					this.updateCpuReadback(slot.surfaceId, slice, 0, y + row);
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
					this.updateCpuReadback(slot.surfaceId, segment, x, y);
					x += segmentWidth;
				}
			}
		}
		this.invalidateReadCache(slot.surfaceId);
	}

	private findVramSlot(addr: number, length: number): VramSlot {
		for (let index = 0; index < this.vramSlots.length; index += 1) {
			const slot = this.vramSlots[index];
			if (addr >= slot.baseAddr && addr + length <= slot.baseAddr + slot.capacity) {
				return slot;
			}
		}
		throw vdpFault(`VRAM write has no mapped slot (addr=${addr}, len=${length}).`);
	}

}
