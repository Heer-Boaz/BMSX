import { $ } from '../core/engine_core';
import { taskGate } from '../core/taskgate';
import { Runtime } from './runtime';
import * as SkyboxPipeline from '../render/3d/skybox_pipeline';
import { decodePngToRgba } from '../utils/image_decode';
import type { Layer2D, SkyboxImageIds, color } from '../render/shared/render_types';
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
	IO_VDP_TILE_HANDLE_NONE,
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
	VRAM_FRAMEBUFFER_BASE,
	VRAM_FRAMEBUFFER_SIZE,
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
const VDP_RD_SURFACE_FRAMEBUFFER = 3;
const VDP_RD_SURFACE_COUNT = 4;
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

export type VdpGlyphRunGlyph = VdpBlitterSource & {
	dstX: number;
	dstY: number;
	advance: number;
};

export type VdpTileRunBlit = VdpBlitterSource & {
	dstX: number;
	dstY: number;
};

export type VdpBlitterClearCommand = {
	opcode: 'clear';
	seq: number;
	color: VdpFrameBufferColor;
};

export type VdpBlitterBlitCommand = {
	opcode: 'blit';
	seq: number;
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

export interface VdpBlitterHost {
	width: number;
	height: number;
	frameBufferTextureKey: string;
	getSurface(surfaceId: number): { textureKey: string; width: number; height: number };
	getShaderAtlasId(surfaceId: number): number;
}

export interface VdpBlitterExecutor {
	readonly backendType: 'webgl2' | 'webgpu' | 'headless';
	execute(host: VdpBlitterHost, commands: readonly VdpBlitterCommand[]): void;
}

export const FRAMEBUFFER_TEXTURE_KEY = '_framebuffer_2d';
const BLITTER_FIFO_CAPACITY = 4096;

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
	private readSurfaces: Array<VdpReadSurface | null> = [null, null, null, null];
	private readCaches: VdpReadCache[] = [];
	private readBudgetBytes = VDP_RD_BUDGET_BYTES;
	private readOverflow = false;
	private cpuReadbackByKey = new Map<string, Uint8Array>();
	private skyboxSlots: SkyboxSlot[] = [];
	private dirtySkybox = false;
	private _skyboxFaceIds: SkyboxImageIds | null = null;
	private lastDitherType = 0;
	private imgDecController: ImgDecController | null = null;
	private _frameBufferWidth = 0;
	private _frameBufferHeight = 0;
	private readonly blitterQueue: VdpBlitterCommand[] = [];
	private blitterSequence = 0;
	public constructor(
		private readonly memory: Memory,
		private readonly blitterExecutor: VdpBlitterExecutor | null,
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

	private packFrameBufferColor(source: color): VdpFrameBufferColor {
		return {
			r: Math.round(source.r * 255),
			g: Math.round(source.g * 255),
			b: Math.round(source.b * 255),
			a: Math.round(source.a * 255),
		};
	}

	private nextBlitterSequence(): number {
		const seq = this.blitterSequence;
		this.blitterSequence += 1;
		return seq;
	}

	private resetBlitterState(): void {
		this.blitterQueue.length = 0;
		this.blitterSequence = 0;
	}

	private enqueueBlitterCommand(command: VdpBlitterCommand): void {
		if (this.blitterQueue.length >= BLITTER_FIFO_CAPACITY) {
			throw new Error(`[BmsxVDP] Blitter FIFO overflow (${BLITTER_FIFO_CAPACITY} commands).`);
		}
		this.blitterQueue.push(command);
	}

	private initializeFrameBufferSurface(): void {
		const width = $.view.viewportSize.x;
		const height = $.view.viewportSize.y;
		const entry = this.memory.hasAsset(FRAMEBUFFER_TEXTURE_KEY)
			? this.memory.getAssetEntry(FRAMEBUFFER_TEXTURE_KEY)
			: this.memory.registerImageSlotAt({
				id: FRAMEBUFFER_TEXTURE_KEY,
				baseAddr: VRAM_FRAMEBUFFER_BASE,
				capacityBytes: VRAM_FRAMEBUFFER_SIZE,
				clear: false,
			});
		const size = width * height * 4;
		if (size > entry.capacity) {
			throw new Error(`[BmsxVDP] Framebuffer surface exceeds VRAM capacity (${size} > ${entry.capacity}).`);
		}
		entry.baseSize = size;
		entry.baseStride = width * 4;
		entry.regionX = 0;
		entry.regionY = 0;
		entry.regionW = width;
		entry.regionH = height;
		this._frameBufferWidth = width;
		this._frameBufferHeight = height;
		this.registerVramSlot(entry, FRAMEBUFFER_TEXTURE_KEY, VDP_RD_SURFACE_FRAMEBUFFER);
	}

	private resolveBlitterSource(handle: number): VdpBlitterSource {
		const entry = Runtime.instance.getAssetEntryByHandle(handle);
		if (entry.type !== 'image') {
			throw new Error(`[BmsxVDP] Asset handle ${handle} is not an image.`);
		}
		if ((entry.flags & ASSET_FLAG_VIEW) !== 0) {
			const baseEntry = Runtime.instance.getAssetEntryByHandle(entry.ownerIndex);
			const slot = this.vramSlots.find((candidate) => candidate.kind === 'asset' && candidate.entry.ownerIndex === baseEntry.ownerIndex)! as AssetVramSlot;
			return {
				surfaceId: slot.surfaceId,
				srcX: entry.regionX,
				srcY: entry.regionY,
				width: entry.regionW,
				height: entry.regionH,
			};
		}
		const slot = this.vramSlots.find((candidate) => candidate.kind === 'asset' && candidate.entry.ownerIndex === entry.ownerIndex)! as AssetVramSlot;
		return {
			surfaceId: slot.surfaceId,
			srcX: 0,
			srcY: 0,
			width: entry.regionW,
			height: entry.regionH,
		};
	}

	public enqueueClear(colorValue: color): void {
		this.enqueueBlitterCommand({
			opcode: 'clear',
			seq: this.nextBlitterSequence(),
			color: this.packFrameBufferColor(colorValue),
		});
	}

	public enqueueBlit(handle: number, x: number, y: number, z: number, layer: Layer2D, scaleX: number, scaleY: number, flipH: boolean, flipV: boolean, colorValue: color, parallaxWeight: number): void {
		this.enqueueBlitterCommand({
			opcode: 'blit',
			seq: this.nextBlitterSequence(),
			layer,
			z,
			source: this.resolveBlitterSource(handle),
			dstX: x,
			dstY: y,
			scaleX,
			scaleY,
			flipH,
			flipV,
			color: this.packFrameBufferColor(colorValue),
			parallaxWeight,
		});
	}

	public enqueueCopyRect(srcX: number, srcY: number, width: number, height: number, dstX: number, dstY: number, z: number, layer: Layer2D): void {
		this.enqueueBlitterCommand({
			opcode: 'copy_rect',
			seq: this.nextBlitterSequence(),
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
		this.enqueueBlitterCommand({
			opcode: 'fill_rect',
			seq: this.nextBlitterSequence(),
			layer,
			z,
			x0,
			y0,
			x1,
			y1,
			color: this.packFrameBufferColor(colorValue),
		});
	}

	public enqueueDrawLine(x0: number, y0: number, x1: number, y1: number, z: number, layer: Layer2D, colorValue: color, thickness: number): void {
		this.enqueueBlitterCommand({
			opcode: 'draw_line',
			seq: this.nextBlitterSequence(),
			layer,
			z,
			x0,
			y0,
			x1,
			y1,
			thickness,
			color: this.packFrameBufferColor(colorValue),
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
		const lines = Array.isArray(text) ? text : [text];
		const glyphs: VdpGlyphRunGlyph[] = [];
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
				const handle = Runtime.instance.resolveAssetHandle(glyph.imgid);
				const source = this.resolveBlitterSource(handle);
				glyphs.push({
					surfaceId: source.surfaceId,
					srcX: source.srcX,
					srcY: source.srcY,
					width: source.width,
					height: source.height,
					dstX: cursorX,
					dstY: cursorY,
					advance: glyph.advance,
				});
				cursorX += glyph.advance;
			}
			cursorY += font.lineHeight;
		}
		this.enqueueBlitterCommand({
			opcode: 'glyph_run',
			seq: this.nextBlitterSequence(),
			layer,
			z,
			lineHeight: font.lineHeight,
			color: this.packFrameBufferColor(colorValue),
			backgroundColor: backgroundColor ? this.packFrameBufferColor(backgroundColor) : null,
			glyphs,
		});
	}

	public enqueueTileRun(desc: { tiles: Array<string | false>; cols: number; rows: number; tile_w: number; tile_h: number; origin_x: number; origin_y: number; scroll_x: number; scroll_y: number; z: number; layer: Layer2D }): void {
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
		const tiles: VdpTileRunBlit[] = [];
		for (let row = 0; row < desc.rows; row += 1) {
			const base = row * desc.cols;
			for (let col = 0; col < desc.cols; col += 1) {
				const tile = desc.tiles[base + col];
				if (tile === false) {
					continue;
				}
				const handle = Runtime.instance.resolveAssetHandle(tile);
				const source = this.resolveBlitterSource(handle);
				if (source.width !== desc.tile_w || source.height !== desc.tile_h) {
					throw new Error(`dma_blit_tiles asset '${tile}' size mismatch (${source.width}x${source.height} != ${desc.tile_w}x${desc.tile_h}).`);
				}
				const tileX = dstX + (col * desc.tile_w) - srcClipX;
				const tileY = dstY + (row * desc.tile_h) - srcClipY;
				const tileRight = tileX + desc.tile_w;
				const tileBottom = tileY + desc.tile_h;
				if (tileRight <= 0 || tileBottom <= 0 || tileX >= frameWidth || tileY >= frameHeight) {
					continue;
				}
				tiles.push({
					surfaceId: source.surfaceId,
					srcX: source.srcX,
					srcY: source.srcY,
					width: source.width,
					height: source.height,
					dstX: tileX,
					dstY: tileY,
				});
			}
		}
		this.enqueueBlitterCommand({
			opcode: 'tile_run',
			seq: this.nextBlitterSequence(),
			layer: desc.layer,
			z: desc.z,
			tiles,
		});
	}

	public enqueueResolvedTileRun(desc: { handles: number[]; cols: number; rows: number; tile_w: number; tile_h: number; origin_x: number; origin_y: number; scroll_x: number; scroll_y: number; z: number; layer: Layer2D }): void {
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
		const tiles: VdpTileRunBlit[] = [];
		for (let row = 0; row < desc.rows; row += 1) {
			const base = row * desc.cols;
			for (let col = 0; col < desc.cols; col += 1) {
				const handle = desc.handles[base + col];
				if (handle === IO_VDP_TILE_HANDLE_NONE) {
					continue;
				}
				const source = this.resolveBlitterSource(handle);
				if (source.width !== desc.tile_w || source.height !== desc.tile_h) {
					throw new Error(`[BmsxVDP] enqueueResolvedTileRun tile size mismatch (${source.width}x${source.height} != ${desc.tile_w}x${desc.tile_h}).`);
				}
				const tileX = dstX + (col * desc.tile_w) - srcClipX;
				const tileY = dstY + (row * desc.tile_h) - srcClipY;
				const tileRight = tileX + desc.tile_w;
				const tileBottom = tileY + desc.tile_h;
				if (tileRight <= 0 || tileBottom <= 0 || tileX >= frameWidth || tileY >= frameHeight) {
					continue;
				}
				tiles.push({
					surfaceId: source.surfaceId,
					srcX: source.srcX,
					srcY: source.srcY,
					width: source.width,
					height: source.height,
					dstX: tileX,
					dstY: tileY,
				});
			}
		}
		this.enqueueBlitterCommand({
			opcode: 'tile_run',
			seq: this.nextBlitterSequence(),
			layer: desc.layer,
			z: desc.z,
			tiles,
		});
	}

	private resolveSurfaceStride(surfaceId: number): number {
		return this.getReadSurface(surfaceId).entry.regionW * 4;
	}

	private getBlitterSurface(surfaceId: number): { textureKey: string; width: number; height: number } {
		const surface = this.getReadSurface(surfaceId);
		return {
			textureKey: surface.textureKey,
			width: surface.entry.regionW,
			height: surface.entry.regionH,
		};
	}

	private getBlitterAtlasId(surfaceId: number): number {
		if (surfaceId === VDP_RD_SURFACE_PRIMARY) {
			return 0;
		}
		if (surfaceId === VDP_RD_SURFACE_SECONDARY) {
			return 1;
		}
		if (surfaceId === VDP_RD_SURFACE_ENGINE) {
			return 254;
		}
		throw new Error(`[BmsxVDP] Surface ${surfaceId} cannot be sampled by the WebGL blitter.`);
	}

	public advanceBlitter(_cycles: number): void {
		if (this.blitterQueue.length === 0) {
			return;
		}
		if (this.blitterExecutor === null) {
			throw new Error(`[BmsxVDP] No JS blitter executor for backend ${$.view.backend.type}.`);
		}
		if ($.view.backend.type !== this.blitterExecutor.backendType) {
			throw new Error(`[BmsxVDP] JS blitter executor mismatch (${this.blitterExecutor.backendType} != ${$.view.backend.type}).`);
		}
		const host: VdpBlitterHost = {
			width: this._frameBufferWidth,
			height: this._frameBufferHeight,
			frameBufferTextureKey: FRAMEBUFFER_TEXTURE_KEY,
			getSurface: (surfaceId) => this.getBlitterSurface(surfaceId),
			getShaderAtlasId: (surfaceId) => this.getBlitterAtlasId(surfaceId),
		};
		this.blitterExecutor.execute(host, this.blitterQueue);
		this.invalidateReadCache(VDP_RD_SURFACE_FRAMEBUFFER);
		this.resetBlitterState();
	}

	public get frameBufferTextureKey(): string {
		return FRAMEBUFFER_TEXTURE_KEY;
	}

	public get frameBufferWidth(): number {
		return this._frameBufferWidth;
	}

	public get frameBufferHeight(): number {
		return this._frameBufferHeight;
	}

	public get frameBufferPixels(): Uint8Array {
		const surface = this.getReadSurface(VDP_RD_SURFACE_FRAMEBUFFER);
		const buffer = this.getCpuReadbackBuffer(surface);
		if ($.view.backend.type !== 'webgpu') {
			buffer.set($.view.backend.readTextureRegion($.texmanager.getTextureByUri(surface.textureKey), 0, 0, this._frameBufferWidth, this._frameBufferHeight));
		}
		return buffer;
	}

	public resolveFrameBufferSource(handle: number): { pixels: Uint8Array; regionX: number; regionY: number; stride: number; width: number; height: number } {
		const source = this.resolveBlitterSource(handle);
		const surface = this.getReadSurface(source.surfaceId);
		return {
			pixels: $.view.backend.type === 'webgpu'
				? this.getCpuReadbackBuffer(surface)
				: $.view.backend.readTextureRegion($.texmanager.getTextureByUri(surface.textureKey), 0, 0, surface.entry.regionW, surface.entry.regionH),
			regionX: source.srcX,
			regionY: source.srcY,
			stride: this.resolveSurfaceStride(source.surfaceId),
			width: source.width,
			height: source.height,
		};
	}

	public writeVram(addr: number, bytes: Uint8Array): void {
		if (addr >= VRAM_STAGING_BASE && addr + bytes.byteLength <= VRAM_STAGING_BASE + VRAM_STAGING_SIZE) {
			const offset = addr - VRAM_STAGING_BASE;
			this.vramStaging.set(bytes, offset);
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
					$.texmanager.updateTextureRegionForKey(slot.textureKey, slice, width, 1, x, row);
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
		const frameBufferSurface = this.readSurfaces[VDP_RD_SURFACE_FRAMEBUFFER];
		if (frameBufferSurface) {
			this._frameBufferWidth = frameBufferSurface.entry.regionW;
			this._frameBufferHeight = frameBufferSurface.entry.regionH;
		} else {
			this._frameBufferWidth = $.view.viewportSize.x;
			this._frameBufferHeight = $.view.viewportSize.y;
		}
		this.resetBlitterState();
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

	public set ditherType(value: number) {
		this.memory.writeValue(IO_VDP_DITHER, value);
		this.syncRegisters();
	}

	public get ditherType(): number {
		return this.lastDitherType;
	}

	public get skyboxFaceIds(): SkyboxImageIds | null {
		return this._skyboxFaceIds;
	}

	public commitViewSnapshot(): void {
		const view = $.view;
		view.primaryAtlasIdInSlot = this.slotAtlasIds[0];
		view.secondaryAtlasIdInSlot = this.slotAtlasIds[1];
		if (this.dirtySkybox) {
			view.skyboxFaceIds = this._skyboxFaceIds;
			this.dirtySkybox = false;
		}
	}

	public get atlasSlotMapping(): { primary: number | null; secondary: number | null } {
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
			const atlasEntry = this.atlasResourcesById.get(atlasId)!;
			const atlasAsset = Runtime.instance.getImageAsset(atlasEntry.resid);
			const { width, height } = atlasAsset.imgmeta!;
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
		const source = $.asset_source;
		const runtime = Runtime.instance;
		this._skyboxFaceIds = ids;
		this.dirtySkybox = true;
		SkyboxPipeline.clearSkyboxSources();
		const tasks = SKYBOX_FACE_KEYS.map((key, index) => {
			const assetId = ids[key];
			const entry = source.getEntry(assetId)!;
			const asset = runtime.getImageAsset(assetId);
			const meta = asset.imgmeta!;
			if (meta.atlassed) {
				throw new Error(`[BmsxVDP] Skybox image '${assetId}' must not be atlassed.`);
			}
			const slot = this.skyboxSlots[index];
			return this.imgDecController!.decodeToVram({
				bytes: source.getBytes(entry),
				dst: slot.entry.baseAddr,
				cap: slot.entry.capacity,
			}).then((decoded) => {
				if (meta.width <= 0) {
					meta.width = decoded.width;
				}
				if (meta.height <= 0) {
					meta.height = decoded.height;
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
		this._skyboxFaceIds = null;
		this.dirtySkybox = true;
		SkyboxPipeline.clearSkyboxSources();
	}

	public async registerImageAssets(source: RawAssetSource): Promise<void> {
		const entries = source.list();
		const viewEntries: RomAsset[] = [];
		const engineAtlasName = generateAtlasName(ENGINE_ATLAS_INDEX);
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
			this.readSurfaces = [null, null, null, null];
			for (let index = 0; index < this.readCaches.length; index += 1) {
				this.readCaches[index].width = 0;
			}
			this.cpuReadbackByKey.clear();
			this.skyboxSlots = [];
			this.imgDecController!.clearExternalSlots();
			this._skyboxFaceIds = null;
		this.dirtySkybox = true;
		SkyboxPipeline.clearSkyboxSources();
		this.vramBootSeed = this.nextVramBootSeed();
		this.seedVramStaging();
		this.initializeFrameBufferSurface();

		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			if (entry.type !== 'image' && entry.type !== 'atlas') {
				continue;
			}
			const imgAsset = Runtime.instance.getImageAssetByEntry(entry);
			const meta = imgAsset.imgmeta!;
			if (entry.type === 'atlas') {
				const atlasId = meta.atlasid!;
				if (meta.width <= 0 || meta.height <= 0) {
					throw new Error(`[BmsxVDP] Atlas '${entry.resid}' missing dimensions.`);
				}
				this.atlasResourcesById.set(atlasId, entry);
				continue;
			}
			if (meta.atlassed) {
				viewEntries.push(entry);
				continue;
			}
		}

		const engineAtlasAsset = Runtime.instance.getImageAsset(engineAtlasName, source);
		const engineAtlasMeta = engineAtlasAsset.imgmeta!;
		if (engineAtlasMeta.width <= 0 || engineAtlasMeta.height <= 0) {
			throw new Error(`[BmsxVDP] Engine atlas '${engineAtlasName}' missing dimensions.`);
		}
		const engineEntryRecord = this.memory.hasAsset(engineAtlasName)
			? this.memory.getAssetEntry(engineAtlasName)
			: this.memory.registerImageSlotAt({
				id: engineAtlasName,
				baseAddr: VRAM_SYSTEM_ATLAS_BASE,
				capacityBytes: VRAM_SYSTEM_ATLAS_SIZE,
				clear: false,
			});
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
			this.imgDecController!.registerExternalSlot(entry.baseAddr, entry);
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
			const meta = imgAsset.imgmeta!;
			const coords = meta.texcoords!;
			const atlasId = meta.atlasid!;
			let atlasWidth = 0;
			let atlasHeight = 0;
			let baseEntry = primarySlotEntry;
			if (atlasId === ENGINE_ATLAS_INDEX) {
				baseEntry = engineEntryRecord;
				atlasWidth = engineAtlasMeta.width;
				atlasHeight = engineAtlasMeta.height;
			} else {
				const atlasEntry = this.atlasResourcesById.get(atlasId)!;
				const atlasAsset = Runtime.instance.getImageAssetByEntry(atlasEntry);
				atlasWidth = atlasAsset.imgmeta.width;
				atlasHeight = atlasAsset.imgmeta.height;
				const mappedSlot = this.atlasSlotById.get(atlasId);
				if (mappedSlot !== undefined) {
					baseEntry = this.atlasSlotEntries[mappedSlot];
				}
			}
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

	private invalidateReadCache(surfaceId: number): void {
		this.readCaches[surfaceId].width = 0;
	}

	private registerReadSurface(surfaceId: number, entry: AssetEntry, textureKey: string): void {
		this.readSurfaces[surfaceId] = { entry, textureKey };
		this.invalidateReadCache(surfaceId);
	}

	private getReadSurface(surfaceId: number): VdpReadSurface {
		return this.readSurfaces[surfaceId]!;
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
		if ($.view.backend.type === 'webgpu') {
			return this.readCpuReadback(cache, surface, x, y, width, height);
		}
		return $.view.backend.readTextureRegion($.texmanager.getTextureByUri(surface.textureKey), x, y, width, height);
	}

	private readCpuReadback(cache: VdpReadCache, surface: VdpReadSurface, x: number, y: number, width: number, height: number): Uint8Array {
		const buffer = this.getCpuReadbackBuffer(surface);
		const stride = surface.entry.regionW * 4;
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
		const surface = this.readSurfaces[surfaceId]!;
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

	public get trackedUsedVramBytes(): number {
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

	public get trackedTotalVramBytes(): number {
		return VRAM_SYSTEM_ATLAS_SIZE + VRAM_PRIMARY_ATLAS_SIZE + VRAM_SECONDARY_ATLAS_SIZE + VRAM_FRAMEBUFFER_SIZE + VRAM_STAGING_SIZE;
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
		const rowPixels = width;
		const maxPixels = Math.floor(this.vramGarbageScratch.byteLength / 4);
		const stream = this.makeVramGarbageStream(slot.baseAddr >>> 0);
		if (rowPixels <= maxPixels) {
			const rowsPerChunk = Math.max(1, Math.floor(maxPixels / rowPixels));
			for (let y = 0; y < height; ) {
					const rows = Math.min(rowsPerChunk, height - y);
					const chunkBytes = rowPixels * rows * 4;
					const chunk = this.vramGarbageScratch.subarray(0, chunkBytes);
					fillVramGarbageScratch(chunk, stream);
					$.texmanager.updateTextureRegionForKey(slot.textureKey, chunk, rowPixels, rows, 0, y);
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
						$.texmanager.updateTextureRegionForKey(slot.textureKey, segment, segmentWidth, 1, x, y);
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
