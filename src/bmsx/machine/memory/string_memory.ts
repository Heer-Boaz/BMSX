import {
	STRING_HANDLE_COUNT,
	STRING_HANDLE_ENTRY_SIZE,
	STRING_HANDLE_TABLE_BASE,
	STRING_HEAP_BASE,
	STRING_HEAP_SIZE,
} from './map';
import { enforceLuaHeapBudget } from './lua_heap_usage';
import { Memory } from './memory';

const TEXT_ENCODER = new TextEncoder();

export type StringHandleEntry = {
	addr: number;
	len: number;
	flags: number;
	gen: number;
};

export class StringHeap {
	private cursor = STRING_HEAP_BASE;

	public allocate(length: number): number {
		const addr = this.cursor;
		const next = addr + length;
		if (next > STRING_HEAP_BASE + STRING_HEAP_SIZE) {
			throw new Error(`[StringHeap] Out of heap memory (len=${length}).`);
		}
		this.cursor = next;
		enforceLuaHeapBudget();
		return addr;
	}

	public reset(): void {
		this.cursor = STRING_HEAP_BASE;
	}

	public usedBytes(): number {
		return this.cursor - STRING_HEAP_BASE;
	}
}

export class StringHandleTable {
	private readonly heap: StringHeap;
	private nextHandle = 0;
	private generation = 0;

	constructor(private readonly memory: Memory) {
		this.heap = new StringHeap();
	}

	public reserveHandles(minHandle: number): void {
		if (minHandle > STRING_HANDLE_COUNT) {
			throw new Error(`[StringHandleTable] Reserve exceeds handle capacity: ${minHandle}.`);
		}
		if (minHandle > this.nextHandle) {
			this.nextHandle = minHandle;
		}
	}

	public beginNewGeneration(resetHeap: boolean): void {
		this.generation += 1;
		if (resetHeap) {
			this.heap.reset();
		}
	}

	public reset(): void {
		this.nextHandle = 0;
		this.generation = 0;
		this.heap.reset();
	}

	public allocateHandle(text: string, flags: number = 0): { id: number; addr: number; len: number } {
		if (this.nextHandle >= STRING_HANDLE_COUNT) {
			throw new Error('[StringHandleTable] Out of string handles.');
		}
		const bytes = TEXT_ENCODER.encode(text);
		const addr = this.heap.allocate(bytes.length);
		this.memory.writeBytes(addr, bytes);
		const id = this.nextHandle;
		this.writeEntry(id, addr, bytes.length, flags, this.generation);
		this.nextHandle += 1;
		return { id, addr, len: bytes.length };
	}

	public writeEntry(id: number, addr: number, len: number, flags: number, gen: number): void {
		const entryAddr = STRING_HANDLE_TABLE_BASE + id * STRING_HANDLE_ENTRY_SIZE;
		this.memory.writeU32(entryAddr, addr);
		this.memory.writeU32(entryAddr + 4, len);
		this.memory.writeU32(entryAddr + 8, flags);
		this.memory.writeU32(entryAddr + 12, gen);
	}

	public usedHeapBytes(): number {
		return this.heap.usedBytes();
	}
}
