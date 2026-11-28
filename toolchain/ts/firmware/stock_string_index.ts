import { readLE32 } from '../../../machine/ts/common/endian';
import { hashText } from '../../../machine/ts/common/hash';
import {
	BLUA32_STRING_HASH_OFFSET, BLUA32_STRING_LENGTH_OFFSET, BLUA32_STRING_NEXT_OFFSET,
	BLUA32_STRING_RECORD_ALIGNMENT, BLUA32_STRING_RECORD_HEADER_SIZE, BLUA32_STRING_RECORD_KIND, BLUA32_STRING_RECORD_ROM_FLAG,
	BLUA32_STRING_ROM_SOCKET_SHIFT,
} from '../../../machine/ts/spec/blua32/image_format';
import { CART_ROM_BASE, CART_ROM_SIZE, MAIN_RAM_SIZE } from '../../../machine/ts/spec/bmsx/memory_map';
import type { Memory, MemoryByteView } from '../../../machine/ts/machine/memory/memory';
import { StringPool, type StringId } from '../../../machine/ts/machine/cpu/string_pool';
import { stockHeapManagementOffset } from './stock_heap_layout';

export const STOCK_STRING_METADATA_OFFSET = 0x300;
export const BUCKETS = 0x00, CAPACITY = 0x04, USED = 0x08;
export const FIRST_CART = 0x14, ROM_TABLES = 0x18;
export const REHASH_BASE = 0x38, REHASH_READY = 0x3c;
const RAM_BYTE_MASK = MAIN_RAM_SIZE - 1;
export const MAX_RAM_RECORDS = MAIN_RAM_SIZE / BLUA32_STRING_RECORD_HEADER_SIZE;
export const RAM_BUCKET_EXTENT_MASK = 2 * MAX_RAM_RECORDS - 1;
export const RAM_BUCKET_REHASH = 0x80000000;
export const RAM_BUCKET_SHRINK = 0x40000000;

export function romStringId(address: number, cartridgeSlot: number): number {
	return address >= CART_ROM_BASE ? (address | (cartridgeSlot << BLUA32_STRING_ROM_SOCKET_SHIFT)) >>> 0 : address;
}

type InternSource = string | Uint8Array;

function matchesBytes(candidate: Uint8Array, start: number, mask: number, source: InternSource,
	offset: number, length: number, wrapped: number): boolean {
	let n = 0;
	if (typeof source === 'string') {
		while (n < length && candidate[(start + n) & mask] === source.charCodeAt(n)) ++n;
		return n === length;
	}
	const first = length - wrapped;
	while (n < first && candidate[(start + n) & mask] === source[offset + n]) ++n;
	if (n !== first) return false;
	while (n < length && candidate[(start + n) & mask] === source[n - first]) ++n;
	return n === length;
}

/** Read the stock firmware's canonical String directory without changing guest RAM. */
export class StockStringIndex extends StringPool {
	public readonly metadataOffset: number;
	protected readonly romView: MemoryByteView;

	public constructor(memory: Memory) {
		super(memory);
		this.metadataOffset = stockHeapManagementOffset(memory) + STOCK_STRING_METADATA_OFFSET;
		this.romView = { bytes: memory.systemRomStorage().bytes, byteOffset: 0, byteLength: 0 };
	}

	protected metadata(field: number): number { return this.memory.readRamRecordWord(this.metadataOffset + field); }
	protected bindRomStringHeader(address: number, cartridgeSlot: number): void {
		const view = this.romView;
		if ((address & (BLUA32_STRING_RECORD_ALIGNMENT - 1)) !== 0
			|| !this.memory.bindRomByteView(address, BLUA32_STRING_RECORD_HEADER_SIZE, cartridgeSlot, view)
			|| readLE32(view.bytes, view.byteOffset) !== (BLUA32_STRING_RECORD_KIND | BLUA32_STRING_RECORD_ROM_FLAG)) {
			throw new Error('BLua32 ROM String header is invalid.');
		}
	}

	protected bindRomStringBytes(address: number, cartridgeSlot: number, length: number): void {
		const view = this.romView;
		if (length > CART_ROM_SIZE - BLUA32_STRING_RECORD_HEADER_SIZE
			|| (length !== 0 && !this.memory.bindRomByteView(address, BLUA32_STRING_RECORD_HEADER_SIZE + length, cartridgeSlot, view))) {
			throw new Error('BLua32 ROM String is truncated.');
		}
		view.byteOffset += BLUA32_STRING_RECORD_HEADER_SIZE;
		view.byteLength = length;
	}

	private lookupRamChain(bucket: number, hash: number, source: InternSource, offset: number, length: number, wrapped: number): number {
		const memory = this.memory;
		const ram = memory.ramData();
		let record = memory.readRamRecordWord(bucket);
		if (record === 0) return 0;
		let remaining = Math.min(this.metadata(USED), MAX_RAM_RECORDS);
		while (record !== 0 && remaining-- !== 0) {
			if (memory.readRamRecordWord(record + BLUA32_STRING_HASH_OFFSET) === hash
				&& (memory.readRamRecordWord(record + BLUA32_STRING_LENGTH_OFFSET) & RAM_BYTE_MASK) === length) {
				const start = (record + BLUA32_STRING_RECORD_HEADER_SIZE) & RAM_BYTE_MASK;
				const mask = length > MAIN_RAM_SIZE - start ? RAM_BYTE_MASK : -1;
				if (matchesBytes(ram, start, mask, source, offset, length, wrapped)) return record;
			}
			record = memory.readRamRecordWord(record + BLUA32_STRING_NEXT_OFFSET);
		}
		return 0;
	}

	private lookupRam(hash: number, source: InternSource, offset: number, length: number, wrapped: number): number {
		const control = this.metadata(CAPACITY), count = control & RAM_BUCKET_EXTENT_MASK;
		if (count === 0) return 0;
		const index = hash & (count - 1);
		if ((control & (RAM_BUCKET_REHASH | RAM_BUCKET_SHRINK)) !== 0) {
			const ready = this.metadata(REHASH_READY);
			if ((control & RAM_BUCKET_REHASH) !== 0) {
				if (index < ready) {
					const bucket = this.metadata(REHASH_BASE) + 4 * (hash & (2 * count - 1));
					const found = this.lookupRamChain(bucket, hash, source, offset, length, wrapped);
					if (found !== 0) return found;
					if (index + 1 < ready) return 0;
				}
			} else {
				const lower = index - (count >>> 1);
				if (lower >= 0 && lower <= ready) {
					const base = this.metadata(BUCKETS);
					const found = this.lookupRamChain(base + 4 * lower, hash, source, offset, length, wrapped);
					if (found !== 0 || lower < ready) return found;
					return this.lookupRamChain(base + 4 * index, hash, source, offset, length, wrapped);
				}
			}
		}
		return this.lookupRamChain(this.metadata(BUCKETS) + 4 * index, hash, source, offset, length, wrapped);
	}

	private lookupRom(directory: number, hash: number, source: InternSource, offset: number, length: number, wrapped: number): number {
		const table = ROM_TABLES + 8 * directory;
		const count = this.metadata(table + 4);
		if (count === 0) return 0;
		let record = this.readWord(this.metadata(table), (hash & (count - 1)) * 4);
		if (record === 0) return 0;
		// Every absolute cartridge reference uses the directory owner's socket.
		const cartridgeSlot = directory === 2 ? 1 : 0;
		const cart = this.memory.cartridgeController.romStorage(cartridgeSlot);
		const available = this.memory.systemRomStorage().bytes.length + (cart === null ? 0 : cart.bytes.length);
		let remaining = (available / BLUA32_STRING_RECORD_HEADER_SIZE) >>> 0;
		while (record !== 0) {
			if (remaining-- === 0) throw new Error('BLua32 ROM String chain is invalid.');
			this.bindRomStringHeader(record, cartridgeSlot);
			const { bytes, byteOffset } = this.romView;
			if (readLE32(bytes, byteOffset + BLUA32_STRING_HASH_OFFSET) === hash
				&& readLE32(bytes, byteOffset + BLUA32_STRING_LENGTH_OFFSET) === length) {
				this.bindRomStringBytes(record, cartridgeSlot, length);
				if (matchesBytes(this.romView.bytes, this.romView.byteOffset, -1, source, offset, length, wrapped)) {
					return romStringId(record, cartridgeSlot);
				}
			}
			record = readLE32(bytes, byteOffset + BLUA32_STRING_NEXT_OFFSET);
		}
		return 0;
	}

	protected lookup(hash: number, source: InternSource, offset: number, length: number, wrapped = 0): number {
		let match = this.lookupRam(hash, source, offset, length, wrapped);
		if (match !== 0) return match;
		match = this.lookupRom(0, hash, source, offset, length, wrapped);
		if (match !== 0) return match;
		const first = this.metadata(FIRST_CART);
		if (first === 0) return 0;
		match = this.lookupRom(first, hash, source, offset, length, wrapped);
		if (match !== 0) return match;
		return this.lookupRom(3 - first, hash, source, offset, length, wrapped);
	}

	public find(value: string): StringId | undefined {
		const id = this.lookup(hashText(value), value, 0, value.length);
		return id === 0 ? undefined : id;
	}
}
