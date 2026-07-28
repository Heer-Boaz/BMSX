import { BASE_RAM_USED_SIZE } from '../../spec/bmsx/memory_map';
import { RAM_SIZE } from '../memory/map';
import { LUA_OUT_OF_MEMORY_SIGNAL } from './errors';
import type { CPU } from './cpu';
import type { Value } from './value';

const MIN_COLLECTION_BYTES = 1024 * 1024;

export class LuaHeap {
	private trackedBytes = 0;
	private nextCollectionBytes = MIN_COLLECTION_BYTES;

	public constructor(private readonly cpu: CPU) {}

	public reserve(
		byteCount: number,
		root0: Value = null,
		root1: Value = null,
		root2: Value = null,
	): void {
		let nextBytes = this.trackedBytes + byteCount;
		const capacity = RAM_SIZE - BASE_RAM_USED_SIZE;
		if (nextBytes > this.nextCollectionBytes || nextBytes > capacity) {
			this.cpu.collectTrackedHeapBytes(root0, root1, root2);
			nextBytes = this.trackedBytes + byteCount;
			if (nextBytes > capacity) {
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
		if (liveBytes > RAM_SIZE - BASE_RAM_USED_SIZE) {
			throw LUA_OUT_OF_MEMORY_SIGNAL;
		}
	}

	public usedBytes(): number {
		return this.trackedBytes;
	}
}
