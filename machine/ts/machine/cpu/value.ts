import { formatInteger, formatFloat } from '../../common/number_format';
import { f32BitsToNumber } from '../../common/float32';
import { BLUA32_FLOAT_NAN, luaCompareIntegerFloat, luaFloatResultBits, luaFloatToInteger, luaFloatToWord, NumericOrder } from '../../spec/blua32/numeric';
import { BuiltinFunctionId } from '../../spec/blua32/builtin';
import type { StringId, StringPool } from './string_pool';
import type { GcHeap } from './gc_heap';
import type { Table } from './table';
import type { Closure } from './closure';
import type { Thread } from './thread';

export const enum ValueTag {
	Nil, False, True, Integer, Float, String, Table, Closure, BuiltinFunction, Thread,
	DeadKey, // Table retirement metadata, never a language value.
}
declare const valueBrand: unique symbol;
// Complete transient transport: all supported tag/word pairs fit exactly in a
// JS Number. Guest Numbers themselves remain int32 or binary32, not binary64.
export type Value = number & { readonly [valueBrand]: true };
const TAG_SCALE = 0x1_0000_0000;
export const EMPTY_CALL_ARGS: ReadonlyArray<Value> = [];
export function valueFromTag(tag: ValueTag, word = 0): Value { return (tag * TAG_SCALE + word) as Value; }
export function valueTag(value: Value): ValueTag { return (value / TAG_SCALE) | 0; }
export function valuePayload(value: Value): number { return value >>> 0; }
export function valueNil(): Value { return valueFromTag(ValueTag.Nil); }
export function valueBool(value: boolean): Value { return valueFromTag(value ? ValueTag.True : ValueTag.False); }
export function valueInteger(value: number): Value { return valueFromTag(ValueTag.Integer, value >>> 0); }
export function valueFloatBits(bits: number): Value { return valueFromTag(ValueTag.Float, bits); }
export function valueFloat(value: number): Value { return valueFloatBits(luaFloatResultBits(value)); }
export function valueString(id: StringId): Value { return valueFromTag(ValueTag.String, id); }
export function valueTable(reference: number): Value { return valueFromTag(ValueTag.Table, reference); }
export function valueClosure(reference: number): Value { return valueFromTag(ValueTag.Closure, reference); }
export function valueThread(reference: number): Value { return valueFromTag(ValueTag.Thread, reference); }
export function valueBuiltinFunction(id: BuiltinFunctionId): Value { return valueFromTag(ValueTag.BuiltinFunction, id); }
export function valueIsInteger(value: Value): boolean { return valueTag(value) === ValueTag.Integer; }
export function valueIsFloat(value: Value): boolean { return valueTag(value) === ValueTag.Float; }
export function valueIsNumber(value: Value): boolean { const tag = valueTag(value); return tag === ValueTag.Integer || tag === ValueTag.Float; }
export function isNil(value: Value): boolean { return valueTag(value) === ValueTag.Nil; }
export function isTruthy(value: Value): boolean { const tag = valueTag(value); return tag !== ValueTag.Nil && tag !== ValueTag.False; }
export function valueIsString(value: Value): boolean { return valueTag(value) === ValueTag.String; }
export function valueIsTable(value: Value): boolean { return valueTag(value) === ValueTag.Table; }
export function valueIsClosure(value: Value): boolean { return valueTag(value) === ValueTag.Closure; }
export function valueIsThread(value: Value): boolean { return valueTag(value) === ValueTag.Thread; }
export function valueIsBuiltinFunction(value: Value): boolean { return valueTag(value) === ValueTag.BuiltinFunction; }
export function asInteger(value: Value): number { return value | 0; }
export function asFloat(value: Value): number { return f32BitsToNumber(valuePayload(value)); }
/** Host inspection of a guest Number, without the rounding of Float promotion. */
export function numberToHost(value: Value): number { return valueIsInteger(value) ? asInteger(value) : asFloat(value); }
export function asStringId(value: Value): StringId { return valuePayload(value); }
export function asBuiltinFunctionId(value: Value): BuiltinFunctionId { return valuePayload(value); }
export function asTable(value: Value, heap: GcHeap): Table { return heap.tableAt(valuePayload(value))!; }
export function asClosure(value: Value, heap: GcHeap): Closure { return heap.closureAt(valuePayload(value))!; }
export function asThread(value: Value, heap: GcHeap): Thread { return heap.object(valuePayload(value)) as Thread; }
export function numberAsFloat(value: Value): number { return valueIsInteger(value) ? Math.fround(asInteger(value)) : asFloat(value); }
export function valueToWord(value: Value): number | null {
	return valueIsInteger(value) ? valuePayload(value) : valueIsFloat(value) ? luaFloatToWord(valuePayload(value)) : null;
}
export function valueToInteger(value: Value): number | null {
	return valueIsInteger(value) ? asInteger(value) : valueIsFloat(value) ? luaFloatToInteger(valuePayload(value)) : null;
}
export function compareNumbers(left: Value, right: Value): NumericOrder {
	if (valueIsInteger(left)) {
		if (!valueIsInteger(right)) return luaCompareIntegerFloat(asInteger(left), asFloat(right));
		return asInteger(left) < asInteger(right) ? NumericOrder.Less : asInteger(left) > asInteger(right) ? NumericOrder.Greater : NumericOrder.Equal;
	}
	if (valueIsInteger(right)) {
		const order = luaCompareIntegerFloat(asInteger(right), asFloat(left));
		return order === NumericOrder.Unordered ? order : -order;
	}
	const a = asFloat(left), b = asFloat(right);
	return a < b ? NumericOrder.Less : a > b ? NumericOrder.Greater : a === b ? NumericOrder.Equal : NumericOrder.Unordered;
}
export function valuesEqual(left: Value, right: Value): boolean {
	if (valueIsNumber(left) && valueIsNumber(right)) return compareNumbers(left, right) === NumericOrder.Equal;
	const tag = valueTag(left);
	return tag <= ValueTag.True ? tag === valueTag(right) : left === right;
}
export function canonicalTableKey(value: Value): Value {
	if (valueTag(value) <= ValueTag.True) return valueFromTag(valueTag(value));
	if (!valueIsFloat(value)) return value;
	const integer = luaFloatToInteger(valuePayload(value));
	if (integer !== null) return valueInteger(integer);
	return (valuePayload(value) & 0x7fffffff) > 0x7f800000 ? valueFloatBits(BLUA32_FLOAT_NAN) : value;
}
export function tableKeysEqual(left: Value, right: Value): boolean { return canonicalTableKey(left) === canonicalTableKey(right); }
export function scalarValueHash(value: Value): number {
	value = canonicalTableKey(value);
	switch (valueTag(value)) {
		case ValueTag.Integer: case ValueTag.Float: {
			let bits = valuePayload(value);
			bits = Math.imul(bits ^ ((bits << 14) | (bits >>> 18)), 0x85ebca6b) >>> 0;
			return (bits ^ (bits >>> 13)) >>> 0;
		}
		case ValueTag.Nil: return 0x27d4eb2d;
		case ValueTag.False: return 0x85ebca6b;
		case ValueTag.True: return 0x9e3779b9;
		case ValueTag.String: return Math.imul(valuePayload(value), 2654435761) >>> 0;
		case ValueTag.BuiltinFunction: return Math.imul(valuePayload(value) + 1, 0x27d4eb2d) >>> 0;
		default: throw new Error('Reference hashing requires its owning heap.');
	}
}
export function valueTypeNameForLuaTag(tag: ValueTag): string {
	switch (tag) {
		case ValueTag.Nil: return 'nil';
		case ValueTag.False: case ValueTag.True: return 'boolean';
		case ValueTag.Integer: case ValueTag.Float: return 'number';
		case ValueTag.String: return 'string';
		case ValueTag.Table: return 'table';
		case ValueTag.Thread: return 'thread';
		case ValueTag.Closure: case ValueTag.BuiltinFunction: return 'function';
		default: throw new Error('Internal table metadata is not a language value.');
	}
}
export function valueToString(value: Value, strings: StringPool): string {
	switch (valueTag(value)) {
		case ValueTag.Nil: return 'nil';
		case ValueTag.False: return 'false';
		case ValueTag.True: return 'true';
		case ValueTag.Integer: return formatInteger(asInteger(value));
		case ValueTag.Float: return formatFloat(asFloat(value));
		case ValueTag.String: return strings.toString(asStringId(value));
		case ValueTag.Table: return 'table';
		case ValueTag.Thread: return 'thread';
		case ValueTag.Closure: case ValueTag.BuiltinFunction: return 'function';
		default: throw new Error('Internal table metadata is not a language value.');
	}
}
