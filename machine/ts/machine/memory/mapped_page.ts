export const MAPPED_PAGE_BYTE_SHIFT = 10;
export const MAPPED_PAGE_BYTE_SIZE = 1 << MAPPED_PAGE_BYTE_SHIFT;
export const MAPPED_PAGE_BYTE_MASK = MAPPED_PAGE_BYTE_SIZE - 1;
const MAPPED_PAGE_WATCH_GROUP_COUNT = MAPPED_PAGE_BYTE_SIZE / (4 * 32);

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
	private readonly values: Uint8Array;
	private readonly words: Uint32Array;

	public groupData(): Uint8Array { return this.values; }

	public constructor(byteLength: number) {
		this.values = new Uint8Array(
			(byteLength + MAPPED_PAGE_BYTE_SIZE - 1) >>> MAPPED_PAGE_BYTE_SHIFT,
		);
		this.words = new Uint32Array(this.values.length * MAPPED_PAGE_WATCH_GROUP_COUNT);
	}

	public bind(offset: number, out: MappedPageBinding): void {
		out.writeWatches = this;
		out.writeWatchIndex = offset >>> MAPPED_PAGE_BYTE_SHIFT;
	}

	public clear(): void {
		this.values.fill(0);
		this.words.fill(0);
	}

	public armWord(pageIndex: number, word: number): void {
		const group = word >>> 5;
		this.words[pageIndex * MAPPED_PAGE_WATCH_GROUP_COUNT + group] |= 1 << (word & 31);
		this.values[pageIndex] |= 1 << group;
	}

	private consume(pageIndex: number, firstWord: number, endWord: number): boolean {
		if (endWord === firstWord + 1) {
			const group = firstWord >>> 5;
			const bit = 1 << (firstWord & 31);
			const index = pageIndex * MAPPED_PAGE_WATCH_GROUP_COUNT + group;
			const watched = this.words[index];
			if ((watched & bit) === 0) return false;
			const remaining = watched & ~bit;
			this.words[index] = remaining;
			if (remaining === 0) this.values[pageIndex] &= ~(1 << group);
			return true;
		}
		const firstGroup = firstWord >>> 5;
		const lastGroup = (endWord - 1) >>> 5;
		let affected = false;
		for (let group = firstGroup; group <= lastGroup; group++) {
			const groupBit = 1 << group;
			if ((this.values[pageIndex] & groupBit) === 0) continue;
			const mask = (group === firstGroup ? 0xffffffff << (firstWord & 31) : 0xffffffff)
				& (group === lastGroup ? 0xffffffff >>> (31 - ((endWord - 1) & 31)) : 0xffffffff);
			const index = pageIndex * MAPPED_PAGE_WATCH_GROUP_COUNT + group;
			const watched = this.words[index];
			affected = affected || (watched & mask) !== 0;
			const remaining = watched & ~mask;
			this.words[index] = remaining;
			if (remaining === 0) this.values[pageIndex] &= ~groupBit;
		}
		return affected;
	}

	public invalidateWrite(
		offset: number,
		byteLength: number,
		keyBase: number,
		invalidator: MappedPageInvalidator,
	): void {
		if (byteLength === 0) {
			return;
		}
		const firstPage = offset >>> MAPPED_PAGE_BYTE_SHIFT;
		const lastPage = (offset + byteLength - 1) >>> MAPPED_PAGE_BYTE_SHIFT;
		if (firstPage === lastPage) {
			if (this.values[firstPage] !== 0) {
				const firstByte = offset & MAPPED_PAGE_BYTE_MASK;
				const endByte = firstByte + byteLength;
				const firstWord = firstByte >>> 2;
				const endWord = (endByte + 3) >>> 2;
				if (this.consume(firstPage, firstWord, endWord)) {
					invalidator.invalidateMappedWords(
						keyBase + firstPage * MAPPED_PAGE_BYTE_SIZE, firstWord, endWord,
					);
				}
			}
			return;
		}
		for (let page = firstPage; page <= lastPage; page += 1) {
			if (this.values[page] !== 0) {
				const firstByte = page === firstPage ? offset & MAPPED_PAGE_BYTE_MASK : 0;
				const endByte = page === lastPage
					? ((offset + byteLength - 1) & MAPPED_PAGE_BYTE_MASK) + 1
					: MAPPED_PAGE_BYTE_SIZE;
				const firstWord = firstByte >>> 2;
				const endWord = (endByte + 3) >>> 2;
				if (this.consume(page, firstWord, endWord)) {
					invalidator.invalidateMappedWords(
						keyBase + page * MAPPED_PAGE_BYTE_SIZE, firstWord, endWord,
					);
				}
			}
		}
	}
}
