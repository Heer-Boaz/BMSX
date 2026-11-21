import { byteStringFromBytes, byteStringToText, writeByteString } from '../../common/byte_string';
import { readLE32 } from '../../common/endian';
import { hashText } from '../../common/hash';
import type { ExecutionDomainId } from '../../spec/blua32/execution_domain';
import {
	BLUA32_STRING_HASH_OFFSET, BLUA32_STRING_LENGTH_OFFSET, BLUA32_STRING_NEXT_OFFSET,
	BLUA32_STRING_RECORD_ALIGNMENT, BLUA32_STRING_RECORD_HEADER_SIZE,
	BLUA32_STRING_RECORD_KIND, BLUA32_STRING_RECORD_ROM_FLAG,
} from '../../spec/blua32/image_format';
import { CART_ROM_BASE, CART_ROM_SIZE, MAIN_RAM_SIZE, RAM_BASE, SYSTEM_ROM_SIZE } from '../../spec/bmsx/memory_map';
import type { Memory, MemoryByteView } from '../memory/memory';
import { HEAP_STRING_METADATA_OFFSET, type HeapAllocator } from './heap_allocator';
import type { LuaHeap } from './lua_heap';

export type StringId = number;
export const STRING_GC_OLD = 0x80;
export const STRING_GC_MINOR_MARK = 0x40;
export const STRING_GC_EPOCH_MASK = 1;

const BUCKETS = 0x00, CAPACITY = 0x04, USED = 0x08, EPOCH = 0x0c, SWEEP = 0x10;
const FIRST_CART = 0x14, ROM_TABLES = 0x18;
const SWEEP_LINK = 0x30, SWEEP_LEFT = 0x34, SWEEP_SPLIT = 0x38;
const INITIAL_BUCKETS = 16;
const RAM_BYTE_MASK = MAIN_RAM_SIZE - 1;
const MAX_RAM_RECORDS = MAIN_RAM_SIZE / BLUA32_STRING_RECORD_HEADER_SIZE;
const RAM_BUCKET_EXTENT_MASK = 2 * MAX_RAM_RECORDS - 1;
const SLOT_BIT = 0x80000000;

function ramAddress(address: number): boolean { return address >= RAM_BASE && address < CART_ROM_BASE; }
function storageOffset(address: number): number {
	if (address < RAM_BASE) return address & (SYSTEM_ROM_SIZE - 1);
	if (address < CART_ROM_BASE) return address & (MAIN_RAM_SIZE - 1);
	return (address & (SLOT_BIT - 1)) - CART_ROM_BASE;
}
function romStringId(address: number, cartridgeSlot: number): number {
	return address >= CART_ROM_BASE ? (address | (cartridgeSlot << 31)) >>> 0 : address;
}

function matchesBytes(candidate: Uint8Array, start: number, mask: number, source: string | Uint8Array, offset: number, length: number): boolean {
	let n = 0;
	if (typeof source === 'string') {
		while (n < length && candidate[(start + n) & mask] === source.charCodeAt(n)) ++n;
	} else {
		while (n < length && candidate[(start + n) & mask] === source[offset + n]) ++n;
	}
	return n === length;
}

// All persistent interning and collection state is in the raw machine RAM.
export class StringPool {
	private readonly localRoots: StringId[] = [];
	private readonly localRootBases: number[] = [];
	private readonly metadataOffset: number;
	private readonly romView: MemoryByteView;
	private markWork = 0;

	public constructor(private readonly heap: LuaHeap, private readonly memory: Memory, arena: HeapAllocator) {
		this.metadataOffset = arena.managementOffset() + HEAP_STRING_METADATA_OFFSET;
		this.romView = { bytes: memory.systemRomStorage().bytes, byteOffset: 0, byteLength: 0 };
	}

	private metadata(field: number): number { return this.memory.readRamRecordWord(this.metadataOffset + field); }
	private ramBucketCount(): number { return this.metadata(CAPACITY) & RAM_BUCKET_EXTENT_MASK; }
	private writeMetadata(field: number, word: number): void { this.memory.writeRamRecordWord(this.metadataOffset + field, word); }
	private storage(address: number): Uint8Array | null {
		if (address < RAM_BASE) return this.memory.systemRomStorage().bytes;
		if (address < CART_ROM_BASE) return this.memory.ramData();
		const rom = this.memory.cartridgeController.romStorage(address >>> 31);
		return rom === null ? null : rom.bytes;
	}
	private readWord(base: number, displacement = 0): number {
		if (ramAddress(base)) return this.memory.readRamRecordWord(base + displacement);
		const bytes = this.storage(base);
		return bytes === null ? 0 : readLE32(bytes, (storageOffset(base) + displacement) >>> 0);
	}

	public byteLength(id: StringId): number {
		const count = this.readWord(id, BLUA32_STRING_LENGTH_OFFSET);
		return ramAddress(id) ? count & RAM_BYTE_MASK : count | 0;
	}
	public byteAt(id: StringId, index: number): number {
		if (ramAddress(id)) return this.memory.readRamRecordByte(id + BLUA32_STRING_RECORD_HEADER_SIZE + index);
		return this.storage(id)?.[storageOffset(id) + BLUA32_STRING_RECORD_HEADER_SIZE + index] | 0;
	}

	public bytes(id: StringId): string {
		const length = this.byteLength(id) >>> 0;
		if (length === 0) return '';
		if (ramAddress(id)) {
			const source = this.memory.ramData(), offset = (id + BLUA32_STRING_RECORD_HEADER_SIZE) & RAM_BYTE_MASK;
			const first = Math.min(length, MAIN_RAM_SIZE - offset);
			const prefix = byteStringFromBytes(source, offset, first);
			return first === length ? prefix : prefix + byteStringFromBytes(source, 0, length - first);
		}
		const source = this.storage(id);
		const offset = storageOffset(id) + BLUA32_STRING_RECORD_HEADER_SIZE;
		const backed = source === null ? 0 : Math.min(length, Math.max(0, source.length - offset));
		const prefix = backed === 0 ? '' : byteStringFromBytes(source!, offset, backed);
		return prefix + '\0'.repeat(length - backed);
	}
	public toString(id: StringId): string { return byteStringToText(this.bytes(id)); }

	public compare(left: StringId, right: StringId): number {
		if (left === right) return 0;
		const a = this.storage(left), b = this.storage(right);
		const aMask = ramAddress(left) ? RAM_BYTE_MASK : -1, bMask = ramAddress(right) ? RAM_BYTE_MASK : -1;
		const aOffset = (storageOffset(left) + BLUA32_STRING_RECORD_HEADER_SIZE) & aMask;
		const bOffset = (storageOffset(right) + BLUA32_STRING_RECORD_HEADER_SIZE) & bMask;
		const aLength = this.byteLength(left) >>> 0, bLength = this.byteLength(right) >>> 0;
		const limit = Math.min(aLength, bLength);
		const straight = Math.min(limit, (aMask >>> 0) + 1 - aOffset, (bMask >>> 0) + 1 - bOffset);
		for (let i = 0; i < straight; ++i) {
			const delta = (a?.[aOffset + i] | 0) - (b?.[bOffset + i] | 0);
			if (delta !== 0) return delta;
		}
		for (let i = straight; i < limit; ++i) {
			const delta = (a?.[(aOffset + i) & aMask] | 0) - (b?.[(bOffset + i) & bMask] | 0);
			if (delta !== 0) return delta;
		}
		return aLength - bLength;
	}

	public clearRomTables(): void {
		this.writeMetadata(FIRST_CART, 0);
		for (let field = ROM_TABLES; field < ROM_TABLES + 24; field += 4) this.writeMetadata(field, 0);
	}
	public activateRomTable(domain: ExecutionDomainId, address: number, count: number): void {
		const cartridgeSlot = domain === 1 ? 1 : 0;
		if ((address & 3) !== 0 || count === 0 || (count & (count - 1)) !== 0
			|| count > CART_ROM_SIZE / 4 || !this.memory.bindRomByteView(address, 4 * count, cartridgeSlot, this.romView)) {
			throw new Error('BLua32 String bucket table is invalid.');
		}
		const index = domain + 1;
		this.writeMetadata(ROM_TABLES + 8 * index, romStringId(address, cartridgeSlot));
		this.writeMetadata(ROM_TABLES + 8 * index + 4, count);
		if (index !== 0 && this.metadata(FIRST_CART) === 0) this.writeMetadata(FIRST_CART, index);
	}

	private bindRomStringHeader(address: number, cartridgeSlot: number): void {
		const view = this.romView;
		if ((address & (BLUA32_STRING_RECORD_ALIGNMENT - 1)) !== 0
			|| !this.memory.bindRomByteView(address, BLUA32_STRING_RECORD_HEADER_SIZE, cartridgeSlot, view)
			|| readLE32(view.bytes, view.byteOffset) !== (BLUA32_STRING_RECORD_KIND | BLUA32_STRING_RECORD_ROM_FLAG)) {
			throw new Error('BLua32 ROM String header is invalid.');
		}
	}

	private bindRomStringBytes(address: number, cartridgeSlot: number, length: number): void {
		const view = this.romView;
		if (length > CART_ROM_SIZE - BLUA32_STRING_RECORD_HEADER_SIZE
			|| (length !== 0 && !this.memory.bindRomByteView(address, BLUA32_STRING_RECORD_HEADER_SIZE + length, cartridgeSlot, view))) {
			throw new Error('BLua32 ROM String is truncated.');
		}
		view.byteOffset += BLUA32_STRING_RECORD_HEADER_SIZE;
		view.byteLength = length;
	}

	private lookupRam(hash: number, source: string | Uint8Array, offset: number, length: number): number {
		const count = this.ramBucketCount();
		if (count === 0) return 0;
		const memory = this.memory;
		const ram = memory.ramData();
		let record = memory.readRamRecordWord(this.metadata(BUCKETS) + (hash & (count - 1)) * 4);
		if (record === 0) return 0;
		let remaining = Math.min(this.metadata(USED), MAX_RAM_RECORDS);
		while (record !== 0 && remaining-- !== 0) {
			if (memory.readRamRecordWord(record + BLUA32_STRING_HASH_OFFSET) === hash
				&& (memory.readRamRecordWord(record + BLUA32_STRING_LENGTH_OFFSET) & RAM_BYTE_MASK) === length) {
				const start = (record + BLUA32_STRING_RECORD_HEADER_SIZE) & RAM_BYTE_MASK;
				const mask = length > MAIN_RAM_SIZE - start ? RAM_BYTE_MASK : -1;
				if (matchesBytes(ram, start, mask, source, offset, length)) return record;
			}
			record = memory.readRamRecordWord(record + BLUA32_STRING_NEXT_OFFSET);
		}
		return 0;
	}

	private lookupRom(directory: number, hash: number, source: string | Uint8Array, offset: number, length: number): number {
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
				if (matchesBytes(this.romView.bytes, this.romView.byteOffset, -1, source, offset, length)) {
					return romStringId(record, cartridgeSlot);
				}
			}
			record = readLE32(bytes, byteOffset + BLUA32_STRING_NEXT_OFFSET);
		}
		return 0;
	}

	private lookup(hash: number, source: string | Uint8Array, offset: number, length: number): number {
		let match = this.lookupRam(hash, source, offset, length);
		if (match !== 0) return match;
		match = this.lookupRom(0, hash, source, offset, length);
		if (match !== 0) return match;
		const first = this.metadata(FIRST_CART);
		if (first === 0) return 0;
		match = this.lookupRom(first, hash, source, offset, length);
		if (match !== 0) return match;
		return this.lookupRom(3 - first, hash, source, offset, length);
	}

	public resolveImageRecord(domain: ExecutionDomainId, address: number): StringId {
		const cartridgeSlot = domain === 1 ? 1 : 0;
		this.bindRomStringHeader(address, cartridgeSlot);
		const { bytes, byteOffset } = this.romView;
		const hash = readLE32(bytes, byteOffset + BLUA32_STRING_HASH_OFFSET);
		const length = readLE32(bytes, byteOffset + BLUA32_STRING_LENGTH_OFFSET);
		this.bindRomStringBytes(address, cartridgeSlot, length);
		const match = this.lookup(hash, this.romView.bytes, this.romView.byteOffset, length);
		if (match === 0) throw new Error('BLua32 ROM String is missing from its bucket.');
		return this.retain(match);
	}

	public find(value: string): StringId | undefined {
		const id = this.lookup(hashText(value), value, 0, value.length);
		return id === 0 ? undefined : id;
	}

	// Managed image replacement cannot change a previously exposed ROM identity.
	public shadowsResidentRomString(domain: ExecutionDomainId, value: string): boolean {
		const id = this.find(value);
		if (id === undefined || id < CART_ROM_BASE) return false;
		return domain === -1 || (domain + 1 === this.metadata(FIRST_CART) && (id >>> 31) !== domain);
	}

	private grow(count: number): void {
		const newBase = this.heap.allocateRecord(4 * count, true, 0, 0);
		const sweep = this.metadata(SWEEP);
		const oldBase = this.metadata(BUCKETS), oldCount = this.ramBucketCount();
		const offset = storageOffset(newBase);
		const memory = this.memory;
		memory.ramData().fill(0, offset, offset + 4 * count);
		memory.invalidateRamWrite(offset, 4 * count);
		let remaining = Math.min(this.metadata(USED), MAX_RAM_RECORDS);
		for (let i = 0; i < oldCount && remaining !== 0; ++i) {
			let record = memory.readRamRecordWord(oldBase + 4 * i);
			while (record !== 0 && remaining !== 0 && memory.readRamRecordByte(record) === BLUA32_STRING_RECORD_KIND) {
				--remaining;
				const link = record + BLUA32_STRING_NEXT_OFFSET;
				const next = memory.readRamRecordWord(link);
				const hash = memory.readRamRecordWord(record + BLUA32_STRING_HASH_OFFSET);
				const bucket = newBase + 4 * (hash & (count - 1));
				memory.writeRamRecordWord(link, memory.readRamRecordWord(bucket));
				memory.writeRamRecordWord(bucket, record);
				record = next;
			}
		}
		this.writeMetadata(BUCKETS, newBase);
		this.writeMetadata(CAPACITY, count);
		if (sweep !== 0) {
			// A growth that crosses into sweeping splits each old bucket in
			// two. Keep the completed prefix in both halves.
			memory.writeRamRecordPair(this.metadataOffset + SWEEP_LINK, 0, 0);
			this.writeMetadata(SWEEP_SPLIT, oldCount + sweep - 1);
		}
		if (oldCount !== 0) this.heap.releaseRecord(oldBase, 4 * oldCount);
	}
	public intern(value: string): StringId {
		const hash = hashText(value);
		const existing = this.lookup(hash, value, 0, value.length);
		if (existing !== 0) return this.retain(existing);
		const count = this.ramBucketCount();
		if (count === 0) this.grow(INITIAL_BUCKETS);
		else if (this.metadata(USED) >= count && !this.sweeping()) this.grow(count * 2);
		// An unrepresentable length requests the full bank and still clocks
		// the final collection before the admission fault.
		const id = this.heap.allocateRecord(BLUA32_STRING_RECORD_HEADER_SIZE + Math.min(value.length, MAIN_RAM_SIZE), false, 0, 0);
		const bucket = this.metadata(BUCKETS) + 4 * (hash & (this.ramBucketCount() - 1));
		const memory = this.memory;
		memory.writeRamRecordWord(id, BLUA32_STRING_RECORD_KIND | ((this.metadata(EPOCH) & STRING_GC_EPOCH_MASK) << 8));
		memory.writeRamRecordWord(id + BLUA32_STRING_HASH_OFFSET, hash);
		memory.writeRamRecordWord(id + BLUA32_STRING_LENGTH_OFFSET, value.length);
		memory.writeRamRecordWord(id + BLUA32_STRING_NEXT_OFFSET, memory.readRamRecordWord(bucket));
		if (value.length !== 0) {
			const offset = storageOffset(id) + BLUA32_STRING_RECORD_HEADER_SIZE;
			writeByteString(memory.ramData(), offset, value);
			memory.invalidateRamWrite(offset, value.length);
		}
		memory.writeRamRecordWord(bucket, id);
		this.writeMetadata(USED, this.metadata(USED) + 1);
		return this.retain(id);
	}

	private mark(id: StringId, youngOnly: boolean): number {
		if (!ramAddress(id)) return 0;
		const markByte = id + 1, flags = this.memory.readRamRecordByte(markByte);
		if (youngOnly) {
			if ((flags & (STRING_GC_OLD | STRING_GC_MINOR_MARK)) !== 0) return 0;
			this.memory.writeRamRecordByte(markByte, flags | STRING_GC_MINOR_MARK);
		} else {
			const epoch = this.metadata(EPOCH) & STRING_GC_EPOCH_MASK;
			if ((flags & STRING_GC_EPOCH_MASK) === epoch) return 0;
			this.memory.writeRamRecordByte(markByte, (flags & ~STRING_GC_EPOCH_MASK) | epoch);
		}
		return 1;
	}
	private retain(id: StringId): StringId {
		this.mark(id, false);
		if (this.localRootBases.length !== 0) this.localRoots.push(id);
		return id;
	}
	public beginLocalRoots(): void { this.localRootBases.push(this.localRoots.length); }
	public endLocalRoots(): void { this.localRoots.length = this.localRootBases.pop()!; }
	public beginReachabilityEpoch(): void { this.writeMetadata(EPOCH, this.metadata(EPOCH) ^ 1); }
	public markReachable(id: StringId, youngOnly = false): void { this.markWork += this.mark(id, youngOnly); }
	public markLocalRoots(youngOnly = false): void { for (const id of this.localRoots) this.markReachable(id, youngOnly); }
	public takeMarkWork(): number {
		const work = this.markWork;
		this.markWork = 0;
		return work;
	}

	public beginSweep(): void {
		this.writeMetadata(SWEEP, 1);
		this.memory.writeRamRecordPair(this.metadataOffset + SWEEP_LINK, 0, 0);
		this.writeMetadata(SWEEP_SPLIT, 0);
	}
	public sweeping(): boolean { return this.metadata(SWEEP) !== 0; }
	public sweepStep(allowance: number): number {
		const base = this.metadata(BUCKETS), count = this.ramBucketCount(), epoch = this.metadata(EPOCH) & STRING_GC_EPOCH_MASK;
		let index = this.metadata(SWEEP) - 1, used = this.metadata(USED), work = 0;
		let link = this.metadata(SWEEP_LINK), remaining = this.metadata(SWEEP_LEFT), split = this.metadata(SWEEP_SPLIT);
		const memory = this.memory;
		while (index < count && allowance !== 0) {
			if (link === 0) {
				if (split !== 0 && index === (count >>> 1)) { index = split; split = 0; }
				link = base + 4 * index;
				++work; --allowance;
			}
			// New interns can prepend only before this stable survivor link.
			if (link === base + 4 * index) remaining = Math.min(used, MAX_RAM_RECORDS);
			let record = memory.readRamRecordWord(link);
			while (record !== 0 && remaining !== 0 && allowance !== 0
				&& memory.readRamRecordByte(record) === BLUA32_STRING_RECORD_KIND) {
				const next = memory.readRamRecordWord(record + BLUA32_STRING_NEXT_OFFSET);
				--remaining; --allowance;
				if ((memory.readRamRecordByte(record + 1) & STRING_GC_EPOCH_MASK) !== epoch) {
					memory.writeRamRecordWord(link, next);
					memory.writeRamRecordByte(record, 0);
					this.heap.releaseRecord(record, BLUA32_STRING_RECORD_HEADER_SIZE + this.byteLength(record));
					--used;
				} else link = record + BLUA32_STRING_NEXT_OFFSET;
				record = next;
			}
			if (record !== 0 && remaining !== 0 && allowance === 0) break;
			if (record !== 0) memory.writeRamRecordWord(link, 0);
			link = remaining = 0; ++index;
		}
		this.writeMetadata(SWEEP, index < count ? index + 1 : 0);
		this.writeMetadata(USED, used);
		memory.writeRamRecordPair(this.metadataOffset + SWEEP_LINK, link, remaining);
		this.writeMetadata(SWEEP_SPLIT, split);

		return work;
	}
	public sweepYoungBucket(id: StringId): number {
		const memory = this.memory;
		if (!ramAddress(id) || memory.readRamRecordByte(id) !== BLUA32_STRING_RECORD_KIND
			|| (memory.readRamRecordByte(id + 1) & STRING_GC_OLD) !== 0) return 0;
		const hash = memory.readRamRecordWord(id + BLUA32_STRING_HASH_OFFSET);
		let link = this.metadata(BUCKETS) + 4 * (hash & (this.ramBucketCount() - 1));
		let record = memory.readRamRecordWord(link), used = this.metadata(USED), work = 1;
		for (let remaining = Math.min(used, MAX_RAM_RECORDS); remaining !== 0 && record !== 0; --remaining) {
			++work;
			if (memory.readRamRecordByte(record) !== BLUA32_STRING_RECORD_KIND) break;
			const next = memory.readRamRecordWord(record + BLUA32_STRING_NEXT_OFFSET);
			const flags = memory.readRamRecordByte(record + 1);
			if ((flags & STRING_GC_OLD) !== 0) {
				link = record + BLUA32_STRING_NEXT_OFFSET;
			} else if ((flags & STRING_GC_MINOR_MARK) !== 0) {
				memory.writeRamRecordByte(record + 1, (flags & ~STRING_GC_MINOR_MARK) | STRING_GC_OLD);
				link = record + BLUA32_STRING_NEXT_OFFSET;
			} else {
				memory.writeRamRecordWord(link, next);
				memory.writeRamRecordByte(record, 0);
				this.heap.releaseRecord(record, BLUA32_STRING_RECORD_HEADER_SIZE + this.byteLength(record));
				--used;
			}
			record = next;
		}
		if (record !== 0) memory.writeRamRecordWord(link, 0);
		this.writeMetadata(USED, used);
		return work;
	}

}
