import { closureRecordBytes } from './closure';
import { UPVALUE_HEAP_BYTES, initialize as initializeCell } from './upvalue';
import { HEAP_COLLECTION_TARGET_OFFSET, HEAP_YOUNG_DEBT_OFFSET, heapAllocationBytes } from './heap_allocator';
import { LUA_OUT_OF_MEMORY_SIGNAL } from './errors';
import type { CPU } from './cpu';
import { GC_ASSIST_BYTES } from './gc_heap';
import { shiftRightSigned } from '../common/numeric';
import { valueClosure, valueNil, type Value } from './value';
import { FRAME_CONTROL_BYTES } from './call_state';
import { THREAD_HEAP_BYTES, THREAD_INITIAL_FRAMES, THREAD_INITIAL_VALUES, THREAD_STACK_SLOT_BYTES, ThreadField } from './thread_record';

const NO_NEW_CELLS = new Uint32Array(0);
const MIN_COLLECTION_BYTES = 1024 * 1024;
const YOUNG_INTERVAL_BYTES = 128 * 1024;

export class LuaHeap {
	private readonly targetAddress: number;
	private readonly youngDebtAddress: number;

	public constructor(private readonly cpu: CPU) {
		const management = cpu.heapAllocator.managementOffset();
		this.targetAddress = management + HEAP_COLLECTION_TARGET_OFFSET;
		this.youngDebtAddress = management + HEAP_YOUNG_DEBT_OFFSET;
		this.setCollectionTarget(MIN_COLLECTION_BYTES);
	}

	public collectionTarget(): number {
		return this.cpu.memory.readRamRecordWord(this.targetAddress);
	}

	public setCollectionTarget(bytes: number): void {
		this.cpu.memory.writeRamRecordWord(this.targetAddress, bytes);
	}

	public admit(byteCount: number, root0: Value = valueNil(), root1: Value = valueNil(),
		root2: Value = valueNil(), growingThread = 0): boolean {
		const capacity = this.capacity();
		const nextBytes = this.usedBytes() + byteCount;
		const exhausted = nextBytes > capacity;
		if (!exhausted && nextBytes <= this.collectionTarget()) {
			const memory = this.cpu.memory, debt = memory.readRamRecordWord(this.youngDebtAddress);
			if (debt !== 0 && debt + byteCount > YOUNG_INTERVAL_BYTES && !this.cpu.gc.active()) {
				this.cpu.instructionBudgetRemaining -= this.cpu.gc.collectYoung(root0, root1, root2);
				memory.writeRamRecordWord(this.youngDebtAddress, 0);
			}
			return false;
		}
		if (exhausted) {
			this.collectRuntime(root0, root1, root2, growingThread);
		} else {
			const work = this.cpu.gc.step(
				root0, root1, root2, growingThread);
			this.cpu.instructionBudgetRemaining -= work;
			this.creditStep(work);
		}
		if (this.usedBytes() + byteCount > capacity) throw LUA_OUT_OF_MEMORY_SIGNAL;
		return exhausted;
	}

	public allocateRecord(bytes: number, owned: boolean, backingBytes: number, backingField: number,
		root0: Value = valueNil(), root1: Value = valueNil(), root2: Value = valueNil()): number {
		const charged = heapAllocationBytes(bytes) + (backingBytes === 0 ? 0 : heapAllocationBytes(backingBytes));
		const collected = this.admit(charged, root0, root1, root2, 0);
		const arena = this.cpu.heapAllocator;
		for (let attempt = collected ? 1 : 0; attempt !== 2; ++attempt) {
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
			if (attempt === 0) this.collectRuntime(root0, root1, root2);
		}
		throw LUA_OUT_OF_MEMORY_SIGNAL;
	}

	public allocateStack(bytes: number, thread: number, root: Value): number {
		const charge = heapAllocationBytes(bytes);
		const collected = this.admit(charge, root, valueNil(), valueNil(), thread);
		for (let attempt = collected ? 1 : 0; attempt !== 2; ++attempt) {
			const block = this.cpu.heapAllocator.allocate(bytes, true);
			if (block !== 0) {
				this.accountAllocation(charge);
				return block;
			}
			if (attempt === 0) this.collectRuntime(root, valueNil(), valueNil(), thread);
		}
		throw LUA_OUT_OF_MEMORY_SIGNAL;
	}

	public allocateThreadRecord(entry: number): number {
		const valueBytes = THREAD_INITIAL_VALUES * THREAD_STACK_SLOT_BYTES;
		const frameBytes = THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES;
		const charged = THREAD_HEAP_BYTES + heapAllocationBytes(valueBytes) + heapAllocationBytes(frameBytes);
		const root = entry === 0 ? valueNil() : valueClosure(entry);
		const collected = this.admit(charged, root);
		const arena = this.cpu.heapAllocator;
		for (let attempt = collected ? 1 : 0; attempt !== 2; ++attempt) {
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
			if (attempt === 0) this.collectRuntime(root);
		}
		throw LUA_OUT_OF_MEMORY_SIGNAL;
	}

	/** A call can need both storage lanes. Acquire them before changing either raw descriptor. */
	public reserveThreadFrameStorage(address: number, valueCapacity: number, frameCapacity: number, root: Value): void {
		const valueBytes = valueCapacity * THREAD_STACK_SLOT_BYTES;
		const frameBytes = frameCapacity * FRAME_CONTROL_BYTES;
		const charged = heapAllocationBytes(valueBytes) + heapAllocationBytes(frameBytes);
		const collected = this.admit(charged, root, valueNil(), valueNil(), address);
		const arena = this.cpu.heapAllocator;
		for (let attempt = collected ? 1 : 0; attempt !== 2; ++attempt) {
			const values = valueBytes === 0 ? 0 : arena.allocate(valueBytes, true);
			if (valueBytes === 0 || values !== 0) {
				const frames = frameBytes === 0 ? 0 : arena.allocate(frameBytes, true);
				if (frameBytes === 0 || frames !== 0) {
					const threads = this.cpu.gc.threads;
					if (values !== 0) threads.replaceStack(address, values, valueCapacity);
					if (frames !== 0) threads.replaceControls(address, ThreadField.FrameBlock, frames, frameCapacity);
					this.accountAllocation(charged);
					return;
				}
				if (values !== 0) arena.free(values);
			}
			if (attempt === 0) this.collectRuntime(root, valueNil(), valueNil(), address);
		}
		throw LUA_OUT_OF_MEMORY_SIGNAL;
	}

	/** Admit the closure and its new cells before publishing any frame link. */
	public allocateClosureRecord(captures: number, latched = false, cells: Uint32Array = NO_NEW_CELLS, newCount = 0): number {
		const bytes = closureRecordBytes(captures, latched);
		const charged = heapAllocationBytes(bytes) + newCount * UPVALUE_HEAP_BYTES;
		const collected = this.admit(charged, valueNil(), valueNil(), valueNil(), 0);
		const arena = this.cpu.heapAllocator;
		for (let attempt = collected ? 1 : 0; attempt !== 2; ++attempt) {
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
			if (attempt === 0) this.collectRuntime();
		}
		throw LUA_OUT_OF_MEMORY_SIGNAL;
	}

	public collectRuntime(
		root0: Value = valueNil(), root1: Value = valueNil(), root2: Value = valueNil(),
		growingThread = 0,
	): void {
		this.cpu.instructionBudgetRemaining -= this.cpu.gc.collect(
			root0, root1, root2, growingThread,
		);
	}

	/** Explicit work earns the same allocation credit as an automatic assist. */
	public stepRuntime(): boolean {
		const work = this.cpu.gc.step();
		this.cpu.instructionBudgetRemaining -= work;
		this.creditStep(work);
		return !this.cpu.gc.active();
	}

	private accountAllocation(bytes: number): void {
		const memory = this.cpu.memory;
		memory.writeRamRecordWord(this.youngDebtAddress, memory.readRamRecordWord(this.youngDebtAddress) + bytes);
	}

	private creditStep(work: number): void {
		if (this.cpu.gc.active()) this.setCollectionTarget(this.usedBytes() + Math.max(GC_ASSIST_BYTES, shiftRightSigned(work, 4)));
	}


	/** Completed table-storage work consumes the current run's transient grant. */


	public finishCollection(): void {
		this.cpu.memory.writeRamRecordWord(this.youngDebtAddress, 0);
		const liveBytes = this.usedBytes();
		const capacity = this.capacity();
		this.setCollectionTarget(Math.max(liveBytes + GC_ASSIST_BYTES,
			Math.min(capacity - (capacity >>> 3), Math.max(MIN_COLLECTION_BYTES, liveBytes * 2))));
	}

	public usedBytes(): number {
		return this.cpu.heapAllocator.occupiedBytes();
	}
	public capacity(): number { return this.cpu.heapAllocator.capacityBytes(); }

}
