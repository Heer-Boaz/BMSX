import { $ } from '../core/engine_core';
import { taskGate } from '../core/taskgate';
import { Runtime } from './runtime';
import * as SkyboxPipeline from '../render/3d/skybox_pipeline';
import { decodePngToRgba } from '../utils/image_decode';
import {
	renderLayerTo2dLayer,
} from '../render/shared/render_types';
import type { Layer2D, RenderLayer, SkyboxImageIds, color } from '../render/shared/render_types';
import type { RomAsset, RomImgAsset } from '../rompack/rompack';
import {
	ATLAS_PRIMARY_SLOT_ID,
	ATLAS_SECONDARY_SLOT_ID,
	ENGINE_ATLAS_INDEX,
	ENGINE_ATLAS_TEXTURE_KEY,
	generateAtlasName,
} from '../rompack/rompack';
import type { RawAssetSource } from '../rompack/asset_source';
import {
	IO_VDP_DITHER,
	IO_VDP_LEGACY_CMD,
	IO_VDP_PRIMARY_ATLAS_ID,
	IO_VDP_RD_MODE,
	IO_VDP_RD_SURFACE,
	IO_VDP_RD_X,
	IO_VDP_RD_Y,
	IO_VDP_SECONDARY_ATLAS_ID,
	VDP_ATLAS_ID_NONE,
	VDP_RD_MODE_RGBA8888,
	VDP_RD_STATUS_OVERFLOW,
	VDP_RD_STATUS_READY,
} from './io';
import { ASSET_FLAG_VIEW, type AssetEntry, type ImageWriteEntry, type VdpIoHandler, type VramWriteSink } from './memory';
import { Memory } from './memory';
import { ImgDecController } from './devices/imgdec_controller';
import type { BFont } from '../render/shared/bitmap_font';
import {
	VRAM_SYSTEM_ATLAS_BASE,
	VRAM_SYSTEM_ATLAS_SIZE,
	VRAM_PRIMARY_ATLAS_BASE,
	VRAM_PRIMARY_ATLAS_SIZE,
	VRAM_SECONDARY_ATLAS_BASE,
	VRAM_SECONDARY_ATLAS_SIZE,
	VRAM_SKYBOX_FACE_BYTES,
	VRAM_SKYBOX_NEGX_BASE,
	VRAM_SKYBOX_NEGY_BASE,
	VRAM_SKYBOX_NEGZ_BASE,
	VRAM_SKYBOX_POSX_BASE,
	VRAM_SKYBOX_POSY_BASE,
	VRAM_SKYBOX_POSZ_BASE,
	VRAM_STAGING_BASE,
	VRAM_STAGING_SIZE,
} from './memory_map';

const SKYBOX_FACE_KEYS = ['posx', 'negx', 'posy', 'negy', 'posz', 'negz'] as const;
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

function skyboxFaceBaseByIndex(index: number): number {
	switch (index) {
		case 0: return VRAM_SKYBOX_POSX_BASE;
		case 1: return VRAM_SKYBOX_NEGX_BASE;
		case 2: return VRAM_SKYBOX_POSY_BASE;
		case 3: return VRAM_SKYBOX_NEGY_BASE;
		case 4: return VRAM_SKYBOX_POSZ_BASE;
		case 5: return VRAM_SKYBOX_NEGZ_BASE;
		default: break;
	}
	throw new Error(`[BmsxVDP] Skybox face index out of range: ${index}.`);
}

const VDP_RD_SURFACE_ENGINE = 0;
const VDP_RD_SURFACE_PRIMARY = 1;
const VDP_RD_SURFACE_SECONDARY = 2;
const VDP_RD_SURFACE_COUNT = 3;
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

function fmix32(h: number): number {
	h >>>= 0;
	h ^= h >>> 16;
	h = Math.imul(h, 0x85ebca6b);
	h ^= h >>> 13;
	h = Math.imul(h, 0xc2b2ae35);
	h ^= h >>> 16;
	return h >>> 0;
}

function xorshift32(x: number): number {
	x >>>= 0;
	x ^= (x << 13) >>> 0;
	x ^= x >>> 17;
	x ^= (x << 5) >>> 0;
	return x >>> 0;
}

function scramble32(x: number): number {
	return Math.imul(x >>> 0, 0x9e3779bb) >>> 0;
}

function signed8FromHash(h: number): number {
	return ((h >>> 24) & 0xff) - 128;
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
	const threshold0 = Math.floor((maxBias * VRAM_GARBAGE_FORCE_T0) / VRAM_GARBAGE_FORCE_T_DEN);
	const threshold1 = Math.floor((maxBias * VRAM_GARBAGE_FORCE_T1) / VRAM_GARBAGE_FORCE_T_DEN);
	const threshold2 = Math.floor((maxBias * VRAM_GARBAGE_FORCE_T2) / VRAM_GARBAGE_FORCE_T_DEN);
	return {
		activeOctaves,
		threshold0,
		threshold1,
		threshold2,
	};
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
	const vramBytes = (VRAM_SECONDARY_ATLAS_BASE + VRAM_SECONDARY_ATLAS_SIZE - VRAM_STAGING_BASE) >>> 0;
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
		const maxBytesThisBlock = Math.min(BLOCK_BYTES - startOff, total - out);

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
				const a0 = Math.max(wordByteStart, rangeStart);
				const a1 = Math.min(wordByteEnd, rangeEnd);
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

type VdpReadSurface = {
	entry: AssetEntry;
	textureKey: string;
};

type VdpReadCache = {
	x0: number;
	y: number;
	width: number;
	data: Uint8Array;
};

type VramSlot = {
	kind: 'asset';
	baseAddr: number;
	capacity: number;
	entry: AssetEntry;
	textureKey: string;
	surfaceId: number;
	textureWidth: number;
	textureHeight: number;
} | {
	kind: 'skybox';
	baseAddr: number;
	capacity: number;
	entry: ImageWriteEntry;
};

type AssetVramSlot = Extract<VramSlot, { kind: 'asset' }>;

type SkyboxSlot = {
	face: typeof SKYBOX_FACE_KEYS[number];
	entry: ImageWriteEntry;
};

type FrameBufferCommandType = 'sprite' | 'fill' | 'line';

type FrameBufferColor = {
	r: number;
	g: number;
	b: number;
	a: number;
};

type FrameBufferCommand = {
	type: FrameBufferCommandType;
	sourceIndex: number;
	layer: Layer2D;
	z: number;
	handle: number;
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	scaleX: number;
	scaleY: number;
	flipH: boolean;
	flipV: boolean;
	thickness: number;
	color: FrameBufferColor;
};

const FRAMEBUFFER_TEXTURE_KEY = '_framebuffer_2d';

function createFrameBufferColor(): FrameBufferColor {
	return { r: 255, g: 255, b: 255, a: 255 };
}

function createFrameBufferCommand(): FrameBufferCommand {
	return {
		type: 'sprite',
		sourceIndex: 0,
		layer: 0,
		z: 0,
		handle: 0,
		x0: 0,
		y0: 0,
		x1: 0,
		y1: 0,
		scaleX: 1,
		scaleY: 1,
		flipH: false,
		flipV: false,
		thickness: 1,
		color: createFrameBufferColor(),
	};
}

export class VDP implements VramWriteSink, VdpIoHandler {
	private readonly assetUpdateGate = taskGate.group('asset:update');
	private readonly atlasSlotById = new Map<number, number>();
	private readonly atlasViewsById = new Map<number, AssetEntry[]>();
	private readonly atlasResourcesById = new Map<number, RomAsset>();
	private readonly slotAtlasIds: Array<number | null> = [null, null];
	private atlasSlotEntries: AssetEntry[] = [];
	private vramSlots: VramSlot[] = [];
	private vramStaging = new Uint8Array(VRAM_STAGING_SIZE);
	private readonly vramGarbageScratch = new Uint8Array(VRAM_GARBAGE_CHUNK_BYTES);
	private readonly vramSeedPixel = new Uint8Array(4);
	private vramMachineSeed = 0;
	private vramBootSeed = 0;
	private readSurfaces: Array<VdpReadSurface | null> = [null, null, null];
	private readCaches: VdpReadCache[] = [];
	private readBudgetBytes = VDP_RD_BUDGET_BYTES;
	private readOverflow = false;
	private cpuReadbackByKey = new Map<string, Uint8Array>();
	private skyboxSlots: SkyboxSlot[] = [];
	private dirtySkybox = false;
	private skyboxFaceIds: SkyboxImageIds | null = null;
	private lastDitherType = 0;
	private imgDecController: ImgDecController | null = null;
	private frameBufferWidth = 0;
	private frameBufferHeight = 0;
	private frameBufferPixels = new Uint8Array(0);
	private frameBufferClearRequested = false;
	private readonly frameBufferClearColor = createFrameBufferColor();
	private readonly frameBufferCommands: FrameBufferCommand[] = [];
	private readonly frameBufferCommandPool: FrameBufferCommand[] = [];
	private frameBufferSourceIndex = 0;
	public constructor(
		private readonly memory: Memory,
	) {
		this.memory.setVramWriter(this);
		this.memory.setVdpIoHandler(this);
		this.vramMachineSeed = this.nextVramMachineSeed();
		this.vramBootSeed = this.nextVramBootSeed();
		for (let index = 0; index < VDP_RD_SURFACE_COUNT; index += 1) {
			this.readCaches.push({ x0: 0, y: 0, width: 0, data: new Uint8Array(0) });
		}
	}

	public attachImgDecController(controller: ImgDecController): void {
		this.imgDecController = controller;
	}

	private packFrameBufferColor(source: color): FrameBufferColor {
		return {
			r: Math.round(source.r * 255),
			g: Math.round(source.g * 255),
			b: Math.round(source.b * 255),
			a: Math.round(source.a * 255),
		};
	}

	private acquireFrameBufferCommand(): FrameBufferCommand {
		let command = this.frameBufferCommandPool.pop();
		if (command === undefined) {
			command = createFrameBufferCommand();
		}
		command.sourceIndex = this.frameBufferSourceIndex;
		this.frameBufferSourceIndex += 1;
		return command;
	}

	private releaseFrameBufferCommand(command: FrameBufferCommand): void {
		this.frameBufferCommandPool.push(command);
	}

	private resetFrameBufferCommands(): void {
		for (let index = 0; index < this.frameBufferCommands.length; index += 1) {
			this.releaseFrameBufferCommand(this.frameBufferCommands[index]);
		}
		this.frameBufferCommands.length = 0;
		this.frameBufferClearRequested = false;
		this.frameBufferSourceIndex = 0;
	}

	private ensureFrameBufferSurface(): void {
		const width = $.view.viewportSize.x | 0;
		const height = $.view.viewportSize.y | 0;
		if (width <= 0 || height <= 0) {
			throw new Error('[BmsxVDP] Invalid framebuffer dimensions.');
		}
		if (this.frameBufferWidth === width && this.frameBufferHeight === height && this.frameBufferPixels.byteLength !== 0) {
			return;
		}
		this.frameBufferWidth = width;
		this.frameBufferHeight = height;
		this.frameBufferPixels = new Uint8Array(width * height * 4);
		const handle = $.texmanager.createTextureFromPixelsSync(FRAMEBUFFER_TEXTURE_KEY, this.frameBufferPixels, width, height);
		$.view.textures[FRAMEBUFFER_TEXTURE_KEY] = handle;
	}

	public discardFrameBufferOps(): void {
		this.resetFrameBufferCommands();
	}

	public clearFrameBuffer(colorValue: color): void {
		const packed = this.packFrameBufferColor(colorValue);
		this.frameBufferClearColor.r = packed.r;
		this.frameBufferClearColor.g = packed.g;
		this.frameBufferClearColor.b = packed.b;
		this.frameBufferClearColor.a = packed.a;
		this.frameBufferClearRequested = true;
	}

	public queueFrameBufferSpriteHandle(handle: number, x: number, y: number, z: number, layer: Layer2D, scaleX: number, scaleY: number, flipH: boolean, flipV: boolean, colorize: FrameBufferColor): void {
		const command = this.acquireFrameBufferCommand();
		command.type = 'sprite';
		command.handle = handle;
		command.x0 = x;
		command.y0 = y;
		command.z = z;
		command.layer = layer;
		command.scaleX = scaleX;
		command.scaleY = scaleY;
		command.flipH = flipH;
		command.flipV = flipV;
		command.color.r = colorize.r;
		command.color.g = colorize.g;
		command.color.b = colorize.b;
		command.color.a = colorize.a;
		this.frameBufferCommands.push(command);
	}

	public queueFrameBufferRect(kind: 'fill' | 'rect', x0: number, y0: number, x1: number, y1: number, z: number, layer: Layer2D, colorValue: color): void {
		const packed = this.packFrameBufferColor(colorValue);
		if (kind === 'fill') {
			const command = this.acquireFrameBufferCommand();
			command.type = 'fill';
			command.layer = layer;
			command.z = z;
			command.x0 = x0;
			command.y0 = y0;
			command.x1 = x1;
			command.y1 = y1;
			command.color.r = packed.r;
			command.color.g = packed.g;
			command.color.b = packed.b;
			command.color.a = packed.a;
			this.frameBufferCommands.push(command);
			return;
		}
		this.queueFrameBufferLine(x0, y0, x1, y0, z, layer, colorValue, 1);
		this.queueFrameBufferLine(x0, y1, x1, y1, z, layer, colorValue, 1);
		this.queueFrameBufferLine(x0, y0, x0, y1, z, layer, colorValue, 1);
		this.queueFrameBufferLine(x1, y0, x1, y1, z, layer, colorValue, 1);
	}

	public queueFrameBufferLine(x0: number, y0: number, x1: number, y1: number, z: number, layer: Layer2D, colorValue: color, thickness: number): void {
		const packed = this.packFrameBufferColor(colorValue);
		const command = this.acquireFrameBufferCommand();
		command.type = 'line';
		command.layer = layer;
		command.z = z;
		command.x0 = x0;
		command.y0 = y0;
		command.x1 = x1;
		command.y1 = y1;
		command.thickness = thickness;
		command.color.r = packed.r;
		command.color.g = packed.g;
		command.color.b = packed.b;
		command.color.a = packed.a;
		this.frameBufferCommands.push(command);
	}

	public queueFrameBufferPoly(points: number[], z: number, colorValue: color, thickness: number, layer: Layer2D): void {
		if (points.length < 4) {
			return;
		}
		for (let index = 0; index < points.length; index += 2) {
			const next = (index + 2) % points.length;
			this.queueFrameBufferLine(points[index], points[index + 1], points[next], points[next + 1], z, layer, colorValue, thickness);
		}
	}

	public queueFrameBufferGlyphs(text: string | string[], x: number, y: number, z: number, font: BFont, colorValue: color, backgroundColor: color | undefined, start: number, end: number, layer: RenderLayer): void {
		const lines = Array.isArray(text) ? text : [text];
		const lineLayer = renderLayerTo2dLayer(layer);
		const glyphColor = this.packFrameBufferColor(colorValue);
		const background = backgroundColor ? this.packFrameBufferColor(backgroundColor) : null;
		let cursorY = y;
		for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
			const line = lines[lineIndex];
			if (line.length === 0) {
				cursorY += font.lineHeight;
				continue;
			}
			let cursorX = x;
			for (let glyphIndex = start; glyphIndex < line.length && glyphIndex < end; glyphIndex += 1) {
				const glyph = font.getGlyph(line.charAt(glyphIndex));
				if (background) {
					const backgroundCommand = this.acquireFrameBufferCommand();
					backgroundCommand.type = 'fill';
					backgroundCommand.layer = lineLayer;
					backgroundCommand.z = z;
					backgroundCommand.x0 = cursorX;
					backgroundCommand.y0 = cursorY;
					backgroundCommand.x1 = cursorX + glyph.advance;
					backgroundCommand.y1 = cursorY + font.lineHeight;
					backgroundCommand.color.r = background.r;
					backgroundCommand.color.g = background.g;
					backgroundCommand.color.b = background.b;
					backgroundCommand.color.a = background.a;
					this.frameBufferCommands.push(backgroundCommand);
				}
				const handle = Runtime.instance.resolveAssetHandle(glyph.imgid);
				this.queueFrameBufferSpriteHandle(handle, cursorX, cursorY, z, lineLayer, 1, 1, false, false, glyphColor);
				cursorX += glyph.advance;
			}
			cursorY += font.lineHeight;
		}
	}

	private getFrameBufferSourcePixels(entry: AssetEntry): Uint8Array {
		if (!this.memory.isVramRange(entry.baseAddr, Math.max(1, entry.baseSize))) {
			return Runtime.instance.getImagePixels(entry);
		}
		const slot = this.getAssetVramSlotByOwner(entry.ownerIndex);
		return this.getCpuReadbackBuffer(this.getReadSurface(slot.surfaceId));
	}

	private resolveFrameBufferImageSource(handle: number): { pixels: Uint8Array; regionX: number; regionY: number; stride: number; width: number; height: number } {
		const entry = Runtime.instance.getAssetEntryByHandle(handle);
		if (entry.type !== 'image') {
			throw new Error(`[BmsxVDP] Asset handle ${handle} is not an image.`);
		}
		if ((entry.flags & ASSET_FLAG_VIEW) !== 0) {
			const baseEntry = Runtime.instance.getAssetEntryByHandle(entry.ownerIndex);
			if (baseEntry.type !== 'image') {
				throw new Error(`[BmsxVDP] View owner for '${entry.id}' is not an image.`);
			}
			return {
				pixels: this.getFrameBufferSourcePixels(baseEntry),
				regionX: entry.regionX,
				regionY: entry.regionY,
				stride: baseEntry.baseStride,
				width: entry.regionW,
				height: entry.regionH,
			};
		}
		return {
			pixels: this.getFrameBufferSourcePixels(entry),
			regionX: 0,
			regionY: 0,
			stride: entry.baseStride,
			width: entry.regionW,
			height: entry.regionH,
		};
	}

	private blendFrameBufferPixel(index: number, r: number, g: number, b: number, a: number): void {
		if (a <= 0) {
			return;
		}
		if (a >= 255) {
			this.frameBufferPixels[index + 0] = r;
			this.frameBufferPixels[index + 1] = g;
			this.frameBufferPixels[index + 2] = b;
			this.frameBufferPixels[index + 3] = 255;
			return;
		}
		const inverse = 255 - a;
		this.frameBufferPixels[index + 0] = ((r * a) + (this.frameBufferPixels[index + 0] * inverse) + 127) / 255;
		this.frameBufferPixels[index + 1] = ((g * a) + (this.frameBufferPixels[index + 1] * inverse) + 127) / 255;
		this.frameBufferPixels[index + 2] = ((b * a) + (this.frameBufferPixels[index + 2] * inverse) + 127) / 255;
		this.frameBufferPixels[index + 3] = a + ((this.frameBufferPixels[index + 3] * inverse) + 127) / 255;
	}

	private rasterizeFrameBufferFill(command: FrameBufferCommand): void {
		let left = Math.round(command.x0);
		let top = Math.round(command.y0);
		let right = Math.round(command.x1);
		let bottom = Math.round(command.y1);
		if (right < left) {
			const swap = left;
			left = right;
			right = swap;
		}
		if (bottom < top) {
			const swap = top;
			top = bottom;
			bottom = swap;
		}
		if (left < 0) left = 0;
		if (top < 0) top = 0;
		if (right > this.frameBufferWidth) right = this.frameBufferWidth;
		if (bottom > this.frameBufferHeight) bottom = this.frameBufferHeight;
		for (let y = top; y < bottom; y += 1) {
			let index = (y * this.frameBufferWidth + left) * 4;
			for (let x = left; x < right; x += 1) {
				this.blendFrameBufferPixel(index, command.color.r, command.color.g, command.color.b, command.color.a);
				index += 4;
			}
		}
	}

	private rasterizeFrameBufferLine(command: FrameBufferCommand): void {
		let x0 = Math.round(command.x0);
		let y0 = Math.round(command.y0);
		const x1 = Math.round(command.x1);
		const y1 = Math.round(command.y1);
		const dx = Math.abs(x1 - x0);
		const dy = Math.abs(y1 - y0);
		const sx = x0 < x1 ? 1 : -1;
		const sy = y0 < y1 ? 1 : -1;
		let err = dx - dy;
		const thickness = Math.max(1, Math.round(command.thickness));
		while (true) {
			const half = thickness >> 1;
			for (let yy = y0 - half; yy < y0 - half + thickness; yy += 1) {
				if (yy < 0 || yy >= this.frameBufferHeight) {
					continue;
				}
				for (let xx = x0 - half; xx < x0 - half + thickness; xx += 1) {
					if (xx < 0 || xx >= this.frameBufferWidth) {
						continue;
					}
					const index = (yy * this.frameBufferWidth + xx) * 4;
					this.blendFrameBufferPixel(index, command.color.r, command.color.g, command.color.b, command.color.a);
				}
			}
			if (x0 === x1 && y0 === y1) {
				return;
			}
			const e2 = err << 1;
			if (e2 > -dy) {
				err -= dy;
				x0 += sx;
			}
			if (e2 < dx) {
				err += dx;
				y0 += sy;
			}
		}
	}

	private rasterizeFrameBufferSprite(command: FrameBufferCommand): void {
		const source = this.resolveFrameBufferImageSource(command.handle);
		const dstW = Math.max(1, Math.round(source.width * command.scaleX));
		const dstH = Math.max(1, Math.round(source.height * command.scaleY));
		const dstX = Math.round(command.x0);
		const dstY = Math.round(command.y0);
		for (let y = 0; y < dstH; y += 1) {
			const targetY = dstY + y;
			if (targetY < 0 || targetY >= this.frameBufferHeight) {
				continue;
			}
			const srcY = command.flipV
				? source.height - 1 - Math.floor((y * source.height) / dstH)
				: Math.floor((y * source.height) / dstH);
			for (let x = 0; x < dstW; x += 1) {
				const targetX = dstX + x;
				if (targetX < 0 || targetX >= this.frameBufferWidth) {
					continue;
				}
				const srcX = command.flipH
					? source.width - 1 - Math.floor((x * source.width) / dstW)
					: Math.floor((x * source.width) / dstW);
				const srcIndex = ((source.regionY + srcY) * source.stride) + ((source.regionX + srcX) * 4);
				const srcA = source.pixels[srcIndex + 3];
				if (srcA === 0) {
					continue;
				}
				const outA = (srcA * command.color.a + 127) / 255;
				const outR = (source.pixels[srcIndex + 0] * command.color.r + 127) / 255;
				const outG = (source.pixels[srcIndex + 1] * command.color.g + 127) / 255;
				const outB = (source.pixels[srcIndex + 2] * command.color.b + 127) / 255;
				const dstIndex = (targetY * this.frameBufferWidth + targetX) * 4;
				this.blendFrameBufferPixel(dstIndex, outR, outG, outB, outA);
			}
		}
	}

	public flushFrameBufferOps(): void {
		this.ensureFrameBufferSurface();
		const clearColor = this.frameBufferClearColor;
		if (!this.frameBufferClearRequested) {
			clearColor.r = 0;
			clearColor.g = 0;
			clearColor.b = 0;
			clearColor.a = 0;
		}
		for (let index = 0; index < this.frameBufferPixels.length; index += 4) {
			this.frameBufferPixels[index + 0] = clearColor.r;
			this.frameBufferPixels[index + 1] = clearColor.g;
			this.frameBufferPixels[index + 2] = clearColor.b;
			this.frameBufferPixels[index + 3] = clearColor.a;
		}
		if (this.frameBufferCommands.length > 1) {
			this.frameBufferCommands.sort((a, b) => {
				if (a.layer !== b.layer) {
					return a.layer - b.layer;
				}
				if (a.z !== b.z) {
					return a.z - b.z;
				}
				return a.sourceIndex - b.sourceIndex;
			});
		}
		for (let index = 0; index < this.frameBufferCommands.length; index += 1) {
			const command = this.frameBufferCommands[index];
			if (command.type === 'fill') {
				this.rasterizeFrameBufferFill(command);
				continue;
			}
			if (command.type === 'line') {
				this.rasterizeFrameBufferLine(command);
				continue;
			}
			this.rasterizeFrameBufferSprite(command);
		}
		$.texmanager.updateTexturesForKey(FRAMEBUFFER_TEXTURE_KEY, this.frameBufferPixels, this.frameBufferWidth, this.frameBufferHeight);
		this.resetFrameBufferCommands();
	}

	public getFrameBufferTextureKey(): string {
		return FRAMEBUFFER_TEXTURE_KEY;
	}

	public ensureFrameBufferSurfaceReady(): void {
		this.ensureFrameBufferSurface();
	}

	public getFrameBufferWidth(): number {
		return this.frameBufferWidth;
	}

	public getFrameBufferHeight(): number {
		return this.frameBufferHeight;
	}

	public getFrameBufferPixels(): Uint8Array {
		return this.frameBufferPixels;
	}

	public writeVram(addr: number, bytes: Uint8Array): void {
		if (addr >= VRAM_STAGING_BASE && addr + bytes.byteLength <= VRAM_STAGING_BASE + VRAM_STAGING_SIZE) {
			this.writeVramStaging(addr, bytes);
			return;
		}
		const slot = this.findVramSlot(addr, bytes.byteLength);
		const entry = slot.entry;
		if (entry.baseStride === 0 || entry.regionW === 0 || entry.regionH === 0) {
			throw new Error('[BmsxVDP] VRAM slot is not initialized.');
		}
		if (slot.kind === 'asset') {
			this.syncVramSlotTextureSize(slot);
		}
		const offset = addr - slot.baseAddr;
		const stride = entry.baseStride;
		const rowCount = entry.regionH;
		const totalBytes = rowCount * stride;
		if (offset + bytes.byteLength > totalBytes) {
			throw new Error('[BmsxVDP] VRAM write out of bounds.');
		}
		if ((offset & 3) !== 0 || (bytes.byteLength & 3) !== 0) {
			throw new Error('[BmsxVDP] VRAM writes must be 32-bit aligned.');
		}
		let remaining = bytes.byteLength;
		let cursor = 0;
		let row = Math.floor(offset / stride);
		let rowOffset = offset - row * stride;
		while (remaining > 0) {
			const rowAvailable = stride - rowOffset;
			const rowBytes = remaining < rowAvailable ? remaining : rowAvailable;
			const x = rowOffset / 4;
			const width = rowBytes / 4;
			const slice = bytes.subarray(cursor, cursor + rowBytes);
			if (slot.kind === 'asset') {
				this.updateTextureRegion(slot.textureKey, slice, width, 1, x, row);
				this.invalidateReadCache(slot.surfaceId);
				this.updateCpuReadback(slot.surfaceId, slice, x, row);
			}
			remaining -= rowBytes;
			cursor += rowBytes;
			row += 1;
			rowOffset = 0;
		}
	}

	public beginFrame(): void {
		this.readBudgetBytes = VDP_RD_BUDGET_BYTES;
		this.readOverflow = false;
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
		const surfaceId = (this.memory.readValue(IO_VDP_RD_SURFACE) as number) >>> 0;
		const x = (this.memory.readValue(IO_VDP_RD_X) as number) >>> 0;
		const y = (this.memory.readValue(IO_VDP_RD_Y) as number) >>> 0;
		const mode = (this.memory.readValue(IO_VDP_RD_MODE) as number) >>> 0;
		if (mode !== VDP_RD_MODE_RGBA8888) {
			throw new Error(`[BmsxVDP] Unsupported VDP read mode ${mode}.`);
		}
		const surface = this.getReadSurface(surfaceId);
		const width = surface.entry.regionW;
		const height = surface.entry.regionH;
		if (x >= width || y >= height) {
			throw new Error(`[BmsxVDP] VDP read out of bounds (${x}, ${y}) for surface ${surfaceId}.`);
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
		this.frameBufferWidth = 0;
		this.frameBufferHeight = 0;
		this.frameBufferPixels = new Uint8Array(0);
		this.resetFrameBufferCommands();
		this.memory.writeValue(IO_VDP_DITHER, dither);
		this.memory.writeValue(IO_VDP_LEGACY_CMD, 0);
		this.lastDitherType = dither;
		$.view.dither_type = dither;
	}

	public syncRegisters(): void {
		const dither = this.memory.readValue(IO_VDP_DITHER) as number;
		if (dither !== this.lastDitherType) {
			this.lastDitherType = dither;
			$.view.dither_type = dither;
		}
		const primaryRaw = (this.memory.readValue(IO_VDP_PRIMARY_ATLAS_ID) as number) >>> 0;
		const secondaryRaw = (this.memory.readValue(IO_VDP_SECONDARY_ATLAS_ID) as number) >>> 0;
		const primary = primaryRaw === VDP_ATLAS_ID_NONE ? null : primaryRaw;
		const secondary = secondaryRaw === VDP_ATLAS_ID_NONE ? null : secondaryRaw;
		if (primary !== this.slotAtlasIds[0] || secondary !== this.slotAtlasIds[1]) {
			this.applyAtlasSlotMapping(primary, secondary);
		}
		const command = (this.memory.readValue(IO_VDP_LEGACY_CMD) as number) >>> 0;
		if (command !== 0) {
			throw new Error(`[BmsxVDP] Legacy VDP command register was removed. Got ${command}.`);
		}
	}

	public setDitherType(value: number): void {
		this.memory.writeValue(IO_VDP_DITHER, value);
		this.syncRegisters();
	}

	public getDitherType(): number {
		return this.lastDitherType;
	}

	public getSkyboxFaceIds(): SkyboxImageIds | null {
		return this.skyboxFaceIds;
	}

	public commitViewSnapshot(): void {
		const view = $.view;
		view.primaryAtlasIdInSlot = this.slotAtlasIds[0];
		view.secondaryAtlasIdInSlot = this.slotAtlasIds[1];
		if (this.dirtySkybox) {
			view.skyboxFaceIds = this.skyboxFaceIds;
			this.dirtySkybox = false;
		}
	}

	public getAtlasSlotMapping(): { primary: number | null; secondary: number | null } {
		return { primary: this.slotAtlasIds[0], secondary: this.slotAtlasIds[1] };
	}

	public restoreAtlasSlotMapping(mapping: { primary: number | null; secondary: number | null }): void {
		const primaryValue = mapping.primary === null ? VDP_ATLAS_ID_NONE : mapping.primary;
		const secondaryValue = mapping.secondary === null ? VDP_ATLAS_ID_NONE : mapping.secondary;
		this.memory.writeValue(IO_VDP_PRIMARY_ATLAS_ID, primaryValue);
		this.memory.writeValue(IO_VDP_SECONDARY_ATLAS_ID, secondaryValue);
		this.applyAtlasSlotMapping(mapping.primary, mapping.secondary);
	}

	private applyAtlasSlotMapping(primary: number | null, secondary: number | null): void {
		const configureSlotEntry = (slotEntry: AssetEntry, atlasId: number | null): void => {
			if (atlasId === null) {
				const maxPixels = Math.floor(slotEntry.capacity / 4);
				const side = Math.floor(Math.sqrt(maxPixels));
				slotEntry.baseSize = side * side * 4;
				slotEntry.baseStride = side * 4;
				slotEntry.regionX = 0;
				slotEntry.regionY = 0;
				slotEntry.regionW = side;
				slotEntry.regionH = side;
				return;
			}
				const atlasEntry = this.atlasResourcesById.get(atlasId);
				if (!atlasEntry) {
					throw new Error(`[BmsxVDP] Atlas ${atlasId} not registered.`);
				}
				const atlasAsset = Runtime.instance.getImageAsset(atlasEntry.resid);
				const width = atlasAsset.imgmeta.width;
				const height = atlasAsset.imgmeta.height;
			const size = width * height * 4;
			if (size > slotEntry.capacity) {
				throw new Error(`[BmsxVDP] Atlas ${atlasId} (${width}x${height}) exceeds slot capacity ${slotEntry.capacity}.`);
			}
			slotEntry.baseSize = size;
			slotEntry.baseStride = width * 4;
			slotEntry.regionX = 0;
			slotEntry.regionY = 0;
			slotEntry.regionW = width;
			slotEntry.regionH = height;
		};
		configureSlotEntry(this.atlasSlotEntries[0], primary);
		configureSlotEntry(this.atlasSlotEntries[1], secondary);
		this.atlasSlotById.clear();
		this.slotAtlasIds[0] = primary;
		this.slotAtlasIds[1] = secondary;
		if (primary !== null) {
			this.atlasSlotById.set(primary, 0);
		}
		if (secondary !== null) {
			this.atlasSlotById.set(secondary, 1);
		}
		if (primary !== null) {
			const viewEntries = this.atlasViewsById.get(primary);
			if (viewEntries) {
				for (let index = 0; index < viewEntries.length; index += 1) {
					this.memory.updateImageViewBase(viewEntries[index], this.atlasSlotEntries[0]);
				}
			}
		}
		if (secondary !== null) {
			const viewEntries = this.atlasViewsById.get(secondary);
			if (viewEntries) {
				for (let index = 0; index < viewEntries.length; index += 1) {
					this.memory.updateImageViewBase(viewEntries[index], this.atlasSlotEntries[1]);
				}
			}
		}
	}

	public setSkyboxImages(ids: SkyboxImageIds): void {
		if (!this.imgDecController) {
			throw new Error('[BmsxVDP] ImgDecController not attached.');
		}
		const source = $.asset_source;
		if (!source) {
			throw new Error('[BmsxVDP] Asset source not configured.');
		}
		const runtime = Runtime.instance;
		this.skyboxFaceIds = ids;
		this.dirtySkybox = true;
		SkyboxPipeline.clearSkyboxSources();
		const tasks = SKYBOX_FACE_KEYS.map((key, index) => {
			const assetId = ids[key];
			const entry = source.getEntry(assetId);
			if (!entry) {
				throw new Error(`[BmsxVDP] Skybox image '${assetId}' not found.`);
			}
			if (entry.type !== 'image') {
				throw new Error(`[BmsxVDP] Skybox image '${assetId}' is not an image.`);
			}
			if (typeof entry.start !== 'number' || typeof entry.end !== 'number') {
				throw new Error(`[BmsxVDP] Skybox image '${assetId}' missing ROM buffer offsets.`);
			}
			const asset = runtime.getImageAsset(assetId);
			if (!asset.imgmeta) {
				throw new Error(`[BmsxVDP] Skybox image '${assetId}' missing metadata.`);
			}
			if (asset.imgmeta.atlassed) {
				throw new Error(`[BmsxVDP] Skybox image '${assetId}' must not be atlassed.`);
			}
			const slot = this.skyboxSlots[index];
			return this.imgDecController.decodeToVram({
				bytes: source.getBytes(entry),
				dst: slot.entry.baseAddr,
				cap: slot.entry.capacity,
			}).then((decoded) => {
				if (asset.imgmeta.width <= 0) {
					asset.imgmeta.width = decoded.width;
				}
				if (asset.imgmeta.height <= 0) {
					asset.imgmeta.height = decoded.height;
				}
				return {
					width: slot.entry.regionW,
					height: slot.entry.regionH,
					data: decoded.pixels,
				};
			});
		});
		SkyboxPipeline.setSkyboxSources(ids, tasks);
	}

	public clearSkybox(): void {
		this.skyboxFaceIds = null;
		this.dirtySkybox = true;
		SkyboxPipeline.clearSkyboxSources();
	}

	public async registerImageAssets(source: RawAssetSource): Promise<void> {
		if (!this.imgDecController) {
			throw new Error('[BmsxVDP] ImgDecController not attached.');
		}
		const entries = source.list();
		const viewEntries: RomAsset[] = [];
		const engineAtlasName = generateAtlasName(ENGINE_ATLAS_INDEX);
		let engineEntryRecord: AssetEntry | null = null;
		const setAtlasEntryDimensions = (slotEntry: AssetEntry, width: number, height: number): void => {
			const size = width * height * 4;
			if (size > slotEntry.capacity) {
				throw new Error(`[BmsxVDP] Atlas entry '${slotEntry.id}' (${width}x${height}) exceeds capacity ${slotEntry.capacity}.`);
			}
			slotEntry.baseSize = size;
			slotEntry.baseStride = width * 4;
			slotEntry.regionX = 0;
			slotEntry.regionY = 0;
			slotEntry.regionW = width;
			slotEntry.regionH = height;
		};
		const seedAtlasSlot = (slotEntry: AssetEntry): void => {
			const maxPixels = Math.floor(slotEntry.capacity / 4);
			const side = Math.floor(Math.sqrt(maxPixels));
			setAtlasEntryDimensions(slotEntry, side, side);
		};
		this.atlasResourcesById.clear();
		this.atlasViewsById.clear();
		this.atlasSlotById.clear();
		this.slotAtlasIds[0] = null;
		this.slotAtlasIds[1] = null;
		this.vramSlots = [];
		this.readSurfaces = [null, null, null];
		this.clearReadCaches();
		this.cpuReadbackByKey.clear();
		this.skyboxSlots = [];
		this.imgDecController.clearExternalSlots();
		this.skyboxFaceIds = null;
		this.dirtySkybox = true;
		SkyboxPipeline.clearSkyboxSources();
		this.vramBootSeed = this.nextVramBootSeed();
		this.seedVramStaging();

		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			if (entry.type !== 'image' && entry.type !== 'atlas') {
				continue;
			}
			const imgAsset = Runtime.instance.getImageAssetByEntry(entry);
			if (!imgAsset) {
				throw new Error(`[BmsxVDP] Image asset '${entry.resid}' not found.`);
			}
			const meta = imgAsset.imgmeta;
			if (!meta) {
				throw new Error(`[BmsxVDP] Image asset '${entry.resid}' missing metadata.`);
			}
			if (entry.type === 'atlas') {
				if (typeof meta.atlasid !== 'number') {
					throw new Error(`[BmsxVDP] Atlas '${entry.resid}' missing atlas id.`);
				}
				if (meta.width <= 0 || meta.height <= 0) {
					throw new Error(`[BmsxVDP] Atlas '${entry.resid}' missing dimensions.`);
				}
				this.atlasResourcesById.set(meta.atlasid, entry);
				continue;
			}
			if (meta.atlassed) {
				viewEntries.push(entry);
				continue;
			}
		}

		if (!engineEntryRecord && this.memory.hasAsset(engineAtlasName)) {
			engineEntryRecord = this.memory.getAssetEntry(engineAtlasName);
		}

		const engineAtlasAsset = Runtime.instance.getImageAsset(engineAtlasName, source);
		if (!engineAtlasAsset) {
			throw new Error(`[BmsxVDP] Engine atlas '${engineAtlasName}' not found.`);
		}
		const engineAtlasMeta = engineAtlasAsset.imgmeta;
		if (!engineAtlasMeta || engineAtlasMeta.width <= 0 || engineAtlasMeta.height <= 0) {
			throw new Error(`[BmsxVDP] Engine atlas '${engineAtlasName}' missing dimensions.`);
		}
		if (!engineEntryRecord) {
			engineEntryRecord = this.memory.registerImageSlotAt({
				id: engineAtlasName,
				baseAddr: VRAM_SYSTEM_ATLAS_BASE,
				capacityBytes: VRAM_SYSTEM_ATLAS_SIZE,
				clear: false,
			});
		}
		setAtlasEntryDimensions(engineEntryRecord, engineAtlasMeta.width, engineAtlasMeta.height);
		this.registerVramSlot(engineEntryRecord, ENGINE_ATLAS_TEXTURE_KEY, VDP_RD_SURFACE_ENGINE);
		await this.restoreEngineAtlasFromSource(engineEntryRecord, source, engineAtlasAsset);

		const skyboxBytes = VRAM_SKYBOX_FACE_BYTES;
		for (let index = 0; index < SKYBOX_FACE_KEYS.length; index += 1) {
			const entry: ImageWriteEntry = {
				baseAddr: skyboxFaceBaseByIndex(index),
				capacity: skyboxBytes,
				baseSize: 0,
				baseStride: 0,
				regionX: 0,
				regionY: 0,
				regionW: 0,
				regionH: 0,
			};
			this.skyboxSlots.push({ face: SKYBOX_FACE_KEYS[index], entry });
			this.imgDecController.registerExternalSlot(entry.baseAddr, entry);
			this.vramSlots.push({
				kind: 'skybox',
				baseAddr: entry.baseAddr,
				capacity: entry.capacity,
				entry,
			});
		}

		const primarySlotEntry = this.memory.hasAsset(ATLAS_PRIMARY_SLOT_ID)
			? this.memory.getAssetEntry(ATLAS_PRIMARY_SLOT_ID)
			: this.memory.registerImageSlotAt({
				id: ATLAS_PRIMARY_SLOT_ID,
				baseAddr: VRAM_PRIMARY_ATLAS_BASE,
				capacityBytes: VRAM_PRIMARY_ATLAS_SIZE,
				clear: false,
			});
		const secondarySlotEntry = this.memory.hasAsset(ATLAS_SECONDARY_SLOT_ID)
			? this.memory.getAssetEntry(ATLAS_SECONDARY_SLOT_ID)
			: this.memory.registerImageSlotAt({
				id: ATLAS_SECONDARY_SLOT_ID,
				baseAddr: VRAM_SECONDARY_ATLAS_BASE,
				capacityBytes: VRAM_SECONDARY_ATLAS_SIZE,
				clear: false,
			});
		seedAtlasSlot(primarySlotEntry);
		seedAtlasSlot(secondarySlotEntry);
		this.atlasSlotEntries = [primarySlotEntry, secondarySlotEntry];
		this.registerVramSlot(primarySlotEntry, ATLAS_PRIMARY_SLOT_ID, VDP_RD_SURFACE_PRIMARY);
		this.registerVramSlot(secondarySlotEntry, ATLAS_SECONDARY_SLOT_ID, VDP_RD_SURFACE_SECONDARY);

		for (let index = 0; index < viewEntries.length; index += 1) {
			const entry = viewEntries[index];
			const imgAsset = Runtime.instance.getImageAssetByEntry(entry);
			const meta = imgAsset.imgmeta;
			if (!meta.atlassed) {
				throw new Error(`[BmsxVDP] Image asset '${entry.resid}' expected to be atlassed.`);
			}
			if (!meta.texcoords) {
				throw new Error(`[BmsxVDP] Image asset '${entry.resid}' missing atlas texcoords.`);
			}
			const atlasId = meta.atlasid;
			if (atlasId === undefined || atlasId === null) {
				throw new Error(`[BmsxVDP] Image asset '${entry.resid}' missing atlas id.`);
			}
			let atlasWidth = 0;
			let atlasHeight = 0;
			let baseEntry = primarySlotEntry;
			if (atlasId === ENGINE_ATLAS_INDEX) {
				baseEntry = engineEntryRecord;
				atlasWidth = engineAtlasMeta.width;
				atlasHeight = engineAtlasMeta.height;
			} else {
				const atlasEntry = this.atlasResourcesById.get(atlasId);
				if (!atlasEntry) {
					throw new Error(`[BmsxVDP] Atlas ${atlasId} not registered for '${entry.resid}'.`);
				}
				const atlasAsset = Runtime.instance.getImageAssetByEntry(atlasEntry);
				atlasWidth = atlasAsset.imgmeta.width;
				atlasHeight = atlasAsset.imgmeta.height;
				const mappedSlot = this.atlasSlotById.get(atlasId);
				if (mappedSlot !== undefined) {
					baseEntry = this.atlasSlotEntries[mappedSlot];
				}
			}
			const coords = meta.texcoords;
			const minU = Math.min(coords[0], coords[2], coords[4], coords[6], coords[8], coords[10]);
			const maxU = Math.max(coords[0], coords[2], coords[4], coords[6], coords[8], coords[10]);
			const minV = Math.min(coords[1], coords[3], coords[5], coords[7], coords[9], coords[11]);
			const maxV = Math.max(coords[1], coords[3], coords[5], coords[7], coords[9], coords[11]);
			// Texcoords are serialized as float32, so round back to the source texel grid.
			const offsetX = Math.round(minU * atlasWidth);
			const offsetY = Math.round(minV * atlasHeight);
			const regionW = Math.max(1, Math.min(atlasWidth - offsetX, Math.round((maxU - minU) * atlasWidth)));
			const regionH = Math.max(1, Math.min(atlasHeight - offsetY, Math.round((maxV - minV) * atlasHeight)));
			const viewEntry = this.memory.hasAsset(entry.resid)
				? this.memory.getAssetEntry(entry.resid)
				: this.memory.registerImageView({
					id: entry.resid,
					baseEntry,
					regionX: offsetX,
					regionY: offsetY,
					regionW,
					regionH,
				});
			let list = this.atlasViewsById.get(atlasId);
			if (!list) {
				list = [];
				this.atlasViewsById.set(atlasId, list);
			}
			list.push(viewEntry);
		}

		this.syncRegisters();
	}

	private async restoreEngineAtlasFromSource(entry: AssetEntry, source: RawAssetSource, asset: RomImgAsset): Promise<void> {
		if (typeof asset.start !== 'number' || typeof asset.end !== 'number') {
			throw new Error(`[BmsxVDP] Engine atlas '${asset.resid}' missing ROM buffer offsets.`);
		}
		const decoded = await decodePngToRgba(source.getBytes(asset));
		const plan = this.memory.planImageSlotWrite(entry, {
			pixels: decoded.pixels,
			width: decoded.width,
			height: decoded.height,
			capacity: entry.capacity,
		});
		if (plan.clipped) {
			throw new Error(`[BmsxVDP] Engine atlas '${asset.resid}' does not fit in system atlas slot.`);
		}
		this.memory.writeBytes(entry.baseAddr, decoded.pixels.subarray(0, plan.writeSize));
	}

	public flushAssetEdits(): void {
		const dirty = this.memory.consumeDirtyAssets();
		if (dirty.length === 0) {
			return;
		}
		const engineAtlasName = generateAtlasName(ENGINE_ATLAS_INDEX);
		for (let index = 0; index < dirty.length; index += 1) {
			const entry = dirty.get(index);
			if (entry.type === 'image') {
				const vramSpan = entry.capacity > 0 ? entry.capacity : 1;
				if (this.memory.isVramRange(entry.baseAddr, vramSpan)) {
					continue;
				}
				const pixels = this.memory.getImagePixels(entry);
				const width = entry.regionW;
				const height = entry.regionH;
				const token = this.assetUpdateGate.begin({ blocking: false, category: 'texture', tag: `asset:${entry.id}` });
				const textureKey = entry.id === engineAtlasName ? ENGINE_ATLAS_TEXTURE_KEY : entry.id;
				if ((entry.id === ATLAS_PRIMARY_SLOT_ID || entry.id === ATLAS_SECONDARY_SLOT_ID)
					&& !$.texmanager.getTextureByUri(textureKey)) {
					void $.texmanager.loadTextureFromPixels(textureKey, pixels, width, height)
						.then((handle) => { $.view.textures[textureKey] = handle; })
						.finally(() => this.assetUpdateGate.end(token));
				} else {
					void $.texmanager.updateTexturesForKey(textureKey, pixels, width, height)
						.finally(() => this.assetUpdateGate.end(token));
				}
			} else if (entry.type === 'audio') {
				$.sndmaster.invalidateClip(entry.id);
			}
		}
	}

	private updateTextureRegion(textureKey: string, pixels: Uint8Array, width: number, height: number, x: number, y: number): void {
		$.texmanager.updateTextureRegionForKey(textureKey, pixels, width, height, x, y);
	}

	private clearReadCaches(): void {
		for (let index = 0; index < this.readCaches.length; index += 1) {
			this.readCaches[index].width = 0;
		}
	}

	private invalidateReadCache(surfaceId: number): void {
		const cache = this.readCaches[surfaceId];
		if (cache) {
			cache.width = 0;
		}
	}

	private registerReadSurface(surfaceId: number, entry: AssetEntry, textureKey: string): void {
		if (surfaceId < 0 || surfaceId >= VDP_RD_SURFACE_COUNT) {
			throw new Error(`[BmsxVDP] Invalid read surface ${surfaceId}.`);
		}
		this.readSurfaces[surfaceId] = { entry, textureKey };
		this.invalidateReadCache(surfaceId);
	}

	private getReadSurface(surfaceId: number): VdpReadSurface {
		const surface = this.readSurfaces[surfaceId];
		if (!surface) {
			throw new Error(`[BmsxVDP] Read surface ${surfaceId} not registered.`);
		}
		return surface;
	}

	private getReadCache(surfaceId: number, surface: VdpReadSurface, x: number, y: number): VdpReadCache {
		const cache = this.readCaches[surfaceId];
		if (cache.width === 0 || cache.y !== y || x < cache.x0 || x >= cache.x0 + cache.width) {
			this.prefetchReadCache(cache, surface, x, y);
		}
		return cache;
	}

	private prefetchReadCache(cache: VdpReadCache, surface: VdpReadSurface, x: number, y: number): void {
		const width = surface.entry.regionW;
		const height = surface.entry.regionH;
		if (x >= width || y >= height) {
			throw new Error(`[BmsxVDP] Read cache prefetch out of bounds (${x}, ${y}).`);
		}
		const maxPixelsByBudget = Math.floor(this.readBudgetBytes / 4);
		if (maxPixelsByBudget <= 0) {
			this.readOverflow = true;
			cache.width = 0;
			return;
		}
		const chunkW = Math.min(VDP_RD_MAX_CHUNK_PIXELS, width - x, maxPixelsByBudget);
		const data = this.readSurfacePixels(cache, surface, x, y, chunkW, 1);
		cache.x0 = x;
		cache.y = y;
		cache.width = chunkW;
		cache.data = data;
	}

	private readSurfacePixels(cache: VdpReadCache, surface: VdpReadSurface, x: number, y: number, width: number, height: number): Uint8Array {
		if (this.useCpuReadback()) {
			return this.readCpuReadback(cache, surface, x, y, width, height);
		}
		const handle = $.texmanager.getTextureByUri(surface.textureKey);
		if (!handle) {
			throw new Error(`[BmsxVDP] Readback texture missing for '${surface.textureKey}'.`);
		}
		return $.view.backend.readTextureRegion(handle, x, y, width, height);
	}

	private ensureReadCacheCapacity(cache: VdpReadCache, byteLength: number): Uint8Array {
		if (cache.data.byteLength < byteLength) {
			cache.data = new Uint8Array(byteLength);
		}
		return cache.data;
	}

	private readCpuReadback(cache: VdpReadCache, surface: VdpReadSurface, x: number, y: number, width: number, height: number): Uint8Array {
		const buffer = this.getCpuReadbackBuffer(surface);
		const stride = surface.entry.regionW * 4;
		const rowBytes = width * 4;
		const out = this.ensureReadCacheCapacity(cache, rowBytes * height);
		for (let row = 0; row < height; row += 1) {
			const srcOffset = (y + row) * stride + x * 4;
			const dstOffset = row * rowBytes;
			out.set(buffer.subarray(srcOffset, srcOffset + rowBytes), dstOffset);
		}
		return out;
	}

	private updateCpuReadback(surfaceId: number, slice: Uint8Array, x: number, y: number): void {
		const surface = this.readSurfaces[surfaceId];
		if (!surface) {
			return;
		}
		const buffer = this.getCpuReadbackBuffer(surface);
		const stride = surface.entry.regionW * 4;
		const offset = y * stride + x * 4;
		buffer.set(slice, offset);
	}

	private getCpuReadbackBuffer(surface: VdpReadSurface): Uint8Array {
		const key = surface.textureKey;
		let buffer = this.cpuReadbackByKey.get(key);
		const expectedSize = surface.entry.regionW * surface.entry.regionH * 4;
		if (!buffer || buffer.byteLength !== expectedSize) {
			buffer = new Uint8Array(expectedSize);
			this.cpuReadbackByKey.set(key, buffer);
		}
		return buffer;
	}

	private getAssetVramSlotByOwner(ownerIndex: number): AssetVramSlot {
		for (let index = 0; index < this.vramSlots.length; index += 1) {
			const slot = this.vramSlots[index];
			if (slot.kind === 'asset' && slot.entry.ownerIndex === ownerIndex) {
				return slot;
			}
		}
		throw new Error(`[BmsxVDP] No VRAM slot found for owner ${ownerIndex}.`);
	}

	private useCpuReadback(): boolean {
		return $.view.backend.type === 'headless';
	}

	private writeVramStaging(addr: number, bytes: Uint8Array): void {
		const offset = addr - VRAM_STAGING_BASE;
		if (offset < 0 || offset + bytes.byteLength > this.vramStaging.byteLength) {
			throw new Error(`[BmsxVDP] VRAM staging write out of bounds (addr=${addr}, len=${bytes.byteLength}).`);
		}
		this.vramStaging.set(bytes, offset);
	}

	public getTrackedUsedVramBytes(): number {
		let usedBytes = 0;
		for (let index = 0; index < this.vramSlots.length; index += 1) {
			const slot = this.vramSlots[index];
			if (slot.kind === 'skybox') {
				continue;
			}
			usedBytes += slot.entry.baseSize;
		}
		return usedBytes;
	}

	public getTrackedTotalVramBytes(): number {
		return VRAM_SYSTEM_ATLAS_SIZE + VRAM_PRIMARY_ATLAS_SIZE + VRAM_SECONDARY_ATLAS_SIZE + VRAM_STAGING_SIZE;
	}

	private registerVramSlot(entry: AssetEntry, textureKey: string, surfaceId: number): void {
		let handle = $.texmanager.getTextureByUri(textureKey);
		const isEngineAtlas = textureKey === ENGINE_ATLAS_TEXTURE_KEY;
		const preserveEngineAtlasTexture = isEngineAtlas && !!handle;
		let textureWidth = entry.regionW;
		let textureHeight = entry.regionH;
		if (!handle) {
			const stream = this.makeVramGarbageStream(entry.baseAddr >>> 0);
			fillVramGarbageScratch(this.vramSeedPixel, stream);
			handle = $.texmanager.createTextureFromPixelsSync(textureKey, this.vramSeedPixel, 1, 1);
			handle = $.texmanager.resizeTextureForKey(textureKey, entry.regionW, entry.regionH);
		} else if (!preserveEngineAtlasTexture) {
			handle = $.texmanager.resizeTextureForKey(textureKey, entry.regionW, entry.regionH);
		}
		$.view.textures[textureKey] = handle;
		const slot: AssetVramSlot = {
			kind: 'asset',
			baseAddr: entry.baseAddr,
			capacity: entry.capacity,
			entry,
			textureKey,
			surfaceId,
			textureWidth,
			textureHeight,
		};
		this.vramSlots.push(slot);
		this.registerReadSurface(surfaceId, entry, textureKey);
		if (!isEngineAtlas) {
			this.seedVramSlotTexture(slot);
		}
	}

	private syncVramSlotTextureSize(slot: AssetVramSlot): void {
		const width = slot.entry.regionW;
		const height = slot.entry.regionH;
		if (slot.textureWidth === width && slot.textureHeight === height) {
			return;
		}
		const handle = $.texmanager.resizeTextureForKey(slot.textureKey, width, height);
		$.view.textures[slot.textureKey] = handle;
		slot.textureWidth = width;
		slot.textureHeight = height;
		this.invalidateReadCache(slot.surfaceId);
		this.seedVramSlotTexture(slot);
	}

	private makeVramGarbageStream(addr: number): VramGarbageStream {
		return {
			machineSeed: this.vramMachineSeed,
			bootSeed: this.vramBootSeed,
			slotSalt: VRAM_GARBAGE_SPACE_SALT >>> 0,
			addr: addr >>> 0,
		};
	}

	private nextVramMachineSeed(): number {
		const time = Date.now() >>> 0;
		const rand = Math.floor(Math.random() * 0xffffffff) >>> 0;
		return (time ^ rand) >>> 0;
	}

	private nextVramBootSeed(): number {
		const time = Date.now() >>> 0;
		const rand = Math.floor(Math.random() * 0xffffffff) >>> 0;
		const jitter = Math.floor(Math.random() * 0xffffffff) >>> 0;
		return (time ^ rand ^ jitter) >>> 0;
	}

	private seedVramStaging(): void {
		const stream = this.makeVramGarbageStream(VRAM_STAGING_BASE >>> 0);
		fillVramGarbageScratch(this.vramStaging, stream);
	}

	private seedVramSlotTexture(slot: AssetVramSlot): void {
		const width = slot.entry.regionW;
		const height = slot.entry.regionH;
		if (width === 0 || height === 0) {
			throw new Error(`[BmsxVDP] VRAM slot '${slot.entry.id}' missing dimensions.`);
		}
		const rowPixels = width;
		const maxPixels = Math.floor(this.vramGarbageScratch.byteLength / 4);
		if (maxPixels <= 0) {
			throw new Error('[BmsxVDP] VRAM garbage scratch buffer is empty.');
		}
		const stream = this.makeVramGarbageStream(slot.baseAddr >>> 0);
		if (rowPixels <= maxPixels) {
			const rowsPerChunk = Math.max(1, Math.floor(maxPixels / rowPixels));
			for (let y = 0; y < height; ) {
				const rows = Math.min(rowsPerChunk, height - y);
				const chunkBytes = rowPixels * rows * 4;
				const chunk = this.vramGarbageScratch.subarray(0, chunkBytes);
				fillVramGarbageScratch(chunk, stream);
				this.updateTextureRegion(slot.textureKey, chunk, rowPixels, rows, 0, y);
				for (let row = 0; row < rows; row += 1) {
					const rowOffset = row * rowPixels * 4;
					const slice = chunk.subarray(rowOffset, rowOffset + rowPixels * 4);
					this.updateCpuReadback(slot.surfaceId, slice, 0, y + row);
				}
				y += rows;
			}
		} else {
			for (let y = 0; y < height; y += 1) {
				for (let x = 0; x < width; ) {
					const segmentWidth = Math.min(maxPixels, width - x);
					const segmentBytes = segmentWidth * 4;
					const segment = this.vramGarbageScratch.subarray(0, segmentBytes);
					fillVramGarbageScratch(segment, stream);
					this.updateTextureRegion(slot.textureKey, segment, segmentWidth, 1, x, y);
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
		throw new Error(`[BmsxVDP] VRAM write has no mapped slot (addr=${addr}, len=${length}).`);
	}

}
