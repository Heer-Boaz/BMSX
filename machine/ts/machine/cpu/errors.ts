import { LUA_FAULT_REASON_UNKNOWN } from '../../spec/blua32/cop0';
import type { Value } from './value';

export const LUA_OUT_OF_MEMORY_SIGNAL = Symbol('Lua out of memory');

export class LuaThrownValueError extends Error {
	public readonly value: Value;

	public constructor(value: Value, message: string) {
		super(message);
		this.name = 'LuaThrownValueError';
		this.value = value;
	}
}

export class LuaExecutionError extends Error {
	public constructor(message: string, public readonly reason: number = LUA_FAULT_REASON_UNKNOWN) {
		super(message);
		this.name = 'LuaExecutionError';
	}
}
