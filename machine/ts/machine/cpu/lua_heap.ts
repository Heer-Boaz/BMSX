import { closureRecordBytes } from './closure';
import { UPVALUE_HEAP_BYTES, initialize as initializeCell } from './upvalue';
import { HEAP_COLLECTION_TARGET_OFFSET, HEAP_LOGICAL_OCCUPIED_OFFSET } from './heap_allocator';
import type { CPU } from './cpu';
import { valueClosure, valueNil, type Value } from './value';
import { FRAME_CONTROL_BYTES } from './call_state';
import { THREAD_CONTROL_COUNT_MASK, THREAD_HEAP_BYTES, THREAD_INITIAL_FRAMES, THREAD_INITIAL_VALUES, THREAD_STACK_SLOT_BYTES, ThreadField } from './thread_record';

const NO_NEW_CELLS = new Uint32Array(0);
const MIN_COLLECTION_BYTES = 1024 * 1024;
const COLLECTION_RESERVE_SHIFT = 3;
const GC_ASSIST_MIN_WORDS = 512;
export const GC_STEP_WORDS = 4096;
export const GC_ASSIST_BYTES = 256;
export const enum LuaAllocationRecovery { CurrentOrFresh, Fresh, Exhausted }

export class LuaHeap {
	private readonly targetAddress: number;
	private readonly occupiedAddress: number;

	public constructor(private readonly cpu: CPU) {
		const management = cpu.heapAllocator.managementOffset();
		this.targetAddress = management + HEAP_COLLECTION_TARGET_OFFSET;
		this.occupiedAddress = management + HEAP_LOGICAL_OCCUPIED_OFFSET;
		this.setCollectionTarget(MIN_COLLECTION_BYTES);
	}

	public collectionTarget(): number {
		return this.cpu.memory.readRamRecordWord(this.targetAddress);
	}

	public setCollectionTarget(bytes: number): void {
		this.cpu.memory.writeRamRecordWord(this.targetAddress, bytes);
	}

	public prepareAllocation(byteCount: number, root0: Value, root1: Value,
		root2: Value, growingThread = 0): boolean {
		const capacity = this.capacity();
		const nextBytes = this.usedBytes() + byteCount;
		if (nextBytes > capacity) return false;
		const target = this.collectionTarget();
		if (nextBytes <= target) return true;
		const gc = this.cpu.gc;
		if (gc.finalMarkPending()) return true;
		const reserve = capacity - (capacity >>> COLLECTION_RESERVE_SHIFT);
		const pressure = nextBytes > reserve;
		const debt = nextBytes - target;
		const allowance = pressure ? GC_STEP_WORDS : Math.min(GC_STEP_WORDS, Math.max(GC_ASSIST_MIN_WORDS, (debt + 1) >>> 1));
		const work = gc.step(root0, root1, root2, growingThread, false, allowance);
		if (pressure) this.creditStep();
		else if (gc.active()) {
			// A work unit covers four bytes at a two-times pace. Preserve
			// unpaid debt and count the pending request in the new frontier.
			this.setCollectionTarget(Math.min(reserve, Math.max(0, this.usedBytes() + byteCount + 2 * work - debt)));
		}
		return true;
	}

	public admit(byteCount: number, root0: Value = valueNil(), root1: Value = valueNil(),
		root2: Value = valueNil(), growingThread = 0): LuaAllocationRecovery {
		let recovery = LuaAllocationRecovery.CurrentOrFresh;
		if (!this.prepareAllocation(byteCount, root0, root1, root2, growingThread)) {
			do {
				recovery = this.cpu.gc.recoverAllocation(recovery, root0, root1, root2, growingThread);
			} while (this.usedBytes() + byteCount > this.capacity());
		}
		return recovery;
	}

	public allocateRecord(bytes: number, owned: boolean, backingBytes: number, backingField: number,
		root0: Value = valueNil(), root1: Value = valueNil(), root2: Value = valueNil(), backingCharge = backingBytes): number {
		const charged = bytes + backingCharge;
		let recovery = this.admit(charged, root0, root1, root2, 0);
		const arena = this.cpu.heapAllocator;
		for (;;) {
			const address = arena.allocate(bytes, owned);
			if (address !== 0) {
				const backing = backingBytes === 0 ? 0 : arena.allocate(backingBytes, true);
				if (backingBytes === 0 || backing !== 0) {
					if (backingField !== 0) this.cpu.memory.writeRamRecordWord(address + backingField, backing);
					this.accountAllocation(charged);
					return address;
				}
				arena.free(address);
			}
			recovery = this.cpu.gc.recoverAllocation(recovery, root0, root1, root2);
		}
	}

	/** Admit the owner's logical increase, then reserve backing without committing occupancy. */
	public reserveBacking(bytes: number, logicalBytes: number, root0 = valueNil(), root1 = valueNil(), root2 = valueNil(), growingThread = 0): number {
		let recovery = logicalBytes !== 0 ? this.admit(logicalBytes, root0, root1, root2, growingThread) : LuaAllocationRecovery.CurrentOrFresh;
		for (;;) {
			const block = this.cpu.heapAllocator.allocate(bytes, true);
			if (block !== 0) return block;
			recovery = this.cpu.gc.recoverAllocation(recovery, root0, root1, root2, growingThread);
		}
	}

	public allocateThreadRecord(entry: number): number {
		const valueBytes = THREAD_INITIAL_VALUES * THREAD_STACK_SLOT_BYTES;
		const frameBytes = THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES;
		const charged = THREAD_HEAP_BYTES + valueBytes + frameBytes;
		const root = entry === 0 ? valueNil() : valueClosure(entry);
		let recovery = this.admit(charged, root);
		const arena = this.cpu.heapAllocator;
		for (;;) {
			const address = arena.allocate(THREAD_HEAP_BYTES, false);
			if (address !== 0) {
				const values = arena.allocate(valueBytes, true);
				if (values !== 0) {
					const frames = arena.allocate(frameBytes, true);
					if (frames !== 0) {
						this.cpu.gc.threads.initializeRecord(address, values, frames, entry, this.cpu.gc.white());
						this.accountAllocation(charged);
						return address;
					}
					arena.free(values);
				}
				arena.free(address);
			}
			recovery = this.cpu.gc.recoverAllocation(recovery, root);
		}
	}

	/** A call can need both storage lanes. Acquire them before changing either raw descriptor. */
	public reserveThreadFrameStorage(address: number, valueCapacity: number, frameCapacity: number, root: Value): void {
		const valueBytes = valueCapacity * THREAD_STACK_SLOT_BYTES;
		const frameBytes = frameCapacity * FRAME_CONTROL_BYTES;
		const memory = this.cpu.memory;
		const previousValues = valueCapacity !== 0 ? memory.readRamRecordWord(address + ThreadField.StackCapacity) * THREAD_STACK_SLOT_BYTES : 0;
		const previousFrames = frameCapacity !== 0
			? (memory.readRamRecordWord(address + ThreadField.FrameCapacity) & THREAD_CONTROL_COUNT_MASK) * FRAME_CONTROL_BYTES : 0;
		const requested = valueBytes + frameBytes, previous = previousValues + previousFrames;
		let recovery = requested > previous
			? this.admit(requested - previous, root, valueNil(), valueNil(), address)
			: LuaAllocationRecovery.CurrentOrFresh;
		const arena = this.cpu.heapAllocator;
		for (;;) {
			const values = valueBytes === 0 ? 0 : arena.allocate(valueBytes, true);
			if (valueBytes === 0 || values !== 0) {
				const frames = frameBytes === 0 ? 0 : arena.allocate(frameBytes, true);
				if (frameBytes === 0 || frames !== 0) {
					const threads = this.cpu.gc.threads;
					if (values !== 0) threads.replaceStack(address, values, valueCapacity);
					if (frames !== 0) threads.replaceControls(address, ThreadField.FrameBlock, frames, frameCapacity);
					return;
				}
				if (values !== 0) arena.free(values);
			}
			recovery = this.cpu.gc.recoverAllocation(recovery, root, valueNil(), valueNil(), address);
		}
	}

	/** Admit the closure and its new cells before publishing any frame link. */
	public allocateClosureRecord(captures: number, latched = false, cells: Uint32Array = NO_NEW_CELLS, newCount = 0): number {
		const bytes = closureRecordBytes(captures, latched);
		const charged = bytes + newCount * UPVALUE_HEAP_BYTES;
		let recovery = this.admit(charged, valueNil(), valueNil(), valueNil(), 0);
		const arena = this.cpu.heapAllocator;
		for (;;) {
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
					const white = this.cpu.gc.white();
					for (let index = 0; index < newCount; ++index) initializeCell(memory, cells[index], white);
					this.accountAllocation(charged);
					return closure;
				}
				while (count !== 0) arena.free(cells[--count]);
				arena.free(closure);
			}
			recovery = this.cpu.gc.recoverAllocation(recovery);
		}
	}

	public collectRuntime(
		root0: Value = valueNil(), root1: Value = valueNil(), root2: Value = valueNil(),
		growingThread = 0,
	): void {
		this.cpu.gc.collect(root0, root1, root2, growingThread);
	}

	public stepRuntime(): boolean {
		this.cpu.gc.step();
		this.creditStep();
		return !this.cpu.gc.active();
	}

	private accountAllocation(bytes: number): void {
		const memory = this.cpu.memory;
		memory.writeRamRecordWord(this.occupiedAddress, memory.readRamRecordWord(this.occupiedAddress) + bytes);
	}

	public releaseRecord(address: number, bytes: number): void {
		this.cpu.heapAllocator.free(address);
		const memory = this.cpu.memory;
		memory.writeRamRecordWord(this.occupiedAddress, memory.readRamRecordWord(this.occupiedAddress) - bytes);
	}

	public replaceRecord(oldAddress: number, oldBytes: number, newBytes: number): void {
		if (oldAddress !== 0) this.cpu.heapAllocator.free(oldAddress);
		if (oldBytes !== newBytes) this.accountAllocation(newBytes - oldBytes);
	}

	private creditStep(): void {
		if (this.cpu.gc.active()) this.setCollectionTarget(this.usedBytes() + GC_ASSIST_BYTES);
	}
	public finishCollection(): void {
		const liveBytes = this.usedBytes();
		const capacity = this.capacity();
		this.setCollectionTarget(Math.max(liveBytes + GC_ASSIST_BYTES,
			Math.min(capacity - (capacity >>> COLLECTION_RESERVE_SHIFT), Math.max(MIN_COLLECTION_BYTES, liveBytes * 2))));
	}

	public usedBytes(): number {
		return this.cpu.memory.readRamRecordWord(this.occupiedAddress);
	}
	public capacity(): number { return this.cpu.heapAllocator.capacityBytes(); }

}
