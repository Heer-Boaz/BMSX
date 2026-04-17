import { $ } from '../../../core/engine_core';
import { taskGate } from '../../../core/taskgate';
import { Runtime } from '../../runtime/runtime';
import { decodePngToRgba } from '../../../common/image_decode';
import { SKYBOX_FACE_KEYS, type Layer2D, type SkyboxImageIds, type color } from '../../../render/shared/render_types';
import type { RomAsset, RomImgAsset } from '../../../rompack/rompack';
import {
	VDP_RENDER_ALPHA_COST_MULTIPLIER,
	VDP_RENDER_CLEAR_COST,
	blitAreaBucket,
	blitSpanBucket,
	computeClippedLineSpan,
	computeClippedRect,
	tileRunCost,
} from './vdp_render_budget';
import {
	ATLAS_PRIMARY_SLOT_ID,
	ATLAS_SECONDARY_SLOT_ID,
	ENGINE_ATLAS_INDEX,
	ENGINE_ATLAS_TEXTURE_KEY,
	generateAtlasName,
} from '../../../rompack/rompack';
import type { RawAssetSource } from '../../../rompack/asset_source';
import {
	IO_VDP_DITHER,
	IO_VDP_CMD,
	IO_VDP_CMD_ARG0,
		IO_VDP_CMD_ARG_COUNT,
	IO_VDP_FIFO,
	IO_VDP_FIFO_CTRL,
	IO_PAYLOAD_ALLOC_ADDR,
	IO_PAYLOAD_DATA_ADDR,
		IO_VDP_PRIMARY_ATLAS_ID,
		IO_VDP_RD_DATA,
		IO_VDP_RD_MODE,
		IO_VDP_RD_STATUS,
		IO_VDP_RD_SURFACE,
	IO_VDP_RD_X,
	IO_VDP_RD_Y,
	IO_VDP_SECONDARY_ATLAS_ID,
	IO_VDP_STATUS,
	IO_VDP_TILE_HANDLE_NONE,
	VDP_ATLAS_ID_NONE,
	VDP_FIFO_CTRL_SEAL,
	VDP_RD_MODE_RGBA8888,
	VDP_RD_STATUS_OVERFLOW,
	VDP_RD_STATUS_READY,
	VDP_STATUS_SUBMIT_BUSY,
	VDP_STATUS_SUBMIT_REJECTED,
	VDP_STATUS_VBLANK,
} from '../../bus/io';
import { ASSET_FLAG_VIEW, type AssetEntry, type VramWriteSink } from '../../memory/memory';
import { Memory } from '../../memory/memory';
import { DEVICE_SERVICE_VDP, type DeviceScheduler } from '../../scheduler/device_scheduler';
import type { BFont } from '../../../render/shared/bitmap_font';
import {
	VRAM_SYSTEM_ATLAS_BASE,
	VRAM_SYSTEM_ATLAS_SIZE,
	VRAM_PRIMARY_ATLAS_BASE,
	VRAM_PRIMARY_ATLAS_SIZE,
	VRAM_FRAMEBUFFER_BASE,
	VRAM_FRAMEBUFFER_SIZE,
	VRAM_SECONDARY_ATLAS_BASE,
	VRAM_SECONDARY_ATLAS_SIZE,
	VRAM_STAGING_BASE,
	VRAM_STAGING_SIZE,
	VDP_STREAM_BUFFER_SIZE,
	VDP_STREAM_CAPACITY_WORDS,
	VDP_STREAM_PACKET_HEADER_WORDS,
	VDP_STREAM_PAYLOAD_CAPACITY_WORDS,
} from '../../memory/memory_map';
import { fmix32, scramble32, signed8FromHash, xorshift32 } from '../../common/hash';
import { processVdpBufferedCommand, processVdpCommand } from './vdp_command_processor';
import { getVdpPacketSchema } from './vdp_packet_schema';

export type VdpState = {
	atlasSlots: { primary: number | null; secondary: number | null };
	skyboxFaceIds: SkyboxImageIds | null;
	ditherType: number;
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

function vdpFault(message: string): Error {
	return new Error(`VDP fault: ${message}`);
}

function vdpStreamFault(message: string): Error {
	return new Error(`VDP stream fault: ${message}`);
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
};

type AssetVramSlot = VramSlot;

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
	atlasId: number;
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
export const FRAMEBUFFER_RENDER_TEXTURE_KEY = '_framebuffer_render_2d';
const BLITTER_FIFO_CAPACITY = 4096;

export class VDP implements VramWriteSink {
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
	private _skyboxFaceIds: SkyboxImageIds | null = null;
	private committedSkyboxFaceIds: SkyboxImageIds | null = null;
	private lastDitherType = 0;
	private committedDitherType = 0;
	private _frameBufferWidth = 0;
	private _frameBufferHeight = 0;
	private buildBlitterQueue: VdpBlitterCommand[] = [];
	private activeBlitterQueue: VdpBlitterCommand[] = [];
	private pendingBlitterQueue: VdpBlitterCommand[] = [];
	private readonly glyphBufferPool: VdpGlyphRunGlyph[][] = [];
	private readonly tileBufferPool: VdpTileRunBlit[][] = [];
	private readonly glyphEntryPool: VdpGlyphRunGlyph[] = [];
	private readonly tileEntryPool: VdpTileRunBlit[] = [];
	private readonly clippedRectScratchA = { width: 0, height: 0, area: 0 };
	private readonly clippedRectScratchB = { width: 0, height: 0, area: 0 };
	private readonly implicitClearCommand: VdpBlitterClearCommand = {
		opcode: 'clear',
		seq: 0,
		renderCost: VDP_RENDER_CLEAR_COST,
		color: { r: 0, g: 0, b: 0, a: 255 },
	};
	private readonly implicitClearQueue: readonly VdpBlitterCommand[] = [this.implicitClearCommand];
	private blitterSequence = 0;
	private buildFrameCost = 0;
	private buildFrameOpen = false;
	private activeFrameOccupied = false;
	private activeFrameReady = false;
	private activeFrameCost = 0;
	private activeFrameWorkRemaining = 0;
	private pendingFrameOccupied = false;
	private pendingFrameCost = 0;
	private readonly activeSlotAtlasIds: Array<number | null> = [null, null];
	private readonly pendingSlotAtlasIds: Array<number | null> = [null, null];
	private activeDitherType = 0;
	private pendingDitherType = 0;
	private activeSkyboxFaceIds: SkyboxImageIds | null = null;
	private pendingSkyboxFaceIds: SkyboxImageIds | null = null;
	private readonly committedSlotAtlasIds: Array<number | null> = [null, null];
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
		private readonly blitterExecutor: VdpBlitterExecutor | null,
		private readonly scheduler: DeviceScheduler,
			) {
				this.memory.setVramWriter(this);
				this.memory.mapIoRead(IO_VDP_RD_STATUS, this.readVdpStatus.bind(this));
				this.memory.mapIoRead(IO_VDP_RD_DATA, this.readVdpData.bind(this));
				this.memory.mapIoWrite(IO_VDP_FIFO, this.onVdpFifoWrite.bind(this));
				this.memory.mapIoWrite(IO_VDP_FIFO_CTRL, this.onVdpFifoCtrlWrite.bind(this));
				this.memory.mapIoWrite(IO_PAYLOAD_ALLOC_ADDR, this.onObsoletePayloadIoWrite.bind(this));
				this.memory.mapIoWrite(IO_PAYLOAD_DATA_ADDR, this.onObsoletePayloadIoWrite.bind(this));
				this.memory.mapIoWrite(IO_VDP_CMD, this.onVdpCommandWrite.bind(this));
				this.vramMachineSeed = this.nextVramMachineSeed();
		this.vramBootSeed = this.nextVramBootSeed();
		for (let index = 0; index < VDP_RD_SURFACE_COUNT; index += 1) {
			this.readCaches.push({ x0: 0, y: 0, width: 0, data: new Uint8Array(0) });
		}
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

	public setVblankStatus(active: boolean): void {
		const nextStatus = active ? (this.vdpStatus | VDP_STATUS_VBLANK) : (this.vdpStatus & ~VDP_STATUS_VBLANK);
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
		this.setSubmitRejectedStatus(false);
		this.refreshSubmitBusyStatus();
	}

	public rejectSubmitAttempt(): void {
		this.setSubmitRejectedStatus(true);
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

	private setSubmitBusyStatus(active: boolean): void {
		const nextStatus = active ? (this.vdpStatus | VDP_STATUS_SUBMIT_BUSY) : (this.vdpStatus & ~VDP_STATUS_SUBMIT_BUSY);
		if (nextStatus === this.vdpStatus) {
			return;
		}
		this.vdpStatus = nextStatus >>> 0;
		this.memory.writeValue(IO_VDP_STATUS, this.vdpStatus);
	}

	private refreshSubmitBusyStatus(): void {
		this.setSubmitBusyStatus(this.hasBlockedSubmitPath());
	}

	private setSubmitRejectedStatus(active: boolean): void {
		const nextStatus = active ? (this.vdpStatus | VDP_STATUS_SUBMIT_REJECTED) : (this.vdpStatus & ~VDP_STATUS_SUBMIT_REJECTED);
		if (nextStatus === this.vdpStatus) {
			return;
		}
		this.vdpStatus = nextStatus >>> 0;
		this.memory.writeValue(IO_VDP_STATUS, this.vdpStatus);
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
				processVdpCommand(Runtime.instance, {
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
				processVdpBufferedCommand(Runtime.instance, {
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
			processVdpCommand(Runtime.instance, {
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

	private onObsoletePayloadIoWrite(): void {
		throw vdpFault('payload staging I/O is obsolete. Write payload words directly into the claimed VDP stream packet in RAM.');
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
		this.recycleBlitterBuffers(this.buildBlitterQueue);
		this.buildFrameCost = 0;
		this.buildFrameOpen = false;
	}

	private enqueueBlitterCommand(command: VdpBlitterCommand): void {
		if (!this.buildFrameOpen) {
			throw vdpFault('no submitted frame is open.');
		}
		if (this.buildBlitterQueue.length >= BLITTER_FIFO_CAPACITY) {
			throw vdpFault(`blitter FIFO overflow (${BLITTER_FIFO_CAPACITY} commands).`);
		}
		this.buildFrameCost += command.renderCost;
		this.buildBlitterQueue.push(command);
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

	private executeBlitterQueue(queue: readonly VdpBlitterCommand[]): void {
		if (queue.length === 0) {
			return;
		}
		if (this.blitterExecutor === null) {
			throw vdpFault(`no JS blitter executor for backend ${$.view.backend.type}.`);
		}
		if ($.view.backend.type !== this.blitterExecutor.backendType) {
			throw vdpFault(`JS blitter executor mismatch (${this.blitterExecutor.backendType} != ${$.view.backend.type}).`);
		}
		const host: VdpBlitterHost = {
			width: this._frameBufferWidth,
			height: this._frameBufferHeight,
			frameBufferTextureKey: FRAMEBUFFER_RENDER_TEXTURE_KEY,
			getSurface: (surfaceId) => this.getBlitterSurface(surfaceId),
			getShaderAtlasId: (surfaceId) => this.getBlitterAtlasId(surfaceId),
		};
		if (queue[0].opcode !== 'clear') {
			this.blitterExecutor.execute(host, this.implicitClearQueue);
		}
		this.blitterExecutor.execute(host, queue);
	}

	private ensureDisplayFrameBufferTexture(): void {
		let handle = $.texmanager.getTextureByUri(FRAMEBUFFER_TEXTURE_KEY);
		if (!handle) {
			handle = $.texmanager.createTextureFromPixelsSync(FRAMEBUFFER_TEXTURE_KEY, this.vramSeedPixel, 1, 1);
		}
		handle = $.texmanager.resizeTextureForKey(FRAMEBUFFER_TEXTURE_KEY, this._frameBufferWidth, this._frameBufferHeight);
		$.view.textures[FRAMEBUFFER_TEXTURE_KEY] = handle;
	}

	private swapFrameBufferPages(): void {
		$.texmanager.swapTextureHandlesByUri(FRAMEBUFFER_TEXTURE_KEY, FRAMEBUFFER_RENDER_TEXTURE_KEY);
		$.view.textures[FRAMEBUFFER_TEXTURE_KEY] = $.texmanager.getTextureByUri(FRAMEBUFFER_TEXTURE_KEY);
		$.view.textures[FRAMEBUFFER_RENDER_TEXTURE_KEY] = $.texmanager.getTextureByUri(FRAMEBUFFER_RENDER_TEXTURE_KEY);
		const displayReadback = this.cpuReadbackByKey.get(FRAMEBUFFER_TEXTURE_KEY);
		const renderReadback = this.cpuReadbackByKey.get(FRAMEBUFFER_RENDER_TEXTURE_KEY);
		if (displayReadback || renderReadback) {
			if (displayReadback) {
				this.cpuReadbackByKey.set(FRAMEBUFFER_RENDER_TEXTURE_KEY, displayReadback);
			} else {
				this.cpuReadbackByKey.delete(FRAMEBUFFER_RENDER_TEXTURE_KEY);
			}
			if (renderReadback) {
				this.cpuReadbackByKey.set(FRAMEBUFFER_TEXTURE_KEY, renderReadback);
			} else {
				this.cpuReadbackByKey.delete(FRAMEBUFFER_TEXTURE_KEY);
			}
		}
		this.invalidateReadCache(VDP_RD_SURFACE_FRAMEBUFFER);
	}

	private syncRenderFrameBufferToDisplayPage(): void {
		$.texmanager.copyTextureByUri(FRAMEBUFFER_RENDER_TEXTURE_KEY, FRAMEBUFFER_TEXTURE_KEY, this._frameBufferWidth, this._frameBufferHeight);
		const renderReadback = this.cpuReadbackByKey.get(FRAMEBUFFER_RENDER_TEXTURE_KEY);
		if (renderReadback) {
			let displayReadback = this.cpuReadbackByKey.get(FRAMEBUFFER_TEXTURE_KEY);
			if (!displayReadback || displayReadback.byteLength !== renderReadback.byteLength) {
				displayReadback = new Uint8Array(renderReadback.byteLength);
				this.cpuReadbackByKey.set(FRAMEBUFFER_TEXTURE_KEY, displayReadback);
			}
			displayReadback.set(renderReadback);
		} else {
			this.cpuReadbackByKey.delete(FRAMEBUFFER_TEXTURE_KEY);
		}
		this.invalidateReadCache(VDP_RD_SURFACE_FRAMEBUFFER);
	}

	public canAcceptSubmittedFrame(): boolean {
		return !this.pendingFrameOccupied;
	}

	public beginSubmittedFrame(): void {
		if (this.buildFrameOpen) {
			throw vdpFault('submitted frame already open.');
		}
		this.resetBuildFrameState();
		this.blitterSequence = 0;
		this.buildFrameOpen = true;
	}

	public cancelSubmittedFrame(): void {
		this.resetBuildFrameState();
		this.scheduleNextService(this.scheduler.currentNowCycles());
		this.refreshSubmitBusyStatus();
	}

	private assignBuildToSlot(slot: 'active' | 'pending'): void {
		if (!this.buildFrameOpen) {
			throw vdpFault('no submitted frame is open.');
		}
		const queue = slot === 'active' ? this.activeBlitterQueue : this.pendingBlitterQueue;
		if (queue.length !== 0) {
			throw vdpFault(`${slot} frame queue is not empty.`);
		}
		const buildQueue = this.buildBlitterQueue;
		const frameCost = this.submittedFrameCost(buildQueue, this.buildFrameCost);
		this.buildBlitterQueue = queue;
		if (slot === 'active') {
			this.activeBlitterQueue = buildQueue;
			this.activeFrameOccupied = true;
			this.activeFrameCost = frameCost;
			this.activeFrameWorkRemaining = frameCost;
			this.activeFrameReady = frameCost === 0;
			this.activeDitherType = this.lastDitherType;
			this.activeSlotAtlasIds[0] = this.slotAtlasIds[0];
			this.activeSlotAtlasIds[1] = this.slotAtlasIds[1];
			this.activeSkyboxFaceIds = this._skyboxFaceIds === null ? null : { ...this._skyboxFaceIds };
		} else {
			this.pendingBlitterQueue = buildQueue;
			this.pendingFrameOccupied = true;
			this.pendingFrameCost = frameCost;
			this.pendingDitherType = this.lastDitherType;
			this.pendingSlotAtlasIds[0] = this.slotAtlasIds[0];
			this.pendingSlotAtlasIds[1] = this.slotAtlasIds[1];
			this.pendingSkyboxFaceIds = this._skyboxFaceIds === null ? null : { ...this._skyboxFaceIds };
		}
		this.buildBlitterQueue.length = 0;
		this.buildFrameCost = 0;
		this.buildFrameOpen = false;
		this.scheduleNextService(this.scheduler.currentNowCycles());
		this.refreshSubmitBusyStatus();
	}

	public sealSubmittedFrame(): void {
		if (!this.buildFrameOpen) {
			throw vdpFault('no submitted frame is open.');
		}
		if (!this.activeFrameOccupied) {
			this.assignBuildToSlot('active');
			return;
		}
		if (!this.pendingFrameOccupied) {
			this.assignBuildToSlot('pending');
			return;
		}
		throw vdpFault('submit slot busy.');
	}

	private promotePendingFrame(): void {
		if (this.activeFrameOccupied || !this.pendingFrameOccupied) {
			return;
		}
		const activeQueue = this.activeBlitterQueue;
		this.activeBlitterQueue = this.pendingBlitterQueue;
		this.pendingBlitterQueue = activeQueue;
		this.pendingBlitterQueue.length = 0;
		this.activeFrameOccupied = true;
		this.activeFrameReady = this.pendingFrameCost === 0;
		this.activeFrameCost = this.pendingFrameCost;
		this.activeFrameWorkRemaining = this.pendingFrameCost;
		this.activeDitherType = this.pendingDitherType;
		this.activeSlotAtlasIds[0] = this.pendingSlotAtlasIds[0];
		this.activeSlotAtlasIds[1] = this.pendingSlotAtlasIds[1];
		this.activeSkyboxFaceIds = this.pendingSkyboxFaceIds;
		this.pendingFrameOccupied = false;
		this.pendingFrameCost = 0;
		this.pendingDitherType = 0;
		this.pendingSlotAtlasIds[0] = null;
		this.pendingSlotAtlasIds[1] = null;
		this.pendingSkyboxFaceIds = null;
		this.scheduleNextService(this.scheduler.currentNowCycles());
		this.refreshSubmitBusyStatus();
	}

	public advanceWork(workUnits: number): void {
		if (!this.activeFrameOccupied) {
			this.promotePendingFrame();
		}
		if (!this.activeFrameOccupied || this.activeFrameReady || workUnits <= 0) {
			return;
		}
		if (workUnits >= this.activeFrameWorkRemaining) {
			this.activeFrameWorkRemaining = 0;
			this.executeBlitterQueue(this.activeBlitterQueue);
			this.activeFrameReady = true;
			this.scheduleNextService(this.scheduler.currentNowCycles());
			return;
		}
		this.activeFrameWorkRemaining -= workUnits;
	}

	public needsImmediateSchedulerService(): boolean {
		return !this.activeFrameOccupied && this.pendingFrameOccupied;
	}

	public hasPendingRenderWork(): boolean {
		if (!this.activeFrameOccupied) {
			return this.pendingFrameOccupied && this.pendingFrameCost > 0;
		}
		return !this.activeFrameReady;
	}

	public getPendingRenderWorkUnits(): number {
		if (!this.activeFrameOccupied) {
			return this.pendingFrameCost;
		}
		if (this.activeFrameReady) {
			return 0;
		}
		return this.activeFrameWorkRemaining;
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
		this.scheduler.scheduleDeviceService(DEVICE_SERVICE_VDP, nowCycles + this.cyclesUntilWorkUnits(targetUnits - this.availableWorkUnits));
	}

	private cyclesUntilWorkUnits(targetUnits: number): number {
		const needed = BigInt(targetUnits) * this.cpuHz - this.workCarry;
		if (needed <= 0n) {
			return 1;
		}
		const cycles = (needed + this.workUnitsPerSec - 1n) / this.workUnitsPerSec;
		const max = BigInt(Number.MAX_SAFE_INTEGER);
		const clamped = cycles > max ? max : cycles;
		const out = Number(clamped);
		return out <= 0 ? 1 : out;
	}

	private clearActiveFrame(): void {
		this.recycleBlitterBuffers(this.activeBlitterQueue);
		this.activeFrameOccupied = false;
		this.activeFrameReady = false;
		this.activeFrameCost = 0;
		this.activeFrameWorkRemaining = 0;
		this.activeDitherType = 0;
		this.activeSlotAtlasIds[0] = null;
		this.activeSlotAtlasIds[1] = null;
		this.activeSkyboxFaceIds = null;
	}

	private commitActiveVisualState(): void {
		this.committedDitherType = this.activeDitherType;
		this.committedSlotAtlasIds[0] = this.activeSlotAtlasIds[0];
		this.committedSlotAtlasIds[1] = this.activeSlotAtlasIds[1];
		this.committedSkyboxFaceIds = this.activeSkyboxFaceIds;
	}

	public presentReadyFrameOnVblankEdge(): void {
		if (!this.activeFrameOccupied) {
			this.lastFrameCommitted = false;
			this.lastFrameCost = 0;
			this.lastFrameHeld = false;
			this.promotePendingFrame();
			this.scheduleNextService(this.scheduler.currentNowCycles());
			this.refreshSubmitBusyStatus();
			return;
		}
		this.lastFrameCost = this.activeFrameCost;
		if (!this.activeFrameReady) {
			this.lastFrameCommitted = false;
			this.lastFrameHeld = true;
			return;
		}
		if (this.activeBlitterQueue.length > 0) {
			this.swapFrameBufferPages();
		}
		this.commitActiveVisualState();
		this.lastFrameCommitted = true;
		this.lastFrameHeld = false;
		this.clearActiveFrame();
		this.promotePendingFrame();
		this.scheduleNextService(this.scheduler.currentNowCycles());
		this.refreshSubmitBusyStatus();
	}

	private initializeFrameBufferSurface(): void {
		const width = $.view.viewportSize.x;
		const height = $.view.viewportSize.y;
		const entry = this.memory.hasAsset(FRAMEBUFFER_RENDER_TEXTURE_KEY)
			? this.memory.getAssetEntry(FRAMEBUFFER_RENDER_TEXTURE_KEY)
			: this.memory.registerImageSlotAt({
				id: FRAMEBUFFER_RENDER_TEXTURE_KEY,
				baseAddr: VRAM_FRAMEBUFFER_BASE,
				capacityBytes: VRAM_FRAMEBUFFER_SIZE,
				clear: false,
			});
		const size = width * height * 4;
		if (size > entry.capacity) {
			throw vdpFault(`framebuffer surface exceeds VRAM capacity (${size} > ${entry.capacity}).`);
		}
		entry.baseSize = size;
		entry.baseStride = width * 4;
		entry.regionX = 0;
		entry.regionY = 0;
		entry.regionW = width;
		entry.regionH = height;
		this._frameBufferWidth = width;
		this._frameBufferHeight = height;
		this.registerVramSlot(entry, FRAMEBUFFER_RENDER_TEXTURE_KEY, VDP_RD_SURFACE_FRAMEBUFFER);
		this.ensureDisplayFrameBufferTexture();
		this.registerReadSurface(VDP_RD_SURFACE_FRAMEBUFFER, entry, FRAMEBUFFER_RENDER_TEXTURE_KEY);
		this.syncRenderFrameBufferToDisplayPage();
	}

	private resolveBlitterSource(handle: number): VdpBlitterSource {
		const entry = Runtime.instance.getAssetEntryByHandle(handle);
		if (entry.type !== 'image') {
			throw vdpFault(`asset handle ${handle} is not an image.`);
		}
		if ((entry.flags & ASSET_FLAG_VIEW) !== 0) {
			const baseEntry = Runtime.instance.getAssetEntryByHandle(entry.ownerIndex);
			const slot = this.vramSlots.find((candidate) => candidate.entry.ownerIndex === baseEntry.ownerIndex);
			if (!slot) {
				throw vdpFault(`image handle ${handle} is not mapped to a blitter surface.`);
			}
			return {
				surfaceId: slot.surfaceId,
				srcX: entry.regionX,
				srcY: entry.regionY,
				width: entry.regionW,
				height: entry.regionH,
			};
		}
		const slot = this.vramSlots.find((candidate) => candidate.entry.ownerIndex === entry.ownerIndex);
		if (!slot) {
			throw vdpFault(`image handle ${handle} is not mapped to a blitter surface.`);
		}
		return {
			surfaceId: slot.surfaceId,
			srcX: 0,
			srcY: 0,
			width: entry.regionW,
			height: entry.regionH,
		};
	}

	public resolveBlitterSample(handle: number): VdpResolvedBlitterSample {
		const source = this.resolveBlitterSource(handle);
		const surface = this.getBlitterSurface(source.surfaceId);
		return {
			source,
			surfaceWidth: surface.width,
			surfaceHeight: surface.height,
			atlasId: this.getBlitterAtlasId(source.surfaceId),
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

	public enqueueBlit(handle: number, x: number, y: number, z: number, layer: Layer2D, scaleX: number, scaleY: number, flipH: boolean, flipV: boolean, colorValue: color, parallaxWeight: number): void {
		const source = this.resolveBlitterSource(handle);
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
				const handle = Runtime.instance.resolveAssetHandle(glyph.imgid);
				const source = this.resolveBlitterSource(handle);
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

	private enqueueTileRunInternal(desc: {
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
		resolveTileHandle: (index: number) => number;
		mismatchMessage: (source: VdpBlitterSource) => string;
	}): void {
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
				const handle = desc.resolveTileHandle(base + col);
				if (handle === IO_VDP_TILE_HANDLE_NONE) {
					continue;
				}
				const source = this.resolveBlitterSource(handle);
				if (source.width !== desc.tile_w || source.height !== desc.tile_h) {
					throw new Error(desc.mismatchMessage(source));
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

	public enqueueTileRun(desc: { tiles: Array<string | false>; cols: number; rows: number; tile_w: number; tile_h: number; origin_x: number; origin_y: number; scroll_x: number; scroll_y: number; z: number; layer: Layer2D }): void {
		this.enqueueTileRunInternal({
			...desc,
			resolveTileHandle: (index) => {
				const tile = desc.tiles[index];
				if (tile === false) {
					return IO_VDP_TILE_HANDLE_NONE;
				}
				return Runtime.instance.resolveAssetHandle(tile);
			},
			mismatchMessage: (source) => `dma_blit_tiles size mismatch (${source.width}x${source.height} != ${desc.tile_w}x${desc.tile_h}).`,
		});
	}

	public enqueueResolvedTileRun(desc: { handles: number[]; cols: number; rows: number; tile_w: number; tile_h: number; origin_x: number; origin_y: number; scroll_x: number; scroll_y: number; z: number; layer: Layer2D }): void {
		this.enqueueTileRunInternal({
			...desc,
			resolveTileHandle: (index) => desc.handles[index]!,
			mismatchMessage: (source) => `VDP fault: enqueueResolvedTileRun tile size mismatch (${source.width}x${source.height} != ${desc.tile_w}x${desc.tile_h}).`,
		});
	}

	public enqueuePayloadTileRun(desc: { payload_base: number; tile_count: number; cols: number; rows: number; tile_w: number; tile_h: number; origin_x: number; origin_y: number; scroll_x: number; scroll_y: number; z: number; layer: Layer2D }): void {
		if (desc.tile_count !== desc.cols * desc.rows) {
			throw vdpFault(`enqueuePayloadTileRun size mismatch (${desc.tile_count} != ${desc.cols * desc.rows}).`);
		}
		this.enqueueTileRunInternal({
			cols: desc.cols,
			rows: desc.rows,
			tile_w: desc.tile_w,
			tile_h: desc.tile_h,
			origin_x: desc.origin_x,
			origin_y: desc.origin_y,
			scroll_x: desc.scroll_x,
			scroll_y: desc.scroll_y,
			z: desc.z,
			layer: desc.layer,
			resolveTileHandle: (index) => this.memory.readU32(desc.payload_base + index * 4) >>> 0,
			mismatchMessage: (source) => `VDP fault: enqueuePayloadTileRun tile size mismatch (${source.width}x${source.height} != ${desc.tile_w}x${desc.tile_h}).`,
		});
	}

	public enqueuePayloadTileRunWords(desc: { payload_words: Uint32Array; payload_word_offset: number; tile_count: number; cols: number; rows: number; tile_w: number; tile_h: number; origin_x: number; origin_y: number; scroll_x: number; scroll_y: number; z: number; layer: Layer2D }): void {
		if (desc.tile_count !== desc.cols * desc.rows) {
			throw vdpFault(`enqueuePayloadTileRunWords size mismatch (${desc.tile_count} != ${desc.cols * desc.rows}).`);
		}
		this.enqueueTileRunInternal({
			cols: desc.cols,
			rows: desc.rows,
			tile_w: desc.tile_w,
			tile_h: desc.tile_h,
			origin_x: desc.origin_x,
			origin_y: desc.origin_y,
			scroll_x: desc.scroll_x,
			scroll_y: desc.scroll_y,
			z: desc.z,
			layer: desc.layer,
			resolveTileHandle: (index) => desc.payload_words[desc.payload_word_offset + index] >>> 0,
			mismatchMessage: (source) => `VDP fault: enqueuePayloadTileRunWords tile size mismatch (${source.width}x${source.height} != ${desc.tile_w}x${desc.tile_h}).`,
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
			return ENGINE_ATLAS_INDEX;
		}
		throw vdpFault(`surface ${surfaceId} cannot be sampled by the WebGL blitter.`);
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
			throw vdpFault('VRAM slot is not initialized.');
		}
		if (slot.kind === 'asset') {
			this.syncVramSlotTextureSize(slot);
		}
		const offset = addr - slot.baseAddr;
		const stride = entry.baseStride;
		const rowCount = entry.regionH;
		const totalBytes = rowCount * stride;
		if (offset + bytes.byteLength > totalBytes) {
			throw vdpFault('VRAM write out of bounds.');
		}
		if ((offset & 3) !== 0 || (bytes.byteLength & 3) !== 0) {
			throw vdpFault('VRAM writes must be 32-bit aligned.');
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

	public readVram(addr: number, out: Uint8Array): void {
		if (addr >= VRAM_STAGING_BASE && addr + out.byteLength <= VRAM_STAGING_BASE + VRAM_STAGING_SIZE) {
			const offset = addr - VRAM_STAGING_BASE;
			out.set(this.vramStaging.subarray(offset, offset + out.byteLength));
			return;
		}
		const slot = this.findVramSlot(addr, out.byteLength);
		const entry = slot.entry;
		if (entry.baseStride === 0 || entry.regionW === 0 || entry.regionH === 0) {
			out.fill(0);
			return;
		}
		const offset = addr - slot.baseAddr;
		const stride = entry.baseStride;
		const totalBytes = entry.regionH * stride;
		if (offset + out.byteLength > totalBytes) {
			throw vdpFault('VRAM read out of bounds.');
		}
		let remaining = out.byteLength;
		let cursor = 0;
		let row = Math.floor(offset / stride);
		let rowOffset = offset - row * stride;
		while (remaining > 0) {
			const rowAvailable = stride - rowOffset;
			const rowBytes = remaining < rowAvailable ? remaining : rowAvailable;
			if (slot.kind === 'asset') {
				const x = rowOffset / 4;
				const width = rowBytes / 4;
				if ($.view.backend.type === 'webgpu') {
					const surface = this.readSurfaces[slot.surfaceId]!;
					const buffer = this.getCpuReadbackBuffer(surface);
					const srcOffset = row * stride + rowOffset;
					out.set(buffer.subarray(srcOffset, srcOffset + rowBytes), cursor);
				} else {
					const slice = $.view.backend.readTextureRegion($.texmanager.getTextureByUri(slot.textureKey), x, row, width, 1);
					out.set(slice, cursor);
				}
			} else {
				out.fill(0, cursor, cursor + rowBytes);
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
		const width = surface.entry.regionW;
		const height = surface.entry.regionH;
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
			this._frameBufferWidth = frameBufferSurface.entry.regionW;
			this._frameBufferHeight = frameBufferSurface.entry.regionH;
		} else {
			this._frameBufferWidth = $.view.viewportSize.x;
			this._frameBufferHeight = $.view.viewportSize.y;
		}
		this.resetBuildFrameState();
		this.clearActiveFrame();
		this.recycleBlitterBuffers(this.pendingBlitterQueue);
		this.workCarry = 0n;
		this.availableWorkUnits = 0;
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_VDP);
		this.pendingFrameOccupied = false;
		this.pendingFrameCost = 0;
		this.pendingDitherType = 0;
		this.pendingSlotAtlasIds[0] = null;
		this.pendingSlotAtlasIds[1] = null;
		this.pendingSkyboxFaceIds = null;
		this.slotAtlasIds[0] = null;
		this.slotAtlasIds[1] = null;
		this.blitterSequence = 0;
		this.resetIngressState();
		this.resetStatus();
		this.memory.writeIoValue(IO_VDP_PRIMARY_ATLAS_ID, VDP_ATLAS_ID_NONE);
		this.memory.writeIoValue(IO_VDP_SECONDARY_ATLAS_ID, VDP_ATLAS_ID_NONE);
		this.memory.writeIoValue(IO_VDP_RD_SURFACE, VDP_RD_SURFACE_ENGINE);
		this.memory.writeIoValue(IO_VDP_RD_X, 0);
		this.memory.writeIoValue(IO_VDP_RD_Y, 0);
		this.memory.writeIoValue(IO_VDP_RD_MODE, VDP_RD_MODE_RGBA8888);
		this.memory.writeIoValue(IO_VDP_DITHER, dither);
		this.memory.writeIoValue(IO_VDP_CMD, 0);
		for (let index = 0; index < IO_VDP_CMD_ARG_COUNT; index += 1) {
			this.memory.writeIoValue(IO_VDP_CMD_ARG0 + index * 4, 0);
		}
		this.lastDitherType = dither;
		this.committedDitherType = dither;
		this._skyboxFaceIds = null;
		this.committedSkyboxFaceIds = null;
		this.committedSlotAtlasIds[0] = this.slotAtlasIds[0];
		this.committedSlotAtlasIds[1] = this.slotAtlasIds[1];
		this.lastFrameCommitted = true;
		this.lastFrameCost = 0;
		this.lastFrameHeld = false;
		if ($.texmanager.getTextureByUri(FRAMEBUFFER_RENDER_TEXTURE_KEY)) {
			this.syncRenderFrameBufferToDisplayPage();
		}
		this.commitViewSnapshot();
	}

	public syncRegisters(): void {
		const dither = this.memory.readIoI32(IO_VDP_DITHER);
		if (dither !== this.lastDitherType) {
			this.lastDitherType = dither;
		}
		const primaryRaw = this.memory.readIoU32(IO_VDP_PRIMARY_ATLAS_ID);
		const secondaryRaw = this.memory.readIoU32(IO_VDP_SECONDARY_ATLAS_ID);
		const primary = primaryRaw === VDP_ATLAS_ID_NONE ? null : primaryRaw;
		const secondary = secondaryRaw === VDP_ATLAS_ID_NONE ? null : secondaryRaw;
		if (primary !== this.slotAtlasIds[0] || secondary !== this.slotAtlasIds[1]) {
			this.applyAtlasSlotMapping(primary, secondary);
		}
	}

	private setDitherType(value: number): void {
		this.memory.writeValue(IO_VDP_DITHER, value);
		this.syncRegisters();
	}

	public captureState(): VdpState {
		return {
			atlasSlots: { primary: this.slotAtlasIds[0], secondary: this.slotAtlasIds[1] },
			skyboxFaceIds: this._skyboxFaceIds === null ? null : { ...this._skyboxFaceIds },
			ditherType: this.lastDitherType,
		};
	}

	public restoreState(state: VdpState): void {
		this.restoreAtlasSlotMapping(state.atlasSlots);
		if (state.skyboxFaceIds === null) {
			this.clearSkybox();
		} else {
			this.setSkyboxImages(state.skyboxFaceIds);
		}
		this.setDitherType(state.ditherType);
		this.commitLiveVisualState();
		this.commitViewSnapshot();
	}

	public commitViewSnapshot(): void {
		const view = $.view;
		view.dither_type = this.committedDitherType;
		view.primaryAtlasIdInSlot = this.committedSlotAtlasIds[0];
		view.secondaryAtlasIdInSlot = this.committedSlotAtlasIds[1];
		view.skyboxFaceIds = this.committedSkyboxFaceIds;
	}

	public commitLiveVisualState(): void {
		this.committedDitherType = this.lastDitherType;
		this.committedSlotAtlasIds[0] = this.slotAtlasIds[0];
		this.committedSlotAtlasIds[1] = this.slotAtlasIds[1];
		this.committedSkyboxFaceIds = this._skyboxFaceIds === null ? null : { ...this._skyboxFaceIds };
	}

	private restoreAtlasSlotMapping(mapping: { primary: number | null; secondary: number | null }): void {
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
				throw vdpFault(`atlas ${atlasId} (${width}x${height}) exceeds slot capacity ${slotEntry.capacity}.`);
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
		this.syncVramSlotTextureSize(this.getVramSlotByTextureKey(ATLAS_PRIMARY_SLOT_ID));
		this.syncVramSlotTextureSize(this.getVramSlotByTextureKey(ATLAS_SECONDARY_SLOT_ID));
	}

	public setSkyboxImages(ids: SkyboxImageIds): void {
		const source = $.asset_source;
		const runtime = Runtime.instance;
		for (let index = 0; index < SKYBOX_FACE_KEYS.length; index += 1) {
			const assetId = ids[SKYBOX_FACE_KEYS[index]];
			source.getEntry(assetId);
			const asset = runtime.getImageAsset(assetId);
			const meta = asset.imgmeta!;
			if (!meta.atlassed) {
				throw vdpFault(`skybox image '${assetId}' must be atlassed.`);
			}
			if (meta.atlasid === undefined || meta.atlasid === null) {
				throw vdpFault(`skybox image '${assetId}' is missing an atlas id.`);
			}
			if (meta.atlasid === ENGINE_ATLAS_INDEX) {
				throw vdpFault(`skybox image '${assetId}' must live in primary/secondary atlas space, not the engine atlas.`);
			}
		}
		this._skyboxFaceIds = ids;
	}

	public clearSkybox(): void {
		this._skyboxFaceIds = null;
	}

	public async registerImageAssets(source: RawAssetSource): Promise<void> {
		const entries = source.list();
		const viewEntries: RomAsset[] = [];
		const engineAtlasName = generateAtlasName(ENGINE_ATLAS_INDEX);
		const setAtlasEntryDimensions = (slotEntry: AssetEntry, width: number, height: number): void => {
			const size = width * height * 4;
			if (size > slotEntry.capacity) {
				throw vdpFault(`atlas entry '${slotEntry.id}' (${width}x${height}) exceeds capacity ${slotEntry.capacity}.`);
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
		this.resetBuildFrameState();
		this.clearActiveFrame();
		this.recycleBlitterBuffers(this.pendingBlitterQueue);
		this.workCarry = 0n;
		this.availableWorkUnits = 0;
		this.scheduler.cancelDeviceService(DEVICE_SERVICE_VDP);
		this.pendingFrameOccupied = false;
		this.pendingFrameCost = 0;
		this.pendingDitherType = 0;
		this.pendingSlotAtlasIds[0] = null;
		this.pendingSlotAtlasIds[1] = null;
		this.pendingSkyboxFaceIds = null;
		this.slotAtlasIds[0] = null;
		this.slotAtlasIds[1] = null;
		this.vramSlots = [];
		this.readSurfaces = [null, null, null, null];
		for (let index = 0; index < this.readCaches.length; index += 1) {
			this.readCaches[index].width = 0;
		}
		this.cpuReadbackByKey.clear();
		this._skyboxFaceIds = null;
		this.committedSkyboxFaceIds = null;
		this.committedDitherType = this.lastDitherType;
		this.committedSlotAtlasIds[0] = null;
		this.committedSlotAtlasIds[1] = null;
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
					throw vdpFault(`atlas '${entry.resid}' missing dimensions.`);
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
			throw vdpFault(`engine atlas '${engineAtlasName}' missing dimensions.`);
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
		this.commitViewSnapshot();
	}

	private async restoreEngineAtlasFromSource(entry: AssetEntry, source: RawAssetSource, asset: RomImgAsset): Promise<void> {
		if (typeof asset.start !== 'number' || typeof asset.end !== 'number') {
			throw vdpFault(`engine atlas '${asset.resid}' missing ROM buffer offsets.`);
		}
		const decoded = await decodePngToRgba(source.getBytes(asset));
		const plan = this.memory.planImageSlotWrite(entry, {
			pixels: decoded.pixels,
			width: decoded.width,
			height: decoded.height,
			capacity: entry.capacity,
		});
		if (plan.clipped) {
			throw vdpFault(`engine atlas '${asset.resid}' does not fit in system atlas slot.`);
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
			usedBytes += this.vramSlots[index].entry.baseSize;
		}
		return usedBytes;
	}

	public get trackedTotalVramBytes(): number {
		return VRAM_SYSTEM_ATLAS_SIZE + VRAM_PRIMARY_ATLAS_SIZE + VRAM_SECONDARY_ATLAS_SIZE + VRAM_FRAMEBUFFER_SIZE + VRAM_STAGING_SIZE;
	}

	private registerVramSlot(entry: AssetEntry, textureKey: string, surfaceId: number): void {
		let handle = $.texmanager.getTextureByUri(textureKey);
		const isEngineAtlas = textureKey === ENGINE_ATLAS_TEXTURE_KEY;
		let textureWidth = entry.regionW;
		let textureHeight = entry.regionH;
		if (!handle) {
			const stream = this.makeVramGarbageStream(entry.baseAddr >>> 0);
			fillVramGarbageScratch(this.vramSeedPixel, stream);
			handle = $.texmanager.createTextureFromPixelsSync(textureKey, this.vramSeedPixel, 1, 1);
		}
		handle = $.texmanager.resizeTextureForKey(textureKey, entry.regionW, entry.regionH);
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

	private getVramSlotByTextureKey(textureKey: string): AssetVramSlot {
		for (let index = 0; index < this.vramSlots.length; index += 1) {
			const slot = this.vramSlots[index];
			if (slot.kind === 'asset' && slot.textureKey === textureKey) {
				return slot;
			}
		}
		throw vdpFault(`VRAM slot not registered for texture '${textureKey}'.`);
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
		throw vdpFault(`VRAM write has no mapped slot (addr=${addr}, len=${length}).`);
	}

}
