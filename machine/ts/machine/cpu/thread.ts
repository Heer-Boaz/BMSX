import { GcObject, GcKind } from './gc_object';
import { PROTECTED_CALL_BYTES, PROTECTED_CALL_KIND_MASK, PROTECTED_CALL_PARENT, ProtectedField, type ProtectedCallKind, type CallFrame } from './call_state';
import type { Closure } from './closure';
import type { GcHeap } from './gc_heap';
import { heapAllocationBytes } from './heap_allocator';
import { valueFromTag, valueNil, valuePayload, valueTag, type Value } from './value';
import { writeLE32 } from '../../common/endian';
import { MAIN_RAM_SIZE, RAM_RECORD_WORD_MASK } from '../../spec/bmsx/memory_map';
import { ValueSlots } from './value_slots';
import { MAPPED_BUS_MASTER_CPU } from '../memory/bus_signals';
import { MAPPED_PAGE_BYTE_MASK, MAPPED_PAGE_BYTE_SHIFT } from '../memory/mapped_page';

export const enum ThreadStatus { New, Running, Normal, Suspended, Dead, Failed }
export const THREAD_HEAP_BYTES = 64;
export const THREAD_STACK_SLOT_BYTES = 5;
export const THREAD_RECORD_KIND = 4;
export const enum ThreadField {
	Header = 0, Status = 8, Resumer = 12, Entry = 16, StackBlock = 24, StackCapacity = 28,
	ProtectedCapacity = 36, ErrorWord = 40, ErrorKind = 44, CallBase = 48, ReturnCount = 52,
	ProtectedDepth = 60,
}

// Eighteen count bits cover every 20-byte record that can fit in physical RAM.
const PROTECTED_COUNT_MASK = (1 << 18) - 1;
function controlOffset(values: number): number { return (values * THREAD_STACK_SLOT_BYTES + 3) & ~3; }
function backingBytes(values: number, protectedCapacity: number): number {
	return controlOffset(values) + protectedCapacity * PROTECTED_CALL_BYTES;
}

/** Retained language execution state. Physical CPU/IRQ/bus state is not thread-local. */
export class Thread extends GcObject {
	public firstFrame: CallFrame | null = null;
	public currentFrame: CallFrame | null = null;
	public frameDepth = 0;
	public readonly stackRegisters = new ValueSlots(0);
	public stackTop = 0;
	public constructor(private readonly heap: GcHeap, public readonly address: number) { super(GcKind.Thread); }

	public initializeRecord(entry: Closure | null): void {
		const memory = this.heap.memory, offset = this.address & (MAIN_RAM_SIZE - 1);
		const ram = memory.ramData();
		const block = this.read(ThreadField.StackBlock);
		ram.fill(0, offset, offset + THREAD_HEAP_BYTES);
		writeLE32(ram, offset + ThreadField.Header, THREAD_RECORD_KIND);
		writeLE32(ram, offset + ThreadField.Entry, entry === null ? 0 : entry.address);
		writeLE32(ram, offset + ThreadField.StackBlock, block);
		writeLE32(ram, offset + ThreadField.StackCapacity, 8);
		this.bindStack();
		memory.invalidateRamWrite(offset, THREAD_HEAP_BYTES);
		this.stackRegisters.clear(8);
		this.armStackWatch();
	}

	private read(field: ThreadField): number { return this.heap.memory.readRamRecordWord(this.address + field); }
	private write(field: ThreadField, word: number): void { this.heap.memory.writeRamRecordWord(this.address + field, word); }

	public get status(): ThreadStatus { return this.read(ThreadField.Status); }
	public set status(status: ThreadStatus) { this.write(ThreadField.Status, status); }
	public get resumer(): Thread | null {
		const owner = this.read(ThreadField.Resumer);
		return owner === 0 ? null : this.heap.threadAt(owner);
	}
	public set resumer(thread: Thread | null) { this.write(ThreadField.Resumer, thread === null ? 0 : thread.address); }
	public get entry(): Closure | null {
		const closure = this.read(ThreadField.Entry);
		return closure === 0 ? null : this.heap.closureAt(closure);
	}
	public set entry(closure: Closure | null) { this.write(ThreadField.Entry, closure === null ? 0 : closure.address); }
	public get callBase(): number { return this.read(ThreadField.CallBase) | 0; }
	public get returnCount(): number { return this.read(ThreadField.ReturnCount) | 0; }
	public setReturnWindow(base: number, count: number): void {
		this.heap.memory.writeRamRecordPair(this.address + ThreadField.CallBase, base, count);
	}
	public get error(): Value { return valueFromTag(this.heap.memory.readRamRecordByte(this.address + ThreadField.ErrorKind), this.read(ThreadField.ErrorWord)); }
	public set error(value: Value) {
		this.heap.memory.writeRamRecordPair(this.address + ThreadField.ErrorWord, valuePayload(value), valueTag(value));
	}

	public stackOffset(): number { return this.stackRegisters.ramOffset(); }
	public backingByteLength(): number {
		return backingBytes(this.stackRegisters.capacity(), this.protectedCapacity);
	}
	private get protectedCapacity(): number { return this.read(ThreadField.ProtectedCapacity) & PROTECTED_COUNT_MASK; }
	public get protectedDepth(): number { return this.read(ThreadField.ProtectedDepth) & PROTECTED_COUNT_MASK; }
	public set protectedDepth(depth: number) { this.write(ThreadField.ProtectedDepth, depth); }
	private protectedAddress(index: number): number {
		return this.stackOffset() + controlOffset(this.stackRegisters.capacity()) + index * PROTECTED_CALL_BYTES;
	}
	public protectedWord(index: number, field: ProtectedField): number {
		return this.heap.memory.readRamRecordWord(this.protectedAddress(index) + field);
	}
	public setProtectedKind(index: number, kind: ProtectedCallKind): void {
		const flags = this.protectedWord(index, ProtectedField.Flags);
		this.heap.memory.writeRamRecordWord(this.protectedAddress(index) + ProtectedField.Flags, (flags & ~PROTECTED_CALL_KIND_MASK) | kind);
	}
	public protectedCaller(index: number): CallFrame | null {
		const depth = this.protectedWord(index, ProtectedField.Caller);
		if (depth >= this.frameDepth) return null;
		let frame = this.currentFrame!;
		for (let at = this.frameDepth - 1; at > depth; --at) frame = frame.previous!;
		return frame;
	}
	public pushProtectedCall(kind: ProtectedCallKind, parent: boolean, base: number, wanted: number, handler: number): number {
		const index = this.protectedDepth;
		const reserved = this.protectedCapacity;
		if (index === reserved) {
			const capacity = reserved === 0 ? 1 : reserved * 2;
			const values = this.stackRegisters.capacity();
			const block = this.heap.budget.allocateStack(backingBytes(values, capacity), this, valueNil());
			this.replaceStack(block, values, capacity);
		}
		const address = this.protectedAddress(index) & RAM_RECORD_WORD_MASK;
		const memory = this.heap.memory, ram = memory.ramData();
		writeLE32(ram, (address + ProtectedField.Flags) & RAM_RECORD_WORD_MASK, kind | (parent ? PROTECTED_CALL_PARENT : 0));
		writeLE32(ram, (address + ProtectedField.Caller) & RAM_RECORD_WORD_MASK, this.frameDepth - 1);
		writeLE32(ram, (address + ProtectedField.Base) & RAM_RECORD_WORD_MASK, base);
		writeLE32(ram, (address + ProtectedField.Wanted) & RAM_RECORD_WORD_MASK, wanted);
		writeLE32(ram, (address + ProtectedField.Handler) & RAM_RECORD_WORD_MASK, handler);
		const first = Math.min(PROTECTED_CALL_BYTES, MAIN_RAM_SIZE - address);
		memory.invalidateRamWrite(address, first);
		if (first !== PROTECTED_CALL_BYTES) memory.invalidateRamWrite(0, PROTECTED_CALL_BYTES - first);
		this.protectedDepth = index + 1;
		return index;
	}

	public stackRequiresScalar(): boolean {
		return this.stackRegisters.ramMirrored() || this.stackTop > this.stackRegisters.capacity()
			|| this.heap.memory.ramWriteWatches().anyWatched(this.stackOffset(), this.stackRegisters.byteLength());
	}

	public bindStack(): void {
		const capacity = this.read(ThreadField.StackCapacity);
		let extent = 0;
		for (let frame = this.currentFrame; frame !== null; frame = frame.previous)
			extent = Math.max(extent, frame.stackBase + frame.stackCapacity);
		this.stackRegisters.bindRam(this.heap.memory, this.read(ThreadField.StackBlock) & (MAIN_RAM_SIZE - 4), capacity, false, extent > capacity);
		this.rebindFrames();
	}

	private rebindFrames(): void {
		for (let frame = this.currentFrame; frame !== null; frame = frame.previous)
			frame.registers.rebind(this.stackRegisters, frame.stackBase, frame.stackCapacity);
	}

	public armStackWatch(): void {
		const offset = this.address & (MAIN_RAM_SIZE - 1);
		const page = offset >>> MAPPED_PAGE_BYTE_SHIFT;
		const word = ((offset & MAPPED_PAGE_BYTE_MASK) + ThreadField.StackBlock) >>> 2;
		const watches = this.heap.memory.ramWriteWatches();
		watches.armWord(page, word);
		watches.armWord(page, word + 1);
	}

	public observeStackWrite(): void {
		this.armStackWatch();
		if ((this.read(ThreadField.StackBlock) & (MAIN_RAM_SIZE - 4)) !== this.stackOffset()
			|| this.read(ThreadField.StackCapacity) !== this.stackRegisters.capacity())
			this.bindStack();
	}

	public resizeStack(capacity: number, root = valueNil()): void {
		if (capacity === this.stackRegisters.capacity()) return;
		const protectedCapacity = this.protectedCapacity;
		const block = this.heap.budget.allocateStack(backingBytes(capacity, protectedCapacity), this, root);
		this.replaceStack(block, capacity, protectedCapacity);
	}

	public freeStack(): void { this.heap.arena.free(this.read(ThreadField.StackBlock)); }

	private replaceStack(block: number, capacity: number, continuationCapacity: number): void {
		const memory = this.heap.memory, ram = memory.ramData();
		const oldBlock = this.read(ThreadField.StackBlock);
		const oldBytes = this.backingByteLength();
		const start = block & (MAIN_RAM_SIZE - 4);
		const oldRecords = this.protectedAddress(0) & (MAIN_RAM_SIZE - 4);
		const records = start + controlOffset(capacity);
		const occupied = Math.min(this.protectedDepth, this.protectedCapacity, continuationCapacity) * PROTECTED_CALL_BYTES;
		const bytes = backingBytes(capacity, continuationCapacity);
		this.stackRegisters.bindRam(memory, start, capacity, true);
		if (occupied !== 0) {
			const first = Math.min(occupied, MAIN_RAM_SIZE - oldRecords);
			ram.copyWithin(records, oldRecords, oldRecords + first);
			ram.copyWithin(records + first, 0, occupied - first);
		}
		ram.fill(0, start + capacity * THREAD_STACK_SLOT_BYTES, records);
		ram.fill(0, records + occupied, start + bytes);
		const endOfValues = start + capacity * THREAD_STACK_SLOT_BYTES;
		if (endOfValues < start + bytes) memory.invalidateRamWrite(endOfValues, start + bytes - endOfValues);
		this.write(ThreadField.ProtectedCapacity, continuationCapacity);
		memory.writeRamRecordPair(this.address + ThreadField.StackBlock, block, capacity);
		this.rebindFrames();
		this.heap.arena.free(oldBlock);
		this.heap.budget.release(heapAllocationBytes(oldBytes));
	}

	public shrinkStack(): number {
		let used = this.stackTop;
		for (let frame = this.currentFrame; frame !== null; frame = frame.previous)
			used = Math.max(used, frame.stackBase + frame.stackCapacity);
		const capacity = this.stackRegisters.capacity(), priorProtected = this.protectedCapacity;
		const nextProtected = priorProtected > 4 && this.protectedDepth * 3 < priorProtected ? priorProtected >>> 1 : priorProtected;
		const nextValues = capacity > 16 && used * 3 < capacity ? capacity >>> 1 : capacity;
		if (nextValues === capacity && nextProtected === priorProtected) return 0;
		const bytes = backingBytes(nextValues, nextProtected);
		const block = this.heap.arena.allocate(bytes, true);
		if (block === 0) return 0; // Collection cannot recursively collect for a shrink.
		this.heap.budget.restoreAllocate(heapAllocationBytes(bytes));
		this.replaceStack(block, nextValues, nextProtected);
		return bytes;
	}

	/** Prepare the first inactive node; stack growth can collect before entry. */
	public acquireFrame(): CallFrame {
		let frame = this.currentFrame === null ? this.firstFrame : this.currentFrame.next;
		if (frame === null) {
			frame = {
				thread: this, previous: this.currentFrame, next: null,
				functionAddress: 0, executionImage: null!, decodedPage: null,
				decodedPageAddress: 0, decodedPageBusSignals: MAPPED_BUS_MASTER_CPU,
				compilationEntry: true, pc: 0, varargBase: 0, varargCount: 0,
				stackBase: 0, stackCapacity: 0, registers: new ValueSlots(0), closure: null!,
				returnBase: 0, returnCount: 0, protectedContinuationIndex: -1, top: 0, returnToCompletionLatch: false,
				callSitePc: 0, isExceptionFrame: false, isNonMaskableExceptionFrame: false,
				openUpvalueHead: 0,
			};
			if (this.currentFrame === null) this.firstFrame = frame;
			else this.currentFrame.next = frame;
		}
		return frame;
	}

	public enterFrame(frame: CallFrame): void {
		this.currentFrame = frame;
		++this.frameDepth;
	}

	/** Callers close upvalues and consume results before retiring the node. */
	public leaveFrame(): void {
		const frame = this.currentFrame!;
		this.currentFrame = frame.previous;
		this.stackTop = this.currentFrame === null ? 0 : this.currentFrame.stackBase + this.currentFrame.stackCapacity;
		--this.frameDepth;
		frame.executionImage = null!;
		frame.closure = null!;
		frame.decodedPage = null;
		frame.decodedPageAddress = 0;
		frame.compilationEntry = true;
		frame.registers.unbind();
		frame.protectedContinuationIndex = -1;
		frame.isExceptionFrame = false;
		frame.isNonMaskableExceptionFrame = false;
	}

	/** Cold diagnostic/snapshot conversion; execution uses current/previous. */
	public frameAtDepth(index: number): CallFrame {
		let frame = this.firstFrame!;
		while (index-- > 0) frame = frame.next!;
		return frame;
	}

	public frameIndex(target: CallFrame): number {
		let frame = this.firstFrame;
		for (let index = 0; index < this.frameDepth; ++index, frame = frame!.next)
			if (frame === target) return index;
		return -1;
	}

	/** Keep the first spare (possibly prepared), then free alternate spares. */
	public trimFrames(): void {
		let frame = this.currentFrame === null ? this.firstFrame : this.currentFrame.next;
		while (frame !== null && frame.next !== null) {
			const next = frame.next.next;
			frame.next.previous = null;
			frame.next.next = null;
			frame.next = next;
			if (next !== null) next.previous = frame;
			frame = next;
		}
	}
}
