import { ThreadField, ThreadStatus, THREAD_INITIAL_FRAMES, THREAD_CONTROL_COUNT_MASK, controlOffset, backingBytes } from './thread_record';
export { ThreadStatus, THREAD_HEAP_BYTES, THREAD_STACK_SLOT_BYTES, THREAD_INITIAL_VALUES, THREAD_INITIAL_FRAMES, THREAD_INITIAL_BACKING_BYTES, THREAD_RECORD_KIND } from './thread_record';
import { GC_COLOR_OFFSET } from './gc_object';
import { CallFrame, FrameField, FRAME_CONTROL_BYTES, FRAME_WINDOW_MASK, PROTECTED_CALL_BYTES, PROTECTED_CALL_KIND_MASK, PROTECTED_CALL_PARENT, ProtectedField, type ProtectedCallKind } from './call_state';
import type { GcHeap } from './gc_heap';
import type { CPU } from './cpu';
import { valueFromTag, valueNil, valuePayload, valueTag, type Value } from './value';
import { writeLE32 } from '../../common/endian';
import { MAIN_RAM_SIZE, RAM_BASE, RAM_RECORD_WORD_MASK } from '../../spec/bmsx/memory_map';
import { ValueSlots } from './value_slots';
import { MAPPED_PAGE_BYTE_MASK, MAPPED_PAGE_BYTE_SHIFT } from '../memory/mapped_page';

/** Reusable CPU execution bank bound to one raw Thread record; never a guest identity. */
export class Thread {
	public get gcColor(): number { return this.heap.memory.readRamRecordByte(this.address + GC_COLOR_OFFSET); }
	public set gcColor(color: number) { this.heap.memory.writeRamRecordByte(this.address + GC_COLOR_OFFSET, color); }
	public firstFrame: CallFrame | null = null;
	public currentFrame: CallFrame | null = null;
	public get frameDepth(): number { return this.read(ThreadField.FrameDepth) & THREAD_CONTROL_COUNT_MASK; }
	public readonly stackRegisters = new ValueSlots(0);
	public get stackTop(): number { return this.read(ThreadField.StackTop) & FRAME_WINDOW_MASK; }
	public set stackTop(top: number) { this.write(ThreadField.StackTop, top); }
	private boundFrameOffset = 0;
	private boundBackingBytes = 0;
	private boundFrameCapacity = 0;
	private boundProtectedCapacity = 0;
	private watchedFrameCount = 0;
	private recordWordOffset = 0;
	public address = 0;
	public constructor(private readonly heap: GcHeap, private readonly cpu: CPU) {}
	public bindAddress(address: number): void {
		this.detachFrameViews();
		this.stackRegisters.unbind();
		this.address = address;
		this.recordWordOffset = (address & RAM_RECORD_WORD_MASK) >>> 2;
	}

	private read(field: ThreadField): number { return this.heap.memory.ramWords[this.recordWordOffset + (field >>> 2)]; }
	private write(field: ThreadField, word: number): void { this.heap.memory.writeRamRecordWord(this.address + field, word); }

	public get status(): ThreadStatus { return this.read(ThreadField.Status); }
	public set status(status: ThreadStatus) { this.write(ThreadField.Status, status); }
	public get resumer(): number {
		const address = this.read(ThreadField.Resumer);
		return address === 0 ? 0 : this.heap.threadRecordAddress(address);
	}
	public set resumer(address: number) { this.write(ThreadField.Resumer, address); }
	public get entry(): number { return this.read(ThreadField.Entry); }
	public set entry(closure: number) { this.write(ThreadField.Entry, closure); }
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
		return this.boundBackingBytes;
	}
	private get frameCapacity(): number { return this.read(ThreadField.FrameCapacity) & THREAD_CONTROL_COUNT_MASK; }
	private get protectedCapacity(): number { return this.read(ThreadField.ProtectedCapacity) & THREAD_CONTROL_COUNT_MASK; }
	public get protectedDepth(): number { return this.read(ThreadField.ProtectedDepth) & THREAD_CONTROL_COUNT_MASK; }
	public set protectedDepth(depth: number) { this.write(ThreadField.ProtectedDepth, depth); }
	private frameControlAddress(index: number): number {
		return this.stackOffset() + this.boundFrameOffset + index * FRAME_CONTROL_BYTES;
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
			const block = this.heap.budget.allocateStack(backingBytes(values, frames, capacity), this.address, valueNil());
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
		const bytes = this.backingByteLength(), offset = this.stackOffset(), controls = this.boundFrameOffset;
		const watches = this.heap.memory.ramWriteWatches();
		return this.stackRegisters.ramMirrored() || this.stackTop > this.stackRegisters.capacity()
			|| this.frameDepth > this.boundFrameCapacity || bytes > MAIN_RAM_SIZE - offset
			|| watches.anyWatched((this.address + ThreadField.StackTop) & RAM_RECORD_WORD_MASK, 4)
			|| watches.anyWatched((this.address + ThreadField.FrameDepth) & RAM_RECORD_WORD_MASK, 4, false)
			|| watches.anyWatched(offset, controls) || watches.anyWatched(offset + controls, bytes - controls, false);
	}

	public bindStack(): void {
		this.disarmWatches();
		const capacity = this.read(ThreadField.StackCapacity);
		this.boundFrameCapacity = this.frameCapacity;
		this.boundProtectedCapacity = this.protectedCapacity;
		const block = this.read(ThreadField.StackBlock) & RAM_RECORD_WORD_MASK;
		this.boundFrameOffset = controlOffset(capacity);
		this.boundBackingBytes = backingBytes(capacity, this.boundFrameCapacity, this.boundProtectedCapacity);
		this.bindFrameControls(block + this.boundFrameOffset);
		let extent = 0;
		for (let frame = this.currentFrame; frame !== null; frame = frame.previous)
			extent = Math.max(extent, frame.stackBase + frame.stackCapacity);
		this.stackRegisters.bindRam(this.heap.memory, block, capacity, false, extent > capacity);
		this.rebindFrames();
		this.cpu.armThreadStackWatches();
	}

	private rebindFrames(): void {
		for (let frame = this.currentFrame; frame !== null; frame = frame.previous)
			frame.registers.rebind(this.stackRegisters, frame.stackBase, frame.stackCapacity);
	}

	private bindFrameControls(start: number): void {
		const count = Math.max(this.frameDepth, this.boundFrameCapacity);
		let index = 0;
		for (let frame = this.firstFrame; frame !== null; frame = frame.next, ++index) {
			frame.bindControl(start + index * FRAME_CONTROL_BYTES);
			if (index < count) this.armFrameWindowWatch(frame, index);
		}
	}

	private armFrameWindowWatch(frame: CallFrame, index: number): void {
		this.watchedFrameCount = Math.max(this.watchedFrameCount, index + 1);
		const watches = this.heap.memory.ramWriteWatches();
		for (let field = FrameField.StackBase; field <= FrameField.StackCapacity; field += 4) {
			const offset = (frame.controlOffset + field) & RAM_RECORD_WORD_MASK;
			watches.armViewWord(offset >>> MAPPED_PAGE_BYTE_SHIFT, (offset & MAPPED_PAGE_BYTE_MASK) >>> 2);
		}
	}

	public armFrameWindowWatches(): void {
		let index = 0;
		for (let frame = this.firstFrame, count = Math.max(this.frameDepth, this.boundFrameCapacity); frame !== null && index < count; frame = frame.next, ++index) this.armFrameWindowWatch(frame, index);
	}

	public observeFrameWindowWrites(first: number, end: number): void {
		const depth = this.frameDepth;
		let active = false, index = 0;
		for (let frame = this.firstFrame, count = Math.max(depth, this.boundFrameCapacity); frame !== null && index < count; frame = frame.next, ++index) {
			const base = RAM_BASE + ((frame.controlOffset + FrameField.StackBase) & RAM_RECORD_WORD_MASK);
			const size = RAM_BASE + ((frame.controlOffset + FrameField.StackCapacity) & RAM_RECORD_WORD_MASK);
			if ((first <= base && base < end) || (first <= size && size < end)) {
				this.armFrameWindowWatch(frame, index);
				active ||= index < depth;
			}
		}
		if (active) {
			this.bindStack();
			this.stackTop = this.currentFrame!.stackBase + this.currentFrame!.stackCapacity;
		}
	}

	public armStackWatch(): void {
		const offset = this.recordWordOffset * 4;
		const page = offset >>> MAPPED_PAGE_BYTE_SHIFT;
		const word = ((offset & MAPPED_PAGE_BYTE_MASK) + ThreadField.StackBlock) >>> 2;
		const watches = this.heap.memory.ramWriteWatches();
		watches.armViewWord(page, word);
		watches.armViewWord(page, word + 1);
		watches.armViewWord(page, word + 2);
		watches.armViewWord(page, word + 3);
		watches.armViewWord(page, ((offset & MAPPED_PAGE_BYTE_MASK) + ThreadField.FrameDepth) >>> 2);
	}

	public disarmWatches(): void {
		const watches = this.heap.memory.ramWriteWatches();
		for (let field = ThreadField.StackBlock; field <= ThreadField.ProtectedCapacity; field += 4) {
			const offset = (this.address + field) & RAM_RECORD_WORD_MASK;
			watches.clearViewWord(offset >>> MAPPED_PAGE_BYTE_SHIFT, (offset & MAPPED_PAGE_BYTE_MASK) >>> 2);
		}
		const depth = (this.address + ThreadField.FrameDepth) & RAM_RECORD_WORD_MASK;
		watches.clearViewWord(depth >>> MAPPED_PAGE_BYTE_SHIFT, (depth & MAPPED_PAGE_BYTE_MASK) >>> 2);
		let index = 0;
		for (let frame = this.firstFrame; frame !== null && index < this.watchedFrameCount; frame = frame.next, ++index) {
			for (let field = FrameField.StackBase; field <= FrameField.StackCapacity; field += 4) {
				const offset = (frame.controlOffset + field) & RAM_RECORD_WORD_MASK;
				watches.clearViewWord(offset >>> MAPPED_PAGE_BYTE_SHIFT, (offset & MAPPED_PAGE_BYTE_MASK) >>> 2);
			}
		}
		this.watchedFrameCount = 0;
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
		const block = this.heap.budget.allocateStack(backingBytes(capacity, frames, continuations), this.address, root);
		this.replaceStack(block, capacity, frames, continuations);
	}

	public reserveFrame(values: number, root = valueNil(), exception = false): void {
		const wanted = this.frameDepth + (exception ? 1 : 2);
		let frames = Math.max(THREAD_INITIAL_FRAMES, this.boundFrameCapacity);
		while (frames < wanted) frames *= 2;
		if (values === this.stackRegisters.capacity() && frames === this.boundFrameCapacity) return;
		const continuations = this.boundProtectedCapacity;
		const block = this.heap.budget.allocateStack(backingBytes(values, frames, continuations), this.address, root);
		this.replaceStack(block, values, frames, continuations);
	}

	private replaceStack(block: number, capacity: number, frames: number, continuations: number): void {
		this.heap.threads.replaceStack(this.address, block, capacity, frames, continuations);
		this.bindStack();
	}

	/** Prepare the first inactive node; stack growth can collect before entry. */
	public acquireFrame(): CallFrame {
		const existing = this.currentFrame === null ? this.firstFrame : this.currentFrame.next;
		if (existing !== null) return existing;
		const frame = this.frameNode(this.currentFrame);
		frame.bindControl(this.frameControlAddress(this.frameDepth));
		this.armFrameWindowWatch(frame, this.frameDepth);
		return frame;
	}

	private frameNode(previous: CallFrame | null): CallFrame {
		let frame = previous === null ? this.firstFrame : previous.next;
		if (frame === null) {
			frame = new CallFrame(this, previous, this.heap);
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
		this.currentFrame = null;
		for (let frame = this.firstFrame; frame !== null; frame = frame.next) {
			frame.registers.unbind();
			frame.executionImage = null!;
			frame.decodedPage = null;
			frame.compilationEntry = true;
		}
	}

	public bindFrameViews(): void {
		this.detachFrameViews();
		const depth = this.frameDepth;
		for (let index = 0; index < depth; ++index) {
			const frame = this.frameNode(this.currentFrame);
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

}
