export const MAPPED_PAGE_BYTE_SHIFT = 10;
export const MAPPED_PAGE_BYTE_SIZE = 1 << MAPPED_PAGE_BYTE_SHIFT;
export const MAPPED_PAGE_BYTE_MASK = MAPPED_PAGE_BYTE_SIZE - 1;
const WATCH_CODE = 1, WATCH_VIEW = 2;
const MAPPED_PAGE_WATCH_GROUP_COUNT = MAPPED_PAGE_BYTE_SIZE / (4 * 32);
// Match the native page word: code groups, view groups, history clean.
const VIEW_SHIFT = MAPPED_PAGE_WATCH_GROUP_COUNT;
const CODE_GROUPS = (1 << VIEW_SHIFT) - 1;
const WATCH_GROUP_MASK = CODE_GROUPS | (CODE_GROUPS << VIEW_SHIFT);
const HISTORY_CLEAN = 1 << (2 * VIEW_SHIFT);

function watchedGroupBits(flags: number, includeViews: boolean): number {
	return (flags | (includeViews ? flags >>> VIEW_SHIFT : 0)) & CODE_GROUPS;
}

function mappedWatchWordMask(group: number, firstWord: number, lastWord: number): number {
	return (group === (firstWord >>> 5) ? 0xffffffff << (firstWord & 31) : 0xffffffff)
		& (group === (lastWord >>> 5) ? 0xffffffff >>> (31 - (lastWord & 31)) : 0xffffffff);
}

export interface MappedPageInvalidator {
	invalidateMappedWords(key: number, firstWord: number, endWord: number): void;
	invalidateMappedRange(firstKey: number, endKey: number): void;
	invalidateMappedViews?(key: number, firstWord: number, endWord: number): void;
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
	private readonly views: Uint32Array;

	public groupData(): Uint32Array { return this.values; }
	public anyWatched(first: number, length: number, includeViews = true): boolean {
		if (length === 0) return false;
		const last = first + length - 1;
		const firstPage = first >>> MAPPED_PAGE_BYTE_SHIFT, lastPage = last >>> MAPPED_PAGE_BYTE_SHIFT;
		for (let page = firstPage; page <= lastPage; ++page) {
			const flags = this.values[page];
			const watchedGroups = watchedGroupBits(flags, includeViews);
			if (watchedGroups === 0) continue;
			if (page > firstPage && page < lastPage) return true;
			const firstWord = page === firstPage ? (first & MAPPED_PAGE_BYTE_MASK) >>> 2 : 0;
			const lastWord = page === lastPage ? (last & MAPPED_PAGE_BYTE_MASK) >>> 2 : MAPPED_PAGE_BYTE_MASK >>> 2;
			for (let group = firstWord >>> 5; group <= lastWord >>> 5; ++group) {
				if ((watchedGroups & (1 << group)) === 0) continue;
				const bits = this.watchedWords(page, group, flags, includeViews);
				if (bits & mappedWatchWordMask(group, firstWord, lastWord)) return true;
			}
		}
		return false;
	}

	public constructor(byteLength: number, watchViews = false) {
		this.values = new Uint32Array(
			(byteLength + MAPPED_PAGE_BYTE_SIZE - 1) >>> MAPPED_PAGE_BYTE_SHIFT,
		);
		this.words = new Uint32Array(this.values.length * MAPPED_PAGE_WATCH_GROUP_COUNT);
		this.views = new Uint32Array(watchViews ? this.words.length : 0);
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
			this.consume(page, begin, end + 1, false);
		}
	}

	public clear(): void {
		for (let page = 0; page < this.values.length; ++page) this.values[page] &= HISTORY_CLEAN;
		this.words.fill(0);
		this.views.fill(0);
	}

	public historyPageDirty(firstPage: number, endPage: number): boolean {
		for (let page = firstPage; page < endPage; ++page)
			if ((this.values[page] & HISTORY_CLEAN) === 0) return true;
		return false;
	}

	public armHistoryWrites(): void {
		for (let page = 0; page < this.values.length; ++page) this.values[page] |= HISTORY_CLEAN;
	}

	public disarmHistoryWrites(): void {
		for (let page = 0; page < this.values.length; ++page) this.values[page] &= WATCH_GROUP_MASK;
	}

	public armWord(pageIndex: number, word: number): void { this.arm(this.words, pageIndex, word, 0); }
	public armViewWord(pageIndex: number, word: number): void { this.arm(this.views, pageIndex, word, VIEW_SHIFT); }

	private arm(bank: Uint32Array, pageIndex: number, word: number, shift: number): void {
		const group = word >>> 5;
		bank[pageIndex * MAPPED_PAGE_WATCH_GROUP_COUNT + group] |= 1 << (word & 31);
		this.values[pageIndex] |= 1 << (group + shift);
	}

	private watchedWords(page: number, group: number, flags: number, includeViews: boolean): number {
		const index = page * MAPPED_PAGE_WATCH_GROUP_COUNT + group;
		const bit = 1 << group;
		const code = (flags & bit) !== 0 ? this.words[index] : 0;
		return includeViews && (flags & (bit << VIEW_SHIFT)) !== 0 ? code | this.views[index] : code;
	}

	private consume(page: number, firstWord: number, endWord: number, reportViews: boolean): number {
		const lastWord = endWord - 1;
		let affected = 0;
		for (let group = firstWord >>> 5; group <= (lastWord >>> 5); ++group) {
			const bit = 1 << group;
			const viewBit = bit << VIEW_SHIFT;
			const index = page * MAPPED_PAGE_WATCH_GROUP_COUNT + group;
			const mask = mappedWatchWordMask(group, firstWord, lastWord);
			if (this.values[page] & bit) {
				const hit = this.words[index] & mask;
				if (hit !== 0) {
					affected |= WATCH_CODE;
					this.words[index] ^= hit;
					if (this.words[index] === 0) this.values[page] &= ~bit;
				}
			}
			if (reportViews && (this.values[page] & viewBit)) {
				const hit = this.views[index] & mask;
				if (hit !== 0) {
					affected |= WATCH_VIEW;
					this.views[index] ^= hit;
					if (this.views[index] === 0) this.values[page] &= ~viewBit;
				}
			}
		}
		return affected;
	}

	public invalidateWrite(offset: number, byteLength: number, keyBase: number, invalidator: MappedPageInvalidator, reportViews = true): void {
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
					if ((this.watchedWords(firstPage, firstGroup, flags, reportViews) & mask) === 0) return;
				} else if ((watchedGroupBits(flags, reportViews) & ((2 << lastGroup) - (1 << firstGroup))) === 0) {
					return;
				}
			}
		}
		for (let page = firstPage; page <= lastPage; ++page) {
			if (this.values[page] & HISTORY_CLEAN) this.values[page] &= WATCH_GROUP_MASK;
			if (watchedGroupBits(this.values[page], reportViews) === 0) continue;
			const firstWord = ((page === firstPage ? offset & MAPPED_PAGE_BYTE_MASK : 0) >>> 2);
			const endWord = page === lastPage ? ((lastByte & MAPPED_PAGE_BYTE_MASK) >>> 2) + 1 : MAPPED_PAGE_BYTE_SIZE >>> 2;
			const reason = this.consume(page, firstWord, endWord, reportViews);
			const key = keyBase + page * MAPPED_PAGE_BYTE_SIZE;
			if (reason & WATCH_VIEW) invalidator.invalidateMappedViews!(key, firstWord, endWord);
			if (reason & WATCH_CODE) invalidator.invalidateMappedWords(key, firstWord, endWord);
		}
	}
}
