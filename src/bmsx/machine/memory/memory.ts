import type { Value } from '../cpu/cpu';
import {
	ASSET_DATA_BASE,
	ASSET_DATA_ALLOC_END,
	ASSET_DATA_END,
	ASSET_RAM_BASE,
	ASSET_RAM_SIZE,
	ASSET_TABLE_BASE,
	ASSET_TABLE_SIZE,
	CART_ROM_BASE,
	SYSTEM_ROM_BASE,
	IO_BASE,
	IO_WORD_SIZE,
	OVERLAY_ROM_BASE,
	RAM_BASE,
	RAM_USED_END,
	VRAM_FRAMEBUFFER_BASE,
	VRAM_FRAMEBUFFER_SIZE,
	VRAM_SYSTEM_ATLAS_BASE,
	VRAM_SYSTEM_ATLAS_SIZE,
	VRAM_PRIMARY_ATLAS_BASE,
	VRAM_PRIMARY_ATLAS_SIZE,
	VRAM_SECONDARY_ATLAS_BASE,
	VRAM_SECONDARY_ATLAS_SIZE,
	VRAM_STAGING_BASE,
	VRAM_STAGING_SIZE,
} from './map';
import {
	IO_APU_EVENT_HANDLE,
	IO_APU_EVENT_KIND,
	IO_APU_EVENT_SEQ,
	IO_APU_EVENT_SLOT,
	IO_APU_STATUS,
	IO_DMA_STATUS,
	IO_DMA_WRITTEN,
	IO_GEO_FAULT,
	IO_GEO_PROCESSED,
	IO_GEO_STATUS,
	IO_IMG_STATUS,
	IO_IMG_WRITTEN,
	IO_IRQ_FLAGS,
	IO_SLOT_COUNT,
	IO_SYS_CART_BOOTREADY,
	IO_SYS_HOST_FAULT_FLAGS,
	IO_SYS_HOST_FAULT_STAGE,
	IO_VDP_RD_DATA,
	IO_VDP_RD_STATUS,
	IO_VDP_STATUS,
} from '../bus/io';
import { enforceLuaHeapBudget } from './lua_heap_usage';
import { hashAssetId, tokenKey } from '../../rompack/tokens';
import { ScratchBatch } from '../../common/scratchbatch';
import { formatNumberAsHex } from '../../common/byte_hex_string';

export type AssetType = 'image' | 'audio';

export type AssetEntry = {
	id: string;
	idTokenLo: number;
	idTokenHi: number;
	type: AssetType;
	flags: number;
	ownerIndex: number;
	baseAddr: number;
	baseSize: number;
	capacity: number;
	baseStride: number;
	regionX: number;
	regionY: number;
	regionW: number;
	regionH: number;
	sampleRate: number;
	channels: number;
	frames: number;
	bitsPerSample: number;
	audioDataOffset: number;
	audioDataSize: number;
};

export type ImageWritePlan = {
	baseAddr: number;
	writeWidth: number;
	writeHeight: number;
	writeStride: number;
	targetStride: number;
	sourceStride: number;
	writeSize: number;
	clipped: boolean;
};

export type ImageWriteEntry = {
	baseAddr: number;
	capacity: number;
	baseSize: number;
	baseStride: number;
	regionX: number;
	regionY: number;
	regionW: number;
	regionH: number;
};

export type VramWriteSink = {
	writeVram(addr: number, bytes: Uint8Array): void;
	readVram(addr: number, out: Uint8Array): void;
};

export type IoReadHandler = (addr: number) => Value;
export type IoWriteHandler = (addr: number, value: Value) => void;

export type MemoryState = {
	ioMemory: Value[];
	assetMemory: Uint8Array;
};

export type MemorySaveState = {
	ram: Uint8Array;
};

export type MemoryInit = {
	engineRom: Uint8Array;
	cartRom?: Uint8Array;
	overlayRom?: Uint8Array;
};

const ASSET_TABLE_MAGIC = 0x32534d41; // 'AMS2'
export const ASSET_TABLE_HEADER_SIZE = 40;
export const ASSET_TABLE_ENTRY_SIZE = 64;
// 2 = FNV-1a 64 over exact UTF-8 bytes.
const ASSET_TABLE_HASH_ALG_ID = 2;
const ASSET_PAGE_SHIFT = 12;
export const ASSET_PAGE_SIZE = 1 << ASSET_PAGE_SHIFT;
const utf8Decoder = new TextDecoder();

const ASSET_TYPE_IMAGE = 1;
const ASSET_TYPE_AUDIO = 2;

export const ASSET_FLAG_VIEW = 1 << 1;

export class Memory {
	private readonly engineRom: Uint8Array;
	private readonly cartRom: Uint8Array | undefined;
	private readonly overlayRom: Uint8Array | undefined;
	private readonly ram: Uint8Array;
	private readonly ramView: DataView;
	private readonly ioSlots: Value[];
	private readonly ioReadHandlers: Array<IoReadHandler | null>;
	private readonly ioWriteHandlers: Array<IoWriteHandler | null>;
	private vramWriter: VramWriteSink;
	private readonly vramScratch = new Uint8Array(4);
	private readonly vramReadScratch = new Uint8Array(4);
	private readonly mappedFloatBuffer = new ArrayBuffer(8);
	private readonly mappedFloatView = new DataView(this.mappedFloatBuffer);
	private assetEntries: AssetEntry[] = [];
	private assetIndexById = new Map<string, number>();
	private assetIndexByToken = new Map<string, number>();
	private assetOwnerPages: Int32Array;
	private readonly assetDirtyEntries = new ScratchBatch<AssetEntry>();
	private readonly assetDirtyDrainEntries = new ScratchBatch<AssetEntry>();
	private assetDirtyFlags = new Uint8Array(0);
	private assetDataCursor = ASSET_DATA_BASE;
	private assetTableFinalized = false;
	private engineAssetEntryCount = 0;
	private engineAssetDataEnd = ASSET_DATA_BASE;
	private cartAssetDataBase = ASSET_DATA_BASE;

	public constructor(init: MemoryInit) {
		this.engineRom = init.engineRom;
		this.cartRom = init.cartRom;
		this.overlayRom = init.overlayRom;
		this.ram = new Uint8Array(RAM_USED_END - RAM_BASE);
		this.ramView = new DataView(this.ram.buffer, this.ram.byteOffset, this.ram.byteLength);
		this.ioSlots = new Array<Value>(IO_SLOT_COUNT);
		for (let index = 0; index < this.ioSlots.length; index += 1) {
			this.ioSlots[index] = null;
		}
		this.ioReadHandlers = new Array<IoReadHandler | null>(IO_SLOT_COUNT);
		this.ioWriteHandlers = new Array<IoWriteHandler | null>(IO_SLOT_COUNT);
		for (let index = 0; index < IO_SLOT_COUNT; index += 1) {
			this.ioReadHandlers[index] = null;
			this.ioWriteHandlers[index] = null;
		}
		const pageCount = Math.ceil((ASSET_DATA_END - ASSET_DATA_BASE) / ASSET_PAGE_SIZE);
		this.assetOwnerPages = new Int32Array(pageCount);
		this.resetAssetMemory();
	}

	public setVramWriter(writer: VramWriteSink): void {
		this.vramWriter = writer;
	}

	public getUsedAssetTableBytes(): number {
		const headerOffset = ASSET_TABLE_BASE - RAM_BASE;
		const entryCount = this.ramView.getUint32(headerOffset + 12, true);
		const stringTableLength = this.ramView.getUint32(headerOffset + 20, true);
		return ASSET_TABLE_HEADER_SIZE + (entryCount * ASSET_TABLE_ENTRY_SIZE) + stringTableLength;
	}

	public getUsedAssetDataBytes(): number {
		const headerOffset = ASSET_TABLE_BASE - RAM_BASE;
		return this.ramView.getUint32(headerOffset + 28, true);
	}

	public mapIoRead(addr: number, handler: IoReadHandler): void {
		this.ioReadHandlers[this.ioIndex(addr)] = handler;
	}

	public mapIoWrite(addr: number, handler: IoWriteHandler): void {
		this.ioWriteHandlers[this.ioIndex(addr)] = handler;
	}

	public getOverlayRomSize(): number {
		return this.overlayRom ? this.overlayRom.byteLength : 0;
	}

	public getIoSlotCount(): number {
		return this.ioSlots.length;
	}

	public getIoSlots(): ReadonlyArray<Value> {
		return this.ioSlots;
	}

	public loadIoSlots(slots: ReadonlyArray<Value>): void {
		if (slots.length !== this.ioSlots.length) {
			throw new Error(`[Memory] I/O snapshot slot count mismatch (${slots.length} != ${this.ioSlots.length}).`);
		}
		for (let index = 0; index < this.ioSlots.length; index += 1) {
			this.ioSlots[index] = slots[index];
		}
	}

	public clearIoSlots(): void {
		this.ioSlots.fill(null);
	}

	public resetAssetMemory(): void {
		const previousDataCursor = this.assetDataCursor;
		if (previousDataCursor > ASSET_TABLE_BASE) {
			const clearEnd = Math.min(previousDataCursor, ASSET_DATA_ALLOC_END);
			const clearStartOffset = ASSET_TABLE_BASE - RAM_BASE;
			const clearEndOffset = clearEnd - RAM_BASE;
			this.ram.fill(0, clearStartOffset, clearEndOffset);
		}
		this.assetEntries = [];
		this.assetIndexById.clear();
		this.assetIndexByToken.clear();
		this.clearDirtyAssetTracking();
		this.assetTableFinalized = false;
		this.engineAssetEntryCount = 0;
		this.engineAssetDataEnd = ASSET_DATA_BASE;
		this.cartAssetDataBase = ASSET_DATA_BASE;
		this.assetOwnerPages.fill(-1);
		this.assetDataCursor = ASSET_DATA_BASE;
	}

	public hasAsset(id: string): boolean {
		if (this.assetIndexById.has(id)) {
			return true;
		}
		const { lo, hi } = hashAssetId(id);
		return this.assetIndexByToken.has(tokenKey(lo, hi));
	}

	public sealEngineAssets(): void {
		this.engineAssetEntryCount = this.assetEntries.length;
		this.engineAssetDataEnd = this.assetDataCursor;
		const mask = ASSET_PAGE_SIZE - 1;
		const aligned = (this.engineAssetDataEnd + mask) & ~mask;
		if (aligned > ASSET_DATA_ALLOC_END) {
			throw new Error(`[Memory] Engine data exceeds reserved RAM range (${aligned} > ${ASSET_DATA_ALLOC_END}).`);
		}
		this.cartAssetDataBase = aligned;
	}

	public resetCartAssets(): void {
		const previousDataCursor = this.assetDataCursor;
		this.assetEntries.length = this.engineAssetEntryCount;
		this.assetIndexById.clear();
		this.assetIndexByToken.clear();
		this.clearDirtyAssetTracking();
		this.assetTableFinalized = false;
		this.assetOwnerPages.fill(-1);
		for (let index = 0; index < this.assetEntries.length; index += 1) {
			const entry = this.assetEntries[index];
			this.assetIndexById.set(entry.id, index);
			this.assetIndexByToken.set(tokenKey(entry.idTokenLo, entry.idTokenHi), index);
		}
		this.mapOwnedAssetPages(this.assetEntries.length);
		this.assetDataCursor = this.cartAssetDataBase;
		if (previousDataCursor > this.cartAssetDataBase) {
			const clearEnd = Math.min(previousDataCursor, ASSET_DATA_ALLOC_END);
			const clearStartOffset = this.cartAssetDataBase - RAM_BASE;
			const clearEndOffset = clearEnd - RAM_BASE;
			this.ram.fill(0, clearStartOffset, clearEndOffset);
		}
	}

	public registerImageSlot(params: {
		id: string;
		capacityBytes: number;
		flags?: number;
	}): AssetEntry {
		const { addr, view } = this.allocateAssetData(params.capacityBytes, 4);
		view.fill(0);
		const entry = this.createAssetEntry({
			id: params.id,
			idTokenLo: 0,
			idTokenHi: 0,
			type: 'image',
			flags: params.flags ?? 0,
			baseAddr: addr,
			baseSize: 0,
			capacity: params.capacityBytes,
			baseStride: 0,
			regionX: 0,
			regionY: 0,
			regionW: 0,
			regionH: 0,
			sampleRate: 0,
			channels: 0,
			frames: 0,
			bitsPerSample: 0,
			audioDataOffset: 0,
			audioDataSize: 0,
			ownerIndex: -1,
		});
		return this.registerOwnedAssetEntry(entry, addr, params.capacityBytes);
	}

	public registerImageSlotAt(params: {
		id: string;
		baseAddr: number;
		capacityBytes: number;
		flags?: number;
		clear?: boolean;
	}): AssetEntry {
		const isVramSlot = this.isVramRange(params.baseAddr, params.capacityBytes);
		if (!isVramSlot) {
			const offset = params.baseAddr - RAM_BASE;
			if (offset < 0 || offset + params.capacityBytes > this.ram.byteLength) {
				throw new Error(`[Memory] Image slot '${params.id}' out of RAM bounds.`);
			}
			const slotView = this.ram.subarray(offset, offset + params.capacityBytes);
			if (params.clear !== false) {
				slotView.fill(0);
			}
		}
		const entry = this.createAssetEntry({
			id: params.id,
			idTokenLo: 0,
			idTokenHi: 0,
			type: 'image',
			flags: params.flags ?? 0,
			baseAddr: params.baseAddr,
			baseSize: 0,
			capacity: params.capacityBytes,
			baseStride: 0,
			regionX: 0,
			regionY: 0,
			regionW: 0,
			regionH: 0,
			sampleRate: 0,
			channels: 0,
			frames: 0,
			bitsPerSample: 0,
			audioDataOffset: 0,
			audioDataSize: 0,
			ownerIndex: -1,
		});
		entry.ownerIndex = this.registerAssetEntry(entry);
		if (!isVramSlot) {
			this.mapAssetPages(entry.ownerIndex, params.baseAddr, params.capacityBytes);
		}
		return entry;
	}

	public registerImageBuffer(params: {
		id: string;
		width: number;
		height: number;
		pixels: Uint8Array;
		flags?: number;
	}): AssetEntry {
		const stride = params.width * 4;
		const size = stride * params.height;
		const { addr, view } = this.allocateAssetData(size, 4);
		view.set(params.pixels);
		const entry = this.createAssetEntry({
			id: params.id,
			idTokenLo: 0,
			idTokenHi: 0,
			type: 'image',
			flags: params.flags ?? 0,
			baseAddr: addr,
			baseSize: size,
			capacity: size,
			baseStride: stride,
			regionX: 0,
			regionY: 0,
			regionW: params.width,
			regionH: params.height,
			sampleRate: 0,
			channels: 0,
			frames: 0,
			bitsPerSample: 0,
			audioDataOffset: 0,
			audioDataSize: 0,
			ownerIndex: -1,
		});
		return this.registerOwnedAssetEntry(entry, addr, size);
	}

	public registerImageView(params: {
		id: string;
		baseEntry: AssetEntry;
		regionX: number;
		regionY: number;
		regionW: number;
		regionH: number;
		flags?: number;
	}): AssetEntry {
		const entry = this.createAssetEntry({
			id: params.id,
			idTokenLo: 0,
			idTokenHi: 0,
			type: 'image',
			flags: (params.flags ?? 0) | ASSET_FLAG_VIEW,
			baseAddr: params.baseEntry.baseAddr,
			baseSize: params.baseEntry.baseSize,
			capacity: 0,
			baseStride: params.baseEntry.baseStride,
			regionX: params.regionX,
			regionY: params.regionY,
			regionW: params.regionW,
			regionH: params.regionH,
			sampleRate: 0,
			channels: 0,
			frames: 0,
			bitsPerSample: 0,
			audioDataOffset: 0,
			audioDataSize: 0,
			ownerIndex: params.baseEntry.ownerIndex,
		});
		// @ts-ignore
		const index = this.registerAssetEntry(entry);
		return entry;
	}

	public registerAudioBuffer(params: {
		id: string;
		bytes: Uint8Array;
		sampleRate: number;
		channels: number;
		bitsPerSample: number;
		frames: number;
		dataOffset: number;
		dataSize: number;
	}): AssetEntry {
		const { addr, view } = this.allocateAssetData(params.bytes.byteLength, 2);
		view.set(params.bytes);
		const entry = this.createAssetEntry({
			id: params.id,
			idTokenLo: 0,
			idTokenHi: 0,
			type: 'audio',
			flags: 0,
			baseAddr: addr,
			baseSize: params.bytes.byteLength,
			capacity: params.bytes.byteLength,
			baseStride: 0,
			regionX: 0,
			regionY: 0,
			regionW: 0,
			regionH: 0,
			sampleRate: params.sampleRate,
			channels: params.channels,
			frames: params.frames,
			bitsPerSample: params.bitsPerSample,
			audioDataOffset: params.dataOffset,
			audioDataSize: params.dataSize,
			ownerIndex: -1,
		});
		return this.registerOwnedAssetEntry(entry, addr, params.bytes.byteLength);
	}

	public registerAudioMeta(params: {
		id: string;
		sampleRate: number;
		channels: number;
		bitsPerSample: number;
		frames: number;
		dataOffset: number;
		dataSize: number;
	}): AssetEntry {
		const entry = this.createAssetEntry({
			id: params.id,
			idTokenLo: 0,
			idTokenHi: 0,
			type: 'audio',
			flags: 0,
			baseAddr: 0,
			baseSize: 0,
			capacity: 0,
			baseStride: 0,
			regionX: 0,
			regionY: 0,
			regionW: 0,
			regionH: 0,
			sampleRate: params.sampleRate,
			channels: params.channels,
			frames: params.frames,
			bitsPerSample: params.bitsPerSample,
			audioDataOffset: params.dataOffset,
			audioDataSize: params.dataSize,
			ownerIndex: -1,
		});
		entry.ownerIndex = this.registerAssetEntry(entry);
		return entry;
	}

	public getAssetEntry(id: string): AssetEntry {
		return this.getAssetEntryByHandle(this.resolveAssetHandle(id));
	}

	public getAssetEntryByHandle(handle: number): AssetEntry {
		if (handle < 0 || handle >= this.assetEntries.length) {
			throw new Error(`[Memory] Asset handle out of range: ${handle}.`);
		}
		return this.assetEntries[handle];
	}

	public resolveAssetHandle(id: string): number {
		const direct = this.assetIndexById.get(id);
		if (direct !== undefined) {
			return direct;
		}
		const { lo, hi } = hashAssetId(id);
		const key = tokenKey(lo, hi);
		const handle = this.assetIndexByToken.get(key);
		if (handle === undefined) {
			throw new Error(`[Memory] Asset '${id}' not registered in memory.`);
		}
		return handle;
	}

	public getImagePixels(entry: AssetEntry): Uint8Array {
		if (entry.flags & ASSET_FLAG_VIEW) {
			throw new Error(`[Memory] Asset '${entry.id}' is a view and has no direct pixel buffer.`);
		}
		if (this.isVramRange(entry.baseAddr, entry.capacity)) {
			throw new Error(`[Memory] Asset '${entry.id}' lives in VRAM and has no CPU pixel buffer.`);
		}
		const offset = entry.baseAddr - RAM_BASE;
		const size = entry.regionW * entry.regionH * 4;
		return this.ram.subarray(offset, offset + size);
	}

	public getAudioBytes(entry: AssetEntry): Uint8Array {
		const offset = entry.baseAddr - RAM_BASE;
		return this.ram.subarray(offset, offset + entry.baseSize);
	}

	public consumeDirtyAssets(): ScratchBatch<AssetEntry> {
		const drained = this.assetDirtyDrainEntries;
		drained.clear();
		for (let index = 0; index < this.assetDirtyEntries.length; index += 1) {
			const entry = this.assetDirtyEntries.get(index);
			this.assetDirtyFlags[entry.ownerIndex] = 0;
			drained.push(entry);
		}
		this.assetDirtyEntries.clear();
		return drained;
	}

	public markAllAssetsDirty(): void {
		for (let index = 0; index < this.assetEntries.length; index += 1) {
			const entry = this.assetEntries[index];
			if (entry.ownerIndex !== index) {
				continue;
			}
			if (this.isVramRange(entry.baseAddr, entry.capacity)) {
				continue;
			}
			this.markAssetOwnerDirty(index);
		}
	}

	public finalizeAssetTable(): void {
		const entryCount = this.assetEntries.length;
		const entriesSize = entryCount * ASSET_TABLE_ENTRY_SIZE;
		const entryBaseAddr = ASSET_TABLE_BASE + ASSET_TABLE_HEADER_SIZE;
		const encoder = new TextEncoder();
		const stringOffsets = new Map<string, number>();
		const strings: Uint8Array[] = [];
		let stringTableLength = 0;

		for (const entry of this.assetEntries) {
			let offset = stringOffsets.get(entry.id);
			if (offset === undefined) {
				const bytes = encoder.encode(entry.id);
				offset = stringTableLength;
				stringOffsets.set(entry.id, offset);
				strings.push(bytes);
				stringTableLength += bytes.byteLength + 1;
			}
		}

		const stringTableAddr = entryBaseAddr + entriesSize;
		const tableEnd = ASSET_TABLE_BASE + ASSET_TABLE_SIZE;
		if (stringTableAddr + stringTableLength > tableEnd) {
			throw new Error(`[Memory] Asset table overflow: entries=${entryCount} strings=${stringTableLength}.`);
		}

		const headerOffset = ASSET_TABLE_BASE - RAM_BASE;
		this.ramView.setUint32(headerOffset + 0, ASSET_TABLE_MAGIC, true);
		this.ramView.setUint32(headerOffset + 4, ASSET_TABLE_HEADER_SIZE, true);
		this.ramView.setUint32(headerOffset + 8, ASSET_TABLE_ENTRY_SIZE, true);
		this.ramView.setUint32(headerOffset + 12, entryCount, true);
		this.ramView.setUint32(headerOffset + 16, stringTableAddr, true);
		this.ramView.setUint32(headerOffset + 20, stringTableLength, true);
		this.ramView.setUint32(headerOffset + 24, ASSET_DATA_BASE, true);
		this.ramView.setUint32(headerOffset + 28, this.assetDataCursor - ASSET_DATA_BASE, true);
		this.ramView.setUint32(headerOffset + 32, ASSET_TABLE_HASH_ALG_ID, true);
		this.ramView.setUint32(headerOffset + 36, 0, true);

		for (let index = 0; index < this.assetEntries.length; index += 1) {
			const entry = this.assetEntries[index];
			const entryAddr = entryBaseAddr + index * ASSET_TABLE_ENTRY_SIZE;
			const entryOffset = entryAddr - RAM_BASE;
			let typeId = 0;
			switch (entry.type) {
				case 'image':
					typeId = ASSET_TYPE_IMAGE;
					break;
				case 'audio':
					typeId = ASSET_TYPE_AUDIO;
					break;
				default:
					throw new Error(`[Memory] Asset entry has unknown type: ${entry.type}.`);
			}
			const idOffset = stringTableAddr + stringOffsets.get(entry.id);
			this.ramView.setUint32(entryOffset + 0, typeId, true);
			this.ramView.setUint32(entryOffset + 4, entry.flags, true);
			this.ramView.setUint32(entryOffset + 8, entry.idTokenLo, true);
			this.ramView.setUint32(entryOffset + 12, entry.idTokenHi, true);
			this.ramView.setUint32(entryOffset + 16, idOffset, true);
			this.writeAssetEntryMutableData(entryOffset, entry);
		}

		const stringOffset = stringTableAddr - RAM_BASE;
		let cursor = stringOffset;
		for (const bytes of strings) {
			this.ram.set(bytes, cursor);
			cursor += bytes.byteLength;
			this.ram[cursor] = 0;
			cursor += 1;
		}
		this.assetTableFinalized = true;
		enforceLuaHeapBudget();
	}

	public writeImageSlot(entry: AssetEntry, params: { pixels: Uint8Array; width: number; height: number; capacity?: number }): void {
		const plan = this.planImageSlotWrite(entry, params);
		if (plan.writeSize > 0) {
			const offset = entry.baseAddr - RAM_BASE;
			if (plan.writeWidth === Math.floor(params.width)) {
				this.ram.set(params.pixels.subarray(0, plan.writeSize), offset);
			} else {
				for (let row = 0; row < plan.writeHeight; row += 1) {
					const srcOffset = row * plan.sourceStride;
					const dstOffset = offset + row * plan.writeStride;
					this.ram.set(params.pixels.subarray(srcOffset, srcOffset + plan.writeStride), dstOffset);
				}
			}
			this.markAssetDirty(entry.baseAddr, plan.writeSize);
		}
	}

	public planImageWrite(entry: ImageWriteEntry, params: { pixels: Uint8Array; width: number; height: number; capacity?: number }): ImageWritePlan {
		let capacity = entry.capacity;
		if (params.capacity !== undefined) {
			const requestedCapacity = Math.floor(params.capacity);
			capacity = requestedCapacity < entry.capacity ? requestedCapacity : entry.capacity;
		}
		const sourceWidth = Math.floor(params.width);
		const sourceHeight = Math.floor(params.height);
		const sourceStride = sourceWidth * 4;
		const maxPixels = Math.floor(capacity / 4);
		let writeWidth = sourceWidth;
		let writeHeight = sourceHeight;
		if (sourceStride <= 0 || sourceHeight <= 0 || maxPixels <= 0) {
			writeWidth = 0;
			writeHeight = 0;
		} else {
			const maxRowsByPixels = Math.floor(params.pixels.byteLength / sourceStride);
			if (sourceWidth > maxPixels) {
				writeWidth = Math.min(sourceWidth, maxPixels);
				writeHeight = Math.min(1, maxRowsByPixels);
			} else {
				const maxRowsByCapacity = Math.floor(capacity / sourceStride);
				writeHeight = Math.min(sourceHeight, maxRowsByCapacity, maxRowsByPixels);
			}
		}
		const writeStride = writeWidth * 4;
		const writeSize = writeStride * writeHeight;
		entry.baseSize = writeSize;
		entry.baseStride = writeStride;
		entry.regionX = 0;
		entry.regionY = 0;
		entry.regionW = writeWidth;
		entry.regionH = writeHeight;
		return {
			baseAddr: entry.baseAddr,
			writeWidth,
			writeHeight,
			writeStride,
			targetStride: writeStride,
			sourceStride,
			writeSize,
			clipped: writeWidth !== sourceWidth || writeHeight !== sourceHeight,
		};
	}

	public planImageSlotWrite(entry: AssetEntry, params: { pixels: Uint8Array; width: number; height: number; capacity?: number }): ImageWritePlan {
		const index = this.assetIndexById.get(entry.id)!;
		const plan = this.planImageWrite(entry, params);
		if (this.assetTableFinalized) {
			this.writeAssetEntryData(index, entry);
		}
		return plan;
	}

	public updateImageViewBase(entry: AssetEntry, baseEntry: AssetEntry): void {
		const index = this.assetIndexById.get(entry.id)!;
		entry.baseAddr = baseEntry.baseAddr;
		entry.baseSize = baseEntry.baseSize;
		entry.baseStride = baseEntry.baseStride;
		entry.ownerIndex = baseEntry.ownerIndex;
		if (this.assetTableFinalized) {
			this.writeAssetEntryData(index, entry);
		}
	}

	public dumpAssetMemory(): Uint8Array {
		const offset = ASSET_RAM_BASE - RAM_BASE;
		return this.ram.slice(offset, offset + ASSET_RAM_SIZE);
	}

	public restoreAssetMemory(snapshot: Uint8Array): void {
		const offset = ASSET_RAM_BASE - RAM_BASE;
		if (snapshot.byteLength !== ASSET_RAM_SIZE) {
			throw new Error(`[Memory] RAM snapshot length mismatch (${snapshot.byteLength} != ${ASSET_RAM_SIZE}).`);
		}
		this.ram.set(snapshot, offset);
		this.rehydrateAssetEntriesFromTable();
		this.markAllAssetsDirty();
	}

	public dumpMutableRam(): Uint8Array {
		return this.ram.slice();
	}

	public restoreMutableRam(snapshot: Uint8Array): void {
		if (snapshot.byteLength !== this.ram.byteLength) {
			throw new Error(`[Memory] RAM snapshot length mismatch (${snapshot.byteLength} != ${this.ram.byteLength}).`);
		}
		this.ram.set(snapshot);
		this.rehydrateAssetEntriesFromTable();
		this.markAllAssetsDirty();
	}

	public captureState(): MemoryState {
		return {
			ioMemory: this.ioSlots.slice(),
			assetMemory: this.dumpAssetMemory(),
		};
	}

	public restoreState(state: MemoryState): void {
		this.loadIoSlots(state.ioMemory);
		this.restoreAssetMemory(state.assetMemory);
	}

	public captureSaveState(): MemorySaveState {
		return {
			ram: this.dumpMutableRam(),
		};
	}

	public restoreSaveState(state: MemorySaveState): void {
		this.restoreMutableRam(state.ram);
	}

	public rehydrateAssetEntriesFromTable(): void {
		const headerOffset = ASSET_TABLE_BASE - RAM_BASE;
		const magic = this.ramView.getUint32(headerOffset + 0, true);
		if (magic !== ASSET_TABLE_MAGIC) {
			throw new Error(`[Memory] Asset table magic mismatch (${magic} != ${ASSET_TABLE_MAGIC}).`);
		}
		const headerSize = this.ramView.getUint32(headerOffset + 4, true);
		if (headerSize !== ASSET_TABLE_HEADER_SIZE) {
			throw new Error(`[Memory] Asset table header size mismatch (${headerSize} != ${ASSET_TABLE_HEADER_SIZE}).`);
		}
		const entrySize = this.ramView.getUint32(headerOffset + 8, true);
		if (entrySize !== ASSET_TABLE_ENTRY_SIZE) {
			throw new Error(`[Memory] Asset table entry size mismatch (${entrySize} != ${ASSET_TABLE_ENTRY_SIZE}).`);
		}
		const entryCount = this.ramView.getUint32(headerOffset + 12, true);
		const stringTableAddr = this.ramView.getUint32(headerOffset + 16, true);
		const stringTableLength = this.ramView.getUint32(headerOffset + 20, true);
		const dataBase = this.ramView.getUint32(headerOffset + 24, true);
		const dataLength = this.ramView.getUint32(headerOffset + 28, true);
		const hashAlgId = this.ramView.getUint32(headerOffset + 32, true);
		if (dataBase !== ASSET_DATA_BASE) {
			throw new Error(`[Memory] Asset table data base mismatch (${dataBase} != ${ASSET_DATA_BASE}).`);
		}
		if (hashAlgId !== ASSET_TABLE_HASH_ALG_ID) {
			throw new Error(`[Memory] Asset table hash algorithm mismatch (${hashAlgId} != ${ASSET_TABLE_HASH_ALG_ID}).`);
		}

		const stringTableOffset = stringTableAddr - RAM_BASE;
		const stringTableEnd = stringTableOffset + stringTableLength;
		const readString = (addr: number): string => {
			const offset = addr - RAM_BASE;
			if (offset < stringTableOffset || offset >= stringTableEnd) {
				throw new Error(`[Memory] Asset string pointer out of range (${addr}).`);
			}
			let cursor = offset;
			while (cursor < stringTableEnd && this.ram[cursor] !== 0) {
				cursor += 1;
			}
			if (cursor >= stringTableEnd) {
				throw new Error(`[Memory] Asset string at ${addr} missing terminator.`);
			}
			return utf8Decoder.decode(this.ram.subarray(offset, cursor));
		};

		const entryBaseAddr = ASSET_TABLE_BASE + ASSET_TABLE_HEADER_SIZE;
		const reuseEntries = this.assetEntries.length === entryCount;
		const entries = reuseEntries ? this.assetEntries : new Array<AssetEntry>(entryCount);
		this.assetIndexById.clear();
		this.assetIndexByToken.clear();
		this.clearDirtyAssetTracking();
		for (let index = 0; index < entryCount; index += 1) {
			const entryOffset = entryBaseAddr + index * ASSET_TABLE_ENTRY_SIZE - RAM_BASE;
			const typeId = this.ramView.getUint32(entryOffset + 0, true);
			const flags = this.ramView.getUint32(entryOffset + 4, true);
			const tokenLo = this.ramView.getUint32(entryOffset + 8, true);
			const tokenHi = this.ramView.getUint32(entryOffset + 12, true);
			const idAddr = this.ramView.getUint32(entryOffset + 16, true);
			const id = readString(idAddr);
			let type: AssetType;
			if (typeId === ASSET_TYPE_IMAGE) {
				type = 'image';
			} else if (typeId === ASSET_TYPE_AUDIO) {
				type = 'audio';
			} else {
				throw new Error(`[Memory] Asset '${id}' has unknown type id ${typeId}.`);
			}
			const baseAddr = this.ramView.getUint32(entryOffset + 20, true);
			const baseSize = this.ramView.getUint32(entryOffset + 24, true);
			const capacity = this.ramView.getUint32(entryOffset + 28, true);
			const entry = reuseEntries ? entries[index]! : {
				id,
				idTokenLo: tokenLo,
				idTokenHi: tokenHi,
				type,
				flags,
				ownerIndex: -1,
				baseAddr,
				baseSize,
				capacity,
				baseStride: 0,
				regionX: 0,
				regionY: 0,
				regionW: 0,
				regionH: 0,
				sampleRate: 0,
				channels: 0,
				frames: 0,
				bitsPerSample: 0,
				audioDataOffset: 0,
				audioDataSize: 0,
			};
			entry.id = id;
			entry.idTokenLo = tokenLo;
			entry.idTokenHi = tokenHi;
			entry.type = type;
			entry.flags = flags;
			entry.ownerIndex = -1;
			entry.baseAddr = baseAddr;
			entry.baseSize = baseSize;
			entry.capacity = capacity;
			entry.baseStride = 0;
			entry.regionX = 0;
			entry.regionY = 0;
			entry.regionW = 0;
			entry.regionH = 0;
			entry.sampleRate = 0;
			entry.channels = 0;
			entry.frames = 0;
			entry.bitsPerSample = 0;
			entry.audioDataOffset = 0;
			entry.audioDataSize = 0;
			switch (type) {
				case 'image':
					entry.baseStride = this.ramView.getUint32(entryOffset + 32, true);
					entry.regionX = this.ramView.getUint32(entryOffset + 36, true);
					entry.regionY = this.ramView.getUint32(entryOffset + 40, true);
					entry.regionW = this.ramView.getUint32(entryOffset + 44, true);
					entry.regionH = this.ramView.getUint32(entryOffset + 48, true);
					break;
				case 'audio':
					entry.sampleRate = this.ramView.getUint32(entryOffset + 32, true);
					entry.channels = this.ramView.getUint32(entryOffset + 36, true);
					entry.frames = this.ramView.getUint32(entryOffset + 40, true);
					entry.bitsPerSample = this.ramView.getUint32(entryOffset + 44, true);
					entry.audioDataOffset = this.ramView.getUint32(entryOffset + 48, true);
					entry.audioDataSize = this.ramView.getUint32(entryOffset + 52, true);
					break;
			}
			const expectedToken = hashAssetId(id);
			if (expectedToken.lo !== tokenLo || expectedToken.hi !== tokenHi) {
				throw new Error(`[Memory] Asset token mismatch for '${id}'.`);
			}
			const tokenKeyValue = tokenKey(tokenLo, tokenHi);
			if (this.assetIndexById.has(id)) {
				throw new Error(`[Memory] Duplicate asset id '${id}' in asset table.`);
			}
			if (this.assetIndexByToken.has(tokenKeyValue)) {
				throw new Error(`[Memory] Duplicate asset token for '${id}' in asset table.`);
			}
			entries[index] = entry;
			this.assetIndexById.set(id, index);
			this.assetIndexByToken.set(tokenKeyValue, index);
		}
		this.assetEntries = entries;
		this.ensureAssetDirtyFlagCapacity(entryCount);

		const ownerByBaseAddr = new Map<number, number>();
		for (let index = 0; index < entryCount; index += 1) {
			const entry = this.assetEntries[index];
			if (entry.flags & ASSET_FLAG_VIEW) {
				continue;
			}
			entry.ownerIndex = index;
			ownerByBaseAddr.set(entry.baseAddr, index);
		}
		for (let index = 0; index < entryCount; index += 1) {
			const entry = this.assetEntries[index];
			if (entry.flags & ASSET_FLAG_VIEW) {
				const ownerIndex = ownerByBaseAddr.get(entry.baseAddr);
				if (ownerIndex === undefined) {
					throw new Error(`[Memory] Missing owner for asset view '${entry.id}'.`);
				}
				entry.ownerIndex = ownerIndex;
			}
		}

		this.assetOwnerPages.fill(-1);
		this.mapOwnedAssetPages(entryCount);
		this.assetDataCursor = dataBase + dataLength;
		this.assetTableFinalized = true;
	}

	public readValue(addr: number): Value {
		if (this.isIoAddress(addr)) {
			const slot = this.ioIndex(addr);
			const handler = this.ioReadHandlers[slot];
			if (handler !== null) {
				return handler(addr);
			}
			return this.ioSlots[slot];
		}
		if (addr < RAM_BASE) {
			return this.readU32FromRegion(addr);
		}
		return this.readU32(addr);
	}

	public readMappedValue(addr: number): Value {
		if (this.isVramRange(addr, 4)) {
			return this.readMappedU32LE(addr);
		}
		return this.readValue(addr);
	}

	public writeValue(addr: number, value: Value): void {
		if (this.isIoAddress(addr)) {
			const slot = this.ioIndex(addr);
			this.ioSlots[slot] = value;
			const handler = this.ioWriteHandlers[slot];
			if (handler !== null) {
				handler(addr, value);
			}
			return;
		}
		if (typeof value !== 'number') {
			throw new Error(`Bus fault: non-numeric store @ ${formatNumberAsHex(addr >>> 0, 8)}.`);
		}
		this.writeU32(addr, value);
	}

	public writeIoValue(addr: number, value: Value): void {
		if (!this.isIoAddress(addr)) {
			throw new Error(`I/O fault @ ${formatNumberAsHex(addr >>> 0, 8)}: invalid register.`);
		}
		this.ioSlots[this.ioIndex(addr)] = value;
	}

	public writeMappedValue(addr: number, value: Value): void {
		if (!this.isMappedWritableRange(addr, 4)) {
			throw new Error(`Bus fault @ ${formatNumberAsHex(addr >>> 0, 8)}: write word.`);
		}
		if (this.isVramRange(addr, 4)) {
			if (typeof value !== 'number') {
				throw new Error(`VRAM write fault @ ${formatNumberAsHex(addr >>> 0, 8)}: non-numeric value.`);
			}
			this.writeMappedU32LE(addr, value);
			return;
		}
		this.writeValue(addr, value);
	}

	public readU8(addr: number): number {
		const { data, offset } = this.resolveReadRegion(addr, 1);
		return data[offset];
	}

	public readMappedU8(addr: number): number {
		if (this.isVramRange(addr, 1)) {
			const out = this.vramReadScratch.subarray(0, 1);
			this.readVram(addr, out);
			return out[0];
		}
		if (this.isIoAddress(addr)) {
			const value = this.readValue(addr);
			if (typeof value !== 'number') {
				throw new Error(`I/O read fault @ ${formatNumberAsHex(addr >>> 0, 8)}: non-numeric register.`);
			}
			return value & 0xff;
		}
		if (this.isIoRegionRange(addr, 1)) {
			throw new Error(`I/O read fault @ ${formatNumberAsHex(addr >>> 0, 8)}: unaligned.`);
		}
		return this.readU8(addr);
	}

	public writeU8(addr: number, value: number): void {
		if (this.isVramRange(addr, 1)) {
			this.vramScratch[0] = value & 0xff;
			this.vramScratch[1] = 0;
			this.vramScratch[2] = 0;
			this.vramScratch[3] = 0;
			this.writeVram(addr, this.vramScratch.subarray(0, 1));
			return;
		}
		const { data, offset } = this.resolveWriteRegion(addr, 1);
		data[offset] = value & 0xff;
		this.markAssetDirty(addr, 1);
	}

	public writeMappedU8(addr: number, value: number): void {
		if (!this.isMappedWritableRange(addr, 1)) {
			throw new Error(`Bus fault @ ${formatNumberAsHex(addr >>> 0, 8)}: write byte.`);
		}
		if (this.isIoAddress(addr)) {
			this.writeValue(addr, value & 0xff);
			return;
		}
		this.writeU8(addr, value);
	}

	public readIoU32(addr: number): number {
		if (!this.isIoAddress(addr)) {
			throw new Error(`I/O read fault @ ${formatNumberAsHex(addr >>> 0, 8)}: invalid register.`);
		}
		const value = this.readValue(addr);
		if (typeof value !== 'number') {
			throw new Error(`I/O read fault @ ${formatNumberAsHex(addr >>> 0, 8)}: non-numeric register.`);
		}
		return value >>> 0;
	}

	public readIoI32(addr: number): number {
		return this.readIoU32(addr) | 0;
	}

	public readU32(addr: number): number {
		this.assertReadableRange(addr, 4);
		if (addr < RAM_BASE) {
			return this.readU32FromRegion(addr);
		}
		const offset = this.resolveRamOffset(addr, 4);
		return this.ramView.getUint32(offset, true);
	}

	private readU32FromRegion(addr: number): number {
		const { data, offset } = this.resolveReadRegion(addr, 4);
		return (
			data[offset]
			| (data[offset + 1] << 8)
			| (data[offset + 2] << 16)
			| (data[offset + 3] << 24)
		) >>> 0;
	}

	public readMappedU16LE(addr: number): number {
		const b0 = this.readMappedU8(addr);
		const b1 = this.readMappedU8(addr + 1);
		return (b0 | (b1 << 8)) >>> 0;
	}

	public readMappedU32LE(addr: number): number {
		const b0 = this.readMappedU8(addr);
		const b1 = this.readMappedU8(addr + 1);
		const b2 = this.readMappedU8(addr + 2);
		const b3 = this.readMappedU8(addr + 3);
		return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
	}

	public readMappedF32LE(addr: number): number {
		this.mappedFloatView.setUint32(0, this.readMappedU32LE(addr), true);
		return this.mappedFloatView.getFloat32(0, true);
	}

	public readMappedF64LE(addr: number): number {
		this.mappedFloatView.setUint32(0, this.readMappedU32LE(addr), true);
		this.mappedFloatView.setUint32(4, this.readMappedU32LE(addr + 4), true);
		return this.mappedFloatView.getFloat64(0, true);
	}

	public writeU32(addr: number, value: number): void {
		if (this.isVramRange(addr, 4)) {
			this.vramScratch[0] = value & 0xff;
			this.vramScratch[1] = (value >>> 8) & 0xff;
			this.vramScratch[2] = (value >>> 16) & 0xff;
			this.vramScratch[3] = (value >>> 24) & 0xff;
			this.writeVram(addr, this.vramScratch);
			return;
		}
		const offset = this.resolveRamOffset(addr, 4);
		this.ramView.setUint32(offset, value >>> 0, true);
		this.markAssetDirty(addr, 4);
	}

	public writeMappedU16LE(addr: number, value: number): void {
		if (!this.isMappedWritableRange(addr, 2)) {
			throw new Error(`Bus fault @ ${formatNumberAsHex(addr >>> 0, 8)}: write halfword.`);
		}
		this.writeMappedU8(addr, value);
		this.writeMappedU8(addr + 1, value >>> 8);
	}

	public writeMappedU32LE(addr: number, value: number): void {
		if (!this.isMappedWritableRange(addr, 4)) {
			throw new Error(`Bus fault @ ${formatNumberAsHex(addr >>> 0, 8)}: write word.`);
		}
		if (this.isIoAddress(addr)) {
			this.writeValue(addr, value >>> 0);
			return;
		}
		this.writeMappedU8(addr, value);
		this.writeMappedU8(addr + 1, value >>> 8);
		this.writeMappedU8(addr + 2, value >>> 16);
		this.writeMappedU8(addr + 3, value >>> 24);
	}

	public writeMappedF32LE(addr: number, value: number): void {
		this.mappedFloatView.setFloat32(0, value, true);
		this.writeMappedU32LE(addr, this.mappedFloatView.getUint32(0, true));
	}

	public writeMappedF64LE(addr: number, value: number): void {
		if (!this.isMappedWritableRange(addr, 8)) {
			throw new Error(`Bus fault @ ${formatNumberAsHex(addr >>> 0, 8)}: write doubleword.`);
		}
		this.mappedFloatView.setFloat64(0, value, true);
		this.writeMappedU32LE(addr, this.mappedFloatView.getUint32(0, true));
		this.writeMappedU32LE(addr + 4, this.mappedFloatView.getUint32(4, true));
	}

	public readBytes(addr: number, length: number): Uint8Array {
		const { data, offset } = this.resolveReadRegion(addr, length);
		return data.subarray(offset, offset + length);
	}

	public isReadableMainMemoryRange(addr: number, length: number): boolean {
		return this.isRangeWithinRegion(addr, length, SYSTEM_ROM_BASE, this.engineRom.byteLength)
			|| (!!this.cartRom && this.isRangeWithinRegion(addr, length, CART_ROM_BASE, this.cartRom.byteLength))
			|| (!!this.overlayRom && this.isRangeWithinRegion(addr, length, OVERLAY_ROM_BASE, this.overlayRom.byteLength))
			|| this.isRangeWithinRegion(addr, length, RAM_BASE, RAM_USED_END - RAM_BASE);
	}

	public isRamRange(addr: number, length: number): boolean {
		return this.isRangeWithinRegion(addr, length, RAM_BASE, RAM_USED_END - RAM_BASE);
	}

	public writeBytes(addr: number, bytes: Uint8Array): void {
		if (this.isVramRange(addr, bytes.byteLength)) {
			this.writeVram(addr, bytes);
			return;
		}
		const { data, offset } = this.resolveWriteRegion(addr, bytes.byteLength);
		data.set(bytes, offset);
		this.markAssetDirty(addr, bytes.byteLength);
	}

	public writeBytesFrom(src: Uint8Array, srcOffset: number, dstAddr: number, length: number): void {
		const slice = src.subarray(srcOffset, srcOffset + length);
		if (this.isVramRange(dstAddr, length)) {
			this.writeVram(dstAddr, slice);
			return;
		}
		const { data, offset } = this.resolveWriteRegion(dstAddr, length);
		const dst = data.subarray(offset, offset + length);
		dst.set(slice);
		this.markAssetDirty(dstAddr, length);
	}

	private isIoAddress(addr: number): boolean {
		const index = addr - IO_BASE;
		return index >= 0 && index < this.ioSlots.length * IO_WORD_SIZE && (index % IO_WORD_SIZE) === 0;
	}

	private isIoRegionRange(addr: number, length: number): boolean {
		return addr >= IO_BASE && addr + length <= IO_BASE + this.ioSlots.length * IO_WORD_SIZE;
	}

	private ioIndex(addr: number): number {
		const index = addr - IO_BASE;
		if (index < 0 || (index % IO_WORD_SIZE) !== 0) {
			throw new Error(`I/O fault @ ${formatNumberAsHex(addr >>> 0, 8)}: unaligned.`);
		}
		const slot = index / IO_WORD_SIZE;
		if (slot < 0 || slot >= this.ioSlots.length) {
			throw new Error(`I/O fault @ ${formatNumberAsHex(addr >>> 0, 8)}: out of range.`);
		}
		return slot;
	}

	private resolveReadRegion(addr: number, length: number): { data: Uint8Array; offset: number } {
		this.assertReadableRange(addr, length);
		if (addr >= SYSTEM_ROM_BASE && addr + length <= SYSTEM_ROM_BASE + this.engineRom.byteLength) {
			return { data: this.engineRom, offset: addr - SYSTEM_ROM_BASE };
		}
		if (this.cartRom && addr >= CART_ROM_BASE && addr + length <= CART_ROM_BASE + this.cartRom.byteLength) {
			return { data: this.cartRom, offset: addr - CART_ROM_BASE };
		}
		if (this.overlayRom && addr >= OVERLAY_ROM_BASE && addr + length <= OVERLAY_ROM_BASE + this.overlayRom.byteLength) {
			return { data: this.overlayRom, offset: addr - OVERLAY_ROM_BASE };
		}
		const offset = this.resolveRamOffset(addr, length);
		return { data: this.ram, offset };
	}

	private resolveWriteRegion(addr: number, length: number): { data: Uint8Array; offset: number } {
		if (this.overlayRom && addr >= OVERLAY_ROM_BASE && addr + length <= OVERLAY_ROM_BASE + this.overlayRom.byteLength) {
			return { data: this.overlayRom, offset: addr - OVERLAY_ROM_BASE };
		}
		const offset = this.resolveRamOffset(addr, length);
		return { data: this.ram, offset };
	}

	private resolveRamOffset(addr: number, length: number): number {
		if (addr < RAM_BASE || addr + length > RAM_USED_END) {
			throw new Error(`Bus fault @ ${formatNumberAsHex(addr >>> 0, 8)}: RAM range len=${length}.`);
		}
		return addr - RAM_BASE;
	}

	private assertReadableRange(addr: number, length: number): void {
		if (this.isVramRange(addr, length)) {
			throw new Error(`VRAM read fault @ ${formatNumberAsHex(addr >>> 0, 8)}: write-only len=${length}.`);
		}
	}

	private isRangeWithinRegion(addr: number, length: number, base: number, size: number): boolean {
		return addr >= base && addr + length <= base + size;
	}

	private isLuaReadOnlyIoAddress(addr: number): boolean {
		return addr === IO_SYS_CART_BOOTREADY
			|| addr === IO_SYS_HOST_FAULT_FLAGS
			|| addr === IO_SYS_HOST_FAULT_STAGE
			|| addr === IO_IRQ_FLAGS
			|| addr === IO_DMA_STATUS
			|| addr === IO_DMA_WRITTEN
			|| addr === IO_GEO_STATUS
			|| addr === IO_GEO_PROCESSED
			|| addr === IO_GEO_FAULT
			|| addr === IO_IMG_STATUS
			|| addr === IO_IMG_WRITTEN
			|| addr === IO_APU_STATUS
			|| addr === IO_APU_EVENT_KIND
			|| addr === IO_APU_EVENT_SLOT
			|| addr === IO_APU_EVENT_HANDLE
			|| addr === IO_APU_EVENT_SEQ
			|| addr === IO_VDP_RD_STATUS
			|| addr === IO_VDP_RD_DATA
			|| addr === IO_VDP_STATUS;
	}

	private isMappedWritableRange(addr: number, length: number): boolean {
		if (this.isIoRegionRange(addr, length)) {
			return length === IO_WORD_SIZE && this.isIoAddress(addr) && !this.isLuaReadOnlyIoAddress(addr);
		}
		if (this.isRangeWithinRegion(addr, length, SYSTEM_ROM_BASE, this.engineRom.byteLength)) {
			return false;
		}
		if (this.cartRom && this.isRangeWithinRegion(addr, length, CART_ROM_BASE, this.cartRom.byteLength)) {
			return false;
		}
		if (this.overlayRom && this.isRangeWithinRegion(addr, length, OVERLAY_ROM_BASE, this.overlayRom.byteLength)) {
			return false;
		}
		if (this.isVramRange(addr, length)) {
			return true;
		}
		return addr >= RAM_BASE && addr + length <= RAM_USED_END;
	}

	private writeVram(addr: number, bytes: Uint8Array): void {
		this.vramWriter.writeVram(addr, bytes);
	}

	private readVram(addr: number, out: Uint8Array): void {
		this.vramWriter.readVram(addr, out);
	}

	public isVramRange(addr: number, length: number): boolean {
		if (length <= 0) {
			return false;
		}
		const end = addr + length;
		const overlaps = (base: number, size: number): boolean => addr < base + size && end > base;
		return overlaps(VRAM_STAGING_BASE, VRAM_STAGING_SIZE)
			|| overlaps(VRAM_SYSTEM_ATLAS_BASE, VRAM_SYSTEM_ATLAS_SIZE)
			|| overlaps(VRAM_PRIMARY_ATLAS_BASE, VRAM_PRIMARY_ATLAS_SIZE)
			|| overlaps(VRAM_SECONDARY_ATLAS_BASE, VRAM_SECONDARY_ATLAS_SIZE)
			|| overlaps(VRAM_FRAMEBUFFER_BASE, VRAM_FRAMEBUFFER_SIZE);
	}

	private allocateAssetData(size: number, alignment: number): { addr: number; view: Uint8Array } {
		let addr = this.assetDataCursor;
		if (alignment > 1) {
			const mask = alignment - 1;
			addr = (addr + mask) & ~mask;
		}
		const end = addr + size;
		if (end > ASSET_DATA_ALLOC_END) {
			throw new Error(`[Memory] RAM exhausted: ${end} > ${ASSET_DATA_ALLOC_END}.`);
		}
		this.assetDataCursor = end;
		enforceLuaHeapBudget();
		const offset = addr - RAM_BASE;
		return { addr, view: this.ram.subarray(offset, offset + size) };
	}

	private createAssetEntry(entry: AssetEntry): AssetEntry {
		return { ...entry };
	}

	private registerAssetEntry(entry: AssetEntry): number {
		if (this.assetIndexById.has(entry.id)) {
			throw new Error(`[Memory] Asset entry '${entry.id}' is already registered.`);
		}
		const { lo, hi } = hashAssetId(entry.id);
		entry.idTokenLo = lo;
		entry.idTokenHi = hi;
		const key = tokenKey(lo, hi);
		const existing = this.assetIndexByToken.get(key);
		if (existing !== undefined) {
			throw new Error(`[Memory] Asset token collision for '${entry.id}'.`);
		}
		const index = this.assetEntries.length;
		this.assetEntries.push(entry);
		this.ensureAssetDirtyFlagCapacity(this.assetEntries.length);
		this.assetDirtyFlags[index] = 0;
		this.assetIndexById.set(entry.id, index);
		this.assetIndexByToken.set(key, index);
		enforceLuaHeapBudget();
		return index;
	}

	private registerOwnedAssetEntry(entry: AssetEntry, addr: number, size: number): AssetEntry {
		entry.ownerIndex = this.registerAssetEntry(entry);
		this.mapAssetPages(entry.ownerIndex, addr, size);
		return entry;
	}

	private mapOwnedAssetPages(entryCount: number): void {
		for (let index = 0; index < entryCount; index += 1) {
			const entry = this.assetEntries[index];
			if (entry.ownerIndex !== index) {
				continue;
			}
			if (this.isVramRange(entry.baseAddr, entry.capacity)) {
				continue;
			}
			this.mapAssetPages(index, entry.baseAddr, entry.capacity);
		}
	}

	private writeAssetEntryData(index: number, entry: AssetEntry): void {
		const entryAddr = ASSET_TABLE_BASE + ASSET_TABLE_HEADER_SIZE + index * ASSET_TABLE_ENTRY_SIZE;
		const entryOffset = entryAddr - RAM_BASE;
		this.writeAssetEntryMutableData(entryOffset, entry);
	}

	private writeAssetEntryMutableData(entryOffset: number, entry: AssetEntry): void {
		this.ramView.setUint32(entryOffset + 20, entry.baseAddr, true);
		this.ramView.setUint32(entryOffset + 24, entry.baseSize, true);
		this.ramView.setUint32(entryOffset + 28, entry.capacity, true);
		this.writeAssetEntryPayload(entryOffset, entry);
	}

	private writeAssetEntryPayload(entryOffset: number, entry: AssetEntry): void {
		switch (entry.type) {
			case 'image':
				this.ramView.setUint32(entryOffset + 32, entry.baseStride, true);
				this.ramView.setUint32(entryOffset + 36, entry.regionX, true);
				this.ramView.setUint32(entryOffset + 40, entry.regionY, true);
				this.ramView.setUint32(entryOffset + 44, entry.regionW, true);
				this.ramView.setUint32(entryOffset + 48, entry.regionH, true);
				break;
			case 'audio':
				this.ramView.setUint32(entryOffset + 32, entry.sampleRate, true);
				this.ramView.setUint32(entryOffset + 36, entry.channels, true);
				this.ramView.setUint32(entryOffset + 40, entry.frames, true);
				this.ramView.setUint32(entryOffset + 44, entry.bitsPerSample, true);
				this.ramView.setUint32(entryOffset + 48, entry.audioDataOffset, true);
				this.ramView.setUint32(entryOffset + 52, entry.audioDataSize, true);
				break;
			default:
				throw new Error(`[Memory] Asset entry has unknown type: ${entry.type}.`);
		}
	}

	private clearDirtyAssetTracking(): void {
		this.assetDirtyEntries.clear();
		this.assetDirtyDrainEntries.clear();
		this.assetDirtyFlags.fill(0);
	}

	private ensureAssetDirtyFlagCapacity(length: number): void {
		if (this.assetDirtyFlags.length >= length) {
			return;
		}
		const grown = new Uint8Array(Math.max(length, this.assetDirtyFlags.length * 2, 8));
		grown.set(this.assetDirtyFlags);
		this.assetDirtyFlags = grown;
	}

	private markAssetOwnerDirty(ownerIndex: number): void {
		if (this.assetDirtyFlags[ownerIndex] !== 0) {
			return;
		}
		this.assetDirtyFlags[ownerIndex] = 1;
		this.assetDirtyEntries.push(this.assetEntries[ownerIndex]);
	}

	private mapAssetPages(ownerIndex: number, addr: number, size: number): void {
		const startPage = (addr - ASSET_DATA_BASE) >> ASSET_PAGE_SHIFT;
		const endPage = (addr + size - ASSET_DATA_BASE - 1) >> ASSET_PAGE_SHIFT;
		for (let page = startPage; page <= endPage; page += 1) {
			this.assetOwnerPages[page] = ownerIndex;
		}
	}

	private markAssetDirty(addr: number, length: number): void {
		const start = addr < ASSET_DATA_BASE ? ASSET_DATA_BASE : addr;
		let end = addr + length;
		if (end > ASSET_DATA_END) {
			end = ASSET_DATA_END;
		}
		if (start >= end) {
			return;
		}
		let startPage = (start - ASSET_DATA_BASE) >> ASSET_PAGE_SHIFT;
		let endPage = (end - ASSET_DATA_BASE - 1) >> ASSET_PAGE_SHIFT;
		for (let page = startPage; page <= endPage; page += 1) {
			const owner = this.assetOwnerPages[page];
			if (owner >= 0) {
				this.markAssetOwnerDirty(owner);
			}
		}
	}

}
