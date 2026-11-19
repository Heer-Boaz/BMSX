import { DYNAMIC_RAM_BASE, HEAP_PAGE_SIZE, MAIN_RAM_SIZE, RAM_BASE, RUNTIME_MANAGEMENT_SIZE } from '../../spec/bmsx/memory_map';
import type { Memory } from '../memory/memory';

// Requests up to half a page share 4 KB pages of one size class: multiples of
// 8 bytes through 64, then four classes per doubling. Larger requests take the
// highest fitting run of whole pages.
export const HEAP_SMALL_LIMIT = 2048;
export const HEAP_CLASS_BYTES: readonly number[] = [
	8, 16, 24, 32, 40, 48, 56, 64,
	80, 96, 112, 128, 160, 192, 224, 256,
	320, 384, 448, 512, 640, 768, 896, 1024,
	1280, 1536, 1792, 2048,
];
const CLASS_COUNT = 28;
const PAGE_SHIFT = 12;
const PAGE_MASK = HEAP_PAGE_SIZE - 1;
const MAX_PAGES = (MAIN_RAM_SIZE - RUNTIME_MANAGEMENT_SIZE) >>> PAGE_SHIFT;

// Management-area layout, as byte offsets from its base. Every field is a
// little-endian word in guest RAM; partial-list links store page + 1.
const FLOOR = 0x000;
const OCCUPIED = 0x004;
const SWEEP_PAGE = 0x008;
const PARTIAL_HEADS = 0x040;
const AVAILABLE_PAGES = 0x200;
const PAGE_ENTRIES = 0x1000;
const PAGE_ENTRY_BYTES = 12;

// Page entry: word 0 = kind | class << 8 | live << 16; word 1 = free-slot head
// (guest address), run length or run head. Word 2 packs the bump in units
// of 8 bytes, then the previous and next partial-page links, 10 bits each.
const BUMP_SHIFT = 3;
const LINK_MASK = 0x3ff;
const PREVIOUS_SHIFT = 10;
const NEXT_SHIFT = 20;
const enum PageKind {
	Unused = 0,
	ObjectSlots = 1,
	OwnedSlots = 2,
	ObjectRun = 3,
	OwnedRun = 4,
	RunTail = 5,
}

export function heapClassIndex(byteCount: number): number {
	if (byteCount <= 64) {
		return ((byteCount + 7) >>> 3) - 1;
	}
	// byteCount lies in (2^(ceilingShift - 1), 2^ceilingShift]; that span has four classes.
	const ceilingShift = 32 - Math.clz32(byteCount - 1);
	const stepShift = ceilingShift - 3;
	const quarter = (byteCount - (1 << (ceilingShift - 1)) + (1 << stepShift) - 1) >>> stepShift;
	return 8 + (ceilingShift - 7) * 4 + quarter - 1;
}

export function heapAllocationBytes(byteCount: number): number {
	return byteCount <= HEAP_SMALL_LIMIT
		? HEAP_CLASS_BYTES[heapClassIndex(byteCount)]
		: (byteCount + PAGE_MASK) & ~PAGE_MASK;
}

// Owns the non-moving language-heap allocator whose entire state lives in the
// runtime management area. Pointers read back from RAM are guest-writable and
// are validated before use; a broken invariant fails as an unsatisfied request.
export class HeapAllocator {
	private readonly management: number;
	private readonly pageLimit: number;
	private readonly minimumFloorPage: number;
	private readonly lastAvailableMask: number;

	public constructor(private readonly memory: Memory) {
		this.management = (memory.ramByteCount() & ~PAGE_MASK) - RUNTIME_MANAGEMENT_SIZE;
		this.pageLimit = Math.min(this.management >>> PAGE_SHIFT, MAX_PAGES);
		this.minimumFloorPage = Math.min((DYNAMIC_RAM_BASE - RAM_BASE) >>> PAGE_SHIFT, this.pageLimit);
		const tailBits = this.pageLimit & 31;
		this.lastAvailableMask = tailBits === 0 ? -1 : ~(-1 << tailBits);
		this.reset(DYNAMIC_RAM_BASE);
	}

	public managementOffset(): number {
		return this.management;
	}

	public reset(floorAddress: number): void {
		this.memory.ramData().fill(0, this.management, this.management + RUNTIME_MANAGEMENT_SIZE);
		this.memory.invalidateRamWrite(this.management, RUNTIME_MANAGEMENT_SIZE);
		const floorPage = this.pageForFloor(floorAddress);
		this.setAvailable(floorPage, this.pageLimit, true);
		this.memory.writeRamRecordWord(this.management + FLOOR, RAM_BASE + (floorPage << PAGE_SHIFT));
	}

	// Raising the floor is refused while an allocated page lies below it.
	public setFloor(floorAddress: number): boolean {
		const current = this.floorPage();
		const next = this.pageForFloor(floorAddress);
		if (next > current) {
			for (let page = current; page < next; page += 1) {
				if (!this.isAvailable(page)) {
					return false;
				}
			}
			this.setAvailable(current, next, false);
		} else if (next < current) {
			this.setAvailable(next, current, true);
		}
		this.memory.writeRamRecordWord(this.management + FLOOR, RAM_BASE + (next << PAGE_SHIFT));
		return true;
	}

	public floorAddress(): number {
		return RAM_BASE + (this.floorPage() << PAGE_SHIFT);
	}

	public capacityBytes(): number {
		return (this.pageLimit - this.floorPage()) << PAGE_SHIFT;
	}

	public occupiedBytes(): number {
		return this.memory.readRamRecordWord(this.management + OCCUPIED);
	}

	public beginObjectSweep(): void {
		this.memory.writeRamRecordWord(this.management + SWEEP_PAGE, this.floorPage());
	}

	public objectSweepActive(): boolean {
		return this.memory.readRamRecordWord(this.management + SWEEP_PAGE) < this.pageLimit;
	}

	public sweepObjects(allowance: number, visit: (address: number) => boolean): number {
		const cursor = this.management + SWEEP_PAGE;
		let page = this.memory.readRamRecordWord(cursor);
		if (page >= this.pageLimit) return 0;
		let work = 0;
		while (page < this.pageLimit && work < allowance) {
			const pageEntry = this.entry(page);
			const info = this.memory.readRamRecordWord(pageEntry);
			const base = RAM_BASE + (page << PAGE_SHIFT);
			++page;
			switch (info & 0xff) {
				case PageKind.ObjectRun:
					++work;
					page += Math.min((this.memory.readRamRecordWord(pageEntry + 4) - 1) >>> 0, this.pageLimit - page);
					if (this.memory.readRamRecordByte(base) !== 0) visit(base);
					break;
				case PageKind.ObjectSlots: {
					const classIndex = (info >>> 8) & 0xff;
					// The class and bump come from cartridge-writable management RAM.
					if (classIndex >= CLASS_COUNT) break;
					const stride = HEAP_CLASS_BYTES[classIndex];
					const end = Math.min((this.memory.readRamRecordWord(pageEntry + 8) & LINK_MASK) << BUMP_SHIFT, HEAP_PAGE_SIZE);
					let live = info >>> 16;
					for (let slot = 0; slot + stride <= end; slot += stride) {
						++work;
						const address = base + slot;
						if (this.memory.readRamRecordByte(address) !== 0 && visit(address) && --live === 0) break;
					}
					break;
				}
			}
		}
		this.memory.writeRamRecordWord(cursor, page);
		return work;
	}

	// Returns the guest address of the allocation, or 0 when no slot or page run fits.
	public allocate(byteCount: number, owned: boolean): number {
		if (byteCount > HEAP_SMALL_LIMIT) {
			return this.allocateRun(byteCount, owned);
		}
		const classIndex = heapClassIndex(byteCount);
		const size = HEAP_CLASS_BYTES[classIndex];
		const kindAndClass = (owned ? PageKind.OwnedSlots : PageKind.ObjectSlots) | (classIndex << 8);
		const head = this.partialHead(owned, classIndex);
		let page = this.memory.readRamRecordWord(head) - 1;
		if (page < 0) {
			page = this.takeTopPage();
			if (page < 0) {
				return 0;
			}
			const entry = this.entry(page);
			this.memory.writeRamRecordWord(entry, kindAndClass);
			this.memory.writeRamRecordWord(entry + 4, 0);
			this.memory.writeRamRecordWord(entry + 8, 0);
			this.memory.writeRamRecordWord(head, page + 1);
		} else if (page >= this.pageLimit) {
			return 0;
		}
		const entry = this.entry(page);
		const word0 = this.memory.readRamRecordWord(entry);
		if ((word0 & 0xffff) !== kindAndClass) {
			return 0;
		}
		const pageOffset = page << PAGE_SHIFT;
		const freeHead = this.memory.readRamRecordWord(entry + 4);
		const word2 = this.memory.readRamRecordWord(entry + 8);
		let bump = (word2 & LINK_MASK) << BUMP_SHIFT;
		let slot: number;
		let nextFree: number;
		if (freeHead !== 0) {
			slot = (freeHead - RAM_BASE) >>> 0;
			const within = slot - pageOffset;
			if (within < 0 || within >= bump || within % size !== 0) {
				return 0;
			}
			nextFree = this.memory.readRamRecordWord(slot + 4);
		} else {
			if (bump + size > HEAP_PAGE_SIZE) {
				return 0;
			}
			slot = pageOffset + bump;
			bump += size;
			nextFree = 0;
		}
		const full = nextFree === 0 && bump + size > HEAP_PAGE_SIZE;
		this.memory.writeRamRecordWord(entry, kindAndClass | (((word0 >>> 16) + 1) << 16));
		this.memory.writeRamRecordWord(entry + 4, nextFree);
		this.memory.writeRamRecordWord(entry + 8, (bump >>> BUMP_SHIFT) | (full ? 0 : word2 & ~LINK_MASK));
		if (full) this.unlinkPartial(head, word2);
		this.memory.writeRamRecordWord(this.management + OCCUPIED, this.occupiedBytes() + size);
		return RAM_BASE + slot;
	}

	public free(address: number): void {
		const offset = (address - RAM_BASE) >>> 0;
		const page = offset >>> PAGE_SHIFT;
		if (page >= this.pageLimit) {
			return;
		}
		const entry = this.entry(page);
		const word0 = this.memory.readRamRecordWord(entry);
		const kind = word0 & 0xff;
		if (kind === PageKind.ObjectRun || kind === PageKind.OwnedRun) {
			const pages = this.memory.readRamRecordWord(entry + 4);
			if ((offset & PAGE_MASK) !== 0 || pages === 0 || pages > this.pageLimit - page) {
				return;
			}
			this.releasePages(page, page + pages);
			this.memory.writeRamRecordWord(this.management + OCCUPIED, this.occupiedBytes() - (pages << PAGE_SHIFT));
			return;
		}
		const classIndex = (word0 >>> 8) & 0xff;
		const live = word0 >>> 16;
		if ((kind !== PageKind.ObjectSlots && kind !== PageKind.OwnedSlots) || classIndex >= CLASS_COUNT || live === 0) {
			return;
		}
		const size = HEAP_CLASS_BYTES[classIndex];
		const word2 = this.memory.readRamRecordWord(entry + 8);
		const bump = (word2 & LINK_MASK) << BUMP_SHIFT;
		const within = offset & PAGE_MASK;
		if (within >= bump || within % size !== 0) {
			return;
		}
		const freeHead = this.memory.readRamRecordWord(entry + 4);
		const wasFull = freeHead === 0 && bump + size > HEAP_PAGE_SIZE;
		const head = this.partialHead(kind === PageKind.OwnedSlots, classIndex);
		this.memory.writeRamRecordWord(offset, 0);
		this.memory.writeRamRecordWord(offset + 4, freeHead);
		this.memory.writeRamRecordWord(this.management + OCCUPIED, this.occupiedBytes() - size);
		if (live === 1) {
			if (!wasFull) {
				this.unlinkPartial(head, word2);
			}
			this.releasePages(page, page + 1);
			return;
		}
		this.memory.writeRamRecordWord(entry, (word0 & 0xffff) | ((live - 1) << 16));
		this.memory.writeRamRecordWord(entry + 4, address);
		if (wasFull) {
			const next = this.memory.readRamRecordWord(head) & LINK_MASK;
			this.memory.writeRamRecordWord(entry + 8, (bump >>> BUMP_SHIFT) | (next << NEXT_SHIFT));
			if (next !== 0) this.setPreviousPartial(next, page + 1);
			this.memory.writeRamRecordWord(head, page + 1);
		}
	}

	private allocateRun(byteCount: number, owned: boolean): number {
		const pages = Math.ceil(byteCount / HEAP_PAGE_SIZE);
		if (pages > this.pageLimit) {
			return 0;
		}
		const first = this.takeTopRun(pages);
		if (first < 0) {
			return 0;
		}
		const head = this.entry(first);
		this.memory.writeRamRecordWord(head, owned ? PageKind.OwnedRun : PageKind.ObjectRun);
		this.memory.writeRamRecordWord(head + 4, pages);
		this.memory.writeRamRecordWord(head + 8, 0);
		for (let page = first + 1; page < first + pages; page += 1) {
			const entry = this.entry(page);
			this.memory.writeRamRecordWord(entry, PageKind.RunTail);
			this.memory.writeRamRecordWord(entry + 4, first);
			this.memory.writeRamRecordWord(entry + 8, 0);
		}
		this.memory.writeRamRecordWord(this.management + OCCUPIED, this.occupiedBytes() + (pages << PAGE_SHIFT));
		return RAM_BASE + (first << PAGE_SHIFT);
	}

	private takeTopPage(): number {
		for (let word = ((this.pageLimit + 31) >>> 5) - 1; word >= 0; word -= 1) {
			const offset = this.management + AVAILABLE_PAGES + word * 4;
			const stored = this.memory.readRamRecordWord(offset);
			const bits = word === ((this.pageLimit - 1) >>> 5) ? stored & this.lastAvailableMask : stored;
			if (bits !== 0) {
				const bit = 31 - Math.clz32(bits);
				this.memory.writeRamRecordWord(offset, stored & ~(1 << bit));
				return (word << 5) + bit;
			}
		}
		return -1;
	}

	private takeTopRun(pages: number): number {
		let count = 0;
		for (let page = this.pageLimit - 1; page >= 0; page -= 1) {
			if (!this.isAvailable(page)) {
				count = 0;
				continue;
			}
			count += 1;
			if (count === pages) {
				this.setAvailable(page, page + pages, false);
				return page;
			}
		}
		return -1;
	}

	private unlinkPartial(head: number, links: number): void {
		const previous = (links >>> PREVIOUS_SHIFT) & LINK_MASK;
		const next = (links >>> NEXT_SHIFT) & LINK_MASK;
		if (previous === 0) {
			this.memory.writeRamRecordWord(head, next);
		} else {
			const field = this.entry(previous - 1) + 8;
			this.memory.writeRamRecordWord(field, (this.memory.readRamRecordWord(field) & ~(LINK_MASK << NEXT_SHIFT)) | (next << NEXT_SHIFT));
		}
		if (next !== 0) this.setPreviousPartial(next, previous);
	}

	private setPreviousPartial(pageLink: number, previous: number): void {
		const field = this.entry(pageLink - 1) + 8;
		this.memory.writeRamRecordWord(field, (this.memory.readRamRecordWord(field) & ~(LINK_MASK << PREVIOUS_SHIFT)) | (previous << PREVIOUS_SHIFT));
	}

	private releasePages(first: number, end: number): void {
		for (let page = first; page < end; page += 1) {
			const entry = this.entry(page);
			this.memory.writeRamRecordWord(entry, 0);
			this.memory.writeRamRecordWord(entry + 4, 0);
			this.memory.writeRamRecordWord(entry + 8, 0);
		}
		this.setAvailable(first, end, true);
	}

	private setAvailable(first: number, end: number, available: boolean): void {
		for (let page = first; page < end; page += 1) {
			const offset = this.management + AVAILABLE_PAGES + (page >>> 5) * 4;
			const bit = 1 << (page & 31);
			const stored = this.memory.readRamRecordWord(offset);
			this.memory.writeRamRecordWord(offset, available ? stored | bit : stored & ~bit);
		}
	}

	private isAvailable(page: number): boolean {
		return ((this.memory.readRamRecordWord(this.management + AVAILABLE_PAGES + (page >>> 5) * 4) >>> (page & 31)) & 1) !== 0;
	}

	private floorPage(): number {
		const page = ((this.memory.readRamRecordWord(this.management + FLOOR) - RAM_BASE) >>> 0) >>> PAGE_SHIFT;
		return Math.min(Math.max(page, this.minimumFloorPage), this.pageLimit);
	}

	private pageForFloor(address: number): number {
		const page = Math.ceil(Math.max(address - RAM_BASE, 0) / HEAP_PAGE_SIZE);
		return Math.min(Math.max(page, this.minimumFloorPage), this.pageLimit);
	}

	private partialHead(owned: boolean, classIndex: number): number {
		return this.management + PARTIAL_HEADS + ((owned ? CLASS_COUNT : 0) + classIndex) * 4;
	}

	private entry(page: number): number {
		return this.management + PAGE_ENTRIES + page * PAGE_ENTRY_BYTES;
	}
}
