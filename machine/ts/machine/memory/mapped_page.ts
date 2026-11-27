import { CART_ROM_BASE, CART_BUS_END } from '../../spec/bmsx/memory_map';

export const MAPPED_PAGE_BYTE_SHIFT = 10;
export const MAPPED_PAGE_BYTE_SIZE = 1 << MAPPED_PAGE_BYTE_SHIFT;
export const MAPPED_PAGE_BYTE_MASK = MAPPED_PAGE_BYTE_SIZE - 1;

// The high lane identifies the mapped ROM aperture (system, cartridge 0, cartridge 1).
const MAPPED_PAGE_DOMAIN_KEY_STRIDE = 0x100000000;
export function mappedPageDomainKey(imageIndex: number): number { return imageIndex * MAPPED_PAGE_DOMAIN_KEY_STRIDE; }
export function mappedPageDomainIndex(key: number): number { return (key / MAPPED_PAGE_DOMAIN_KEY_STRIDE) >>> 0; }
export function mappedPageAddressKey(address: number, cartridgeSlot: number): number {
	return address >= CART_ROM_BASE && address < CART_BUS_END ? mappedPageDomainKey(1 + cartridgeSlot) + address : address;
}
const MAPPED_PAGE_WATCH_GROUP_COUNT = MAPPED_PAGE_BYTE_SIZE / (4 * 32);
// Match the native page word: code groups, history clean, and byte observers.
const CODE_GROUPS = (1 << MAPPED_PAGE_WATCH_GROUP_COUNT) - 1;
const HISTORY_CLEAN = 1 << MAPPED_PAGE_WATCH_GROUP_COUNT;
const BYTE_OBSERVERS = HISTORY_CLEAN << 1;
const BYTE_WATCH_COUNT = MAPPED_PAGE_BYTE_SIZE >>> 5;

function mappedWatchWordMask(group: number, firstWord: number, lastWord: number): number {
	return (group === (firstWord >>> 5) ? 0xffffffff << (firstWord & 31) : 0xffffffff)
		& (group === (lastWord >>> 5) ? 0xffffffff >>> (31 - (lastWord & 31)) : 0xffffffff);
}

export interface MappedPageInvalidator {
	invalidateMappedWords(key: number, firstWord: number, endWord: number): void;
	invalidateMappedRange(firstKey: number, endKey: number): void;
}

export type MappedPageBinding = {
	key: number;
	cacheable: boolean;
	readBytes: Uint8Array | null;
	readByteOffset: number;
	writeWatches: MappedPageWriteWatches | null;
	writeWatchIndex: number;
};

export class MappedPageWriteWatches {
	private readonly values: Uint32Array;
	private readonly words: Uint32Array;
	private bytePages: Map<number, Uint32Array> | null = null;
	private sharedBytes: Map<number, number> | null = null;
	private epoch = 0;

	public groupData(): Uint32Array { return this.values; }
	public anyWatched(first: number, length: number): boolean {
		if (length === 0) return false;
		const last = first + length - 1;
		const firstPage = first >>> MAPPED_PAGE_BYTE_SHIFT, lastPage = last >>> MAPPED_PAGE_BYTE_SHIFT;
		for (let page = firstPage; page <= lastPage; ++page) {
			const flags = this.values[page];
			const watchedGroups = flags & CODE_GROUPS;
			if (watchedGroups === 0) continue;
			if (page > firstPage && page < lastPage) return true;
			const firstWord = page === firstPage ? (first & MAPPED_PAGE_BYTE_MASK) >>> 2 : 0;
			const lastWord = page === lastPage ? (last & MAPPED_PAGE_BYTE_MASK) >>> 2 : MAPPED_PAGE_BYTE_MASK >>> 2;
			for (let group = firstWord >>> 5; group <= lastWord >>> 5; ++group) {
				if ((watchedGroups & (1 << group)) === 0) continue;
				const bits = this.words[page * MAPPED_PAGE_WATCH_GROUP_COUNT + group];
				if (bits & mappedWatchWordMask(group, firstWord, lastWord)) return true;
			}
		}
		return false;
	}

	public constructor(byteLength: number, groupBuffer?: ArrayBuffer, groupOffset = 0,
		private readonly observeByte?: (offset: number) => void) {
		const pages = (byteLength + MAPPED_PAGE_BYTE_SIZE - 1) >>> MAPPED_PAGE_BYTE_SHIFT;
		this.values = groupBuffer === undefined ? new Uint32Array(pages) : new Uint32Array(groupBuffer, groupOffset, pages);
		this.words = new Uint32Array(this.values.length * MAPPED_PAGE_WATCH_GROUP_COUNT);
	}

	public watchByte(offset: number): void {
		const page = offset >>> MAPPED_PAGE_BYTE_SHIFT;
		const pages = this.bytePages ??= new Map();
		let bytes = pages.get(page);
		if (bytes === undefined) {
			bytes = new Uint32Array(BYTE_WATCH_COUNT + 1);
			pages.set(page, bytes);
			this.values[page] |= BYTE_OBSERVERS;
		}
		const lane = (offset & MAPPED_PAGE_BYTE_MASK) >>> 5, bit = 1 << (offset & 31);
		if (bytes[lane] & bit) {
			const shared = this.sharedBytes ??= new Map();
			shared.set(offset, (shared.get(offset) ?? 1) + 1);
		} else {
			bytes[lane] |= bit;
			++bytes[BYTE_WATCH_COUNT];
		}
	}

	public unwatchByte(offset: number): void {
		const shared = this.sharedBytes;
		const count = shared?.get(offset);
		if (count !== undefined) {
			if (count === 2) shared!.delete(offset);
			else shared!.set(offset, count - 1);
			return;
		}
		const page = offset >>> MAPPED_PAGE_BYTE_SHIFT;
		const pages = this.bytePages!, bytes = pages.get(page)!;
		bytes[(offset & MAPPED_PAGE_BYTE_MASK) >>> 5] &= ~(1 << (offset & 31));
		if (--bytes[BYTE_WATCH_COUNT] === 0) {
			pages.delete(page);
			this.values[page] &= ~BYTE_OBSERVERS;
		}
	}

	private notifyByteWrites(page: number, first: number, last: number): void {
		const bytes = this.bytePages!.get(page)!;
		for (let group = first >>> 5; group <= last >>> 5; ++group) {
			let pending = bytes[group] & mappedWatchWordMask(group, first, last);
			while (pending !== 0) {
				const bit = pending & -pending;
				this.observeByte!(page * MAPPED_PAGE_BYTE_SIZE + group * 32 + 31 - Math.clz32(bit));
				// The observer may disarm a byte before continuing this write.
				pending = (pending ^ bit) & bytes[group];
			}
		}
	}

	public bind(offset: number, out: MappedPageBinding): void {
		out.writeWatches = this;
		out.writeWatchIndex = offset >>> MAPPED_PAGE_BYTE_SHIFT;
	}

	public armCodeRange(first: number, length: number): void {
		const last = first + length - 1;
		const firstPage = first >>> MAPPED_PAGE_BYTE_SHIFT, lastPage = last >>> MAPPED_PAGE_BYTE_SHIFT;
		for (let page = firstPage; page <= lastPage; ++page) {
			const begin = page === firstPage ? (first & MAPPED_PAGE_BYTE_MASK) >>> 2 : 0;
			const end = page === lastPage ? (last & MAPPED_PAGE_BYTE_MASK) >>> 2 : MAPPED_PAGE_BYTE_MASK >>> 2;
			for (let group = begin >>> 5; group <= end >>> 5; ++group) {
				this.values[page] |= 1 << group;
				this.words[page * MAPPED_PAGE_WATCH_GROUP_COUNT + group] |= mappedWatchWordMask(group, begin, end);
			}
		}
	}

	public clearCodeRange(first: number, length: number): void {
		const last = first + length - 1;
		const firstPage = first >>> MAPPED_PAGE_BYTE_SHIFT, lastPage = last >>> MAPPED_PAGE_BYTE_SHIFT;
		for (let page = firstPage; page <= lastPage; ++page) {
			const begin = page === firstPage ? (first & MAPPED_PAGE_BYTE_MASK) >>> 2 : 0;
			const end = page === lastPage ? (last & MAPPED_PAGE_BYTE_MASK) >>> 2 : MAPPED_PAGE_BYTE_MASK >>> 2;
			this.consume(page, begin, end + 1);
		}
	}

	public clear(): void {
		for (let page = 0; page < this.values.length; ++page) this.values[page] &= HISTORY_CLEAN | BYTE_OBSERVERS;
		this.words.fill(0);
	}

	public historyPageDirty(firstPage: number, endPage: number): boolean {
		for (let page = firstPage; page < endPage; ++page)
			if ((this.values[page] & HISTORY_CLEAN) === 0) return true;
		return false;
	}

	public armHistoryWrites(): void {
		for (let page = 0; page < this.values.length; ++page) this.values[page] |= HISTORY_CLEAN;
		this.epoch = ((this.epoch + 2) | 1) >>> 0;
	}

	public disarmHistoryWrites(): void {
		for (let page = 0; page < this.values.length; ++page) this.values[page] &= ~HISTORY_CLEAN;
		this.epoch = (this.epoch & ~1) >>> 0;
	}
	public historyEpoch(): number { return this.epoch; }
	public tracksPrivateWrites(): boolean { return (this.epoch & 1) !== 0 || (this.bytePages !== null && this.bytePages.size !== 0); }
	public invalidatePrivateWrite(offset: number, byteLength: number): void {
		if (byteLength === 0) return;
		const firstPage = offset >>> MAPPED_PAGE_BYTE_SHIFT;
		const lastByte = offset + byteLength - 1, lastPage = lastByte >>> MAPPED_PAGE_BYTE_SHIFT;
		for (let page = firstPage; page <= lastPage; ++page) {
			const flags = this.values[page];
			if (flags & HISTORY_CLEAN) this.values[page] = flags & ~HISTORY_CLEAN;
			if (flags & BYTE_OBSERVERS) this.notifyByteWrites(page,
				page === firstPage ? offset & MAPPED_PAGE_BYTE_MASK : 0,
				page === lastPage ? lastByte & MAPPED_PAGE_BYTE_MASK : MAPPED_PAGE_BYTE_MASK);
		}
	}

	public armWord(pageIndex: number, word: number): void {
		const group = word >>> 5;
		this.words[pageIndex * MAPPED_PAGE_WATCH_GROUP_COUNT + group] |= 1 << (word & 31);
		this.values[pageIndex] |= 1 << group;
	}

	private consume(page: number, firstWord: number, endWord: number): boolean {
		const lastWord = endWord - 1;
		let affected = false;
		for (let group = firstWord >>> 5; group <= (lastWord >>> 5); ++group) {
			const bit = 1 << group;
			if ((this.values[page] & bit) === 0) continue;
			const index = page * MAPPED_PAGE_WATCH_GROUP_COUNT + group;
			const hit = this.words[index] & mappedWatchWordMask(group, firstWord, lastWord);
			if (hit !== 0) {
				affected = true;
				this.words[index] ^= hit;
				if (this.words[index] === 0) this.values[page] &= ~bit;
			}
		}
		return affected;
	}

	public invalidateWrite(offset: number, byteLength: number, keyBase: number, invalidator: MappedPageInvalidator): void {
		if (byteLength === 0) return;
		const firstPage = offset >>> MAPPED_PAGE_BYTE_SHIFT;
		const lastByte = offset + byteLength - 1, lastPage = lastByte >>> MAPPED_PAGE_BYTE_SHIFT;
		if (firstPage === lastPage) {
			const flags = this.values[firstPage];
			if (flags === 0) return;
			if ((flags & (HISTORY_CLEAN | BYTE_OBSERVERS)) === 0) {
				const firstWord = (offset & MAPPED_PAGE_BYTE_MASK) >>> 2, lastWord = (lastByte & MAPPED_PAGE_BYTE_MASK) >>> 2;
				const firstGroup = firstWord >>> 5, lastGroup = lastWord >>> 5;
				if (firstGroup === lastGroup) {
					const mask = mappedWatchWordMask(firstGroup, firstWord, lastWord);
					if ((this.words[firstPage * MAPPED_PAGE_WATCH_GROUP_COUNT + firstGroup] & mask) === 0) return;
				} else if (((flags & CODE_GROUPS) & ((2 << lastGroup) - (1 << firstGroup))) === 0) {
					return;
				}
			}
		}
		for (let page = firstPage; page <= lastPage; ++page) {
			const flags = this.values[page];
			if (flags === 0) continue;
			if (flags & HISTORY_CLEAN) this.values[page] = flags & ~HISTORY_CLEAN;
			const first = page === firstPage ? offset & MAPPED_PAGE_BYTE_MASK : 0;
			const last = page === lastPage ? lastByte & MAPPED_PAGE_BYTE_MASK : MAPPED_PAGE_BYTE_MASK;
			if ((flags & CODE_GROUPS) !== 0 && this.consume(page, first >>> 2, (last >>> 2) + 1))
				invalidator.invalidateMappedWords(keyBase + page * MAPPED_PAGE_BYTE_SIZE, first >>> 2, (last >>> 2) + 1);
			if (flags & BYTE_OBSERVERS) this.notifyByteWrites(page, first, last);
		}
	}
}
