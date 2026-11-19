import { UPVALUE_HEAP_BYTES, UPVALUE_RECORD_KIND, closureRecordBytes } from './closure';
import { heapAllocationBytes } from './heap_allocator';
import { LUA_OUT_OF_MEMORY_SIGNAL } from './errors';
import type { CPU } from './cpu';
import type { Thread } from './thread';
import { GC_ASSIST_BYTES } from './gc_heap';
import { shiftRightSigned } from '../common/numeric';
import { valueNil, type Value } from './value';

const NO_NEW_CELLS = new Uint32Array(0);
const MIN_COLLECTION_BYTES = 1024 * 1024;
export type LuaHeapState = {
	trackedBytes: number;
	nextCollectionBytes: number;
};

export class LuaHeap {
	private trackedBytes = 0;
	private nextCollectionBytes = MIN_COLLECTION_BYTES;

	public constructor(private readonly cpu: CPU) {
	}

	public reserve(
		byteCount: number,
		root0: Value = valueNil(), root1: Value = valueNil(), root2: Value = valueNil(),
		growingStack: Thread | null = null,
	): void {
		this.admit(byteCount, root0, root1, root2, growingStack);
		this.trackedBytes += byteCount;
	}

	private admit(byteCount: number, root0: Value, root1: Value, root2: Value, growingStack: Thread | null): boolean {
		const capacity = this.capacity();
		let nextBytes = this.trackedBytes + byteCount;
		const exhausted = nextBytes > capacity;
		if (exhausted) {
			this.collectRuntime(root0, root1, root2, growingStack);
		} else if (nextBytes > this.nextCollectionBytes) {
			const work = this.cpu.gc.step(
				root0, root1, root2, growingStack);
			this.cpu.instructionBudgetRemaining -= work;
			this.creditStep(work);
		}
		nextBytes = this.trackedBytes + byteCount;
		if (nextBytes > capacity) throw LUA_OUT_OF_MEMORY_SIGNAL;
		return exhausted;
	}

	public allocateRecord(bytes: number, owned: boolean, backingBytes: number, backingField: number,
		root0: Value = valueNil(), root1: Value = valueNil(), root2: Value = valueNil()): number {
		const charged = heapAllocationBytes(bytes) + (backingBytes === 0 ? 0 : heapAllocationBytes(backingBytes));
		const collected = this.admit(charged, root0, root1, root2, null);
		const arena = this.cpu.heapAllocator;
		for (let attempt = collected ? 1 : 0; attempt !== 2; ++attempt) {
			if (this.trackedBytes + charged <= this.capacity()) {
				const address = arena.allocate(bytes, owned);
				if (address !== 0) {
					const backing = backingBytes === 0 ? 0 : arena.allocate(backingBytes, true);
					if (backingBytes === 0 || backing !== 0) {
						if (backingField !== 0) this.cpu.memory.writeRamRecordWord(address + backingField, backing);
						this.trackedBytes += charged;
						return address;
					}
					arena.free(address);
				}
			}
			if (attempt === 0) this.collectRuntime(root0, root1, root2);
		}
		throw LUA_OUT_OF_MEMORY_SIGNAL;
	}

	/** Admit the closure and its new cells before publishing any frame link. */
	public allocateClosureRecord(captures: number, cells: Uint32Array = NO_NEW_CELLS, newCount = 0): number {
		const bytes = closureRecordBytes(captures);
		const charged = heapAllocationBytes(bytes) + newCount * UPVALUE_HEAP_BYTES;
		const collected = this.admit(charged, valueNil(), valueNil(), valueNil(), null);
		const arena = this.cpu.heapAllocator;
		for (let attempt = collected ? 1 : 0; attempt !== 2; ++attempt) {
			if (this.trackedBytes + charged <= this.capacity()) {
				const closure = arena.allocate(bytes, false);
				if (closure !== 0) {
					let count = 0;
					for (; count < newCount; ++count) {
						const cell = arena.allocate(UPVALUE_HEAP_BYTES, false);
						if (cell === 0) break;
						cells[count] = cell;
					}
					if (count === newCount) {
						const memory = this.cpu.memory;
						for (let index = 0; index < newCount; ++index) {
							const cell = cells[index];
							memory.writeRamRecordWord(cell, UPVALUE_RECORD_KIND);
							memory.writeRamRecordWord(cell + 4, 0);
							memory.writeRamRecordWord(cell + 8, 0);
							memory.writeRamRecordWord(cell + 12, 0);
						}
						this.trackedBytes += charged;
						return closure;
					}
					while (count !== 0) arena.free(cells[--count]);
					arena.free(closure);
				}
			}
			if (attempt === 0) this.collectRuntime();
		}
		throw LUA_OUT_OF_MEMORY_SIGNAL;
	}

	public collectRuntime(
		root0: Value = valueNil(), root1: Value = valueNil(), root2: Value = valueNil(),
		growingStack: Thread | null = null,
	): void {
		this.cpu.instructionBudgetRemaining -= this.cpu.gc.collect(
			root0, root1, root2, growingStack,
		);
	}

	/** Explicit work earns the same allocation credit as an automatic assist. */
	public stepRuntime(): boolean {
		const work = this.cpu.gc.step();
		this.cpu.instructionBudgetRemaining -= work;
		this.creditStep(work);
		return !this.cpu.gc.active();
	}

	private creditStep(work: number): void {
		if (this.cpu.gc.active()) this.nextCollectionBytes = this.trackedBytes + Math.max(GC_ASSIST_BYTES, shiftRightSigned(work, 4));
	}

	public restoreAllocate(byteCount: number): void {
		this.trackedBytes += byteCount;
	}

	/** Completed table-storage work consumes the current run's transient grant. */
	public accountTableStorageWork(valueSlots: number): void {
		this.cpu.instructionBudgetRemaining -= valueSlots;
	}

	public release(byteCount: number): void {
		this.trackedBytes -= byteCount;
	}

	public adjustForRestore(previousBytes: number, restoredBytes: number): void {
		this.trackedBytes += restoredBytes - previousBytes;
	}

	public finishCollection(): void {
		const liveBytes = this.trackedBytes;
		const capacity = this.capacity();
		this.nextCollectionBytes = Math.max(liveBytes + GC_ASSIST_BYTES,
			Math.min(capacity - (capacity >>> 3), Math.max(MIN_COLLECTION_BYTES, liveBytes * 2)));
	}

	public usedBytes(): number {
		return this.trackedBytes;
	}
	public capacity(): number { return this.cpu.heapAllocator.capacityBytes(); }

	public captureState(): LuaHeapState {
		return {
			trackedBytes: this.trackedBytes,
			nextCollectionBytes: this.nextCollectionBytes,
		};
	}

	public restoreState(state: LuaHeapState): void {
		this.trackedBytes = state.trackedBytes;
		this.nextCollectionBytes = state.nextCollectionBytes;
	}
}
