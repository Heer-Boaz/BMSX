export const MAPPED_PAGE_BYTE_SHIFT = 10;
export const MAPPED_PAGE_BYTE_SIZE = 1 << MAPPED_PAGE_BYTE_SHIFT;
export const MAPPED_PAGE_BYTE_MASK = MAPPED_PAGE_BYTE_SIZE - 1;

export type MappedPageBinding = {
	key: number;
	revisions: Float64Array | null;
	revisionIndex: number;
};

export class MappedPageRevisions {
	public readonly values: Float64Array;
	private nextRevision = 1;

	public constructor(byteLength: number) {
		this.values = new Float64Array(
			(byteLength + MAPPED_PAGE_BYTE_SIZE - 1) >>> MAPPED_PAGE_BYTE_SHIFT,
		);
	}

	public touch(offset: number, byteLength: number): void {
		if (byteLength === 0) {
			return;
		}
		const firstPage = offset >>> MAPPED_PAGE_BYTE_SHIFT;
		const lastPage = (offset + byteLength - 1) >>> MAPPED_PAGE_BYTE_SHIFT;
		const revision = this.nextRevision;
		this.nextRevision += 1;
		if (firstPage === lastPage) {
			this.values[firstPage] = revision;
		} else {
			this.values.fill(revision, firstPage, lastPage + 1);
		}
	}
}
