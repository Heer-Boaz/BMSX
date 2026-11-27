import { byteStringFromBytes, byteStringToText, writeByteString } from '../../common/byte_string';
import { readLE32 } from '../../common/endian';
import { hashBytes, hashText } from '../../common/hash';
import type { ExecutionDomainId } from '../../spec/blua32/execution_domain';
import {
	BLUA32_STRING_HASH_OFFSET, BLUA32_STRING_LENGTH_OFFSET, BLUA32_STRING_NEXT_OFFSET,
	BLUA32_STRING_RECORD_ALIGNMENT, BLUA32_STRING_RECORD_HEADER_SIZE,
	BLUA32_STRING_RECORD_KIND, BLUA32_STRING_RECORD_ROM_FLAG,
	BLUA32_STRING_ROM_ADDRESS_MASK, BLUA32_STRING_ROM_SOCKET_SHIFT,
} from '../../spec/blua32/image_format';
import { CART_ROM_BASE, CART_ROM_SIZE, HEAP_PAGE_SIZE, MAIN_RAM_SIZE, RAM_BASE } from '../../spec/bmsx/memory_map';
import type { Memory, MemoryByteView } from '../memory/memory';
import { HEAP_STRING_MARK_WORK_OFFSET, HEAP_STRING_METADATA_OFFSET, type HeapAllocator } from './heap_allocator';
import type { LuaHeap } from './lua_heap';
import { valueNil, valueString } from './value';

export type StringId = number;
export const STRING_GC_EPOCH_MASK = 1;

const BUCKETS = 0x00, CAPACITY = 0x04, USED = 0x08, EPOCH = 0x0c, SWEEP = 0x10;
const FIRST_CART = 0x14, ROM_TABLES = 0x18;
const SWEEP_LINK = 0x30, SWEEP_LEFT = 0x34, REHASH_BASE = 0x38, REHASH_READY = 0x3c;
const SWEEP_REHASH = 0x80000000;
const SWEEP_SHRINK = 0xc0000000;
const INITIAL_BUCKETS = 16;
const MIN_SHRINK_BUCKETS = 2 * HEAP_PAGE_SIZE / 4;
const INTERN_REHASH_WORK = 64;
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

// All persistent interning and collection state is in the raw machine RAM.
export class StringPool {
	private readonly localRoots: StringId[] = [];
	private readonly localRootBases: number[] = [];
	public readonly metadataOffset: number;
	private readonly markWorkOffset: number;
	private readonly romView: MemoryByteView;

	public constructor(private readonly heap: LuaHeap, private readonly memory: Memory, private readonly arena: HeapAllocator) {
		const management = arena.managementOffset();
		this.metadataOffset = management + HEAP_STRING_METADATA_OFFSET;
		this.markWorkOffset = management + HEAP_STRING_MARK_WORK_OFFSET;
		this.romView = { bytes: memory.systemRomStorage().bytes, byteOffset: 0, byteLength: 0 };
	}

	private metadata(field: number): number { return this.memory.readRamRecordWord(this.metadataOffset + field); }
	private writeMetadata(field: number, word: number): void { this.memory.writeRamRecordWord(this.metadataOffset + field, word); }
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

	private lookup(hash: number, source: InternSource, offset: number, length: number, wrapped = 0): number {
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
		return domain === -1 || (domain + 1 === this.metadata(FIRST_CART) && (id >>> BLUA32_STRING_ROM_SOCKET_SHIFT) !== domain);
	}

	private rehashStep(oldCount: number, nextBase: number, allowance: number): number {
		const oldBase = this.metadata(BUCKETS), count = 2 * oldCount;
		let ready = this.metadata(REHASH_READY), work = 0;
		const memory = this.memory;
		// Only the last prepared pair can still have records in its old bucket.
		while (work < allowance) {
			if (ready !== 0) {
				const head = oldBase + 4 * (ready - 1);
				const record = memory.readRamRecordWord(head);
				if (record !== 0) {
					const link = record + BLUA32_STRING_NEXT_OFFSET;
					const hash = memory.readRamRecordWord(record + BLUA32_STRING_HASH_OFFSET);
					const bucket = nextBase + 4 * (hash & (count - 1));
					memory.writeRamRecordWord(head, memory.readRamRecordWord(link));
					memory.writeRamRecordWord(link, memory.readRamRecordWord(bucket));
					memory.writeRamRecordWord(bucket, record);
					++work;
					continue;
				}
			}
			if (ready === oldCount) {
				this.writeMetadata(BUCKETS, nextBase);
				this.writeMetadata(CAPACITY, count);
				memory.writeRamRecordPair(this.metadataOffset + REHASH_BASE, 0, 0);
				this.heap.replaceRecord(oldBase, 0, 0);
				return work;
			}
			memory.writeRamRecordWord(nextBase + 4 * ready, 0);
			memory.writeRamRecordWord(nextBase + 4 * (ready + oldCount), 0);
			++ready;
			++work;
		}
		this.writeMetadata(REHASH_READY, ready);
		return work;
	}

	private shrinkStep(count: number, allowance: number): number {
		const base = this.metadata(BUCKETS), half = count >>> 1;
		const memory = this.memory, start = this.metadata(REHASH_READY);
		let ready = start, work = 0;
		// Only the current upper bucket may have live links in both halves.
		while (work < allowance && ready < half) {
			const upper = base + 4 * (half + ready);
			const record = memory.readRamRecordWord(upper);
			if (record !== 0) {
				const link = record + BLUA32_STRING_NEXT_OFFSET, lower = base + 4 * ready;
				memory.writeRamRecordWord(upper, memory.readRamRecordWord(link));
				memory.writeRamRecordWord(link, memory.readRamRecordWord(lower));
				memory.writeRamRecordWord(lower, record);
			} else ++ready;
			++work;
		}
		if (work === allowance) {
			if (ready !== start) this.writeMetadata(REHASH_READY, ready);
			return work;
		}
		this.arena.shrinkBacking(base, 4 * half);
		this.writeMetadata(CAPACITY, half);
		this.writeMetadata(REHASH_READY, 0);
		this.writeMetadata(SWEEP, 0);
		return work + 1;
	}

	public intern(value: string): StringId {
		return this.internSource(hashText(value), value, 0, value.length);
	}

	public copyBytes(id: StringId, first: number, count: number, target: Uint8Array, offset: number): void {
		const source = this.storage(id), at = storageOffset(id) + BLUA32_STRING_RECORD_HEADER_SIZE + first;
		const ram = isRamStringId(id), start = ram ? at & RAM_BYTE_MASK : at;
		const n = ram ? Math.min(count, MAIN_RAM_SIZE - start) : count;
		for (let i = 0; i < n; ++i) target[offset + i] = source[start + i];
		for (let i = n; i < count; ++i) target[offset + i] = source[i - n];
	}

	public internHashedBytes(bytes: Uint8Array, length: number, hash: number): StringId {
		return this.internSource(hash, bytes, 0, length);
	}

	public internBytes({ bytes, byteOffset, byteLength }: MemoryByteView): StringId {
		return this.internSource(hashBytes(bytes, byteOffset, byteLength), bytes, byteOffset, byteLength);
	}

	public internSlice(id: StringId, first: number, count: number): StringId {
		const source = this.storage(id), inRam = isRamStringId(id);
		const at = storageOffset(id) + BLUA32_STRING_RECORD_HEADER_SIZE + first;
		const start = inRam ? at & RAM_BYTE_MASK : at;
		const wrapped = inRam ? Math.max(0, start + count - MAIN_RAM_SIZE) : 0;
		return this.internSource(hashBytes(source, start, count, wrapped), source, start, count, id, wrapped);
	}

	private internSource(hash: number, source: InternSource, start: number, length: number, sourceId: StringId = 0,
		wrapped = 0): StringId {
		const existing = this.lookup(hash, source, start, length, wrapped);
		if (existing !== 0) return this.retain(existing);
		// Preserve the borrowed bytes in the active sweep epoch and in any
		// new collection triggered by bucket or record admission.
		let root = valueNil();
		if (sourceId !== 0) {
			this.mark(sourceId);
			root = valueString(sourceId);
		}
		const control = this.metadata(CAPACITY), count = control & RAM_BUCKET_EXTENT_MASK;
		const memory = this.memory;
		if (count === 0) {
			const base = this.heap.reserveBacking(4 * INITIAL_BUCKETS, 0, root);
			const offset = storageOffset(base);
			memory.ramData().fill(0, offset, offset + 4 * INITIAL_BUCKETS);
			memory.invalidateRamWrite(offset, 4 * INITIAL_BUCKETS);
			memory.writeRamRecordPair(this.metadataOffset + BUCKETS, base, INITIAL_BUCKETS);
		} else if (!this.sweeping()) {
			if ((control & RAM_BUCKET_REHASH) !== 0) {
				this.rehashStep(count, this.metadata(REHASH_BASE), INTERN_REHASH_WORK);
			} else if (this.metadata(USED) >= count) {
				// Directory growth is optional. It must not collect and resize the
				// published directory underneath this growth decision.
				const nextBase = this.arena.allocate(8 * count, true);
				if (nextBase !== 0) {
					this.writeMetadata(REHASH_BASE, nextBase);
					this.writeMetadata(CAPACITY, count | RAM_BUCKET_REHASH);
					this.rehashStep(count, nextBase, INTERN_REHASH_WORK);
				}
			}
		}
		// An unrepresentable length requests the full bank and fails fixed admission.
		const id = this.heap.allocateRecord(BLUA32_STRING_RECORD_HEADER_SIZE + Math.min(length, MAIN_RAM_SIZE), false, 0, 0, root);
		const currentControl = this.metadata(CAPACITY), current = currentControl & RAM_BUCKET_EXTENT_MASK;
		let index = hash & (current - 1), base = this.metadata(BUCKETS);
		if ((currentControl & (RAM_BUCKET_REHASH | RAM_BUCKET_SHRINK)) !== 0) {
			const ready = this.metadata(REHASH_READY);
			if ((currentControl & RAM_BUCKET_REHASH) !== 0) {
				if (index < ready) {
					index = hash & (2 * current - 1);
					base = this.metadata(REHASH_BASE);
				}
			} else {
				const lower = index - (current >>> 1);
				if (lower >= 0 && lower <= ready) index = lower;
			}
		}
		const bucket = base + 4 * index;
		memory.writeRamRecordWord(id, BLUA32_STRING_RECORD_KIND | ((this.metadata(EPOCH) & STRING_GC_EPOCH_MASK) << 8));
		memory.writeRamRecordWord(id + BLUA32_STRING_HASH_OFFSET, hash);
		memory.writeRamRecordWord(id + BLUA32_STRING_LENGTH_OFFSET, length);
		memory.writeRamRecordWord(id + BLUA32_STRING_NEXT_OFFSET, memory.readRamRecordWord(bucket));
		if (length !== 0) {
			const offset = storageOffset(id) + BLUA32_STRING_RECORD_HEADER_SIZE;
			const ram = memory.ramData();
			if (typeof source === 'string') writeByteString(ram, offset, source);
			else if (source === ram) {
				const first = length - wrapped;
				ram.copyWithin(offset, start, start + first);
				if (wrapped !== 0) ram.copyWithin(offset + first, 0, wrapped);
			} else {
				ram.set(start === 0 && length === source.length ? source : source.subarray(start, start + length), offset);
			}
			memory.invalidateRamWrite(offset, length);
		}
		memory.writeRamRecordWord(bucket, id);
		this.writeMetadata(USED, this.metadata(USED) + 1);
		return this.retain(id);
	}

	private mark(id: StringId): number {
		if (!isRamStringId(id)) return 0;
		const markByte = id + 1, epoch = this.metadata(EPOCH) & STRING_GC_EPOCH_MASK;
		if ((this.memory.readRamRecordByte(markByte) & STRING_GC_EPOCH_MASK) === epoch) return 0;
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
	public markReachable(id: StringId): void {
		const work = this.mark(id);
		if (work !== 0) this.memory.writeRamRecordWord(this.markWorkOffset, this.memory.readRamRecordWord(this.markWorkOffset) + work);
	}
	public markLocalRoots(): void { for (const id of this.localRoots) this.markReachable(id); }
	public takeMarkWork(): number {
		const work = this.memory.readRamRecordWord(this.markWorkOffset);
		if (work !== 0) this.memory.writeRamRecordWord(this.markWorkOffset, 0);
		return work;
	}
	public resumeMarkWork(work: number): void {
		if (work !== 0 || this.memory.readRamRecordWord(this.markWorkOffset) !== 0) this.memory.writeRamRecordWord(this.markWorkOffset, work);
	}

	public beginSweep(): void {
		const ready = this.metadata(REHASH_READY);
		this.writeMetadata(SWEEP, Math.max(1, ready));
		this.memory.writeRamRecordPair(this.metadataOffset + SWEEP_LINK, 0, 0);
	}
	public sweeping(): boolean { return this.metadata(SWEEP) !== 0; }
	public estimateSweepWork(): number {
		const control = this.metadata(CAPACITY);
		const count = control & RAM_BUCKET_EXTENT_MASK;
		const records = this.metadata(USED);
		// Include a possible second visit during a pending directory migration.
		if ((control & RAM_BUCKET_REHASH) !== 0) return 3 * count + 2 * records;
		return count >= MIN_SHRINK_BUCKETS ? count + (count >>> 1) + 2 * records + 1 : count + records;
	}
	public sweepStep(allowance: number): number {
		const cursor = this.metadata(SWEEP), control = this.metadata(CAPACITY), count = control & RAM_BUCKET_EXTENT_MASK;
		if (cursor === SWEEP_SHRINK) return this.shrinkStep(count, allowance);
		const nextBase = (control & RAM_BUCKET_REHASH) !== 0 ? this.metadata(REHASH_BASE) : 0;
		let work = 0;
		const memory = this.memory;
		if (cursor !== SWEEP_REHASH) {
			const base = this.metadata(BUCKETS), epoch = this.metadata(EPOCH) & STRING_GC_EPOCH_MASK;
			const ready = this.metadata(REHASH_READY), lowEnd = count + ready, end = lowEnd + ready;
			let index = cursor - 1, used = this.metadata(USED);
			let link = this.metadata(SWEEP_LINK), remaining = this.metadata(SWEEP_LEFT);
			// Freeze rehash until the remaining old buckets and the two prepared
			// prefixes have been swept. Inserts still select their owning bucket.
			while (index < end && allowance !== 0) {
				const bucket = index < count ? base + 4 * index : index < lowEnd
					? nextBase + 4 * (index - count) : nextBase + 4 * (index - ready);
				if (link === 0) { link = bucket; ++work; --allowance; }
				// A new intern can prepend before a survivor link, never after it.
				if (link === bucket) remaining = Math.min(used, MAX_RAM_RECORDS);
				let record = memory.readRamRecordWord(link);
				while (record !== 0 && remaining !== 0 && allowance !== 0
					&& memory.readRamRecordByte(record) === BLUA32_STRING_RECORD_KIND) {
					const next = memory.readRamRecordWord(record + BLUA32_STRING_NEXT_OFFSET);
					--remaining; --allowance; ++work;
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
			this.writeMetadata(USED, used);
			memory.writeRamRecordPair(this.metadataOffset + SWEEP_LINK, link, remaining);
			if (index < end) {
				this.writeMetadata(SWEEP, index + 1);
				return work;
			}
		}
		// Emergency admission can recover the old directory without waiting
		// for another distinct intern.
		if (nextBase !== 0) {
			if (allowance !== 0) work += this.rehashStep(count, nextBase, allowance);
			if (this.metadata(REHASH_BASE) !== 0) {
				this.writeMetadata(SWEEP, SWEEP_REHASH);
				return work;
			}
		} else if (count >= MIN_SHRINK_BUCKETS && this.metadata(USED) <= (count >>> 2)) {
			this.writeMetadata(CAPACITY, count | RAM_BUCKET_SHRINK);
			this.writeMetadata(SWEEP, SWEEP_SHRINK);
			return work + this.shrinkStep(count, allowance);
		}
		this.writeMetadata(SWEEP, 0);
		return work;
	}
}
