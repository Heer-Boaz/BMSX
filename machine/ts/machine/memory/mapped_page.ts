export const MAPPED_PAGE_BYTE_SHIFT = 10;
export const MAPPED_PAGE_BYTE_SIZE = 1 << MAPPED_PAGE_BYTE_SHIFT;
export const MAPPED_PAGE_BYTE_MASK = MAPPED_PAGE_BYTE_SIZE - 1;

export interface MappedPageInvalidator {
	invalidateMappedPage(key: number): void;
	invalidateMappedRange(firstKey: number, endKey: number): void;
}

export type MappedPageBinding = {
	key: number;
	cacheable: boolean;
	readBytes: Uint8Array | null;
	readByteOffset: number;
	writeWatches: Uint8Array | null;
	writeWatchIndex: number;
};

export class MappedPageWriteWatches {
	private readonly values: Uint8Array;

	public constructor(byteLength: number) {
		this.values = new Uint8Array(
			(byteLength + MAPPED_PAGE_BYTE_SIZE - 1) >>> MAPPED_PAGE_BYTE_SHIFT,
		);
	}

	public bind(offset: number, out: MappedPageBinding): void {
		out.writeWatches = this.values;
		out.writeWatchIndex = offset >>> MAPPED_PAGE_BYTE_SHIFT;
	}

	public clear(): void {
		for (let index = 0; index < this.values.length; index += 1) {
			this.values[index] = 0;
		}
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
				this.values[firstPage] = 0;
				invalidator.invalidateMappedPage(keyBase + firstPage * MAPPED_PAGE_BYTE_SIZE);
			}
			return;
		}
		for (let page = firstPage; page <= lastPage; page += 1) {
			if (this.values[page] !== 0) {
				this.values[page] = 0;
				invalidator.invalidateMappedPage(keyBase + page * MAPPED_PAGE_BYTE_SIZE);
			}
		}
	}
}
