import { byteStringFromBytes, byteStringToText, writeByteString } from '../../common/byte_string';
import { readLE32 } from '../../common/endian';
import { hashText } from '../../common/hash';
import type { ExecutionDomainId } from '../../spec/blua32/execution_domain';
import {
	BLUA32_STRING_HASH_OFFSET, BLUA32_STRING_LENGTH_OFFSET, BLUA32_STRING_NEXT_OFFSET,
	BLUA32_STRING_RECORD_ALIGNMENT, BLUA32_STRING_RECORD_HEADER_SIZE,
	BLUA32_STRING_RECORD_KIND, BLUA32_STRING_RECORD_ROM_FLAG,
} from '../../spec/blua32/image_format';
import { CART_ROM_BASE, MAIN_RAM_SIZE, RAM_BASE, SYSTEM_ROM_SIZE } from '../../spec/bmsx/memory_map';
import type { Memory } from '../memory/memory';
import { HEAP_STRING_METADATA_OFFSET, type HeapAllocator } from './heap_allocator';
import type { LuaHeap } from './lua_heap';

export type StringId = number;

const BUCKETS = 0x00, CAPACITY = 0x04, USED = 0x08, EPOCH = 0x0c, SWEEP = 0x10;
const FIRST_CART = 0x14, ROM_TABLES = 0x18;
const INITIAL_BUCKETS = 16;
const SLOT_BIT = 0x80000000;

function ramAddress(address: number): boolean { return address >= RAM_BASE && address < CART_ROM_BASE; }
function storageOffset(address: number): number {
	if (address < RAM_BASE) return address & (SYSTEM_ROM_SIZE - 1);
	if (address < CART_ROM_BASE) return address & (MAIN_RAM_SIZE - 1);
	return (address & (SLOT_BIT - 1)) - CART_ROM_BASE;
}
function slotWord(domain: ExecutionDomainId): number { return domain === 1 ? SLOT_BIT : 0; }

// All persistent interning and collection state is in the raw machine RAM.
export class StringPool {
	private readonly localRoots: StringId[] = [];
	private readonly localRootBases: number[] = [];
	private readonly metadataOffset: number;
	private markWork = 0;

	public constructor(private readonly heap: LuaHeap, private readonly memory: Memory, private readonly arena: HeapAllocator) {
		this.metadataOffset = arena.managementOffset() + HEAP_STRING_METADATA_OFFSET;
	}

	private metadata(field: number): number { return this.memory.readRamRecordWord(this.metadataOffset + field); }
	private writeMetadata(field: number, word: number): void { this.memory.writeRamRecordWord(this.metadataOffset + field, word); }
	private storage(address: number): Uint8Array | null {
		if (address < RAM_BASE) return this.memory.systemRomStorage().bytes;
		if (address < CART_ROM_BASE) return this.memory.ramData();
		const rom = this.memory.cartridgeController.romStorage(address >>> 31);
		return rom === null ? null : rom.bytes;
	}
	private readWord(address: number): number {
		if (ramAddress(address)) return this.memory.readRamRecordWord(address);
		const bytes = this.storage(address);
		if (bytes === null) return 0;
		const offset = storageOffset(address);
		return readLE32(bytes, offset); // Missing ROM lanes are pulled to zero.
	}

	public byteLength(id: StringId): number { return this.readWord(id + BLUA32_STRING_LENGTH_OFFSET) | 0; }
	public byteAt(id: StringId, index: number): number {
		return this.storage(id)?.[storageOffset(id) + BLUA32_STRING_RECORD_HEADER_SIZE + index] | 0;
	}

	public bytes(id: StringId): string {
		const length = this.readWord(id + BLUA32_STRING_LENGTH_OFFSET);
		if (length === 0) return '';
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
		const aOffset = storageOffset(left) + BLUA32_STRING_RECORD_HEADER_SIZE;
		const bOffset = storageOffset(right) + BLUA32_STRING_RECORD_HEADER_SIZE;
		const aLength = this.readWord(left + BLUA32_STRING_LENGTH_OFFSET);
		const bLength = this.readWord(right + BLUA32_STRING_LENGTH_OFFSET);
		const limit = Math.min(aLength, bLength);
		for (let i = 0; i < limit; ++i) {
			const delta = (a?.[aOffset + i] | 0) - (b?.[bOffset + i] | 0);
			if (delta !== 0) return delta;
		}
		return aLength - bLength;
	}

	public clearRomTables(): void {
		this.writeMetadata(FIRST_CART, 0);
		for (let field = ROM_TABLES; field < ROM_TABLES + 24; field += 4) this.writeMetadata(field, 0);
	}
	public activateRomTable(domain: ExecutionDomainId, address: number, count: number): void {
		const id = (address | slotWord(domain)) >>> 0;
		const rom = this.storage(id), offset = storageOffset(id);
		if ((address & 3) !== 0 || count === 0 || (count & (count - 1)) !== 0
			|| rom === null || offset > rom.length || 4 * count > rom.length - offset) {
			throw new Error('BLua32 String bucket table is invalid.');
		}
		const index = domain + 1;
		this.writeMetadata(ROM_TABLES + 8 * index, id);
		this.writeMetadata(ROM_TABLES + 8 * index + 4, count);
		if (index !== 0 && this.metadata(FIRST_CART) === 0) this.writeMetadata(FIRST_CART, index);
	}

	private bucketLookup(buckets: number, count: number, hash: number, source: string | Uint8Array, offset: number, length: number): number {
		if (count === 0) return 0;
		const slot = buckets & SLOT_BIT;
		let record = this.readWord(buckets + 4 * (hash & (count - 1)));
		while (record !== 0) {
			record = (record | slot) >>> 0;
			if (this.readWord(record + BLUA32_STRING_HASH_OFFSET) === hash
				&& this.readWord(record + BLUA32_STRING_LENGTH_OFFSET) === length) {
				const candidate = this.storage(record);
				const start = storageOffset(record) + BLUA32_STRING_RECORD_HEADER_SIZE;
				if (candidate !== null && start + length <= candidate.length) {
					let n = 0;
					if (typeof source === 'string') {
						while (n < length && candidate[start + n] === source.charCodeAt(n)) ++n;
					} else {
						while (n < length && candidate[start + n] === source[offset + n]) ++n;
					}
					if (n === length) return record;
				}
			}
			record = this.readWord(record + BLUA32_STRING_NEXT_OFFSET);
		}
		return 0;
	}

	private lookup(hash: number, source: string | Uint8Array, offset: number, length: number): number {
		let match = this.bucketLookup(this.metadata(BUCKETS), this.metadata(CAPACITY), hash, source, offset, length);
		if (match !== 0) return match;
		match = this.bucketLookup(this.metadata(ROM_TABLES), this.metadata(ROM_TABLES + 4), hash, source, offset, length);
		if (match !== 0) return match;
		const first = this.metadata(FIRST_CART);
		if (first === 0) return 0;
		let table = ROM_TABLES + 8 * first;
		match = this.bucketLookup(this.metadata(table), this.metadata(table + 4), hash, source, offset, length);
		if (match !== 0) return match;
		table = ROM_TABLES + 8 * (3 - first);
		return this.bucketLookup(this.metadata(table), this.metadata(table + 4), hash, source, offset, length);
	}

	public resolveImageRecord(domain: ExecutionDomainId, address: number, restoring: boolean): StringId {
		const id = (address | slotWord(domain)) >>> 0;
		if ((address & (BLUA32_STRING_RECORD_ALIGNMENT - 1)) !== 0
			|| this.readWord(id) !== (BLUA32_STRING_RECORD_KIND | BLUA32_STRING_RECORD_ROM_FLAG)) {
			throw new Error('BLua32 ROM String header is invalid.');
		}
		const offset = storageOffset(id) + BLUA32_STRING_RECORD_HEADER_SIZE;
		const rom = this.storage(id)!, length = this.readWord(id + BLUA32_STRING_LENGTH_OFFSET);
		if (offset + length > rom.length) throw new Error('BLua32 ROM String is truncated.');
		const match = this.lookup(this.readWord(id + BLUA32_STRING_HASH_OFFSET), rom, offset, length);
		if (match === 0) throw new Error('BLua32 ROM String is missing from its bucket.');
		return restoring ? match : this.retain(match);
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
		// Admission can enter the string sweep. Finish it while the cursor
		// still addresses the old buffer; neither bucket buffer is an object.
		while (this.sweeping()) this.heap.stepRuntime();
		const oldBase = this.metadata(BUCKETS), oldCount = this.metadata(CAPACITY);
		const offset = storageOffset(newBase);
		const memory = this.memory;
		memory.ramData().fill(0, offset, offset + 4 * count);
		memory.invalidateRamWrite(offset, 4 * count);
		for (let i = 0; i < oldCount; ++i) {
			let record = memory.readRamRecordWord(oldBase + 4 * i);
			while (record !== 0) {
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
		if (oldCount !== 0) {
			this.arena.free(oldBase);

		}
	}
	public intern(value: string): StringId {
		const hash = hashText(value);
		const existing = this.lookup(hash, value, 0, value.length);
		if (existing !== 0) return this.retain(existing);
		const count = this.metadata(CAPACITY);
		if (count === 0) this.grow(INITIAL_BUCKETS);
		else if (this.metadata(USED) >= count && !this.sweeping()) this.grow(count * 2);
		const id = this.heap.allocateRecord(BLUA32_STRING_RECORD_HEADER_SIZE + value.length, false, 0, 0);
		const bucket = this.metadata(BUCKETS) + 4 * (hash & (this.metadata(CAPACITY) - 1));
		const memory = this.memory;
		memory.writeRamRecordWord(id, BLUA32_STRING_RECORD_KIND | (this.metadata(EPOCH) << 8));
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

	private mark(id: StringId): number {
		if (!ramAddress(id)) return 0;
		const markByte = id + 1, epoch = this.metadata(EPOCH);
		if (this.memory.readRamRecordByte(markByte) === epoch) return 0;
		this.memory.writeRamRecordByte(markByte, epoch);
		return 1;
	}
	private retain(id: StringId): StringId {
		this.mark(id);
		if (this.localRootBases.length !== 0) this.localRoots.push(id);
		return id;
	}
	public beginLocalRoots(): void { this.localRootBases.push(this.localRoots.length); }
	public endLocalRoots(): void { this.localRoots.length = this.localRootBases.pop()!; }
	public beginReachabilityEpoch(): void { this.writeMetadata(EPOCH, this.metadata(EPOCH) ^ 1); }
	public markReachable(id: StringId): void { this.markWork += this.mark(id); }
	public markLocalRoots(): void { for (const id of this.localRoots) this.markReachable(id); }
	public takeMarkWork(): number {
		const work = this.markWork;
		this.markWork = 0;
		return work;
	}

	public beginSweep(): void { this.writeMetadata(SWEEP, 1); }
	public sweeping(): boolean { return this.metadata(SWEEP) !== 0; }
	public sweepStep(allowance: number): number {
		const base = this.metadata(BUCKETS), count = this.metadata(CAPACITY), epoch = this.metadata(EPOCH);
		let index = this.metadata(SWEEP) - 1, used = this.metadata(USED), work = 0;
		const memory = this.memory;
		while (index < count && work < allowance) {
			let link = base + 4 * index++;
			let record = memory.readRamRecordWord(link);
			++work;
			while (record !== 0) {
				const next = memory.readRamRecordWord(record + BLUA32_STRING_NEXT_OFFSET);
				if (memory.readRamRecordByte(record + 1) !== epoch) {
					memory.writeRamRecordWord(link, next);
					this.arena.free(record);
					--used;
				} else link = record + BLUA32_STRING_NEXT_OFFSET;
				record = next;
			}
		}
		this.writeMetadata(SWEEP, index === count ? 0 : index + 1);
		this.writeMetadata(USED, used);

		return work;
	}
}
