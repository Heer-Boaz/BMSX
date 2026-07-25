import { formatNumber } from '../common/number_format';
import type { Closure, Table } from './cpu';
import type { StringId, StringPool } from './string_pool';

export const enum ValueTag {
	Nil,
	False,
	True,
	Number,
	String,
	Table,
	Closure,
	BuiltinFunction,
	NativeFunction,
	NativeObject,
}

export const VALUE_TAG: unique symbol = Symbol('bmsx.valueTag');

export class StringValue {
	public readonly [VALUE_TAG] = ValueTag.String;
	public readonly id: StringId;

	private constructor(id: StringId) {
		this.id = id;
	}

	public static get(id: StringId): StringValue {
		let value = STRING_VALUES[id];
		if (value === undefined) {
			value = new StringValue(id);
			STRING_VALUES[id] = value;
		}
		return value;
	}
}

const STRING_VALUES: StringValue[] = [];

export type Value = null | boolean | number | StringValue | Table | Closure | BuiltinFunction | NativeFunction | NativeObject;
export type HeapValue = StringValue | Table | Closure | BuiltinFunction | NativeFunction | NativeObject;
export const EMPTY_CALL_ARGS: ReadonlyArray<Value> = [];

export function valueTag(value: Value): ValueTag {
	if (value === null) {
		return ValueTag.Nil;
	}
	if (value === false) {
		return ValueTag.False;
	}
	if (value === true) {
		return ValueTag.True;
	}
	if (typeof value !== 'object') {
		return ValueTag.Number;
	}
	return value[VALUE_TAG];
}

export function valueIsHeap(value: unknown): value is HeapValue {
	return value !== null && typeof value === 'object' && VALUE_TAG in value;
}

export function valueIsString(value: Value): value is StringValue {
	return valueTag(value) === ValueTag.String;
}

export function asStringId(value: StringValue): StringId {
	return value.id;
}

export const isTruthyValue = (value: Value): boolean => value !== null && value !== false;

export type NativeFnCost = {
	base: number;
	perArg: number;
	perRet: number;
};

export const enum BuiltinFunctionId {
	Next,
	Type,
	SetMetatable,
	GetMetatable,
	RawGet,
	RawSet,
	Select,
	StringByte,
	StringChar,
	Error,
	PCall,
	XPCall,
}

export type BuiltinFunction = {
	readonly [VALUE_TAG]: ValueTag.BuiltinFunction;
	readonly id: BuiltinFunctionId;
	readonly cost: NativeFnCost;
};

const BUILTIN_COST_TIER1: NativeFnCost = { base: 1, perArg: 0, perRet: 0 };
const BUILTIN_COST_TIER2: NativeFnCost = { base: 2, perArg: 0, perRet: 0 };
const BUILTIN_COST_TIER4: NativeFnCost = { base: 4, perArg: 0, perRet: 0 };
const BUILTIN_FUNCTION_VALUE_TAG = ValueTag.BuiltinFunction;
const BUILTIN_FUNCTIONS: readonly BuiltinFunction[] = [
	{ [VALUE_TAG]: BUILTIN_FUNCTION_VALUE_TAG, id: BuiltinFunctionId.Next, cost: BUILTIN_COST_TIER1 },
	{ [VALUE_TAG]: BUILTIN_FUNCTION_VALUE_TAG, id: BuiltinFunctionId.Type, cost: BUILTIN_COST_TIER1 },
	{ [VALUE_TAG]: BUILTIN_FUNCTION_VALUE_TAG, id: BuiltinFunctionId.SetMetatable, cost: BUILTIN_COST_TIER2 },
	{ [VALUE_TAG]: BUILTIN_FUNCTION_VALUE_TAG, id: BuiltinFunctionId.GetMetatable, cost: BUILTIN_COST_TIER2 },
	{ [VALUE_TAG]: BUILTIN_FUNCTION_VALUE_TAG, id: BuiltinFunctionId.RawGet, cost: BUILTIN_COST_TIER1 },
	{ [VALUE_TAG]: BUILTIN_FUNCTION_VALUE_TAG, id: BuiltinFunctionId.RawSet, cost: BUILTIN_COST_TIER1 },
	{ [VALUE_TAG]: BUILTIN_FUNCTION_VALUE_TAG, id: BuiltinFunctionId.Select, cost: BUILTIN_COST_TIER1 },
	{ [VALUE_TAG]: BUILTIN_FUNCTION_VALUE_TAG, id: BuiltinFunctionId.StringByte, cost: BUILTIN_COST_TIER2 },
	{ [VALUE_TAG]: BUILTIN_FUNCTION_VALUE_TAG, id: BuiltinFunctionId.StringChar, cost: BUILTIN_COST_TIER2 },
	{ [VALUE_TAG]: BUILTIN_FUNCTION_VALUE_TAG, id: BuiltinFunctionId.Error, cost: BUILTIN_COST_TIER2 },
	{ [VALUE_TAG]: BUILTIN_FUNCTION_VALUE_TAG, id: BuiltinFunctionId.PCall, cost: BUILTIN_COST_TIER4 },
	{ [VALUE_TAG]: BUILTIN_FUNCTION_VALUE_TAG, id: BuiltinFunctionId.XPCall, cost: BUILTIN_COST_TIER4 },
];

export function createBuiltinFunction(id: BuiltinFunctionId): BuiltinFunction {
	return BUILTIN_FUNCTIONS[id];
}

export type NativeFunction = {
	readonly [VALUE_TAG]: ValueTag.NativeFunction;
	readonly hashId: number;
	readonly name: string;
	invoke(args: NativeArgs, out: Value[]): void;
	readonly cost: NativeFnCost;
};

export type NativeArgs = {
	readonly length: number;
	get(index: number): Value;
};

export type NativeObject = {
	readonly [VALUE_TAG]: ValueTag.NativeObject;
	readonly hashId: number;
	readonly raw: object;
	get(key: Value): Value;
	set(key: Value, value: Value): void;
	len: () => number;
	nextEntry: (after: Value) => [Value, Value] | null;
	metatable: Table | null;
};

export function valueTypeName(value: Value): string {
	switch (valueTag(value)) {
		case ValueTag.Nil: return 'nil';
		case ValueTag.False:
		case ValueTag.True: return 'boolean';
		case ValueTag.Number: return 'number';
		case ValueTag.String: return 'string';
		case ValueTag.Table: return 'table';
		case ValueTag.Closure: return 'closure';
		case ValueTag.BuiltinFunction: return 'builtin_function';
		case ValueTag.NativeFunction: return 'native_function';
		case ValueTag.NativeObject: return 'native_object';
	}
}

export function valueTypeNameForLua(value: Value): string {
	switch (valueTag(value)) {
		case ValueTag.Nil:
			return 'nil';
		case ValueTag.False:
		case ValueTag.True:
			return 'boolean';
		case ValueTag.Number:
			return 'number';
		case ValueTag.String:
			return 'string';
		case ValueTag.Table:
			return 'table';
		case ValueTag.Closure:
		case ValueTag.BuiltinFunction:
		case ValueTag.NativeFunction:
			return 'function';
		case ValueTag.NativeObject:
			return 'native';
	}
}

export function valueToString(value: Value, stringPool: StringPool): string {
	switch (valueTag(value)) {
		case ValueTag.Nil:
			return 'nil';
		case ValueTag.False:
			return 'false';
		case ValueTag.True:
			return 'true';
		case ValueTag.Number: {
			const numberValue = value as number;
			if (numberValue - numberValue !== 0) {
				return numberValue !== numberValue ? 'nan' : (numberValue < 0 ? '-inf' : 'inf');
			}
			return formatNumber(numberValue);
		}
		case ValueTag.String:
			return stringPool.toString(asStringId(value as StringValue));
		case ValueTag.Table:
			return 'table';
		case ValueTag.NativeObject:
			return 'native';
		case ValueTag.Closure:
		case ValueTag.BuiltinFunction:
		case ValueTag.NativeFunction:
			return 'function';
	}
}

export function isBuiltinFunction(value: Value): value is BuiltinFunction {
	return valueTag(value) === ValueTag.BuiltinFunction;
}

export function isNativeFunction(value: Value): value is NativeFunction {
	return valueTag(value) === ValueTag.NativeFunction;
}

export function isNativeObject(value: Value): value is NativeObject {
	return valueTag(value) === ValueTag.NativeObject;
}

export function valueIsClosure(value: Value): value is Closure {
	return valueTag(value) === ValueTag.Closure;
}

export function valueIsNumber(value: Value): value is number {
	return valueTag(value) === ValueTag.Number;
}

export function valueIsTable(value: Value): value is Table {
	return valueTag(value) === ValueTag.Table;
}
