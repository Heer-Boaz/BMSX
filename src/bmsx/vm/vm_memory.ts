import type { Value } from './cpu';
import {
	ASSET_DATA_BASE,
	ASSET_DATA_END,
	ASSET_RAM_BASE,
	ASSET_RAM_SIZE,
	ASSET_TABLE_BASE,
	ASSET_TABLE_SIZE,
	CART_ROM_BASE,
	ENGINE_ROM_BASE,
	IO_BASE,
	IO_WORD_SIZE,
	OVERLAY_ROM_BASE,
	RAM_BASE,
	RAM_USED_END,
} from './memory_map';
import { VM_IO_SLOT_COUNT } from './vm_io';

export type VmAssetType = 'image' | 'audio';

export type VmAssetEntry = {
	id: string;
	idTokenLo: number;
	idTokenHi: number;
	type: VmAssetType;
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

export type VmMemoryInit = {
	engineRom: Uint8Array;
	cartRom?: Uint8Array | null;
	overlayRom?: Uint8Array | null;
};

const ASSET_TABLE_MAGIC = 0x32534d41; // 'AMS2'
const ASSET_TABLE_HEADER_SIZE = 40;
const ASSET_TABLE_ENTRY_SIZE = 64;
// 1 = FNV-1a 64 over canonical UTF-8 (lowercase, slash-normalized, collapse "//", trim leading "./").
const ASSET_TABLE_HASH_ALG_ID = 1;
const ASSET_PAGE_SHIFT = 12;
const ASSET_PAGE_SIZE = 1 << ASSET_PAGE_SHIFT;

const ASSET_TYPE_IMAGE = 1;
const ASSET_TYPE_AUDIO = 2;

export const ASSET_FLAG_VIEW = 1 << 1;

const HASH_SELF_TEST_VECTORS = [
	{ id: '', lo: 0x84222325, hi: 0xcbf29ce4 },
	{ id: 'a', lo: 0x8601ec8c, hi: 0xaf63dc4c },
	{ id: './Foo\\Bar', lo: 0xef2def0d, hi: 0x571d17d6 },
];

let hashSelfTested = false;

export class VmMemory {
	private readonly engineRom: Uint8Array;
	private readonly cartRom: Uint8Array | null;
	private readonly overlayRom: Uint8Array | null;
	private readonly ram: Uint8Array;
	private readonly ramView: DataView;
	private readonly ioSlots: Value[];

	private assetEntries: VmAssetEntry[] = [];
	private assetIndexById = new Map<string, number>();
	private assetIndexByToken = new Map<string, number>();
	private assetOwnerPages: Int32Array;
	private assetDirtyOwners = new Set<number>();
	private assetDataCursor = ASSET_DATA_BASE;
	private assetTableFinalized = false;
	private engineAssetEntryCount = 0;
	private engineAssetDataEnd = ASSET_DATA_BASE;
	private cartAssetDataBase = ASSET_DATA_BASE;
	private readonly assetIdEncoder = new TextEncoder();

	public constructor(init: VmMemoryInit) {
		this.engineRom = init.engineRom;
		this.cartRom = init.cartRom ?? null;
		this.overlayRom = init.overlayRom ?? null;
		this.ram = new Uint8Array(RAM_USED_END - RAM_BASE);
		this.ramView = new DataView(this.ram.buffer, this.ram.byteOffset, this.ram.byteLength);
		this.ioSlots = new Array<Value>(VM_IO_SLOT_COUNT);
		for (let index = 0; index < this.ioSlots.length; index += 1) {
			this.ioSlots[index] = null;
		}
		const pageCount = Math.ceil((ASSET_DATA_END - ASSET_DATA_BASE) / ASSET_PAGE_SIZE);
		this.assetOwnerPages = new Int32Array(pageCount);
		this.resetAssetMemory();
	}

	public getIoSlotCount(): number {
		return this.ioSlots.length;
	}

	public resetAssetMemory(): void {
		this.assetEntries = [];
		this.assetIndexById.clear();
		this.assetIndexByToken.clear();
		this.assetDirtyOwners.clear();
		this.assetTableFinalized = false;
		this.engineAssetEntryCount = 0;
		this.engineAssetDataEnd = ASSET_DATA_BASE;
		this.cartAssetDataBase = ASSET_DATA_BASE;
		this.assetOwnerPages.fill(-1);
		this.assetDataCursor = ASSET_DATA_BASE;
		const assetOffset = ASSET_RAM_BASE - RAM_BASE;
		this.ram.fill(0, assetOffset, assetOffset + ASSET_RAM_SIZE);
	}

	public hasAsset(id: string): boolean {
		if (this.assetIndexById.has(id)) {
			return true;
		}
		const { lo, hi } = this.hashAssetId(id);
		return this.assetIndexByToken.has(this.tokenKey(lo, hi));
	}

	public sealEngineAssets(): void {
		this.engineAssetEntryCount = this.assetEntries.length;
		this.engineAssetDataEnd = this.assetDataCursor;
		const mask = ASSET_PAGE_SIZE - 1;
		const aligned = (this.engineAssetDataEnd + mask) & ~mask;
		if (aligned > ASSET_DATA_END) {
			throw new Error(`[VmMemory] Engine asset data exceeds asset RAM (${aligned} > ${ASSET_DATA_END}).`);
		}
		this.cartAssetDataBase = aligned;
	}

	public resetCartAssets(): void {
		this.assetEntries.length = this.engineAssetEntryCount;
		this.assetIndexById.clear();
		this.assetIndexByToken.clear();
		this.assetDirtyOwners.clear();
		this.assetTableFinalized = false;
		this.assetOwnerPages.fill(-1);
		for (let index = 0; index < this.assetEntries.length; index += 1) {
			const entry = this.assetEntries[index];
			this.assetIndexById.set(entry.id, index);
			this.assetIndexByToken.set(this.tokenKey(entry.idTokenLo, entry.idTokenHi), index);
		}
		for (let index = 0; index < this.assetEntries.length; index += 1) {
			const entry = this.assetEntries[index];
			if (entry.ownerIndex !== index) {
				continue;
			}
			this.mapAssetPages(index, entry.baseAddr, entry.capacity);
		}
		this.assetDataCursor = this.cartAssetDataBase;
		const cartOffset = this.cartAssetDataBase - RAM_BASE;
		const cartEnd = ASSET_DATA_END - RAM_BASE;
		this.ram.fill(0, cartOffset, cartEnd);
	}

	public registerImageSlot(params: {
		id: string;
		capacityBytes: number;
		flags?: number;
	}): VmAssetEntry {
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
		entry.ownerIndex = this.registerAssetEntry(entry);
		this.mapAssetPages(entry.ownerIndex, addr, params.capacityBytes);
		return entry;
	}

	public registerImageBuffer(params: {
		id: string;
		width: number;
		height: number;
		pixels: Uint8Array;
		flags?: number;
	}): VmAssetEntry {
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
		entry.ownerIndex = this.registerAssetEntry(entry);
		this.mapAssetPages(entry.ownerIndex, addr, size);
		return entry;
	}

	public registerImageView(params: {
		id: string;
		baseEntry: VmAssetEntry;
		regionX: number;
		regionY: number;
		regionW: number;
		regionH: number;
		flags?: number;
	}): VmAssetEntry {
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
	}): VmAssetEntry {
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
		entry.ownerIndex = this.registerAssetEntry(entry);
		this.mapAssetPages(entry.ownerIndex, addr, params.bytes.byteLength);
		return entry;
	}

	public getAssetEntry(id: string): VmAssetEntry {
		return this.getAssetEntryByHandle(this.resolveAssetHandle(id));
	}

	public getAssetEntryByHandle(handle: number): VmAssetEntry {
		if (handle < 0 || handle >= this.assetEntries.length) {
			throw new Error(`[VmMemory] Asset handle out of range: ${handle}.`);
		}
		return this.assetEntries[handle];
	}

	public resolveAssetHandle(id: string): number {
		const direct = this.assetIndexById.get(id);
		if (direct !== undefined) {
			return direct;
		}
		const { lo, hi } = this.hashAssetId(id);
		const key = this.tokenKey(lo, hi);
		const handle = this.assetIndexByToken.get(key);
		if (handle === undefined) {
			throw new Error(`[VmMemory] Asset '${id}' not registered in VM memory.`);
		}
		return handle;
	}

	public getImagePixels(entry: VmAssetEntry): Uint8Array {
		if (entry.flags & ASSET_FLAG_VIEW) {
			throw new Error(`[VmMemory] Asset '${entry.id}' is a view and has no direct pixel buffer.`);
		}
		const offset = entry.baseAddr - RAM_BASE;
		const size = entry.regionW * entry.regionH * 4;
		return this.ram.subarray(offset, offset + size);
	}

	public getAudioBytes(entry: VmAssetEntry): Uint8Array {
		const offset = entry.baseAddr - RAM_BASE;
		return this.ram.subarray(offset, offset + entry.baseSize);
	}

	public consumeDirtyAssets(): VmAssetEntry[] {
		if (this.assetDirtyOwners.size === 0) {
			return [];
		}
		const entries: VmAssetEntry[] = [];
		for (const ownerIndex of this.assetDirtyOwners) {
			entries.push(this.assetEntries[ownerIndex]);
		}
		this.assetDirtyOwners.clear();
		return entries;
	}

	public markAllAssetsDirty(): void {
		for (let index = 0; index < this.assetEntries.length; index += 1) {
			const entry = this.assetEntries[index];
			if (entry.ownerIndex === index) {
				this.assetDirtyOwners.add(index);
			}
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
			throw new Error(`[VmMemory] Asset table overflow: entries=${entryCount} strings=${stringTableLength}.`);
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
					throw new Error(`[VmMemory] Asset entry has unknown type: ${entry.type}.`);
			}
			const idOffset = stringTableAddr + stringOffsets.get(entry.id);
			this.ramView.setUint32(entryOffset + 0, typeId, true);
			this.ramView.setUint32(entryOffset + 4, entry.flags, true);
			this.ramView.setUint32(entryOffset + 8, entry.idTokenLo, true);
			this.ramView.setUint32(entryOffset + 12, entry.idTokenHi, true);
			this.ramView.setUint32(entryOffset + 16, idOffset, true);
			this.ramView.setUint32(entryOffset + 20, entry.baseAddr, true);
			this.ramView.setUint32(entryOffset + 24, entry.baseSize, true);
			this.ramView.setUint32(entryOffset + 28, entry.capacity, true);
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
					throw new Error(`[VmMemory] Asset entry has unknown type: ${entry.type}.`);
			}
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
	}

	public writeImageSlot(entry: VmAssetEntry, params: { pixels: Uint8Array; width: number; height: number }): void {
		const index = this.assetIndexById.get(entry.id)!;
		const capacity = entry.capacity;
		const stride = params.width * 4;
		const size = stride * params.height;
		const offset = entry.baseAddr - RAM_BASE;
		const maxWritable = ASSET_DATA_END - entry.baseAddr;
		const writeLen = Math.min(params.pixels.byteLength, maxWritable);
		if (writeLen > 0) {
			this.ram.set(params.pixels.subarray(0, writeLen), offset);
		}
		entry.baseSize = Math.min(size, capacity);
		entry.baseStride = stride;
		entry.regionX = 0;
		entry.regionY = 0;
		entry.regionW = params.width;
		entry.regionH = params.height;
		if (this.assetTableFinalized) {
			this.writeAssetEntryData(index, entry);
		}
		if (writeLen > 0) {
			this.markAssetDirty(entry.baseAddr, writeLen);
		}
	}

	public updateImageViewBase(entry: VmAssetEntry, baseEntry: VmAssetEntry): void {
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
			throw new Error(`[VmMemory] Asset RAM snapshot length mismatch (${snapshot.byteLength} != ${ASSET_RAM_SIZE}).`);
		}
		this.ram.set(snapshot, offset);
		this.markAllAssetsDirty();
	}

	public rehydrateAssetEntriesFromTable(): void {
		const headerOffset = ASSET_TABLE_BASE - RAM_BASE;
		const magic = this.ramView.getUint32(headerOffset + 0, true);
		if (magic !== ASSET_TABLE_MAGIC) {
			throw new Error(`[VmMemory] Asset table magic mismatch (${magic} != ${ASSET_TABLE_MAGIC}).`);
		}
		const headerSize = this.ramView.getUint32(headerOffset + 4, true);
		if (headerSize !== ASSET_TABLE_HEADER_SIZE) {
			throw new Error(`[VmMemory] Asset table header size mismatch (${headerSize} != ${ASSET_TABLE_HEADER_SIZE}).`);
		}
		const entrySize = this.ramView.getUint32(headerOffset + 8, true);
		if (entrySize !== ASSET_TABLE_ENTRY_SIZE) {
			throw new Error(`[VmMemory] Asset table entry size mismatch (${entrySize} != ${ASSET_TABLE_ENTRY_SIZE}).`);
		}
		const entryCount = this.ramView.getUint32(headerOffset + 12, true);
		const stringTableAddr = this.ramView.getUint32(headerOffset + 16, true);
		const stringTableLength = this.ramView.getUint32(headerOffset + 20, true);
		const dataBase = this.ramView.getUint32(headerOffset + 24, true);
		const dataLength = this.ramView.getUint32(headerOffset + 28, true);
		const hashAlgId = this.ramView.getUint32(headerOffset + 32, true);
		if (dataBase !== ASSET_DATA_BASE) {
			throw new Error(`[VmMemory] Asset table data base mismatch (${dataBase} != ${ASSET_DATA_BASE}).`);
		}
		if (hashAlgId !== ASSET_TABLE_HASH_ALG_ID) {
			throw new Error(`[VmMemory] Asset table hash algorithm mismatch (${hashAlgId} != ${ASSET_TABLE_HASH_ALG_ID}).`);
		}

		const stringTableOffset = stringTableAddr - RAM_BASE;
		const stringTableEnd = stringTableOffset + stringTableLength;
		const decoder = new TextDecoder();
		const readString = (addr: number): string => {
			const offset = addr - RAM_BASE;
			if (offset < stringTableOffset || offset >= stringTableEnd) {
				throw new Error(`[VmMemory] Asset string pointer out of range (${addr}).`);
			}
			let cursor = offset;
			while (cursor < stringTableEnd && this.ram[cursor] !== 0) {
				cursor += 1;
			}
			if (cursor >= stringTableEnd) {
				throw new Error(`[VmMemory] Asset string at ${addr} missing terminator.`);
			}
			return decoder.decode(this.ram.subarray(offset, cursor));
		};

		const entryBaseAddr = ASSET_TABLE_BASE + ASSET_TABLE_HEADER_SIZE;
		const reuseEntries = this.assetEntries.length === entryCount;
		const entries = reuseEntries ? this.assetEntries : new Array<VmAssetEntry>(entryCount);
		this.assetIndexById.clear();
		this.assetIndexByToken.clear();
		this.assetDirtyOwners.clear();
		for (let index = 0; index < entryCount; index += 1) {
			const entryOffset = entryBaseAddr + index * ASSET_TABLE_ENTRY_SIZE - RAM_BASE;
			const typeId = this.ramView.getUint32(entryOffset + 0, true);
			const flags = this.ramView.getUint32(entryOffset + 4, true);
			const tokenLo = this.ramView.getUint32(entryOffset + 8, true);
			const tokenHi = this.ramView.getUint32(entryOffset + 12, true);
			const idAddr = this.ramView.getUint32(entryOffset + 16, true);
			const id = readString(idAddr);
			let type: VmAssetType;
			if (typeId === ASSET_TYPE_IMAGE) {
				type = 'image';
			} else if (typeId === ASSET_TYPE_AUDIO) {
				type = 'audio';
			} else {
				throw new Error(`[VmMemory] Asset '${id}' has unknown type id ${typeId}.`);
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
			const expectedToken = this.hashAssetId(id);
			if (expectedToken.lo !== tokenLo || expectedToken.hi !== tokenHi) {
				throw new Error(`[VmMemory] Asset token mismatch for '${id}'.`);
			}
			const tokenKey = this.tokenKey(tokenLo, tokenHi);
			if (this.assetIndexById.has(id)) {
				throw new Error(`[VmMemory] Duplicate asset id '${id}' in asset table.`);
			}
			if (this.assetIndexByToken.has(tokenKey)) {
				throw new Error(`[VmMemory] Duplicate asset token for '${id}' in asset table.`);
			}
			entries[index] = entry;
			this.assetIndexById.set(id, index);
			this.assetIndexByToken.set(tokenKey, index);
		}
		this.assetEntries = entries;

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
					throw new Error(`[VmMemory] Missing owner for asset view '${entry.id}'.`);
				}
				entry.ownerIndex = ownerIndex;
			}
		}

		this.assetOwnerPages.fill(-1);
		for (let index = 0; index < entryCount; index += 1) {
			const entry = this.assetEntries[index];
			if (entry.ownerIndex !== index) {
				continue;
			}
			this.mapAssetPages(index, entry.baseAddr, entry.capacity);
		}
		this.assetDataCursor = dataBase + dataLength;
		this.assetTableFinalized = true;
	}

	public readValue(addr: number): Value {
		if (this.isIoAddress(addr)) {
			return this.ioSlots[this.ioIndex(addr)];
		}
		if (addr < RAM_BASE) {
			return this.readU32FromRegion(addr);
		}
		return this.readU32(addr);
	}

	public writeValue(addr: number, value: Value): void {
		if (this.isIoAddress(addr)) {
			this.ioSlots[this.ioIndex(addr)] = value;
			return;
		}
		if (typeof value !== 'number') {
			throw new Error(`[VmMemory] STORE_MEM expects a number outside IO space. Got ${typeof value}.`);
		}
		this.writeU32(addr, value);
	}

	public readU8(addr: number): number {
		const { data, offset } = this.resolveReadRegion(addr, 1);
		return data[offset];
	}

	public writeU8(addr: number, value: number): void {
		const { data, offset } = this.resolveWriteRegion(addr, 1);
		data[offset] = value & 0xff;
		this.markAssetDirty(addr, 1);
	}

	public readU32(addr: number): number {
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

	public writeU32(addr: number, value: number): void {
		const offset = this.resolveRamOffset(addr, 4);
		this.ramView.setUint32(offset, value >>> 0, true);
		this.markAssetDirty(addr, 4);
	}

	public readBytes(addr: number, length: number): Uint8Array {
		const { data, offset } = this.resolveReadRegion(addr, length);
		return data.subarray(offset, offset + length);
	}

	public writeBytes(addr: number, bytes: Uint8Array): void {
		const { data, offset } = this.resolveWriteRegion(addr, bytes.byteLength);
		data.set(bytes, offset);
		this.markAssetDirty(addr, bytes.byteLength);
	}

	private isIoAddress(addr: number): boolean {
		const index = addr - IO_BASE;
		return index >= 0 && index < this.ioSlots.length * IO_WORD_SIZE && (index % IO_WORD_SIZE) === 0;
	}

	private ioIndex(addr: number): number {
		const index = addr - IO_BASE;
		if (index < 0 || (index % IO_WORD_SIZE) !== 0) {
			throw new Error(`[VmMemory] Unaligned IO address: ${addr}.`);
		}
		const slot = index / IO_WORD_SIZE;
		if (slot < 0 || slot >= this.ioSlots.length) {
			throw new Error(`[VmMemory] IO address out of range: ${addr}.`);
		}
		return slot;
	}

	private resolveReadRegion(addr: number, length: number): { data: Uint8Array; offset: number } {
		if (addr >= ENGINE_ROM_BASE && addr + length <= ENGINE_ROM_BASE + this.engineRom.byteLength) {
			return { data: this.engineRom, offset: addr - ENGINE_ROM_BASE };
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
			throw new Error(`[VmMemory] Address out of RAM bounds: ${addr} (len=${length}).`);
		}
		return addr - RAM_BASE;
	}

	private allocateAssetData(size: number, alignment: number): { addr: number; view: Uint8Array } {
		let addr = this.assetDataCursor;
		if (alignment > 1) {
			const mask = alignment - 1;
			addr = (addr + mask) & ~mask;
		}
		const end = addr + size;
		if (end > ASSET_DATA_END) {
			throw new Error(`[VmMemory] Asset RAM exhausted: ${end} > ${ASSET_DATA_END}.`);
		}
		this.assetDataCursor = end;
		const offset = addr - RAM_BASE;
		return { addr, view: this.ram.subarray(offset, offset + size) };
	}

	private createAssetEntry(entry: VmAssetEntry): VmAssetEntry {
		return { ...entry };
	}

	private canonicalizeAssetId(id: string): string {
		const normalized = id.replace(/\\/g, '/');
		const start = normalized.startsWith('./') ? 2 : 0;
		let prevSlash = false;
		let out = '';
		for (let i = start; i < normalized.length; i += 1) {
			let ch = normalized[i];
			if (ch === '/') {
				if (prevSlash) {
					continue;
				}
				prevSlash = true;
				out += '/';
				continue;
			}
			prevSlash = false;
			const code = ch.charCodeAt(0);
			if (code >= 65 && code <= 90) {
				ch = String.fromCharCode(code + 32);
			}
			out += ch;
		}
		return out;
	}

	private ensureHashSelfTest(): void {
		if (hashSelfTested) {
			return;
		}
		for (let index = 0; index < HASH_SELF_TEST_VECTORS.length; index += 1) {
			const vector = HASH_SELF_TEST_VECTORS[index];
			const actual = this.hashAssetIdInternal(vector.id);
			if (actual.lo !== vector.lo || actual.hi !== vector.hi) {
				throw new Error(
					`[VmMemory] Asset hash self-test failed for '${vector.id}' (${this.tokenKey(actual.lo, actual.hi)}).`
				);
			}
		}
		hashSelfTested = true;
	}

	private hashAssetId(id: string): { lo: number; hi: number } {
		this.ensureHashSelfTest();
		return this.hashAssetIdInternal(id);
	}

	private hashAssetIdInternal(id: string): { lo: number; hi: number } {
		const canonical = this.canonicalizeAssetId(id);
		const bytes = this.assetIdEncoder.encode(canonical);
		let lo = 0x84222325;
		let hi = 0xcbf29ce4;
		for (let i = 0; i < bytes.length; i += 1) {
			lo = (lo ^ bytes[i]) >>> 0;
			const loMul = lo * 0x1b3;
			const loLow = loMul >>> 0;
			const carry = (loMul / 0x100000000) >>> 0;
			const hiMul = hi * 0x1b3 + carry;
			let hiLow = hiMul >>> 0;
			hiLow = (hiLow + ((lo << 8) >>> 0)) >>> 0;
			lo = loLow;
			hi = hiLow;
		}
		return { lo, hi };
	}

	private tokenKey(lo: number, hi: number): string {
		return `${hi.toString(16).padStart(8, '0')}${lo.toString(16).padStart(8, '0')}`;
	}

	private registerAssetEntry(entry: VmAssetEntry): number {
		if (this.assetIndexById.has(entry.id)) {
			throw new Error(`[VmMemory] Asset entry '${entry.id}' is already registered.`);
		}
		const { lo, hi } = this.hashAssetId(entry.id);
		entry.idTokenLo = lo;
		entry.idTokenHi = hi;
		const key = this.tokenKey(lo, hi);
		const existing = this.assetIndexByToken.get(key);
		if (existing !== undefined) {
			throw new Error(`[VmMemory] Asset token collision for '${entry.id}'.`);
		}
		const index = this.assetEntries.length;
		this.assetEntries.push(entry);
		this.assetIndexById.set(entry.id, index);
		this.assetIndexByToken.set(key, index);
		return index;
	}

	private writeAssetEntryData(index: number, entry: VmAssetEntry): void {
		const entryAddr = ASSET_TABLE_BASE + ASSET_TABLE_HEADER_SIZE + index * ASSET_TABLE_ENTRY_SIZE;
		const entryOffset = entryAddr - RAM_BASE;
		this.ramView.setUint32(entryOffset + 20, entry.baseAddr, true);
		this.ramView.setUint32(entryOffset + 24, entry.baseSize, true);
		this.ramView.setUint32(entryOffset + 28, entry.capacity, true);
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
				throw new Error(`[VmMemory] Asset entry has unknown type: ${entry.type}.`);
		}
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
				this.assetDirtyOwners.add(owner);
			}
		}
	}
}
