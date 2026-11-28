import { isRamStringId, storageOffset, type StringId } from '../../../machine/ts/machine/cpu/string_pool';
import {
	BUCKETS, CAPACITY, FIRST_CART, MAX_RAM_RECORDS, RAM_BUCKET_EXTENT_MASK, RAM_BUCKET_REHASH, RAM_BUCKET_SHRINK,
	REHASH_BASE, REHASH_READY, ROM_TABLES, StockStringIndex, USED, romStringId,
} from '../../../toolchain/ts/firmware/stock_string_index';
import { writeByteString } from '../../../machine/ts/common/byte_string';
import { readLE32 } from '../../../machine/ts/common/endian';
import { hashText } from '../../../machine/ts/common/hash';
import type { ExecutionDomainId } from '../../../machine/ts/spec/blua32/execution_domain';
import {
	BLUA32_STRING_HASH_OFFSET, BLUA32_STRING_LENGTH_OFFSET, BLUA32_STRING_NEXT_OFFSET,
	BLUA32_STRING_RECORD_HEADER_SIZE,
	BLUA32_STRING_RECORD_KIND,
} from '../../../machine/ts/spec/blua32/image_format';
import { CART_ROM_SIZE, HEAP_PAGE_SIZE, MAIN_RAM_SIZE } from '../../../machine/ts/spec/bmsx/memory_map';
import type { Memory } from '../../../machine/ts/machine/memory/memory';
import type { HeapAllocator } from './heap_allocator';
import { HEAP_STRING_MARK_WORK_OFFSET } from '../firmware_heap_layout';
import type { LuaHeap } from './lua_heap';
import { valueNil, valueString } from '../../../machine/ts/machine/cpu/value';

export { isRamStringId, type StringId } from '../../../machine/ts/machine/cpu/string_pool';
export const STRING_GC_EPOCH_MASK = 1;

const EPOCH = 0x0c, SWEEP = 0x10;
const SWEEP_LINK = 0x30, SWEEP_LEFT = 0x34;
const SWEEP_REHASH = 0x80000000;
const SWEEP_SHRINK = 0xc0000000;
const INITIAL_BUCKETS = 16;
const MIN_SHRINK_BUCKETS = 2 * HEAP_PAGE_SIZE / 4;
const INTERN_REHASH_WORK = 64;
type InternSource = string | Uint8Array;

// All persistent interning and collection state is in the raw machine RAM.
export class StringPool extends StockStringIndex {
	private readonly localRoots: StringId[] = [];
	private readonly localRootBases: number[] = [];
	private readonly markWorkOffset: number;

	public constructor(private readonly heap: LuaHeap, memory: Memory, private readonly arena: HeapAllocator) {
		super(memory);
		this.markWorkOffset = arena.managementOffset() + HEAP_STRING_MARK_WORK_OFFSET;
	}
	private writeMetadata(field: number, word: number): void { this.memory.writeRamRecordWord(this.metadataOffset + field, word); }

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
