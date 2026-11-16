import { BASE_RAM_USED_SIZE } from '../../spec/bmsx/memory_map';
import { LUA_OUT_OF_MEMORY_SIGNAL } from './errors';
import type { CPU } from './cpu';
import { GC_ASSIST_BYTES } from './gc_heap';
import {
	ValueTag,
	type ValueReference,
} from './value';

const MIN_COLLECTION_BYTES = 1024 * 1024;

export type LuaHeapState = {
	trackedBytes: number;
	nextCollectionBytes: number;
};

export class LuaHeap {
	private trackedBytes = 0;
	private nextCollectionBytes = MIN_COLLECTION_BYTES;
	private readonly capacityBytes: number;

	public constructor(private readonly cpu: CPU, ramByteCount: number) {
		this.capacityBytes = ramByteCount - BASE_RAM_USED_SIZE;
	}

	public reserve(
		byteCount: number,
		root0Tag: ValueTag = ValueTag.Nil,
		root0Scalar: number = NaN,
		root0Reference: ValueReference = null,
		root1Tag: ValueTag = ValueTag.Nil,
		root1Scalar: number = NaN,
		root1Reference: ValueReference = null,
		root2Tag: ValueTag = ValueTag.Nil,
		root2Scalar: number = NaN,
		root2Reference: ValueReference = null,
	): void {
		let nextBytes = this.trackedBytes + byteCount;
		if (nextBytes > this.capacityBytes) {
			this.collectRuntime(root0Tag, root0Scalar, root0Reference,
				root1Tag, root1Scalar, root1Reference, root2Tag, root2Scalar, root2Reference);
		} else if (nextBytes > this.nextCollectionBytes) {
			this.cpu.instructionBudgetRemaining -= this.cpu.gc.step(
				root0Tag, root0Scalar, root0Reference,
				root1Tag, root1Scalar, root1Reference, root2Tag, root2Scalar, root2Reference);
			if (this.cpu.gc.active()) this.nextCollectionBytes = this.trackedBytes + GC_ASSIST_BYTES;
		}
		nextBytes = this.trackedBytes + byteCount;
		if (nextBytes > this.capacityBytes) throw LUA_OUT_OF_MEMORY_SIGNAL;
		this.trackedBytes = nextBytes;
	}

	public collectRuntime(
		root0Tag: ValueTag = ValueTag.Nil,
		root0Scalar: number = NaN,
		root0Reference: ValueReference = null,
		root1Tag: ValueTag = ValueTag.Nil,
		root1Scalar: number = NaN,
		root1Reference: ValueReference = null,
		root2Tag: ValueTag = ValueTag.Nil,
		root2Scalar: number = NaN,
		root2Reference: ValueReference = null,
	): void {
		this.cpu.instructionBudgetRemaining -= this.cpu.gc.collect(
			root0Tag, root0Scalar, root0Reference,
			root1Tag, root1Scalar, root1Reference,
			root2Tag, root2Scalar, root2Reference,
		);
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
		this.nextCollectionBytes = Math.max(liveBytes + GC_ASSIST_BYTES,
			Math.min(this.capacityBytes - (this.capacityBytes >>> 3), Math.max(MIN_COLLECTION_BYTES, liveBytes * 2)));
	}

	public usedBytes(): number {
		return this.trackedBytes;
	}

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
