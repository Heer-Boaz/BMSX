import type { Closure } from './closure';
import type { Blua32RuntimeFunction } from './execution_image';
import type { RegisterFile } from './register_file';

export const enum ProtectedCallKind {
	PCall,
	XPCallBody,
	XPCallHandler,
}

export type CallFrame = {
	functionAddress: number;
	functionRecord: Blua32RuntimeFunction;
	pc: number;
	varargBase: number;
	varargCount: number;
	stackBase: number;
	stackCapacity: number;
	registers: RegisterFile;
	closure: Closure;
	returnBase: number;
	returnCount: number;
	top: number;
	returnToCompletionLatch: boolean;
	callSitePc: number;
	isExceptionFrame: boolean;
	isNonMaskableExceptionFrame: boolean;
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
