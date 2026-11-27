import { ThreadField, ThreadStatus, THREAD_INITIAL_FRAMES, THREAD_CONTROL_COUNT_MASK } from './thread_record';
export { ThreadStatus, THREAD_HEAP_BYTES, THREAD_STACK_SLOT_BYTES, THREAD_INITIAL_VALUES, THREAD_INITIAL_FRAMES, THREAD_RECORD_KIND } from './thread_record';
import { CallFrame, FRAME_CONTROL_BYTES, FRAME_WINDOW_MASK, PROTECTED_CALL_BYTES, PROTECTED_CALL_KIND_MASK, PROTECTED_CALL_PARENT, PROTECTED_CALL_HANDLER_BUILTIN, PROTECTED_CALL_HANDLER_RESIDENT, ProtectedField, type ProtectedCallKind } from './call_state';
import type { GcHeap } from './gc_heap';
import { ValueTag, valueFromTag, valueNil, valuePayload, valueTag, type Value } from './value';
import { writeLE32 } from '../../common/endian';
import { MAIN_RAM_SIZE, RAM_RECORD_WORD_MASK } from '../../spec/bmsx/memory_map';
import { ValueSlots } from './value_slots';

/** Reusable CPU execution bank bound to one raw Thread record; never a guest identity. */
export class Thread {
	public firstFrame: CallFrame | null = null;
	public currentFrame: CallFrame | null = null;
	public get frameDepth(): number { return this.read(ThreadField.FrameDepth) & THREAD_CONTROL_COUNT_MASK; }
	public readonly stackRegisters = new ValueSlots(0);
	public get stackTop(): number { return this.read(ThreadField.StackTop) & FRAME_WINDOW_MASK; }
	public set stackTop(top: number) { this.write(ThreadField.StackTop, top); }
	// Only the attached prefix is visible to the CPU and its observers.
	private lastBoundFrame: CallFrame | null = null;
	private parkedFrameViews: CallFrame | null = null;
	private boundFrameOffset = 0;
	private boundProtectedOffset = 0;
	private boundFrameCapacity = 0;
	private recordWordOffset = 0;
	public address = 0;
	public constructor(private readonly heap: GcHeap) {}
	public bindAddress(address: number): void {
		if (this.lastBoundFrame !== null) {
			this.lastBoundFrame.next = this.parkedFrameViews;
			this.parkedFrameViews = this.firstFrame;
			this.firstFrame = this.lastBoundFrame = null;
		}
		this.currentFrame = null;
		this.stackRegisters.unbind();
		this.boundFrameOffset = this.boundProtectedOffset = this.boundFrameCapacity = 0;
		this.address = address;
		this.recordWordOffset = (address & RAM_RECORD_WORD_MASK) >>> 2;
	}
	// Parked host references must not keep retired image catalogs alive.
	public dropParkedFrameViews(): void { this.parkedFrameViews = null; }

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
	public get returnCount(): number { return this.read(ThreadField.ReturnCount); }
	public setReturnWindow(base: number, count: number): void {
		this.heap.memory.writeRamRecordPair(this.address + ThreadField.CallBase, base, count);
	}
	public get error(): Value { return valueFromTag(this.heap.memory.readRamRecordByte(this.address + ThreadField.ErrorKind), this.read(ThreadField.ErrorWord)); }
	public set error(value: Value) {
		this.heap.memory.writeRamRecordPair(this.address + ThreadField.ErrorWord, valuePayload(value), valueTag(value));
	}

	public stackOffset(): number { return this.stackRegisters.ramOffset(); }
	public get frameBackingOffset(): number { return this.boundFrameOffset; }
	public get frameBackingBytes(): number { return this.boundFrameCapacity * FRAME_CONTROL_BYTES; }
	private get frameCapacity(): number { return this.read(ThreadField.FrameCapacity) & THREAD_CONTROL_COUNT_MASK; }
	private get protectedCapacity(): number { return this.read(ThreadField.ProtectedCapacity) & THREAD_CONTROL_COUNT_MASK; }
	public get protectedDepth(): number { return this.read(ThreadField.ProtectedDepth) & THREAD_CONTROL_COUNT_MASK; }
	public set protectedDepth(depth: number) { this.write(ThreadField.ProtectedDepth, depth); }
	private frameControlAddress(index: number): number {
		return this.boundFrameOffset + index * FRAME_CONTROL_BYTES;
	}
	private protectedAddress(index: number): number {
		return this.boundProtectedOffset + index * PROTECTED_CALL_BYTES;
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
	public protectedHandler(index: number): Value {
		const flags = this.protectedWord(index, ProtectedField.Flags);
		const tag = (flags & PROTECTED_CALL_HANDLER_RESIDENT) !== 0 ? ValueTag.ResidentFunction
			: (flags & PROTECTED_CALL_HANDLER_BUILTIN) !== 0 ? ValueTag.BuiltinFunction : ValueTag.Closure;
		return valueFromTag(tag, this.protectedWord(index, ProtectedField.Handler));
	}
	public pushProtectedCall(kind: ProtectedCallKind, parent: boolean, base: number, wanted: number, handler: Value): number {
		const index = this.protectedDepth;
		const reserved = this.protectedCapacity;
		if (index === reserved) {
			const capacity = reserved === 0 ? 1 : reserved * 2;
			const block = this.heap.budget.reserveThreadControls(this.address, ThreadField.ProtectedBlock, capacity, reserved, handler);
			this.boundProtectedOffset = block & RAM_RECORD_WORD_MASK;
		}
		const address = this.protectedAddress(index) & RAM_RECORD_WORD_MASK;
		const memory = this.heap.memory, ram = memory.ramData();
		const tag = valueTag(handler);
		const handlerFlag = tag === ValueTag.BuiltinFunction ? PROTECTED_CALL_HANDLER_BUILTIN
			: tag === ValueTag.ResidentFunction ? PROTECTED_CALL_HANDLER_RESIDENT : 0;
		writeLE32(ram, (address + ProtectedField.Flags) & RAM_RECORD_WORD_MASK, kind | (parent ? PROTECTED_CALL_PARENT : 0) | handlerFlag);
		writeLE32(ram, (address + ProtectedField.Caller) & RAM_RECORD_WORD_MASK, this.frameDepth - 1);
		writeLE32(ram, (address + ProtectedField.Base) & RAM_RECORD_WORD_MASK, base);
		writeLE32(ram, (address + ProtectedField.Wanted) & RAM_RECORD_WORD_MASK, wanted);
		writeLE32(ram, (address + ProtectedField.Handler) & RAM_RECORD_WORD_MASK, valuePayload(handler));
		const first = Math.min(PROTECTED_CALL_BYTES, MAIN_RAM_SIZE - address);
		memory.invalidateRamWrite(address, first);
		if (first !== PROTECTED_CALL_BYTES) memory.invalidateRamWrite(0, PROTECTED_CALL_BYTES - first);
		this.protectedDepth = index + 1;
		return index;
	}

	public stackRequiresScalar(): boolean {
		// The language heap is outside the instruction bus; only the
		// physical register window matters to the compiled path.
		return this.stackRegisters.ramMirrored() || this.stackTop > this.stackRegisters.capacity()
			|| this.frameDepth > this.boundFrameCapacity;
	}

	public bindStack(ifRelocated = false): void {
		const capacity = this.read(ThreadField.StackCapacity), frameCapacity = this.frameCapacity;
		const block = this.read(ThreadField.StackBlock) & RAM_RECORD_WORD_MASK;
		const frames = this.read(ThreadField.FrameBlock) & RAM_RECORD_WORD_MASK;
		const protectedOffset = this.read(ThreadField.ProtectedBlock) & RAM_RECORD_WORD_MASK;
		if (ifRelocated && capacity === this.stackRegisters.capacity() && block === this.stackRegisters.ramOffset()
			&& frameCapacity === this.boundFrameCapacity && frames === this.boundFrameOffset && protectedOffset === this.boundProtectedOffset) return;
		this.boundFrameCapacity = frameCapacity;
		this.boundFrameOffset = frames;
		this.boundProtectedOffset = protectedOffset;
		this.bindFrameControls(frames);
		let extent = 0;
		for (let frame = this.currentFrame; frame !== null; frame = frame.previous)
			extent = Math.max(extent, frame.stackBase + frame.stackCapacity);
		this.stackRegisters.bindRam(this.heap.memory, block, capacity, false, extent > capacity);
		this.rebindFrames();
	}

	/** Is the retained activation still the RAM-selected frame and register window? */
	public currentFrameViewMatches(): boolean {
		const frame = this.currentFrame, depth = this.frameDepth;
		if (frame === null) return depth === 0;
		if (depth === 0 || (this.read(ThreadField.FrameBlock) & RAM_RECORD_WORD_MASK) !== this.boundFrameOffset
			|| frame.controlOffset !== (this.frameControlAddress(depth - 1) & RAM_RECORD_WORD_MASK)) return false;
		return frame.registers.capacity() === frame.stackCapacity
			&& frame.registers.ramOffset() === this.stackOffset() + 4 * frame.stackBase;
	}

	private rebindFrames(): void {
		for (let frame = this.currentFrame; frame !== null; frame = frame.previous)
			frame.registers.rebind(this.stackRegisters, frame.stackBase, frame.stackCapacity);
	}

	private bindFrameControls(start: number): void {
		let index = 0;
		for (let frame = this.firstFrame; frame !== null; frame = frame.next, ++index) {
			frame.bindControl(start + index * FRAME_CONTROL_BYTES);
		}
	}

	public resizeStack(capacity: number, root = valueNil()): void {
		const previous = this.stackRegisters.capacity();
		if (capacity === previous) return;
		if (capacity < previous) this.heap.threads.resizeStackBacking(this.address, capacity);
		else this.heap.budget.reserveThreadFrameStorage(this.address, capacity, 0, root);
		this.stackRegisters.bindRam(this.heap.memory, this.read(ThreadField.StackBlock) & RAM_RECORD_WORD_MASK, capacity);
		this.rebindFrames();
	}

	public frameSpaceFits(valueEnd: number, controls = 2): boolean {
		return valueEnd <= this.stackRegisters.capacity() && this.frameDepth + controls <= this.boundFrameCapacity;
	}

	public reserveFrame(values: number, root = valueNil(), exception = false): void {
		const wanted = this.frameDepth + (exception ? 1 : 2);
		let frames = Math.max(THREAD_INITIAL_FRAMES, this.boundFrameCapacity);
		while (frames < wanted) frames *= 2;
		const valueChange = values === this.stackRegisters.capacity() ? 0 : values;
		const frameChange = frames === this.boundFrameCapacity ? 0 : frames;
		if (valueChange === 0 && frameChange === 0) return;
		this.heap.budget.reserveThreadFrameStorage(this.address, valueChange, frameChange, root);
		if (frameChange !== 0) {
			this.boundFrameCapacity = frameChange;
			this.boundFrameOffset = this.read(ThreadField.FrameBlock) & RAM_RECORD_WORD_MASK;
			this.bindFrameControls(this.boundFrameOffset);
		}
		if (valueChange !== 0) {
			this.stackRegisters.bindRam(this.heap.memory, this.read(ThreadField.StackBlock) & RAM_RECORD_WORD_MASK, valueChange);
			this.rebindFrames();
		}
	}

	/** Prepare the first inactive node; stack growth can collect before entry. */
	public acquireFrame(): CallFrame {
		const existing = this.currentFrame === null ? this.firstFrame : this.currentFrame.next;
		if (existing !== null) return existing;
		const frame = this.frameNode(this.currentFrame);
		frame.bindControl(this.frameControlAddress(this.frameDepth));
		return frame;
	}

	/** Reserve the host views of the already fitted private service frame bank. */
	public reserveFrameViews(count: number): void {
		let previous: CallFrame | null = null;
		for (let index = 0; index < count; ++index) {
			const frame = this.frameNode(previous);
			frame.bindControl(this.frameControlAddress(index));
			previous = frame;
		}
	}

	private frameNode(previous: CallFrame | null): CallFrame {
		const attached = previous === null ? this.firstFrame : previous.next;
		if (attached !== null) return attached;
		let frame = this.parkedFrameViews;
		if (frame !== null) {
			this.parkedFrameViews = frame.next;
			frame.next = null;
			frame.previous = previous;
			frame.registers.unbind();
			frame.executionImage = null!;
			frame.decodedPage = null;
			frame.compilationEntry = true;
		} else frame = new CallFrame(this, previous, this.heap);
		if (previous === null) this.firstFrame = frame;
		else previous.next = frame;
		this.lastBoundFrame = frame;
		return frame;
	}

	public enterFrame(frame: CallFrame): void {
		this.currentFrame = frame;
		this.publishDepth(this.frameDepth + 1);
	}

	private publishDepth(depth: number): void {
		const memory = this.heap.memory, offset = (this.address + ThreadField.FrameDepth) & RAM_RECORD_WORD_MASK;
		writeLE32(memory.ramData(), offset, depth);
		memory.invalidateRamWrite(offset, 4);
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
