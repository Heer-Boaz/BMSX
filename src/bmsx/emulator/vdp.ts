import { $ } from '../core/engine_core';
import { taskGate } from '../core/taskgate';
import * as SkyboxPipeline from '../render/3d/skybox_pipeline';
import type { SkyboxImageIds } from '../render/shared/render_types';
import type { RomAsset, RuntimeAssets } from '../rompack/rompack';
import { tokenKeyFromAsset, tokenKeyFromId } from '../util/asset_tokens';
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
	VRAM_STAGING_SIZE
} from './memory_map';

const SKYBOX_FACE_KEYS = ['posx', 'negx', 'posy', 'negy', 'posz', 'negz'] as const;
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
	private dirtyAtlasBindings = false;
	private dirtySkybox = false;
	private skyboxFaceIds: SkyboxImageIds | null = null;
	private lastDitherType = 0;
	private imgDecController: ImgDecController | null = null;

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
		this.memory.writeValue(IO_VDP_DITHER, dither);
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
		this.dirtyAtlasBindings = false;
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
		this.atlasSlotById.clear();
		this.slotAtlasIds[0] = primary;
		this.slotAtlasIds[1] = secondary;
		if (primary !== null) {
			this.atlasSlotById.set(primary, 0);
		}
		if (secondary !== null) {
			this.atlasSlotById.set(secondary, 1);
		}
		this.dirtyAtlasBindings = true;
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
		const assets = $.assets;
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
			const asset = assets.img[tokenKeyFromId(assetId)];
			if (!asset || !asset.imgmeta) {
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

	public async registerImageAssets(source: RawAssetSource, assets: RuntimeAssets): Promise<void> {
		if (!this.imgDecController) {
			throw new Error('[BmsxVDP] ImgDecController not attached.');
		}
		const entries = source.list();
		const viewEntries: RomAsset[] = [];
		const engineAtlasName = generateAtlasName(ENGINE_ATLAS_INDEX);
		let engineEntryRecord: AssetEntry | null = null;
		// NOTE: Atlas priming is not allowed; slot sizing must not derive from atlas metadata.
		const seedAtlasSlot = (slotEntry: AssetEntry): void => {
			const maxPixels = Math.floor(slotEntry.capacity / 4);
			const side = Math.floor(Math.sqrt(maxPixels));
			const stride = side * 4;
			const size = stride * side;
			slotEntry.baseSize = size;
			slotEntry.baseStride = stride;
			slotEntry.regionX = 0;
			slotEntry.regionY = 0;
			slotEntry.regionW = side;
			slotEntry.regionH = side;
		};
		this.atlasResourcesById.clear();
		this.atlasViewsById.clear();
		this.atlasSlotById.clear();
		this.slotAtlasIds[0] = null;
		this.slotAtlasIds[1] = null;
		this.dirtyAtlasBindings = true;
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
			const imgAsset = assets.img[tokenKeyFromAsset(entry)];
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

		const engineAtlasAsset = assets.img[tokenKeyFromId(engineAtlasName)];
		if (!engineAtlasAsset) {
			throw new Error(`[BmsxVDP] Engine atlas '${engineAtlasName}' not found.`);
		}
		const engineAtlasMeta = engineAtlasAsset.imgmeta;
		if (!engineAtlasMeta || engineAtlasMeta.width <= 0 || engineAtlasMeta.height <= 0) {
			throw new Error(`[BmsxVDP] Engine atlas '${engineAtlasName}' missing dimensions.`);
		}
		let engineEntryCreated = false;
		if (!engineEntryRecord) {
			engineEntryRecord = this.memory.registerImageSlotAt({
				id: engineAtlasName,
				baseAddr: VRAM_SYSTEM_ATLAS_BASE,
				capacityBytes: VRAM_SYSTEM_ATLAS_SIZE,
				clear: false,
			});
			engineEntryCreated = true;
		}
		if (engineEntryCreated || engineEntryRecord.regionW === 0 || engineEntryRecord.regionH === 0) {
			seedAtlasSlot(engineEntryRecord);
		}
		this.registerVramSlot(engineEntryRecord, ENGINE_ATLAS_TEXTURE_KEY, VDP_RD_SURFACE_ENGINE);

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
			const imgAsset = assets.img[tokenKeyFromAsset(entry)];
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
				const atlasAsset = assets.img[tokenKeyFromAsset(atlasEntry)];
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

	public flushAssetEdits(): void {
		const dirty = this.memory.consumeDirtyAssets();
		if (dirty.length === 0) {
			return;
		}
		for (let index = 0; index < dirty.length; index += 1) {
			const entry = dirty[index];
			if (entry.type === 'image') {
				const vramSpan = entry.capacity > 0 ? entry.capacity : 1;
				if (this.memory.isVramRange(entry.baseAddr, vramSpan)) {
					continue;
				}
				const pixels = this.memory.getImagePixels(entry);
				const width = entry.regionW;
				const height = entry.regionH;
				const token = this.assetUpdateGate.begin({ blocking: false, category: 'texture', tag: `asset:${entry.id}` });
				const textureKey = entry.id === generateAtlasName(ENGINE_ATLAS_INDEX) ? ENGINE_ATLAS_TEXTURE_KEY : entry.id;
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
			this.prefetchReadCache(surfaceId, surface, x, y);
		}
		return this.readCaches[surfaceId];
	}

	private prefetchReadCache(surfaceId: number, surface: VdpReadSurface, x: number, y: number): void {
		const width = surface.entry.regionW;
		const height = surface.entry.regionH;
		if (x >= width || y >= height) {
			throw new Error(`[BmsxVDP] Read cache prefetch out of bounds (${x}, ${y}).`);
		}
		const maxPixelsByBudget = Math.floor(this.readBudgetBytes / 4);
		if (maxPixelsByBudget <= 0) {
			this.readOverflow = true;
			const cache = this.readCaches[surfaceId];
			cache.width = 0;
			return;
		}
		const chunkW = Math.min(VDP_RD_MAX_CHUNK_PIXELS, width - x, maxPixelsByBudget);
		const data = this.readSurfacePixels(surface, x, y, chunkW, 1);
		const cache = this.readCaches[surfaceId];
		cache.x0 = x;
		cache.y = y;
		cache.width = chunkW;
		cache.data = data;
	}

	private readSurfacePixels(surface: VdpReadSurface, x: number, y: number, width: number, height: number): Uint8Array {
		if (this.useCpuReadback()) {
			return this.readCpuReadback(surface, x, y, width, height);
		}
		const handle = $.texmanager.getTextureByUri(surface.textureKey);
		if (!handle) {
			throw new Error(`[BmsxVDP] Readback texture missing for '${surface.textureKey}'.`);
		}
		return $.view.backend.readTextureRegion(handle, x, y, width, height);
	}

	private readCpuReadback(surface: VdpReadSurface, x: number, y: number, width: number, height: number): Uint8Array {
		const buffer = this.getCpuReadbackBuffer(surface);
		const stride = surface.entry.regionW * 4;
		const out = new Uint8Array(width * height * 4);
		for (let row = 0; row < height; row += 1) {
			const srcOffset = (y + row) * stride + x * 4;
			const dstOffset = row * width * 4;
			out.set(buffer.subarray(srcOffset, srcOffset + width * 4), dstOffset);
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

	private registerVramSlot(entry: AssetEntry, textureKey: string, surfaceId: number): void {
		let handle = $.texmanager.getTextureByUri(textureKey);
		let textureWidth = 1;
		let textureHeight = 1;
		if (!handle) {
			const stream = this.makeVramGarbageStream(entry.baseAddr >>> 0);
			fillVramGarbageScratch(this.vramSeedPixel, stream);
			handle = $.texmanager.createTextureFromPixelsSync(textureKey, this.vramSeedPixel, 1, 1);
		}
		$.view.textures[textureKey] = handle;
		this.vramSlots.push({
			kind: 'asset',
			baseAddr: entry.baseAddr,
			capacity: entry.capacity,
			entry,
			textureKey,
			surfaceId,
			textureWidth,
			textureHeight,
		});
		this.registerReadSurface(surfaceId, entry, textureKey);
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
