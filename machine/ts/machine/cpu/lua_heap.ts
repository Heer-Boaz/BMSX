import { LUA_OUT_OF_MEMORY_SIGNAL } from './errors';
import type { CPU } from './cpu';
import type { Thread } from './thread';
import { GC_ASSIST_BYTES } from './gc_heap';
import { shiftRightSigned } from '../common/numeric';
import { valueNil, type Value } from './value';

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
		const capacity = this.capacity();
		let nextBytes = this.trackedBytes + byteCount;
		if (nextBytes > capacity) {
			this.collectRuntime(root0, root1, root2, growingStack);
		} else if (nextBytes > this.nextCollectionBytes) {
			const work = this.cpu.gc.step(
				root0, root1, root2, growingStack);
			this.cpu.instructionBudgetRemaining -= work;
			this.creditStep(work);
		}
		nextBytes = this.trackedBytes + byteCount;
		if (nextBytes > capacity) throw LUA_OUT_OF_MEMORY_SIGNAL;
		this.trackedBytes = nextBytes;
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
