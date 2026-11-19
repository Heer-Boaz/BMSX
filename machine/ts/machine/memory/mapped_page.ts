export const MAPPED_PAGE_BYTE_SHIFT = 10;
export const MAPPED_PAGE_BYTE_SIZE = 1 << MAPPED_PAGE_BYTE_SHIFT;
export const MAPPED_PAGE_BYTE_MASK = MAPPED_PAGE_BYTE_SIZE - 1;
const WATCH_CODE = 1, WATCH_VIEW = 2;
const MAPPED_PAGE_WATCH_GROUP_COUNT = MAPPED_PAGE_BYTE_SIZE / (4 * 32);

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
	private readonly values: Uint8Array;
	private readonly words: Uint32Array;
	private readonly views: Uint32Array;

	public groupData(): Uint8Array { return this.values; }
	public anyWatched(first: number, length: number, includeViews = true): boolean {
		if (length === 0) return false;
		const last = first + length - 1;
		const firstPage = first >>> MAPPED_PAGE_BYTE_SHIFT, lastPage = last >>> MAPPED_PAGE_BYTE_SHIFT;
		for (let page = firstPage; page <= lastPage; ++page) {
			const watchedGroups = this.values[page];
			if (watchedGroups === 0) continue;
			if (includeViews && page > firstPage && page < lastPage) return true;
			const firstWord = page === firstPage ? (first & MAPPED_PAGE_BYTE_MASK) >>> 2 : 0;
			const lastWord = page === lastPage ? (last & MAPPED_PAGE_BYTE_MASK) >>> 2 : MAPPED_PAGE_BYTE_MASK >>> 2;
			const wordBase = page * MAPPED_PAGE_WATCH_GROUP_COUNT;
			for (let group = firstWord >>> 5; group <= lastWord >>> 5; ++group) {
				if ((watchedGroups & (1 << group)) === 0) continue;
				const index = wordBase + group;
				const bits = includeViews && this.views.length !== 0 ? this.words[index] | this.views[index] : this.words[index];
				if (bits & mappedWatchWordMask(group, firstWord, lastWord)) return true;
			}
		}
		return false;
	}

	public constructor(byteLength: number, watchViews = false) {
		this.values = new Uint8Array(
			(byteLength + MAPPED_PAGE_BYTE_SIZE - 1) >>> MAPPED_PAGE_BYTE_SHIFT,
		);
		this.words = new Uint32Array(this.values.length * MAPPED_PAGE_WATCH_GROUP_COUNT);
		this.views = new Uint32Array(watchViews ? this.words.length : 0);
	}

	public bind(offset: number, out: MappedPageBinding): void {
		out.writeWatches = this;
		out.writeWatchIndex = offset >>> MAPPED_PAGE_BYTE_SHIFT;
	}

	public clear(): void {
		this.values.fill(0);
		this.words.fill(0);
		this.views.fill(0);
	}

	public armWord(pageIndex: number, word: number): void { this.arm(this.words, pageIndex, word); }
	public armViewWord(pageIndex: number, word: number): void { this.arm(this.views, pageIndex, word); }

	private arm(bank: Uint32Array, pageIndex: number, word: number): void {
		const group = word >>> 5;
		bank[pageIndex * MAPPED_PAGE_WATCH_GROUP_COUNT + group] |= 1 << (word & 31);
		this.values[pageIndex] |= 1 << group;
	}

	private consume(page: number, firstWord: number, endWord: number, reportViews: boolean): number {
		const lastWord = endWord - 1;
		let affected = 0;
		for (let group = firstWord >>> 5; group <= (lastWord >>> 5); ++group) {
			const bit = 1 << group;
			if ((this.values[page] & bit) === 0) continue;
			const index = page * MAPPED_PAGE_WATCH_GROUP_COUNT + group;
			const mask = mappedWatchWordMask(group, firstWord, lastWord);
			const code = this.words[index];
			let views = this.views.length !== 0 ? this.views[index] : 0;
			if (code & mask) affected |= WATCH_CODE;
			this.words[index] = code & ~mask;
			if (reportViews && (views & mask)) {
				affected |= WATCH_VIEW;
				views &= ~mask;
				this.views[index] = views;
			}
			if ((this.words[index] | views) === 0) this.values[page] &= ~bit;
		}
		return affected;
	}

	public invalidateWrite(offset: number, byteLength: number, keyBase: number, invalidator: MappedPageInvalidator, reportViews = true): void {
		if (byteLength === 0) return;
		const firstPage = offset >>> MAPPED_PAGE_BYTE_SHIFT;
		const lastByte = offset + byteLength - 1, lastPage = lastByte >>> MAPPED_PAGE_BYTE_SHIFT;
		if (firstPage === lastPage && this.values[firstPage] === 0) return;
		for (let page = firstPage; page <= lastPage; ++page) {
			if (this.values[page] === 0) continue;
			const firstWord = ((page === firstPage ? offset & MAPPED_PAGE_BYTE_MASK : 0) >>> 2);
			const endWord = page === lastPage ? ((lastByte & MAPPED_PAGE_BYTE_MASK) >>> 2) + 1 : MAPPED_PAGE_BYTE_SIZE >>> 2;
			const reason = this.consume(page, firstWord, endWord, reportViews);
			const key = keyBase + page * MAPPED_PAGE_BYTE_SIZE;
			if (reason & WATCH_VIEW) invalidator.invalidateMappedViews!(key, firstWord, endWord);
			if (reason & WATCH_CODE) invalidator.invalidateMappedWords(key, firstWord, endWord);
		}
	}
}
