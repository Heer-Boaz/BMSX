import { VALUE_TAG, ValueTag, type Value } from './value';
import type { CallFrame } from './call_state';

export type Upvalue = {
	hashId: number;
	open: boolean;
	index: number;
	frame: CallFrame;
	value: Value;
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
	) {
	}
}
