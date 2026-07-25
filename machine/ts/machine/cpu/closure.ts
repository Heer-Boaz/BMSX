import { VALUE_TAG, ValueTag, type Value } from './value';
import type { CallFrame } from './cpu';

export type Upvalue = {
	hashId: number;
	open: boolean;
	index: number;
	frame: CallFrame;
	value: Value;
};

export const EMPTY_CLOSURE_UPVALUES: Upvalue[] = [];

export type OpenUpvalueSlot = {
	frame: CallFrame;
	index: number;
	upvalue: Upvalue;
};

export class Closure {
	public readonly [VALUE_TAG] = ValueTag.Closure;
	public hashId = 0;

	public constructor(
		public functionAddress: number,
		public upvalues: Upvalue[],
		public heapBytes: number,
	) {
	}
}
