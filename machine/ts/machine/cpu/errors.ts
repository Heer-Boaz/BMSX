import { LUA_FAULT_REASON_UNKNOWN } from '../../spec/blua32/cop0';
import { type ValueReference, ValueTag } from './value';

export const LUA_OUT_OF_MEMORY_SIGNAL = Symbol('Lua out of memory');

export class LuaThrownValueError {
	public constructor(
		public readonly tag: ValueTag,
		public readonly scalar: number,
		public readonly reference: ValueReference,
	) {}
}

export class LuaExecutionError {
	public constructor(public readonly reason: number = LUA_FAULT_REASON_UNKNOWN) {}
}
