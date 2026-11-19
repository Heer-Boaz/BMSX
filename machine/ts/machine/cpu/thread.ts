import { ThreadField } from './thread_record';
import { GcObject, GcKind } from './gc_object';
import { CallFrame, FrameField, FRAME_CONTROL_BYTES, FRAME_WINDOW_MASK, PROTECTED_CALL_BYTES, PROTECTED_CALL_KIND_MASK, PROTECTED_CALL_PARENT, ProtectedField, type ProtectedCallKind } from './call_state';
import type { Closure } from './closure';
import type { GcHeap } from './gc_heap';
import { valueFromTag, valueNil, valuePayload, valueTag, type Value } from './value';
import { writeLE32 } from '../../common/endian';
import { MAIN_RAM_SIZE, RAM_BASE, RAM_RECORD_WORD_MASK } from '../../spec/bmsx/memory_map';
import { ValueSlots } from './value_slots';
import { MAPPED_PAGE_BYTE_MASK, MAPPED_PAGE_BYTE_SHIFT } from '../memory/mapped_page';

export const enum ThreadStatus { New, Running, Normal, Suspended, Dead, Failed }
export const THREAD_HEAP_BYTES = 64;
export const THREAD_STACK_SLOT_BYTES = 5;
export const THREAD_INITIAL_VALUES = 8;
export const THREAD_INITIAL_FRAMES = 2;
export const THREAD_INITIAL_BACKING_BYTES = THREAD_INITIAL_VALUES * THREAD_STACK_SLOT_BYTES + THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES;
export const THREAD_RECORD_KIND = 4;

// Eighteen count bits cover every 20-byte record that can fit in physical RAM.
const CONTROL_COUNT_MASK = (1 << 18) - 1;
function controlOffset(values: number): number { return (values * THREAD_STACK_SLOT_BYTES + 3) & ~3; }
function backingBytes(values: number, frames: number, continuations: number): number {
	return controlOffset(values) + frames * FRAME_CONTROL_BYTES + continuations * PROTECTED_CALL_BYTES;
}

function copyStackControl(ram: Uint8Array, destination: number, source: number, bytes: number): void {
	if (bytes === 0) return;
	source &= RAM_RECORD_WORD_MASK;
	const first = Math.min(bytes, MAIN_RAM_SIZE - source);
	ram.copyWithin(destination, source, source + first);
	if (first !== bytes) ram.copyWithin(destination + first, 0, bytes - first);
}

/** Retained language execution state. Physical CPU/IRQ/bus state is not thread-local. */
export class Thread extends GcObject {
	public firstFrame: CallFrame | null = null;
	public currentFrame: CallFrame | null = null;
	public get frameDepth(): number { return this.read(ThreadField.FrameDepth) & CONTROL_COUNT_MASK; }
	public readonly stackRegisters = new ValueSlots(0);
	public get stackTop(): number { return this.read(ThreadField.StackTop) & FRAME_WINDOW_MASK; }
	public set stackTop(top: number) { this.write(ThreadField.StackTop, top); }
	private boundFrameCapacity = 0;
	private boundProtectedCapacity = 0;
	public constructor(private readonly heap: GcHeap, public readonly address: number) { super(GcKind.Thread); }

	public initializeRecord(entry: Closure | null): void {
		const memory = this.heap.memory, offset = this.address & (MAIN_RAM_SIZE - 1);
		const ram = memory.ramData();
		const block = this.read(ThreadField.StackBlock);
		ram.fill(0, offset, offset + THREAD_HEAP_BYTES);
		writeLE32(ram, offset + ThreadField.Header, THREAD_RECORD_KIND);
		writeLE32(ram, offset + ThreadField.Entry, entry === null ? 0 : entry.address);
		writeLE32(ram, offset + ThreadField.StackBlock, block);
		writeLE32(ram, offset + ThreadField.StackCapacity, THREAD_INITIAL_VALUES);
		writeLE32(ram, offset + ThreadField.FrameCapacity, THREAD_INITIAL_FRAMES);
		const control = (block & RAM_RECORD_WORD_MASK) + controlOffset(THREAD_INITIAL_VALUES);
		ram.fill(0, control, control + THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES);
		memory.invalidateRamWrite(control, THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES);
		this.bindStack();
		memory.invalidateRamWrite(offset, THREAD_HEAP_BYTES);
		this.stackRegisters.clear(THREAD_INITIAL_VALUES);
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
		return backingBytes(this.stackRegisters.capacity(), this.boundFrameCapacity, this.boundProtectedCapacity);
	}
	private get frameCapacity(): number { return this.read(ThreadField.FrameCapacity) & CONTROL_COUNT_MASK; }
	private get protectedCapacity(): number { return this.read(ThreadField.ProtectedCapacity) & CONTROL_COUNT_MASK; }
	public get protectedDepth(): number { return this.read(ThreadField.ProtectedDepth) & CONTROL_COUNT_MASK; }
	public set protectedDepth(depth: number) { this.write(ThreadField.ProtectedDepth, depth); }
	private frameControlAddress(index: number): number {
		return this.stackOffset() + controlOffset(this.stackRegisters.capacity()) + index * FRAME_CONTROL_BYTES;
	}
	private protectedAddress(index: number): number {
		return this.frameControlAddress(this.boundFrameCapacity) + index * PROTECTED_CALL_BYTES;
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
			const frames = this.boundFrameCapacity;
			const block = this.heap.budget.allocateStack(backingBytes(values, frames, capacity), this, valueNil());
			this.replaceStack(block, values, frames, capacity);
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
		const bytes = this.backingByteLength(), offset = this.stackOffset(), controls = controlOffset(this.stackRegisters.capacity());
		const watches = this.heap.memory.ramWriteWatches();
		return this.stackRegisters.ramMirrored() || this.stackTop > this.stackRegisters.capacity()
			|| this.frameDepth > this.boundFrameCapacity || bytes > MAIN_RAM_SIZE - offset
			|| watches.anyWatched((this.address + ThreadField.StackTop) & RAM_RECORD_WORD_MASK, 4)
			|| watches.anyWatched((this.address + ThreadField.FrameDepth) & RAM_RECORD_WORD_MASK, 4, false)
			|| watches.anyWatched(offset, controls) || watches.anyWatched(offset + controls, bytes - controls, false);
	}

	public bindStack(): void {
		const capacity = this.read(ThreadField.StackCapacity);
		this.boundFrameCapacity = this.frameCapacity;
		this.boundProtectedCapacity = this.protectedCapacity;
		const block = this.read(ThreadField.StackBlock) & RAM_RECORD_WORD_MASK;
		this.bindFrameControls(block + controlOffset(capacity));
		let extent = 0;
		for (let frame = this.currentFrame; frame !== null; frame = frame.previous)
			extent = Math.max(extent, frame.stackBase + frame.stackCapacity);
		this.stackRegisters.bindRam(this.heap.memory, block, capacity, false, extent > capacity);
		this.rebindFrames();
	}

	private rebindFrames(): void {
		for (let frame = this.currentFrame; frame !== null; frame = frame.previous)
			frame.registers.rebind(this.stackRegisters, frame.stackBase, frame.stackCapacity);
	}

	private bindFrameControls(start: number): void {
		let index = 0;
		for (let frame = this.firstFrame; frame !== null; frame = frame.next, ++index) {
			frame.bindControl(start + index * FRAME_CONTROL_BYTES);
			this.armFrameWindowWatch(frame);
		}
	}

	private armFrameWindowWatch(frame: CallFrame): void {
		const watches = this.heap.memory.ramWriteWatches();
		for (let field = FrameField.StackBase; field <= FrameField.StackCapacity; field += 4) {
			const offset = (frame.controlOffset + field) & RAM_RECORD_WORD_MASK;
			watches.armViewWord(offset >>> MAPPED_PAGE_BYTE_SHIFT, (offset & MAPPED_PAGE_BYTE_MASK) >>> 2);
		}
	}

	public armFrameWindowWatches(): void {
		for (let frame = this.firstFrame; frame !== null; frame = frame.next) this.armFrameWindowWatch(frame);
	}

	public observeFrameWindowWrites(first: number, end: number): void {
		let active = false, index = 0;
		for (let frame = this.firstFrame; frame !== null; frame = frame.next, ++index) {
			const base = RAM_BASE + ((frame.controlOffset + FrameField.StackBase) & RAM_RECORD_WORD_MASK);
			const size = RAM_BASE + ((frame.controlOffset + FrameField.StackCapacity) & RAM_RECORD_WORD_MASK);
			if ((first <= base && base < end) || (first <= size && size < end)) {
				this.armFrameWindowWatch(frame);
				active ||= index < this.frameDepth;
			}
		}
		if (active) {
			this.bindStack();
			this.stackTop = this.currentFrame!.stackBase + this.currentFrame!.stackCapacity;
		}
	}

	public armStackWatch(): void {
		const offset = this.address & (MAIN_RAM_SIZE - 1);
		const page = offset >>> MAPPED_PAGE_BYTE_SHIFT;
		const word = ((offset & MAPPED_PAGE_BYTE_MASK) + ThreadField.StackBlock) >>> 2;
		const watches = this.heap.memory.ramWriteWatches();
		watches.armViewWord(page, word);
		watches.armViewWord(page, word + 1);
		watches.armViewWord(page, word + 2);
		watches.armViewWord(page, word + 3);
		watches.armViewWord(page, ((offset & MAPPED_PAGE_BYTE_MASK) + ThreadField.FrameDepth) >>> 2);
	}

	public observeStackWrite(): void {
		this.armStackWatch();
		if ((this.read(ThreadField.StackBlock) & (MAIN_RAM_SIZE - 4)) !== this.stackOffset()
			|| this.read(ThreadField.StackCapacity) !== this.stackRegisters.capacity()
			|| this.frameCapacity !== this.boundFrameCapacity || this.protectedCapacity !== this.boundProtectedCapacity)
			this.bindStack();
	}

	public resizeStack(capacity: number, root = valueNil()): void {
		if (capacity === this.stackRegisters.capacity()) return;
		const frames = this.boundFrameCapacity, continuations = this.boundProtectedCapacity;
		const block = this.heap.budget.allocateStack(backingBytes(capacity, frames, continuations), this, root);
		this.replaceStack(block, capacity, frames, continuations);
	}

	public reserveFrame(values: number, root = valueNil(), exception = false): void {
		const wanted = this.frameDepth + (exception ? 1 : 2);
		let frames = Math.max(THREAD_INITIAL_FRAMES, this.boundFrameCapacity);
		while (frames < wanted) frames *= 2;
		if (values === this.stackRegisters.capacity() && frames === this.boundFrameCapacity) return;
		const continuations = this.boundProtectedCapacity;
		const block = this.heap.budget.allocateStack(backingBytes(values, frames, continuations), this, root);
		this.replaceStack(block, values, frames, continuations);
	}

	public freeStack(): void { this.heap.arena.free(this.read(ThreadField.StackBlock)); }

	private replaceStack(block: number, capacity: number, frames: number, continuations: number): void {
		const memory = this.heap.memory, ram = memory.ramData();
		const oldBlock = this.read(ThreadField.StackBlock);
		const start = block & (MAIN_RAM_SIZE - 4);
		const oldFrames = this.frameControlAddress(0), oldProtected = this.protectedAddress(0);
		const records = start + controlOffset(capacity), protectedRecords = records + frames * FRAME_CONTROL_BYTES;
		const frameBytes = Math.min(this.frameDepth, this.boundFrameCapacity, frames) * FRAME_CONTROL_BYTES;
		const occupied = Math.min(this.protectedDepth, this.boundProtectedCapacity, continuations) * PROTECTED_CALL_BYTES;
		const bytes = backingBytes(capacity, frames, continuations);
		this.stackRegisters.bindRam(memory, start, capacity, true);
		copyStackControl(ram, records, oldFrames, frameBytes);
		copyStackControl(ram, protectedRecords, oldProtected, occupied);
		const endOfValues = start + capacity * THREAD_STACK_SLOT_BYTES;
		ram.fill(0, endOfValues, records);
		ram.fill(0, records + frameBytes, protectedRecords);
		ram.fill(0, protectedRecords + occupied, start + bytes);
		memory.invalidateRamWrite(endOfValues, start + bytes - endOfValues);
		this.boundFrameCapacity = frames;
		this.boundProtectedCapacity = continuations;
		const descriptor = (this.address + ThreadField.StackBlock) & RAM_RECORD_WORD_MASK;
		writeLE32(ram, descriptor, block);
		writeLE32(ram, descriptor + 4, capacity);
		writeLE32(ram, descriptor + 8, frames);
		writeLE32(ram, descriptor + 12, continuations);
		this.bindFrameControls(records);
		this.rebindFrames();
		memory.invalidateRamWrite(descriptor, 16, false);
		this.heap.arena.free(oldBlock);

	}

	public shrinkStack(): number {
		let used = this.stackTop;
		for (let frame = this.currentFrame; frame !== null; frame = frame.previous)
			used = Math.max(used, frame.stackBase + frame.stackCapacity);
		const capacity = this.stackRegisters.capacity(), priorProtected = this.protectedCapacity;
		const nextProtected = priorProtected > 4 && this.protectedDepth * 3 < priorProtected ? priorProtected >>> 1 : priorProtected;
		const nextValues = capacity > 16 && used * 3 < capacity ? capacity >>> 1 : capacity;
		const nextFrames = this.boundFrameCapacity > 4 && this.frameDepth * 3 < this.boundFrameCapacity
			? this.boundFrameCapacity >>> 1 : this.boundFrameCapacity;
		if (nextValues === capacity && nextProtected === priorProtected && nextFrames === this.boundFrameCapacity) return 0;
		const bytes = backingBytes(nextValues, nextFrames, nextProtected);
		const block = this.heap.arena.allocate(bytes, true);
		if (block === 0) return 0; // Collection cannot recursively collect for a shrink.

		this.replaceStack(block, nextValues, nextFrames, nextProtected);
		return bytes;
	}

	/** Prepare the first inactive node; stack growth can collect before entry. */
	public acquireFrame(): CallFrame { return this.frameNode(this.currentFrame, this.frameDepth); }

	private frameNode(previous: CallFrame | null, index: number): CallFrame {
		let frame = previous === null ? this.firstFrame : previous.next;
		if (frame === null) {
			frame = new CallFrame(this, previous, this.heap);
			frame.bindControl(this.frameControlAddress(index));
			this.armFrameWindowWatch(frame);
			if (previous === null) this.firstFrame = frame;
			else previous.next = frame;
		}
		return frame;
	}

	public enterFrame(frame: CallFrame): void {
		this.currentFrame = frame;
		this.publishDepth(this.frameDepth + 1);
	}

	private publishDepth(depth: number): void {
		const memory = this.heap.memory, offset = (this.address + ThreadField.FrameDepth) & RAM_RECORD_WORD_MASK;
		writeLE32(memory.ramData(), offset, depth);
		memory.invalidateRamWrite(offset, 4, false);
	}

	public detachFrameViews(): void {
		while (this.currentFrame !== null) {
			const frame = this.currentFrame;
			this.currentFrame = frame.previous;
			frame.registers.unbind();
			frame.decodedPage = null;
			frame.compilationEntry = true;
		}
	}

	public bindFrameViews(): void {
		this.detachFrameViews();
		const depth = this.frameDepth;
		for (let index = 0; index < depth; ++index) {
			const frame = this.frameNode(this.currentFrame, index);
			frame.decodedPage = null;
			frame.compilationEntry = true;
			this.currentFrame = frame;
		}
		this.bindStack();
	}

	/** Callers close upvalues and consume results before retiring the node. */
	public leaveFrame(): void {
		const frame = this.currentFrame!;
		this.currentFrame = frame.previous;
		this.stackTop = this.currentFrame === null ? 0 : this.currentFrame.stackBase + this.currentFrame.stackCapacity;
		this.publishDepth(this.frameDepth - 1);
		frame.executionImage = null!;
		frame.decodedPage = null;
		frame.decodedPageAddress = 0;
		frame.compilationEntry = true;
		frame.registers.unbind();
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
		let index = this.frameDepth;
		while (frame !== null && frame.next !== null) {
			const next = frame.next.next;
			frame.next.previous = null;
			frame.next.next = null;
			frame.next = next;
			if (next !== null) {
				next.previous = frame;
				next.bindControl(this.frameControlAddress(index + 1));
			}
			frame = next;
			++index;
		}
	}
}
