export const MAPPED_PAGE_BYTE_SHIFT = 10;
export const MAPPED_PAGE_BYTE_SIZE = 1 << MAPPED_PAGE_BYTE_SHIFT;
export const MAPPED_PAGE_BYTE_MASK = MAPPED_PAGE_BYTE_SIZE - 1;
const MAPPED_PAGE_WATCH_GROUP_COUNT = MAPPED_PAGE_BYTE_SIZE / (4 * 32);
// Match the native page word: code groups followed by history clean.
const CODE_GROUPS = (1 << MAPPED_PAGE_WATCH_GROUP_COUNT) - 1;
const HISTORY_CLEAN = 1 << MAPPED_PAGE_WATCH_GROUP_COUNT;

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

	public constructor(byteLength: number) {
		this.values = new Uint32Array(
			(byteLength + MAPPED_PAGE_BYTE_SIZE - 1) >>> MAPPED_PAGE_BYTE_SHIFT,
		);
		this.words = new Uint32Array(this.values.length * MAPPED_PAGE_WATCH_GROUP_COUNT);
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
		for (let page = 0; page < this.values.length; ++page) this.values[page] &= HISTORY_CLEAN;
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
		for (let page = 0; page < this.values.length; ++page) this.values[page] &= CODE_GROUPS;
		this.epoch = (this.epoch & ~1) >>> 0;
	}
	public historyEpoch(): number { return this.epoch; }
	public consumeHistoryWrites(offset: number, byteLength: number): void {
		if (byteLength === 0) return;
		const lastPage = (offset + byteLength - 1) >>> MAPPED_PAGE_BYTE_SHIFT;
		for (let page = offset >>> MAPPED_PAGE_BYTE_SHIFT; page <= lastPage; ++page) this.values[page] &= CODE_GROUPS;
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
			if ((flags & HISTORY_CLEAN) === 0) {
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
			if (this.values[page] & HISTORY_CLEAN) this.values[page] &= CODE_GROUPS;
			if ((this.values[page] & CODE_GROUPS) === 0) continue;
			const firstWord = ((page === firstPage ? offset & MAPPED_PAGE_BYTE_MASK : 0) >>> 2);
			const endWord = page === lastPage ? ((lastByte & MAPPED_PAGE_BYTE_MASK) >>> 2) + 1 : MAPPED_PAGE_BYTE_SIZE >>> 2;
			const affected = this.consume(page, firstWord, endWord);
			const key = keyBase + page * MAPPED_PAGE_BYTE_SIZE;
			if (affected) invalidator.invalidateMappedWords(key, firstWord, endWord);
		}
	}
}
