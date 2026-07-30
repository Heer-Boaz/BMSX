import type { Closure, Upvalue } from './closure';
import type { Blua32ExecutionImage } from './execution_image';
import type { ValueSlots } from './value_slots';

export const enum ProtectedCallKind {
	PCall,
	XPCallBody,
	XPCallHandler,
}

export type CallFrame = {
	functionAddress: number;
	executionImage: Blua32ExecutionImage;
	codeAddress: number;
	codeByteCount: number;
	pc: number;
	varargBase: number;
	varargCount: number;
	stackBase: number;
	stackCapacity: number;
	registers: ValueSlots;
	closure: Closure;
	returnBase: number;
	returnCount: number;
	top: number;
	returnToCompletionLatch: boolean;
	callSitePc: number;
	isExceptionFrame: boolean;
	isNonMaskableExceptionFrame: boolean;
	openUpvalueHead: Upvalue | null;
};

export class ProtectedCallContinuation {
	public kind = ProtectedCallKind.PCall;
	public caller: CallFrame | null = null;
	public target: CallFrame | null = null;
	public returnsToProtectedParent = false;
	public callBase = 0;
	public returnCount = 0;
	public handlerRegister = -1;
}
