import { formatInteger, formatFloat } from '../../common/number_format';
import { f32BitsToNumber } from '../../common/float32';
import { luaCompareIntegerFloat, luaFloatResultBits, luaFloatToInteger, luaFloatToWord, NumericOrder } from '../../spec/blua32/numeric';
import { BuiltinFunctionId } from '../../spec/blua32/builtin';
import { BLUA32_STRING_RECORD_ALIGNMENT_SHIFT } from '../../spec/blua32/image_format';
import type { StringId, StringPool } from './string_pool';

export const enum ValueTag {
	Nil, False, True, Integer, Float, String, Table, Closure, BuiltinFunction, Thread,
	DeadKey, // Table retirement metadata, never a language value.
	CodeFunction = 12, // Immutable System Function with no environment.
	UnboundStringLiteral = 0xff, // Only in a decoded operand bank, never a guest Value.
}
declare const valueBrand: unique symbol;
// Complete transient transport: all supported tag/word pairs fit exactly in a
// JS Number. Guest Numbers themselves remain int32 or binary32, not binary64.
export type Value = number & { readonly [valueBrand]: true };
const TAG_SCALE = 0x1_0000_0000;
export const EMPTY_CALL_ARGS: ReadonlyArray<Value> = [];
export function valueFromTag(tag: ValueTag, word = 0): Value { return (tag * TAG_SCALE + word) as Value; }
export function valueTagIsStorageReference(tag: ValueTag): boolean {
	return tag >= ValueTag.String && tag <= ValueTag.Thread && tag !== ValueTag.BuiltinFunction;
}
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
export function valueIsNaN(value: Value): boolean {
	return valueIsFloat(value) && (valuePayload(value) & 0x7fffffff) > 0x7f800000;
}
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
	const tag = valueTag(value);
	if (tag <= ValueTag.True) return valueFromTag(tag);
	if (tag !== ValueTag.Float) return value;
	const integer = luaFloatToInteger(valuePayload(value));
	if (integer !== null) return valueInteger(integer);
	return value;
}
export function tableKeysEqual(left: Value, right: Value): boolean { return canonicalTableKey(left) === canonicalTableKey(right); }
// A table operation normalizes its key before selecting the array or hash.
export function hashCanonicalTableKey(value: Value): number {
	switch (valueTag(value)) {
		case ValueTag.Integer: case ValueTag.Float:
		case ValueTag.Table: case ValueTag.Closure: case ValueTag.Thread: case ValueTag.CodeFunction: {
			let bits = valuePayload(value);
			bits = Math.imul(bits ^ ((bits << 14) | (bits >>> 18)), 0x85ebca6b) >>> 0;
			return (bits ^ (bits >>> 13)) >>> 0;
		}
		case ValueTag.Nil: return 0x27d4eb2d;
		case ValueTag.False: return 0x85ebca6b;
		case ValueTag.True: return 0x9e3779b9;
		// Use the aligned interned record identity, not its byte address.
		case ValueTag.String: return valuePayload(value) >>> BLUA32_STRING_RECORD_ALIGNMENT_SHIFT;
		case ValueTag.BuiltinFunction: return Math.imul(valuePayload(value) + 1, 0x27d4eb2d) >>> 0;
		default: throw new Error('Internal table metadata is not a table key.');
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
		case ValueTag.Closure: case ValueTag.BuiltinFunction: case ValueTag.CodeFunction: return 'function';
		default: throw new Error('Internal table metadata is not a language value.');
	}
}
export function valueToString(value: Value, strings: StringPool): string {
	return valueIsString(value) ? strings.toString(asStringId(value)) : valueToByteString(value, strings);
}

export function valueToByteString(value: Value, strings: StringPool): string {
	switch (valueTag(value)) {
		case ValueTag.Nil: return 'nil';
		case ValueTag.False: return 'false';
		case ValueTag.True: return 'true';
		case ValueTag.Integer: return formatInteger(asInteger(value));
		case ValueTag.Float: return formatFloat(asFloat(value));
		case ValueTag.String: return strings.bytes(asStringId(value));
		case ValueTag.Table: return 'table';
		case ValueTag.Thread: return 'thread';
		case ValueTag.Closure: case ValueTag.BuiltinFunction: case ValueTag.CodeFunction: return 'function';
		default: throw new Error('Internal table metadata is not a language value.');
	}
}
