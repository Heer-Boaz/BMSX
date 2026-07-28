import { formatNumber } from '../../common/number_format';
import { BuiltinFunctionId } from '../../spec/blua32/builtin';
import type { Closure } from './closure';
import type { StringId, StringPool } from './string_pool';
import type { Table } from './table';

export const enum ValueTag {
	Nil,
	False,
	True,
	Number,
	String,
	Table,
	Closure,
	BuiltinFunction,
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

export type Value = null | boolean | number | StringValue | Table | Closure | BuiltinFunction;
export type HeapValue = StringValue | Table | Closure;
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
	if (!value || typeof value !== 'object' || !(VALUE_TAG in value)) {
		return false;
	}
	const tag = value[VALUE_TAG];
	return tag === ValueTag.String || tag === ValueTag.Table || tag === ValueTag.Closure;
}

export function valueIsString(value: Value): value is StringValue {
	return valueTag(value) === ValueTag.String;
}

export function asStringId(value: StringValue): StringId {
	return value.id;
}

export const isTruthyValue = (value: Value): boolean => value !== null && value !== false;

export type BuiltinFunctionCost = {
	base: number;
	perArg: number;
	perRet: number;
};

export type BuiltinFunction = {
	readonly [VALUE_TAG]: ValueTag.BuiltinFunction;
	readonly id: BuiltinFunctionId;
	readonly cost: BuiltinFunctionCost;
};

const BUILTIN_COST_TIER1: BuiltinFunctionCost = { base: 1, perArg: 0, perRet: 0 };
const BUILTIN_COST_TIER2: BuiltinFunctionCost = { base: 2, perArg: 0, perRet: 0 };
const BUILTIN_COST_TIER4: BuiltinFunctionCost = { base: 4, perArg: 0, perRet: 0 };
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

export type BuiltinArgs = {
	readonly length: number;
	get(index: number): Value;
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
			return 'function';
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
		case ValueTag.Closure:
		case ValueTag.BuiltinFunction:
			return 'function';
	}
}

export function isBuiltinFunction(value: Value): value is BuiltinFunction {
	return valueTag(value) === ValueTag.BuiltinFunction;
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
