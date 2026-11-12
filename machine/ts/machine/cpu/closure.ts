import {
	VALUE_TAG,
	ValueTag,
	type ValueReference,
} from './value';
import type { CallFrame } from './call_state';
import type { ExecutionDomainId } from '../../spec/blua32/execution_domain';

export type Upvalue = {
	hashId: number;
	open: boolean;
	index: number;
	frame: CallFrame | null;
	valueTag: ValueTag;
	valueScalar: number;
	valueReference: ValueReference;
	nextOpen: Upvalue | null;
};

export const EMPTY_CLOSURE_UPVALUES: Upvalue[] = [];

export class Closure {
	public readonly [VALUE_TAG] = ValueTag.Closure;
	public hashId = 0;

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
	}
}
