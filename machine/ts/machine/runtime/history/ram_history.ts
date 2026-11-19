import { MAPPED_PAGE_BYTE_MASK, MAPPED_PAGE_BYTE_SHIFT } from '../../memory/mapped_page';
import type { Memory } from '../../memory/memory';

const PAGE_BYTES = 4096;
const SLAB_PAGES = 16;

type Page = {
	bytes: Uint8Array;
	references: number;
	nextFree: number;
};

/** Each checkpoint retains a complete map of shared immutable page versions. */
export class RamHistory {
	private readonly versions: Page[] = [];
	private readonly livePages: Uint8Array[] = [];
	private firstFree = 0;

	public start(memory: Memory): void {
		const ram = memory.ramData();
		for (let offset = 0; offset < ram.length; offset += PAGE_BYTES)
			this.livePages.push(ram.subarray(offset, offset + PAGE_BYTES));
	}

	public clear(): void {
		this.versions.length = 0;
		this.livePages.length = 0;
		this.firstFree = 0;
	}

	private allocate(): number {
		if (this.firstFree === 0) {
			const first = this.versions.length + 1;
			const slab = new Uint8Array(PAGE_BYTES * SLAB_PAGES);
			for (let i = 0; i < SLAB_PAGES; ++i) {
				this.versions.push({
					bytes: slab.subarray(i * PAGE_BYTES, (i + 1) * PAGE_BYTES),
					references: 0,
					nextFree: i + 1 < SLAB_PAGES ? first + i + 1 : 0,
				});
			}
			this.firstFree = first;
		}
		const id = this.firstFree, entry = this.versions[id - 1];
		this.firstFree = entry.nextFree;
		entry.references = 1;
		return id;
	}

	private release(id: number): void {
		if (id === 0) return;
		const entry = this.versions[id - 1];
		if (--entry.references !== 0) return;
		entry.nextFree = this.firstFree;
		this.firstFree = id;
	}

	public capture(memory: Memory, baseline: Uint32Array | null, destination: Uint32Array = new Uint32Array(this.livePages.length)): Uint32Array {
		const watches = memory.ramWriteWatches();
		for (let index = 0; index < destination.length; ++index) {
			const id = destination[index], live = this.livePages[index], offset = index * PAGE_BYTES;
			if (baseline !== null && !watches.historyPageDirty(offset >>> MAPPED_PAGE_BYTE_SHIFT,
				(offset + live.length + MAPPED_PAGE_BYTE_MASK) >>> MAPPED_PAGE_BYTE_SHIFT)) {
				const shared = baseline[index];
				if (id !== shared) {
					++this.versions[shared - 1].references;
					this.release(id);
					destination[index] = shared;
				}
			} else {
				this.release(id);
				const next = this.allocate();
				this.versions[next - 1].bytes.set(live);
				destination[index] = next;
			}
		}
		watches.armHistoryWrites();
		return destination;
	}

	public restore(memory: Memory, baseline: Uint32Array, source: Uint32Array): void {
		const watches = memory.ramWriteWatches();
		for (let index = 0; index < source.length; ++index) {
			const live = this.livePages[index], offset = index * PAGE_BYTES;
			if (baseline[index] !== source[index] || watches.historyPageDirty(offset >>> MAPPED_PAGE_BYTE_SHIFT,
				(offset + live.length + MAPPED_PAGE_BYTE_MASK) >>> MAPPED_PAGE_BYTE_SHIFT)) {
				const bytes = this.versions[source[index] - 1].bytes;
				live.set(live.length === PAGE_BYTES ? bytes : bytes.subarray(0, live.length));
			}
		}
		watches.armHistoryWrites();
	}
}
