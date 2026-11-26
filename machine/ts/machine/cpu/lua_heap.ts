import { LUA_OUT_OF_MEMORY_SIGNAL } from './errors';
import { closureRecordBytes } from './closure';
import { UPVALUE_HEAP_BYTES, initialize as initializeCell } from './upvalue';
import { HEAP_COLLECTION_TARGET_OFFSET, HEAP_GC_CONTROL_OFFSET, HEAP_LOGICAL_OCCUPIED_OFFSET } from './heap_allocator';
import { decodeGcPhase, gcPacedPhase, GcPhase } from './gc_heap';
import { GC_OBJECT_PREFIX } from './gc_object';
import type { CPU } from './cpu';
import { valueClosure, valueNil, type Value } from './value';
import { FRAME_CONTROL_BYTES, PROTECTED_CALL_BYTES } from './call_state';
import { THREAD_CONTROL_COUNT_MASK, THREAD_HEAP_BYTES, THREAD_INITIAL_FRAMES, THREAD_INITIAL_VALUES, THREAD_STACK_SLOT_BYTES, ThreadField } from './thread_record';

const NO_NEW_CELLS = new Uint32Array(0);
const MIN_COLLECTION_BYTES = 1024 * 1024;
const COLLECTION_RESERVE_SHIFT = 3;
const GC_ASSIST_MIN_WORDS = 512;
export const GC_STEP_WORDS = 4096;
export const GC_ASSIST_BYTES = 256;
export const enum LuaAllocationRecovery { CurrentOrFresh, Fresh, Exhausted }
export const enum LuaAllocationMode { Direct, Scheduled, Retry }

export class LuaHeap {
	private readonly targetAddress: number;
	public readonly occupiedOffset: number;
	private readonly gcControlAddress: number;

	public constructor(private readonly cpu: CPU) {
		const management = cpu.heapAllocator.managementOffset();
		this.targetAddress = management + HEAP_COLLECTION_TARGET_OFFSET;
		this.occupiedOffset = management + HEAP_LOGICAL_OCCUPIED_OFFSET;
		this.gcControlAddress = management + HEAP_GC_CONTROL_OFFSET;
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
		if (decodeGcPhase(this.cpu.memory.readRamRecordByte(this.gcControlAddress)) >= GcPhase.Atomic) return true;
		const gc = this.cpu.gc;
		const reserve = capacity - (capacity >>> COLLECTION_RESERVE_SHIFT);
		const pressure = nextBytes > reserve;
		const debt = nextBytes - target;
		const allowance = pressure ? GC_STEP_WORDS : Math.min(GC_STEP_WORDS, Math.max(GC_ASSIST_MIN_WORDS, (debt + 1) >>> 1));
		const work = this.cpu.assistAllocation(root0, root1, root2, growingThread, allowance);
		if (!work || !gc.active()) return true;
		if (pressure) {
			this.setCollectionTarget(this.usedBytes() + Math.trunc(GC_ASSIST_BYTES * Math.min(work, GC_STEP_WORDS) / GC_STEP_WORDS));
		} else {
			// A work unit covers four bytes at a two-times pace. Preserve
			// unpaid debt and count the pending request in the new frontier.
			this.setCollectionTarget(Math.min(reserve, Math.max(0, this.usedBytes() + byteCount + 2 * work - debt)));
		}
		return true;
	}

	private prepareFixedAllocation(byteCount: number, root0: Value, root1: Value, root2: Value, growingThread = 0): boolean {
		if (this.prepareAllocation(byteCount, root0, root1, root2, growingThread)) return true;
		if (byteCount > this.capacity()) throw LUA_OUT_OF_MEMORY_SIGNAL;
		return false;
	}

	public admit(byteCount: number, root0: Value = valueNil(), root1: Value = valueNil(),
		root2: Value = valueNil(), growingThread = 0): LuaAllocationRecovery {
		let recovery = LuaAllocationRecovery.CurrentOrFresh;
		if (!this.prepareFixedAllocation(byteCount, root0, root1, root2, growingThread)) {
			do {
				recovery = this.cpu.gc.recoverAllocation(recovery, root0, root1, root2, growingThread);
			} while (this.usedBytes() + byteCount > this.capacity());
		}
		return recovery;
	}

	private assistBeforeReservation(requested: number, root0 = valueNil(), root1 = valueNil(), root2 = valueNil(), growingThread = 0): void {
		// BIOS String keys precede the collector view, but not the RAM
		// phase latch owned by the language arena.
		if (gcPacedPhase(decodeGcPhase(this.cpu.memory.readRamRecordByte(this.gcControlAddress)))) {
			this.cpu.gc.assistBeforeReservation(requested, root0, root1, root2, growingThread);
		}
	}

	private reserveRecord(bytes: number, object: boolean, backingBytes: number, backingField: number, charged: number, secondBytes: number, secondField: number): number {
		const prefix = object ? GC_OBJECT_PREFIX : 0;
		const arena = this.cpu.heapAllocator;
		const base = arena.allocate(bytes + prefix, !object);
		if (base === 0) return 0;
		const backing = backingBytes === 0 ? 0 : arena.allocate(backingBytes, true);
		if (backingBytes !== 0 && backing === 0) {
			arena.free(base);
			return 0;
		}
		const second = secondBytes === 0 ? 0 : arena.allocate(secondBytes, true);
		if (secondBytes !== 0 && second === 0) {
			if (backing !== 0) arena.free(backing);
			arena.free(base);
			return 0;
		}
		const address = base + prefix;
		if (backingField !== 0) this.cpu.memory.writeRamRecordWord(address + backingField, backing);
		if (secondField !== 0) this.cpu.memory.writeRamRecordWord(address + secondField, second);
		this.accountAllocation(charged);
		return address;
	}

	public admitRecordAllocation(charged: number, requested: number, mode: LuaAllocationMode,
		root0 = valueNil(), root1 = valueNil(), root2 = valueNil()): LuaAllocationRecovery | null {
		if (mode === LuaAllocationMode.Retry)
			return this.usedBytes() + charged <= this.capacity() ? LuaAllocationRecovery.CurrentOrFresh : null;
		let recovery = LuaAllocationRecovery.CurrentOrFresh;
		if (mode === LuaAllocationMode.Scheduled) {
			if (!this.prepareFixedAllocation(charged, root0, root1, root2)) return null;
		} else recovery = this.admit(charged, root0, root1, root2);
		this.assistBeforeReservation(requested, root0, root1, root2);
		return recovery;
	}

	public allocateRecord(bytes: number, object: boolean, backingBytes: number, backingField: number,
		root0: Value = valueNil(), root1: Value = valueNil(), root2: Value = valueNil(), recordCharge: number | undefined = undefined,
		mode = LuaAllocationMode.Direct, secondBytes = 0, secondField = 0): number {
		const charged = recordCharge ?? (bytes + backingBytes + secondBytes);
		let recovery = this.admitRecordAllocation(charged, bytes + (object ? GC_OBJECT_PREFIX : 0) + backingBytes + secondBytes, mode, root0, root1, root2);
		if (recovery === null) return 0;
		if (mode !== LuaAllocationMode.Direct)
			return this.reserveRecord(bytes, object, backingBytes, backingField, charged, secondBytes, secondField);
		for (;;) {
			const address = this.reserveRecord(bytes, object, backingBytes, backingField, charged, secondBytes, secondField);
			if (address !== 0) return address;
			recovery = this.cpu.gc.recoverAllocation(recovery, root0, root1, root2);
		}
	}

	/** Admit the owner's logical increase, then reserve backing without committing occupancy. */
	public reserveBacking(bytes: number, logicalBytes: number, root0 = valueNil(), root1 = valueNil(), root2 = valueNil(), growingThread = 0): number {
		let recovery = logicalBytes !== 0 ? this.admit(logicalBytes, root0, root1, root2, growingThread) : LuaAllocationRecovery.CurrentOrFresh;
		this.assistBeforeReservation(bytes, root0, root1, root2, growingThread);
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
		this.assistBeforeReservation(charged + GC_OBJECT_PREFIX, root);
		const arena = this.cpu.heapAllocator;
		for (;;) {
			const base = arena.allocate(THREAD_HEAP_BYTES + GC_OBJECT_PREFIX, false);
			if (base !== 0) {
				const values = arena.allocate(valueBytes, true);
				if (values !== 0) {
					const frames = arena.allocate(frameBytes, true);
					if (frames !== 0) {
						const address = base + GC_OBJECT_PREFIX;
						this.cpu.gc.threads.initializeRecord(address, values, frames, entry, this.cpu.gc.white());
						this.cpu.gc.publishObject(address);
						this.accountAllocation(charged);
						return address;
					}
					arena.free(values);
				}
				arena.free(base);
			}
			recovery = this.cpu.gc.recoverAllocation(recovery, root);
		}
	}

	/** A call can need both storage lanes. Acquire them before changing either raw descriptor. */
	public reserveThreadControls(address: number, field: ThreadField.FrameBlock | ThreadField.ProtectedBlock, capacity: number, previous: number, root: Value): number {
		const stride = field === ThreadField.FrameBlock ? FRAME_CONTROL_BYTES : PROTECTED_CALL_BYTES;
		let recovery = this.admit((capacity - previous) * stride, root, valueNil(), valueNil(), address);
		this.assistBeforeReservation(capacity * stride, root, valueNil(), valueNil(), address);
		for (;;) {
			const block = this.cpu.gc.threads.growControls(address, field, capacity);
			if (block !== 0) return block;
			recovery = this.cpu.gc.recoverAllocation(recovery, root, valueNil(), valueNil(), address);
		}
	}

	public reserveThreadFrameStorage(address: number, valueCapacity: number, frameCapacity: number, root: Value): void {
		const valueBytes = valueCapacity * THREAD_STACK_SLOT_BYTES;
		const frameBytes = frameCapacity * FRAME_CONTROL_BYTES;
		const memory = this.cpu.memory;
		const previousValues = valueCapacity !== 0 ? memory.readRamRecordWord(address + ThreadField.StackCapacity) * THREAD_STACK_SLOT_BYTES : 0;
		const previousFrames = frameCapacity !== 0
			? (memory.readRamRecordWord(address + ThreadField.FrameCapacity) & THREAD_CONTROL_COUNT_MASK) * FRAME_CONTROL_BYTES : 0;
		if (valueBytes === 0 && frameBytes !== 0) {
			this.reserveThreadControls(address, ThreadField.FrameBlock, frameCapacity, previousFrames / FRAME_CONTROL_BYTES, root);
			return;
		}
		const requested = valueBytes + frameBytes, previous = previousValues + previousFrames;
		let recovery = requested > previous
			? this.admit(requested - previous, root, valueNil(), valueNil(), address)
			: LuaAllocationRecovery.CurrentOrFresh;
		this.assistBeforeReservation(requested, root, valueNil(), valueNil(), address);
		const arena = this.cpu.heapAllocator;
		for (;;) {
			const frames = frameBytes === 0 ? 0 : arena.allocate(frameBytes, true);
			if (frameBytes === 0 || frames !== 0) {
				const threads = this.cpu.gc.threads;
				if (valueBytes === 0 || threads.resizeStackBacking(address, valueCapacity)) {
					if (frames !== 0) threads.growControls(address, ThreadField.FrameBlock, frameCapacity, frames);
					return;
				}
				if (frames !== 0) arena.free(frames);
			}
			recovery = this.cpu.gc.recoverAllocation(recovery, root, valueNil(), valueNil(), address);
		}
	}

	/** Admit the closure and its new cells before publishing any frame link. */
	public allocateClosureRecord(captures: number, latched = false, cells: Uint32Array = NO_NEW_CELLS, newCount = 0): number {
		const bytes = closureRecordBytes(captures, latched);
		const charged = bytes + newCount * UPVALUE_HEAP_BYTES;
		let recovery = this.admit(charged, valueNil(), valueNil(), valueNil(), 0);
		this.assistBeforeReservation(charged + GC_OBJECT_PREFIX * (1 + newCount));
		const arena = this.cpu.heapAllocator;
		for (;;) {
			const closure = arena.allocate(bytes + GC_OBJECT_PREFIX, false);
			if (closure !== 0) {
				let count = 0;
				for (; count < newCount; ++count) {
					const cell = arena.allocate(UPVALUE_HEAP_BYTES + GC_OBJECT_PREFIX, false);
					if (cell === 0) break;
					cells[count] = cell + GC_OBJECT_PREFIX;
				}
				if (count === newCount) {
					const memory = this.cpu.memory;
					const white = this.cpu.gc.white();
					for (let index = 0; index < newCount; ++index) {
						const cell = cells[index];
						initializeCell(memory, cell, white);
						this.cpu.gc.publishObject(cell);
					}
					this.accountAllocation(charged);
					return closure + GC_OBJECT_PREFIX;
				}
				while (count !== 0) arena.free(cells[--count] - GC_OBJECT_PREFIX);
				arena.free(closure);
			}
			recovery = this.cpu.gc.recoverAllocation(recovery);
		}
	}

	public collectRuntime(
		root0: Value = valueNil(), root1: Value = valueNil(), root2: Value = valueNil(),
		growingThread = 0,
	): void {
		this.cpu.chargeCollectionWork(this.cpu.gc.collect(root0, root1, root2, growingThread));
	}

	public stepRuntime(): boolean {
		this.cpu.chargeCollectionWork(this.cpu.gc.step());
		if (this.cpu.gc.active()) this.setCollectionTarget(this.usedBytes() + GC_ASSIST_BYTES);
		return !this.cpu.gc.active();
	}

	private accountAllocation(bytes: number): void {
		const memory = this.cpu.memory;
		memory.writeRamRecordWord(this.occupiedOffset, memory.readRamRecordWord(this.occupiedOffset) + bytes);
	}

	public releaseRecord(address: number, bytes: number): void {
		this.cpu.heapAllocator.free(address);
		const memory = this.cpu.memory;
		memory.writeRamRecordWord(this.occupiedOffset, memory.readRamRecordWord(this.occupiedOffset) - bytes);
	}

	public releaseObject(address: number, bytes: number): void {
		this.cpu.memory.writeRamRecordByte(address, 0);
		this.releaseRecord(address - GC_OBJECT_PREFIX, bytes);
	}

	public replaceRecord(oldAddress: number, oldBytes: number, newBytes: number): void {
		if (oldAddress !== 0) this.cpu.heapAllocator.free(oldAddress);
		this.resizeRecordCharge(oldBytes, newBytes);
	}

	public resizeRecordCharge(oldBytes: number, newBytes: number): void {
		if (oldBytes !== newBytes) this.accountAllocation(newBytes - oldBytes);
	}

	public finishCollection(): void {
		const liveBytes = this.usedBytes();
		const capacity = this.capacity();
		this.setCollectionTarget(Math.max(liveBytes + GC_ASSIST_BYTES,
			Math.min(capacity - (capacity >>> COLLECTION_RESERVE_SHIFT), Math.max(MIN_COLLECTION_BYTES, liveBytes * 2))));
	}

	public usedBytes(): number {
		return this.cpu.memory.readRamRecordWord(this.occupiedOffset);
	}
	public capacity(): number { return this.cpu.heapAllocator.capacityBytes(); }

}
