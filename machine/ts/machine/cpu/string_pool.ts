import { byteStringFromBytes, byteStringToText } from '../../common/byte_string';
import { readLE32 } from '../../common/endian';
import { hashText } from '../../common/hash';
import {
	BLUA32_STRING_HASH_OFFSET, BLUA32_STRING_LENGTH_OFFSET, BLUA32_STRING_NEXT_OFFSET,
	BLUA32_STRING_RECORD_ALIGNMENT, BLUA32_STRING_RECORD_HEADER_SIZE,
	BLUA32_STRING_RECORD_KIND, BLUA32_STRING_RECORD_ROM_FLAG,
	BLUA32_STRING_ROM_ADDRESS_MASK, BLUA32_STRING_ROM_SOCKET_SHIFT,
} from '../../spec/blua32/image_format';
import { CART_ROM_BASE, CART_ROM_SIZE, MAIN_RAM_SIZE, RAM_BASE } from '../../spec/bmsx/memory_map';
import type { Memory, MemoryByteView } from '../memory/memory';
import { HEAP_STRING_METADATA_OFFSET, type HeapAllocator } from './heap_allocator';

export type StringId = number;
export const STRING_GC_EPOCH_MASK = 1;

const BUCKETS = 0x00, CAPACITY = 0x04, USED = 0x08;
const FIRST_CART = 0x14, ROM_TABLES = 0x18;
const REHASH_BASE = 0x38, REHASH_READY = 0x3c;
const RAM_BYTE_MASK = MAIN_RAM_SIZE - 1;
const MAX_RAM_RECORDS = MAIN_RAM_SIZE / BLUA32_STRING_RECORD_HEADER_SIZE;
const RAM_BUCKET_EXTENT_MASK = 2 * MAX_RAM_RECORDS - 1;
const RAM_BUCKET_REHASH = 0x80000000;
const RAM_BUCKET_SHRINK = 0x40000000;
export function isRamStringId(address: StringId): boolean { return address >= RAM_BASE && address < CART_ROM_BASE; }
function storageOffset(address: number): number {
	if (address < RAM_BASE) return address;
	if (address < CART_ROM_BASE) return address & (MAIN_RAM_SIZE - 1);
	return (address & BLUA32_STRING_ROM_ADDRESS_MASK) - CART_ROM_BASE;
}
function romStringId(address: number, cartridgeSlot: number): number {
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

// String records and immutable directory data live in the guest address space.
export class StringPool {
	public readonly metadataOffset: number;
	protected readonly romView: MemoryByteView;

	public constructor(protected readonly memory: Memory, arena: HeapAllocator) {
		const management = arena.managementOffset();
		this.metadataOffset = management + HEAP_STRING_METADATA_OFFSET;

		this.romView = { bytes: memory.systemRomStorage().bytes, byteOffset: 0, byteLength: 0 };
	}

	protected metadata(field: number): number { return this.memory.readRamRecordWord(this.metadataOffset + field); }
	private storage(address: number): Uint8Array {
		if (address < RAM_BASE) return this.memory.systemRomStorage().bytes;
		if (address < CART_ROM_BASE) return this.memory.ramData();
		return this.memory.cartridgeController.romStorage(address >>> BLUA32_STRING_ROM_SOCKET_SHIFT)!.bytes;
	}
	private readWord(base: number, displacement = 0): number {
		if (isRamStringId(base)) return this.memory.readRamRecordWord(base + displacement);
		return readLE32(this.storage(base), storageOffset(base) + displacement);
	}

	public byteLength(id: StringId): number {
		const count = this.readWord(id, BLUA32_STRING_LENGTH_OFFSET);
		return isRamStringId(id) ? count & RAM_BYTE_MASK : count | 0;
	}
	public byteAt(id: StringId, index: number): number {
		if (isRamStringId(id)) return this.memory.readRamRecordByte(id + BLUA32_STRING_RECORD_HEADER_SIZE + index);
		return this.storage(id)[storageOffset(id) + BLUA32_STRING_RECORD_HEADER_SIZE + index];
	}

	public bytes(id: StringId, length = this.byteLength(id) >>> 0): string {
		if (length === 0) return '';
		if (isRamStringId(id)) {
			const source = this.memory.ramData(), offset = (id + BLUA32_STRING_RECORD_HEADER_SIZE) & RAM_BYTE_MASK;
			const first = Math.min(length, MAIN_RAM_SIZE - offset);
			const prefix = byteStringFromBytes(source, offset, first);
			return first === length ? prefix : prefix + byteStringFromBytes(source, 0, length - first);
		}
		return byteStringFromBytes(this.storage(id), storageOffset(id) + BLUA32_STRING_RECORD_HEADER_SIZE, length);
	}
	public toString(id: StringId): string { return byteStringToText(this.bytes(id)); }

	public compareBytes(left: StringId, right: StringId, offset: number, count: number): number {
		if (left === right) return 0;
		const a = this.storage(left), b = this.storage(right);
		const aMask = isRamStringId(left) ? RAM_BYTE_MASK : -1, bMask = isRamStringId(right) ? RAM_BYTE_MASK : -1;
		let ai = (storageOffset(left) + BLUA32_STRING_RECORD_HEADER_SIZE + offset) & aMask;
		let bi = (storageOffset(right) + BLUA32_STRING_RECORD_HEADER_SIZE + offset) & bMask;
		while (count !== 0) {
			const n = Math.min(count, (aMask >>> 0) + 1 - ai, (bMask >>> 0) + 1 - bi);
			for (let i = 0; i < n; ++i) {
				const delta = a[ai + i] - b[bi + i];
				if (delta !== 0) return delta;
			}
			count -= n;
			ai = (ai + n) & aMask;
			bi = (bi + n) & bMask;
		}
		return 0;
	}

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
