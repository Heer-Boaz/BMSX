import { ScratchBuffer } from '../../common/scratchbuffer';
import { ProtectedCallContinuation, type CallFrame } from './call_state';
import type { Closure } from './closure';
import { VALUE_TAG, ValueTag } from './value';
import { ValueSlots } from './value_slots';
import { MAPPED_BUS_MASTER_CPU } from '../memory/bus_signals';

export const enum ThreadStatus { New, Running, Normal, Suspended, Dead, Failed }
export const THREAD_HEAP_BYTES = 64;
export const THREAD_STACK_SLOT_BYTES = 8;

/** Retained language execution state. Physical CPU/IRQ/bus state is not thread-local. */
export class Thread {
	public readonly [VALUE_TAG] = ValueTag.Thread;
	public hashId = 0;
	public status = ThreadStatus.New;
	public firstFrame: CallFrame | null = null;
	public currentFrame: CallFrame | null = null;
	public frameDepth = 0;
	public stackRegisters = new ValueSlots(8);
	public stackTop = 0;
	public readonly protectedCallContinuations = new ScratchBuffer(() => new ProtectedCallContinuation(), 1);
	public protectedCallDepth = 0;
	public resumer: Thread | null = null;
	public callBase = 0;
	public returnCount = 0;
	public readonly error = new ValueSlots(1);

	public constructor(public entry: Closure | null) {}

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
				openUpvalueHead: null,
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
