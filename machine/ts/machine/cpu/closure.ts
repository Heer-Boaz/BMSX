import { GcObject, GcKind } from './gc_object';
import {
	VALUE_TAG,
	ValueTag,
	type ValueReference,
} from './value';
import type { CallFrame } from './call_state';
import type { ExecutionDomainId } from '../../spec/blua32/execution_domain';

export class Upvalue extends GcObject {
	public open = false;
	public index = 0;
	public frame: CallFrame | null = null;
	public valueTag = ValueTag.Nil;
	public valueScalar = NaN;
	public valueReference: ValueReference = null;
	public nextOpen: Upvalue | null = null;
	public constructor() { super(GcKind.Upvalue); }
}

export const EMPTY_CLOSURE_UPVALUES: Upvalue[] = [];

export class Closure extends GcObject {
	public readonly [VALUE_TAG] = ValueTag.Closure;

	public constructor(
		public functionAddress: number,
		public upvalues: Upvalue[],
		public heapBytes: number,
		public codeAddress: number,
		public numParams: number,
		public maxStack: number,
		public flags: number,
		public upvalueTableAddress: number,
		public executionDomainId: ExecutionDomainId,
		public recordUpvalueCount: number,
		public canonical: boolean,
	) {
		super(GcKind.Closure);
	}
}

export const UPVALUE_HEAP_BYTES = 24;
