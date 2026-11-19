import type { Thread } from './thread';
import type { Closure } from './closure';
import type { Blua32ExecutionImage, DecodedInstructionPage } from './execution_image';
import type { ValueSlots } from './value_slots';
import type { MappedBusSignals } from '../memory/bus_signals';

export const enum ProtectedCallKind {
	PCall,
	XPCallBody,
	XPCallHandler,
}

export type CallFrame = {
	thread: Thread;
	previous: CallFrame | null;
	next: CallFrame | null;
	functionAddress: number;
	executionImage: Blua32ExecutionImage;
	decodedPage: DecodedInstructionPage | null;
	decodedPageAddress: number;
	decodedPageBusSignals: MappedBusSignals;
	/** Host translation admission for the next PC, not checkpoint state. */
	compilationEntry: boolean;
	pc: number;
	varargBase: number;
	varargCount: number;
	stackBase: number;
	stackCapacity: number;
	registers: ValueSlots;
	closure: Closure;
	returnBase: number;
	returnCount: number;
	/** Only the activation invoked as a protected target owns its completion. */
	protectedContinuationIndex: number;
	top: number;
	returnToCompletionLatch: boolean;
	callSitePc: number;
	isExceptionFrame: boolean;
	isNonMaskableExceptionFrame: boolean;
	openUpvalueHead: number;
};

export const enum ProtectedField { Flags = 0, Caller = 4, Base = 8, Wanted = 12, Handler = 16 }
export const PROTECTED_CALL_BYTES = 20;
export const PROTECTED_CALL_KIND_MASK = 0xff;
export const PROTECTED_CALL_PARENT = 1 << 8;
