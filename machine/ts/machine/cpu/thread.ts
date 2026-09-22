import { ScratchBuffer } from '../../common/scratchbuffer';
import { ProtectedCallContinuation, type CallFrame } from './call_state';
import type { Closure } from './closure';
import { VALUE_TAG, ValueTag } from './value';
import { ValueSlots } from './value_slots';

export const enum ThreadStatus { New, Running, Normal, Suspended, Dead, Failed }
export const THREAD_HEAP_BYTES = 64;
export const THREAD_STACK_SLOT_BYTES = 8;

/** Retained language execution state. Physical CPU/IRQ/bus state is not thread-local. */
export class Thread {
	public readonly [VALUE_TAG] = ValueTag.Thread;
	public hashId = 0;
	public status = ThreadStatus.New;
	public readonly frames: CallFrame[] = [];
	public stackRegisters = new ValueSlots(8);
	public stackTop = 0;
	public readonly protectedCallContinuations = new ScratchBuffer(() => new ProtectedCallContinuation(), 1);
	public protectedCallDepth = 0;
	public resumer: Thread | null = null;
	public callBase = 0;
	public returnCount = 0;
	public readonly error = new ValueSlots(1);

	public constructor(public entry: Closure | null) {}
}
