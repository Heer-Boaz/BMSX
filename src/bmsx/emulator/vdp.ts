import { $ } from '../core/engine_core';
import { taskGate } from '../core/taskgate';
import { Runtime } from './runtime';
import * as SkyboxPipeline from '../render/3d/skybox_pipeline';
import { decodePngToRgba } from '../utils/image_decode';
import { ScratchBatch } from '../utils/scratchbatch';
import {
	BGMAP_LAYER_FLAG_ENABLED,
	BGMAP_TILE_FLAG_ENABLED,
	OAM_FLAG_ENABLED,
	PAT_FLAG_ENABLED,
} from '../render/shared/render_types';
import type { BgMapEntry, BgMapHeader, OamEntry, PatEntry, PatHeader, SkyboxImageIds, color } from '../render/shared/render_types';
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
	IO_VDP_OAM_BACK_BASE,
	IO_VDP_OAM_BACK_COUNT,
	IO_VDP_OAM_CAPACITY,
	IO_VDP_OAM_CMD,
	IO_VDP_OAM_COMMIT_SEQ,
	IO_VDP_OAM_ENTRY_WORDS,
	IO_VDP_OAM_FRONT_BASE,
	IO_VDP_OAM_FRONT_COUNT,
	IO_VDP_OAM_READ_SOURCE,
	OAM_CMD_CLEAR_BACK,
	OAM_CMD_SWAP,
	IO_VDP_PRIMARY_ATLAS_ID,
	IO_VDP_RD_MODE,
	IO_VDP_RD_SURFACE,
	IO_VDP_RD_X,
	IO_VDP_RD_Y,
	IO_VDP_SECONDARY_ATLAS_ID,
	VDP_OAM_READ_SOURCE_BACK,
	VDP_OAM_READ_SOURCE_FRONT,
	VDP_ATLAS_ID_NONE,
	VDP_RD_MODE_RGBA8888,
	VDP_RD_STATUS_OVERFLOW,
	VDP_RD_STATUS_READY,
} from './io';
import type { AssetEntry, ImageWriteEntry, VdpIoHandler, VramWriteSink } from './memory';
import { Memory } from './memory';
import { ImgDecController } from './devices/imgdec_controller';
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
	VDP_BGMAP_BACK_BASE,
	VDP_BGMAP_ENTRY_BYTES,
	VDP_BGMAP_FRONT_BASE,
	VDP_BGMAP_LAYER_COUNT,
	VDP_BGMAP_LAYER_SIZE,
	VDP_BGMAP_TILE_CAPACITY,
	VDP_OAM_BACK_BASE,
	VDP_OAM_ENTRY_BYTES,
	VDP_OAM_ENTRY_WORDS as VDP_OAM_ENTRY_WORD_COUNT,
	VDP_OAM_FRONT_BASE,
	VDP_OAM_SLOT_COUNT,
	VDP_PAT_BACK_BASE,
	VDP_PAT_CAPACITY,
	VDP_PAT_ENTRY_BYTES,
	VDP_PAT_FRONT_BASE,
	VDP_PAT_HEADER_BYTES,
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

type ActiveOamHeader = {
	base: number;
	count: number;
};

function createActiveOamHeader(): ActiveOamHeader {
	return {
		base: 0,
		count: 0,
	};
}

function createOamEntryScratch(): OamEntry {
	return {
		atlasId: 0,
		flags: OAM_FLAG_ENABLED,
		assetHandle: 0,
		x: 0,
		y: 0,
		z: 0,
		w: 0,
		h: 0,
		u0: 0,
		v0: 0,
		u1: 0,
		v1: 0,
		r: 1,
		g: 1,
		b: 1,
		a: 1,
		layer: 0,
		parallaxWeight: 0,
	};
}

function createPatHeaderScratch(): PatHeader {
	return {
		flags: 0,
		count: 0,
	};
}

function createPatEntryScratch(): PatEntry {
	return {
		atlasId: 0,
		flags: 0,
		assetHandle: 0,
		layer: 0,
		x: 0,
		y: 0,
		z: 0,
		glyphW: 0,
		glyphH: 0,
		bgW: 0,
		bgH: 0,
		u0: 0,
		v0: 0,
		u1: 0,
		v1: 0,
		fgColor: 0,
		bgColor: 0,
	};
}

function createBgMapHeaderScratch(): BgMapHeader {
	return {
		flags: 0,
		layer: 0,
		cols: 0,
		rows: 0,
		tileW: 0,
		tileH: 0,
		originX: 0,
		originY: 0,
		scrollX: 0,
		scrollY: 0,
		z: 0,
	};
}

function createBgMapEntryScratch(): BgMapEntry {
	return {
		atlasId: 0,
		flags: 0,
		assetHandle: 0,
		u0: 0,
		v0: 0,
		u1: 0,
		v1: 0,
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
	private readonly activeOamHeaderScratch = createActiveOamHeader();
	private readonly patHeaderScratch = createPatHeaderScratch();
	private readonly patEntryScratch = createPatEntryScratch();
	private readonly bgMapHeaderScratch = createBgMapHeaderScratch();
	private readonly bgMapEntryScratch = createBgMapEntryScratch();
	private readonly bgMapBackLayerPending = new Array<boolean>(VDP_BGMAP_LAYER_COUNT).fill(false);
	private readonly bgMapBackLayerRewritePending = new Array<boolean>(VDP_BGMAP_LAYER_COUNT).fill(false);
	private readonly bgMapPatchFlags = Array.from({ length: VDP_BGMAP_LAYER_COUNT }, () => new Uint8Array(VDP_BGMAP_TILE_CAPACITY));
	private readonly bgMapPatchEntries = Array.from({ length: VDP_BGMAP_LAYER_COUNT }, () => Array.from({ length: VDP_BGMAP_TILE_CAPACITY }, () => createBgMapEntryScratch()));
	private readonly bgMapPatchIndices = Array.from({ length: VDP_BGMAP_LAYER_COUNT }, () => new ScratchBatch<number>(64));
	private readonly forEach2dScratch = createOamEntryScratch();
	private readonly oamReadPool: OamEntry[] = [];
	private readonly oamWordScratch = new ArrayBuffer(4);
	private readonly oamWordView = new DataView(this.oamWordScratch);
	private bgMapFrontBase = VDP_BGMAP_FRONT_BASE;
	private bgMapBackBase = VDP_BGMAP_BACK_BASE;
	private patFrontBase = VDP_PAT_FRONT_BASE;
	private patBackBase = VDP_PAT_BACK_BASE;
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
		this.bgMapFrontBase = VDP_BGMAP_FRONT_BASE;
		this.bgMapBackBase = VDP_BGMAP_BACK_BASE;
		this.patFrontBase = VDP_PAT_FRONT_BASE;
		this.patBackBase = VDP_PAT_BACK_BASE;
		this.memory.writeValue(IO_VDP_DITHER, dither);
		this.memory.writeValue(IO_VDP_OAM_FRONT_BASE, VDP_OAM_FRONT_BASE);
		this.memory.writeValue(IO_VDP_OAM_BACK_BASE, VDP_OAM_BACK_BASE);
		this.memory.writeValue(IO_VDP_OAM_FRONT_COUNT, 0);
		this.memory.writeValue(IO_VDP_OAM_BACK_COUNT, 0);
		this.memory.writeValue(IO_VDP_OAM_CAPACITY, VDP_OAM_SLOT_COUNT);
		this.memory.writeValue(IO_VDP_OAM_ENTRY_WORDS, VDP_OAM_ENTRY_WORD_COUNT);
		this.memory.writeValue(IO_VDP_OAM_READ_SOURCE, VDP_OAM_READ_SOURCE_FRONT);
		this.memory.writeValue(IO_VDP_OAM_COMMIT_SEQ, 0);
		this.memory.writeValue(IO_VDP_OAM_CMD, 0);
		this.writePatHeader(this.patFrontBase, { flags: 0, count: 0 });
		this.writePatHeader(this.patBackBase, { flags: 0, count: 0 });
		for (let layerIndex = 0; layerIndex < VDP_BGMAP_LAYER_COUNT; layerIndex += 1) {
			this.writeBgMapHeader(this.bgMapFrontBase + layerIndex * VDP_BGMAP_LAYER_SIZE, {
				flags: 0,
				layer: 0,
				cols: 0,
				rows: 0,
				tileW: 0,
				tileH: 0,
				originX: 0,
				originY: 0,
				scrollX: 0,
				scrollY: 0,
				z: 0,
			});
		}
		this.clearBackBgMap();
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
		const command = (this.memory.readValue(IO_VDP_OAM_CMD) as number) >>> 0;
		if (command !== 0) {
			if (command === OAM_CMD_SWAP) {
				this.swapOamBuffers();
			} else if (command === OAM_CMD_CLEAR_BACK) {
				this.clearBackOamBuffer();
			} else {
				throw new Error(`[BmsxVDP] Unknown OAM command ${command}.`);
			}
			this.memory.writeValue(IO_VDP_OAM_CMD, 0);
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

	private floatToBits(value: number): number {
		this.oamWordView.setFloat32(0, value, true);
		return this.oamWordView.getUint32(0, true);
	}

	private bitsToFloat(value: number): number {
		this.oamWordView.setUint32(0, value >>> 0, true);
		return this.oamWordView.getFloat32(0, true);
	}

	private readActiveOamHeaderInto(target: ActiveOamHeader): ActiveOamHeader {
		const source = this.memory.readValue(IO_VDP_OAM_READ_SOURCE) as number;
		if (source === VDP_OAM_READ_SOURCE_BACK) {
			target.base = this.memory.readValue(IO_VDP_OAM_BACK_BASE) as number;
			target.count = this.memory.readValue(IO_VDP_OAM_BACK_COUNT) as number;
			return target;
		}
		target.base = this.memory.readValue(IO_VDP_OAM_FRONT_BASE) as number;
		target.count = this.memory.readValue(IO_VDP_OAM_FRONT_COUNT) as number;
		return target;
	}

	private getBgMapLayerBaseForRead(layerIndex: number): number {
		const readSource = (this.memory.readValue(IO_VDP_OAM_READ_SOURCE) as number) >>> 0;
		if (
			readSource === VDP_OAM_READ_SOURCE_BACK
			&& this.bgMapBackLayerPending[layerIndex]
			&& this.bgMapBackLayerRewritePending[layerIndex]
		) {
			return this.bgMapBackBase + layerIndex * VDP_BGMAP_LAYER_SIZE;
		}
		return this.bgMapFrontBase + layerIndex * VDP_BGMAP_LAYER_SIZE;
	}

	private getActivePatBase(): number {
		return (this.memory.readValue(IO_VDP_OAM_READ_SOURCE) as number) === VDP_OAM_READ_SOURCE_BACK
			? this.patBackBase
			: this.patFrontBase;
	}

	private writeOamEntry(addr: number, entry: OamEntry): void {
		this.memory.writeU32(addr + 0, entry.atlasId >>> 0);
		this.memory.writeU32(addr + 4, entry.flags >>> 0);
		this.memory.writeU32(addr + 8, entry.assetHandle >>> 0);
		this.memory.writeU32(addr + 12, this.floatToBits(entry.x));
		this.memory.writeU32(addr + 16, this.floatToBits(entry.y));
		this.memory.writeU32(addr + 20, this.floatToBits(entry.z));
		this.memory.writeU32(addr + 24, this.floatToBits(entry.w));
		this.memory.writeU32(addr + 28, this.floatToBits(entry.h));
		this.memory.writeU32(addr + 32, this.floatToBits(entry.u0));
		this.memory.writeU32(addr + 36, this.floatToBits(entry.v0));
		this.memory.writeU32(addr + 40, this.floatToBits(entry.u1));
		this.memory.writeU32(addr + 44, this.floatToBits(entry.v1));
		this.memory.writeU32(addr + 48, this.floatToBits(entry.r));
		this.memory.writeU32(addr + 52, this.floatToBits(entry.g));
		this.memory.writeU32(addr + 56, this.floatToBits(entry.b));
		this.memory.writeU32(addr + 60, this.floatToBits(entry.a));
		this.memory.writeU32(addr + 64, entry.layer >>> 0);
		this.memory.writeU32(addr + 68, this.floatToBits(entry.parallaxWeight));
	}

	private readOamEntryInto(addr: number, target: OamEntry): OamEntry {
		target.atlasId = this.memory.readU32(addr + 0);
		target.flags = this.memory.readU32(addr + 4);
		target.assetHandle = this.memory.readU32(addr + 8);
		target.x = this.bitsToFloat(this.memory.readU32(addr + 12));
		target.y = this.bitsToFloat(this.memory.readU32(addr + 16));
		target.z = this.bitsToFloat(this.memory.readU32(addr + 20));
		target.w = this.bitsToFloat(this.memory.readU32(addr + 24));
		target.h = this.bitsToFloat(this.memory.readU32(addr + 28));
		target.u0 = this.bitsToFloat(this.memory.readU32(addr + 32));
		target.v0 = this.bitsToFloat(this.memory.readU32(addr + 36));
		target.u1 = this.bitsToFloat(this.memory.readU32(addr + 40));
		target.v1 = this.bitsToFloat(this.memory.readU32(addr + 44));
		target.r = this.bitsToFloat(this.memory.readU32(addr + 48));
		target.g = this.bitsToFloat(this.memory.readU32(addr + 52));
		target.b = this.bitsToFloat(this.memory.readU32(addr + 56));
		target.a = this.bitsToFloat(this.memory.readU32(addr + 60));
		target.layer = this.memory.readU32(addr + 64) as 0 | 1 | 2;
		target.parallaxWeight = this.bitsToFloat(this.memory.readU32(addr + 68));
		return target;
	}

	private writePatHeader(base: number, header: PatHeader): void {
		this.memory.writeU32(base + 0, header.flags >>> 0);
		this.memory.writeU32(base + 4, header.count >>> 0);
	}

	private readPatHeaderInto(base: number, target: PatHeader): PatHeader {
		target.flags = this.memory.readU32(base + 0);
		target.count = this.memory.readU32(base + 4);
		return target;
	}

	private writePatEntry(addr: number, entry: PatEntry): void {
		this.memory.writeU32(addr + 0, entry.atlasId >>> 0);
		this.memory.writeU32(addr + 4, entry.flags >>> 0);
		this.memory.writeU32(addr + 8, entry.assetHandle >>> 0);
		this.memory.writeU32(addr + 12, entry.layer >>> 0);
		this.memory.writeU32(addr + 16, this.floatToBits(entry.x));
		this.memory.writeU32(addr + 20, this.floatToBits(entry.y));
		this.memory.writeU32(addr + 24, this.floatToBits(entry.z));
		this.memory.writeU32(addr + 28, this.floatToBits(entry.glyphW));
		this.memory.writeU32(addr + 32, this.floatToBits(entry.glyphH));
		this.memory.writeU32(addr + 36, this.floatToBits(entry.bgW));
		this.memory.writeU32(addr + 40, this.floatToBits(entry.bgH));
		this.memory.writeU32(addr + 44, this.floatToBits(entry.u0));
		this.memory.writeU32(addr + 48, this.floatToBits(entry.v0));
		this.memory.writeU32(addr + 52, this.floatToBits(entry.u1));
		this.memory.writeU32(addr + 56, this.floatToBits(entry.v1));
		this.memory.writeU32(addr + 60, entry.fgColor >>> 0);
		this.memory.writeU32(addr + 64, entry.bgColor >>> 0);
	}

	private readPatEntryInto(addr: number, target: PatEntry): PatEntry {
		target.atlasId = this.memory.readU32(addr + 0);
		target.flags = this.memory.readU32(addr + 4);
		target.assetHandle = this.memory.readU32(addr + 8);
		target.layer = this.memory.readU32(addr + 12) as 0 | 1 | 2;
		target.x = this.bitsToFloat(this.memory.readU32(addr + 16));
		target.y = this.bitsToFloat(this.memory.readU32(addr + 20));
		target.z = this.bitsToFloat(this.memory.readU32(addr + 24));
		target.glyphW = this.bitsToFloat(this.memory.readU32(addr + 28));
		target.glyphH = this.bitsToFloat(this.memory.readU32(addr + 32));
		target.bgW = this.bitsToFloat(this.memory.readU32(addr + 36));
		target.bgH = this.bitsToFloat(this.memory.readU32(addr + 40));
		target.u0 = this.bitsToFloat(this.memory.readU32(addr + 44));
		target.v0 = this.bitsToFloat(this.memory.readU32(addr + 48));
		target.u1 = this.bitsToFloat(this.memory.readU32(addr + 52));
		target.v1 = this.bitsToFloat(this.memory.readU32(addr + 56));
		target.fgColor = this.memory.readU32(addr + 60);
		target.bgColor = this.memory.readU32(addr + 64);
		return target;
	}

	private writeBgMapHeader(base: number, header: BgMapHeader): void {
		this.memory.writeU32(base + 0, header.flags >>> 0);
		this.memory.writeU32(base + 4, header.layer >>> 0);
		this.memory.writeU32(base + 8, header.cols >>> 0);
		this.memory.writeU32(base + 12, header.rows >>> 0);
		this.memory.writeU32(base + 16, header.tileW >>> 0);
		this.memory.writeU32(base + 20, header.tileH >>> 0);
		this.memory.writeU32(base + 24, this.floatToBits(header.originX));
		this.memory.writeU32(base + 28, this.floatToBits(header.originY));
		this.memory.writeU32(base + 32, this.floatToBits(header.scrollX));
		this.memory.writeU32(base + 36, this.floatToBits(header.scrollY));
		this.memory.writeU32(base + 40, this.floatToBits(header.z));
	}

	private readBgMapHeaderInto(base: number, target: BgMapHeader): BgMapHeader {
		target.flags = this.memory.readU32(base + 0);
		target.layer = this.memory.readU32(base + 4) as 0 | 1 | 2;
		target.cols = this.memory.readU32(base + 8);
		target.rows = this.memory.readU32(base + 12);
		target.tileW = this.memory.readU32(base + 16);
		target.tileH = this.memory.readU32(base + 20);
		target.originX = this.bitsToFloat(this.memory.readU32(base + 24));
		target.originY = this.bitsToFloat(this.memory.readU32(base + 28));
		target.scrollX = this.bitsToFloat(this.memory.readU32(base + 32));
		target.scrollY = this.bitsToFloat(this.memory.readU32(base + 36));
		target.z = this.bitsToFloat(this.memory.readU32(base + 40));
		return target;
	}

	private writeBgMapEntry(addr: number, entry: BgMapEntry): void {
		this.memory.writeU32(addr + 0, entry.atlasId >>> 0);
		this.memory.writeU32(addr + 4, entry.flags >>> 0);
		this.memory.writeU32(addr + 8, entry.assetHandle >>> 0);
		this.memory.writeU32(addr + 12, this.floatToBits(entry.u0));
		this.memory.writeU32(addr + 16, this.floatToBits(entry.v0));
		this.memory.writeU32(addr + 20, this.floatToBits(entry.u1));
		this.memory.writeU32(addr + 24, this.floatToBits(entry.v1));
	}

	private readBgMapEntryInto(addr: number, target: BgMapEntry): BgMapEntry {
		target.atlasId = this.memory.readU32(addr + 0);
		target.flags = this.memory.readU32(addr + 4);
		target.assetHandle = this.memory.readU32(addr + 8);
		target.u0 = this.bitsToFloat(this.memory.readU32(addr + 12));
		target.v0 = this.bitsToFloat(this.memory.readU32(addr + 16));
		target.u1 = this.bitsToFloat(this.memory.readU32(addr + 20));
		target.v1 = this.bitsToFloat(this.memory.readU32(addr + 24));
		return target;
	}

	private copyBgMapLayer(srcBase: number, dstBase: number): void {
		this.memory.writeBytes(dstBase, this.memory.readBytes(srcBase, VDP_BGMAP_LAYER_SIZE));
	}

	private clearBgMapPatchLayer(layerIndex: number): void {
		const patchFlags = this.bgMapPatchFlags[layerIndex];
		const patchIndices = this.bgMapPatchIndices[layerIndex];
		for (let index = 0; index < patchIndices.size; index += 1) {
			patchFlags[patchIndices.get(index)] = 0;
		}
		patchIndices.clear();
	}

	private writeBgMapPatchEntry(layerIndex: number, tileIndex: number, entry: BgMapEntry): void {
		const patchFlags = this.bgMapPatchFlags[layerIndex];
		if (patchFlags[tileIndex] === 0) {
			patchFlags[tileIndex] = 1;
			this.bgMapPatchIndices[layerIndex].push(tileIndex);
		}
		const target = this.bgMapPatchEntries[layerIndex][tileIndex];
		target.atlasId = entry.atlasId;
		target.flags = entry.flags;
		target.assetHandle = entry.assetHandle;
		target.u0 = entry.u0;
		target.v0 = entry.v0;
		target.u1 = entry.u1;
		target.v1 = entry.v1;
	}

	private getBgMapTileForRead(layerIndex: number, tileIndex: number, layerBase: number, patchRead: boolean, target: BgMapEntry): BgMapEntry {
		if (patchRead && this.bgMapPatchFlags[layerIndex][tileIndex] !== 0) {
			const patch = this.bgMapPatchEntries[layerIndex][tileIndex];
			target.atlasId = patch.atlasId;
			target.flags = patch.flags;
			target.assetHandle = patch.assetHandle;
			target.u0 = patch.u0;
			target.v0 = patch.v0;
			target.u1 = patch.u1;
			target.v1 = patch.v1;
			return target;
		}
		return this.readBgMapEntryInto(layerBase + 44 + tileIndex * VDP_BGMAP_ENTRY_BYTES, target);
	}

	private unpackColorChannel(packed: number, shift: number): number {
		return ((packed >>> shift) & 0xff) / 255;
	}

	private getOamReadEntry(index: number): OamEntry {
		let entry = this.oamReadPool[index];
		if (!entry) {
			entry = createOamEntryScratch();
			this.oamReadPool[index] = entry;
		}
		return entry;
	}

	public submitOamEntry(entry: OamEntry): void {
		const backCount = this.memory.readValue(IO_VDP_OAM_BACK_COUNT) as number;
		const capacity = this.memory.readValue(IO_VDP_OAM_CAPACITY) as number;
		if (backCount >= capacity) {
			throw new Error(`[BmsxVDP] OAM back buffer overflow (${capacity} slots).`);
		}
		const base = this.memory.readValue(IO_VDP_OAM_BACK_BASE) as number;
		this.writeOamEntry(base + backCount * VDP_OAM_ENTRY_BYTES, entry);
		this.memory.writeValue(IO_VDP_OAM_BACK_COUNT, backCount + 1);
	}

	public clearBackOamBuffer(): void {
		this.memory.writeValue(IO_VDP_OAM_BACK_COUNT, 0);
	}

	public clearBackPatBuffer(): void {
		this.writePatHeader(this.patBackBase, { flags: 0, count: 0 });
	}

	public submitPatEntry(entry: PatEntry): void {
		const header = this.readPatHeaderInto(this.patBackBase, this.patHeaderScratch);
		if (header.count >= VDP_PAT_CAPACITY) {
			throw new Error(`[BmsxVDP] PAT back buffer overflow (${VDP_PAT_CAPACITY} entries).`);
		}
		const addr = this.patBackBase + VDP_PAT_HEADER_BYTES + header.count * VDP_PAT_ENTRY_BYTES;
		this.writePatEntry(addr, entry);
		this.writePatHeader(this.patBackBase, { flags: PAT_FLAG_ENABLED, count: header.count + 1 });
	}

	public clearBackBgMap(): void {
		for (let layerIndex = 0; layerIndex < VDP_BGMAP_LAYER_COUNT; layerIndex += 1) {
			this.bgMapBackLayerPending[layerIndex] = false;
			this.bgMapBackLayerRewritePending[layerIndex] = false;
			this.clearBgMapPatchLayer(layerIndex);
			const base = this.bgMapBackBase + layerIndex * VDP_BGMAP_LAYER_SIZE;
			this.writeBgMapHeader(base, {
				flags: 0,
				layer: 0,
				cols: 0,
				rows: 0,
				tileW: 0,
				tileH: 0,
				originX: 0,
				originY: 0,
				scrollX: 0,
				scrollY: 0,
				z: 0,
			});
		}
	}

	public beginBgMapLayerWrite(layerIndex: number, header: BgMapHeader): void {
		if (layerIndex < 0 || layerIndex >= VDP_BGMAP_LAYER_COUNT) {
			throw new Error(`[BmsxVDP] BGMap layer ${layerIndex} outside range 0-${VDP_BGMAP_LAYER_COUNT - 1}.`);
		}
		if (header.cols * header.rows > VDP_BGMAP_TILE_CAPACITY) {
			throw new Error(`[BmsxVDP] BGMap layer ${layerIndex} exceeds tile capacity ${VDP_BGMAP_TILE_CAPACITY}.`);
		}
		const base = this.bgMapBackBase + layerIndex * VDP_BGMAP_LAYER_SIZE;
		this.bgMapBackLayerPending[layerIndex] = true;
		this.bgMapBackLayerRewritePending[layerIndex] = true;
		this.clearBgMapPatchLayer(layerIndex);
		this.writeBgMapHeader(base, header);
		for (let tileIndex = 0; tileIndex < VDP_BGMAP_TILE_CAPACITY; tileIndex += 1) {
			this.memory.writeU32(base + 44 + tileIndex * VDP_BGMAP_ENTRY_BYTES + 4, 0);
		}
	}

	public submitBgMapTile(layerIndex: number, col: number, row: number, entry: BgMapEntry): void {
		if (layerIndex < 0 || layerIndex >= VDP_BGMAP_LAYER_COUNT) {
			throw new Error(`[BmsxVDP] BGMap layer ${layerIndex} outside range 0-${VDP_BGMAP_LAYER_COUNT - 1}.`);
		}
		const rewritePending = this.bgMapBackLayerRewritePending[layerIndex];
		const base = rewritePending
			? this.bgMapBackBase + layerIndex * VDP_BGMAP_LAYER_SIZE
			: this.bgMapFrontBase + layerIndex * VDP_BGMAP_LAYER_SIZE;
		const header = this.readBgMapHeaderInto(base, this.bgMapHeaderScratch);
		if (col < 0 || col >= header.cols || row < 0 || row >= header.rows) {
			throw new Error(`[BmsxVDP] BGMap tile (${col}, ${row}) outside configured layer bounds ${header.cols}x${header.rows}.`);
		}
		const index = row * header.cols + col;
		if (rewritePending) {
			const addr = base + 44 + index * VDP_BGMAP_ENTRY_BYTES;
			this.writeBgMapEntry(addr, entry);
			return;
		}
		this.bgMapBackLayerPending[layerIndex] = true;
		this.writeBgMapPatchEntry(layerIndex, index, entry);
	}

	public swapOamBuffers(): void {
		const frontBase = this.memory.readValue(IO_VDP_OAM_FRONT_BASE) as number;
		const backBase = this.memory.readValue(IO_VDP_OAM_BACK_BASE) as number;
		const backCount = this.memory.readValue(IO_VDP_OAM_BACK_COUNT) as number;
		const commitSeq = this.memory.readValue(IO_VDP_OAM_COMMIT_SEQ) as number;
		this.memory.writeValue(IO_VDP_OAM_FRONT_BASE, backBase);
		this.memory.writeValue(IO_VDP_OAM_BACK_BASE, frontBase);
		this.memory.writeValue(IO_VDP_OAM_FRONT_COUNT, backCount);
		this.memory.writeValue(IO_VDP_OAM_BACK_COUNT, 0);
		this.memory.writeValue(IO_VDP_OAM_COMMIT_SEQ, commitSeq + 1);
		this.memory.writeValue(IO_VDP_OAM_READ_SOURCE, VDP_OAM_READ_SOURCE_FRONT);
	}

	public swapPatBuffers(): void {
		const frontBase = this.patFrontBase;
		this.patFrontBase = this.patBackBase;
		this.patBackBase = frontBase;
		this.clearBackPatBuffer();
	}

	public swapBgMapBuffers(): void {
		for (let layerIndex = 0; layerIndex < VDP_BGMAP_LAYER_COUNT; layerIndex += 1) {
			if (!this.bgMapBackLayerPending[layerIndex]) {
				continue;
			}
			const frontBase = this.bgMapFrontBase + layerIndex * VDP_BGMAP_LAYER_SIZE;
			if (this.bgMapBackLayerRewritePending[layerIndex]) {
				const backBase = this.bgMapBackBase + layerIndex * VDP_BGMAP_LAYER_SIZE;
				this.copyBgMapLayer(backBase, frontBase);
			} else {
				const patchIndices = this.bgMapPatchIndices[layerIndex];
				for (let index = 0; index < patchIndices.size; index += 1) {
					const tileIndex = patchIndices.get(index);
					this.writeBgMapEntry(frontBase + 44 + tileIndex * VDP_BGMAP_ENTRY_BYTES, this.bgMapPatchEntries[layerIndex][tileIndex]);
				}
				this.clearBgMapPatchLayer(layerIndex);
			}
			this.bgMapBackLayerPending[layerIndex] = false;
			this.bgMapBackLayerRewritePending[layerIndex] = false;
		}
	}

	public getBgMapFrontBase(): number {
		return this.bgMapFrontBase;
	}

	public getBgMapBackBase(): number {
		return this.bgMapBackBase;
	}

	public getPatFrontBase(): number {
		return this.patFrontBase;
	}

	public getPatBackBase(): number {
		return this.patBackBase;
	}

	public setOamReadSource(source: 'front' | 'back'): void {
		this.memory.writeValue(IO_VDP_OAM_READ_SOURCE, source === 'back' ? VDP_OAM_READ_SOURCE_BACK : VDP_OAM_READ_SOURCE_FRONT);
	}

	public getOamFrontCount(): number {
		return this.memory.readValue(IO_VDP_OAM_FRONT_COUNT) as number;
	}

	public getOamBackCount(): number {
		return this.memory.readValue(IO_VDP_OAM_BACK_COUNT) as number;
	}

	public hasFrontOamContent(): boolean {
		return this.getOamFrontCount() > 0;
	}

	public hasBackOamContent(): boolean {
		return this.getOamBackCount() > 0;
	}

	public hasFront2dContent(): boolean {
		if (this.getOamFrontCount() > 0) {
			return true;
		}
		if (this.readPatHeaderInto(this.patFrontBase, this.patHeaderScratch).count > 0) {
			return true;
		}
		for (let layerIndex = 0; layerIndex < VDP_BGMAP_LAYER_COUNT; layerIndex += 1) {
			const header = this.readBgMapHeaderInto(this.bgMapFrontBase + layerIndex * VDP_BGMAP_LAYER_SIZE, this.bgMapHeaderScratch);
			if ((header.flags & BGMAP_LAYER_FLAG_ENABLED) !== 0 && header.cols * header.rows > 0) {
				return true;
			}
		}
		return false;
	}

	public hasBack2dContent(): boolean {
		if (this.getOamBackCount() > 0) {
			return true;
		}
		if (this.readPatHeaderInto(this.patBackBase, this.patHeaderScratch).count > 0) {
			return true;
		}
		for (let layerIndex = 0; layerIndex < VDP_BGMAP_LAYER_COUNT; layerIndex += 1) {
			if (!this.bgMapBackLayerPending[layerIndex]) {
				continue;
			}
			const headerBase = this.bgMapBackLayerRewritePending[layerIndex]
				? this.bgMapBackBase + layerIndex * VDP_BGMAP_LAYER_SIZE
				: this.bgMapFrontBase + layerIndex * VDP_BGMAP_LAYER_SIZE;
			const header = this.readBgMapHeaderInto(headerBase, this.bgMapHeaderScratch);
			if ((header.flags & BGMAP_LAYER_FLAG_ENABLED) !== 0 && header.cols * header.rows > 0) {
				return true;
			}
		}
		return false;
	}

	public beginSpriteOamRead(): number {
		this.syncRegisters();
		return this.readActiveOamHeaderInto(this.activeOamHeaderScratch).count;
	}

	public begin2dRead(): number {
		this.syncRegisters();
		const activeOam = this.readActiveOamHeaderInto(this.activeOamHeaderScratch);
		let count = activeOam.count;
		const activePatBase = this.getActivePatBase();
		const patHeader = this.readPatHeaderInto(activePatBase, this.patHeaderScratch);
		let patCount = 0;
		if ((patHeader.flags & PAT_FLAG_ENABLED) !== 0) {
			for (let patIndex = 0; patIndex < patHeader.count; patIndex += 1) {
				const entry = this.readPatEntryInto(activePatBase + VDP_PAT_HEADER_BYTES + patIndex * VDP_PAT_ENTRY_BYTES, this.patEntryScratch);
				if ((entry.flags & PAT_FLAG_ENABLED) !== 0) {
					patCount += 1;
				}
			}
			count += patCount;
		}
		let bgCount = 0;
		const readSource = (this.memory.readValue(IO_VDP_OAM_READ_SOURCE) as number) >>> 0;
		for (let layerIndex = 0; layerIndex < VDP_BGMAP_LAYER_COUNT; layerIndex += 1) {
			const layerBase = this.getBgMapLayerBaseForRead(layerIndex);
			const patchRead = readSource === VDP_OAM_READ_SOURCE_BACK && this.bgMapBackLayerPending[layerIndex] && !this.bgMapBackLayerRewritePending[layerIndex];
			const header = this.readBgMapHeaderInto(layerBase, this.bgMapHeaderScratch);
			if ((header.flags & BGMAP_LAYER_FLAG_ENABLED) !== 0) {
				const cellCount = header.cols * header.rows;
				let layerEnabledCount = 0;
				for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
					const tile = this.getBgMapTileForRead(layerIndex, cellIndex, layerBase, patchRead, this.bgMapEntryScratch);
					if ((tile.flags & BGMAP_TILE_FLAG_ENABLED) === 0) {
						continue;
					}
					layerEnabledCount += 1;
				}
				bgCount += layerEnabledCount;
				count += layerEnabledCount;
			}
		}
		return count;
	}

	public forEachOamEntry(fn: (entry: OamEntry, index: number) => void): void {
		this.syncRegisters();
		const activeOam = this.readActiveOamHeaderInto(this.activeOamHeaderScratch);
		const base = activeOam.base;
		const count = activeOam.count;
		for (let index = 0; index < count; index += 1) {
			const entry = this.readOamEntryInto(base + index * VDP_OAM_ENTRY_BYTES, this.getOamReadEntry(index));
			if (entry.flags !== 0) {
				fn(entry, index);
			}
		}
	}

	public forEach2dEntry(fn: (entry: OamEntry, index: number) => void): void {
		this.syncRegisters();
		let index = 0;
		const scratch = this.forEach2dScratch;
		scratch.flags = OAM_FLAG_ENABLED;
		scratch.r = 1;
		scratch.g = 1;
		scratch.b = 1;
		scratch.a = 1;
		scratch.layer = 0;
		const readSource = (this.memory.readValue(IO_VDP_OAM_READ_SOURCE) as number) >>> 0;
		for (let layerIndex = 0; layerIndex < VDP_BGMAP_LAYER_COUNT; layerIndex += 1) {
			const layerBase = this.getBgMapLayerBaseForRead(layerIndex);
			const patchRead = readSource === VDP_OAM_READ_SOURCE_BACK && this.bgMapBackLayerPending[layerIndex] && !this.bgMapBackLayerRewritePending[layerIndex];
			const header = this.readBgMapHeaderInto(layerBase, this.bgMapHeaderScratch);
			if ((header.flags & BGMAP_LAYER_FLAG_ENABLED) === 0) {
				continue;
			}
			const cellCount = header.cols * header.rows;
			for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
				const tile = this.getBgMapTileForRead(layerIndex, cellIndex, layerBase, patchRead, this.bgMapEntryScratch);
				if ((tile.flags & BGMAP_TILE_FLAG_ENABLED) === 0) {
					continue;
				}
				const col = cellIndex % header.cols;
				const row = Math.floor(cellIndex / header.cols);
				scratch.atlasId = tile.atlasId;
				scratch.assetHandle = tile.assetHandle;
				scratch.x = header.originX + col * header.tileW - header.scrollX;
				scratch.y = header.originY + row * header.tileH - header.scrollY;
				scratch.z = header.z;
				scratch.w = header.tileW;
				scratch.h = header.tileH;
				scratch.u0 = tile.u0;
				scratch.v0 = tile.v0;
				scratch.u1 = tile.u1;
				scratch.v1 = tile.v1;
				scratch.r = 1;
				scratch.g = 1;
				scratch.b = 1;
				scratch.a = 1;
				scratch.layer = header.layer;
				scratch.parallaxWeight = 0;
				fn(scratch, index);
				index += 1;
			}
		}
		const activeOam = this.readActiveOamHeaderInto(this.activeOamHeaderScratch);
		const oamBaseIndex = index;
		for (let oamIndex = 0; oamIndex < activeOam.count; oamIndex += 1) {
			const entry = this.readOamEntryInto(activeOam.base + oamIndex * VDP_OAM_ENTRY_BYTES, this.getOamReadEntry(oamIndex));
			if (entry.flags !== 0) {
				fn(entry, oamBaseIndex + oamIndex);
			}
		}
		index += activeOam.count;
		const patBase = this.getActivePatBase();
		const patHeader = this.readPatHeaderInto(patBase, this.patHeaderScratch);
		if ((patHeader.flags & PAT_FLAG_ENABLED) !== 0) {
			for (let patIndex = 0; patIndex < patHeader.count; patIndex += 1) {
				const entry = this.readPatEntryInto(patBase + VDP_PAT_HEADER_BYTES + patIndex * VDP_PAT_ENTRY_BYTES, this.patEntryScratch);
				if ((entry.flags & PAT_FLAG_ENABLED) === 0) {
					continue;
				}
				scratch.atlasId = entry.atlasId;
				scratch.assetHandle = entry.assetHandle;
				scratch.x = entry.x;
				scratch.y = entry.y;
				scratch.z = entry.z;
				scratch.w = entry.glyphW;
				scratch.h = entry.glyphH;
				scratch.u0 = entry.u0;
				scratch.v0 = entry.v0;
				scratch.u1 = entry.u1;
				scratch.v1 = entry.v1;
				scratch.r = this.unpackColorChannel(entry.fgColor, 0);
				scratch.g = this.unpackColorChannel(entry.fgColor, 8);
				scratch.b = this.unpackColorChannel(entry.fgColor, 16);
				scratch.a = this.unpackColorChannel(entry.fgColor, 24);
				scratch.layer = entry.layer;
				scratch.parallaxWeight = 0;
				fn(scratch, index);
				index += 1;
			}
		}
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
			const offsetX = Math.floor(minU * atlasWidth);
			const offsetY = Math.floor(minV * atlasHeight);
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
		if (!this.useCpuReadback()) {
			return;
		}
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
				if (this.useCpuReadback()) {
					for (let row = 0; row < rows; row += 1) {
						const rowOffset = row * rowPixels * 4;
						const slice = chunk.subarray(rowOffset, rowOffset + rowPixels * 4);
						this.updateCpuReadback(slot.surfaceId, slice, 0, y + row);
					}
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
					if (this.useCpuReadback()) {
						this.updateCpuReadback(slot.surfaceId, segment, x, y);
					}
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
