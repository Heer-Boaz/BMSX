import { BASE_RAM_USED_SIZE } from '../../spec/bmsx/memory_map';
import { LUA_OUT_OF_MEMORY_SIGNAL } from './errors';
import type { CPU } from './cpu';
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
		if (nextBytes > this.nextCollectionBytes || nextBytes > this.capacityBytes) {
			this.cpu.collectTrackedHeapBytes(
				root0Tag,
				root0Scalar,
				root0Reference,
				root1Tag,
				root1Scalar,
				root1Reference,
				root2Tag,
				root2Scalar,
				root2Reference,
			);
			nextBytes = this.trackedBytes + byteCount;
			if (nextBytes > this.capacityBytes) {
				throw LUA_OUT_OF_MEMORY_SIGNAL;
			}
			if (nextBytes > this.nextCollectionBytes) {
				this.nextCollectionBytes = Math.max(MIN_COLLECTION_BYTES, nextBytes * 2);
			}
		}
		this.trackedBytes = nextBytes;
	}

	public restoreAllocate(byteCount: number): void {
		this.trackedBytes += byteCount;
	}

	public release(byteCount: number): void {
		this.trackedBytes -= byteCount;
	}

	public adjustForRestore(previousBytes: number, restoredBytes: number): void {
		this.trackedBytes += restoredBytes - previousBytes;
	}

	public finishCollection(liveBytes: number): void {
		this.trackedBytes = liveBytes;
		this.nextCollectionBytes = Math.max(MIN_COLLECTION_BYTES, liveBytes * 2);
		if (liveBytes > this.capacityBytes) {
			throw LUA_OUT_OF_MEMORY_SIGNAL;
		}
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
