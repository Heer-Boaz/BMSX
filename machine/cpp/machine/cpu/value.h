#pragma once

#include <bit>
#include <cstddef>
#include <cstdint>
#include <string>
#include "common/compiler.h"
#include "common/float32.h"
#include "machine/cpu/string_pool.h"
#include "spec/blua32/builtin.h"
#include "spec/blua32/numeric.h"

namespace bmsx {
class GcHeap;
struct Thread;

// Only transient complete values use this transport word. Persistent slots use
// ValueStorage's separate 32-bit payload and byte-tag planes, never Value[].
using Value = uint64_t;
enum class ValueTag : uint8_t {
	Nil, False, True, Integer, Float, String, Table, Closure, BuiltinFunction, Thread,
	DeadKey, // Table retirement metadata; never a language-level value.
};
inline constexpr unsigned VALUE_HEADER_SHIFT = 32;
inline constexpr std::ptrdiff_t VALUE_HEADER_BYTE_OFFSET = std::endian::native == std::endian::little ? 4 : 0;
inline constexpr std::ptrdiff_t VALUE_LOW_WORD_BYTE_OFFSET = std::endian::native == std::endian::little ? 0 : 4;
inline constexpr uint32_t valueHeader(Value value) { return static_cast<uint32_t>(value >> VALUE_HEADER_SHIFT); }
inline constexpr ValueTag valueTag(Value value) { return static_cast<ValueTag>(valueHeader(value)); }
inline constexpr uint32_t valuePayload(Value value) { return static_cast<uint32_t>(value); }
inline constexpr uint32_t valueTagHeader(ValueTag tag) { return static_cast<uint32_t>(tag); }
inline constexpr Value valueFromTag(ValueTag tag, uint32_t payload = 0) {
	return (static_cast<uint64_t>(tag) << VALUE_HEADER_SHIFT) | payload;
}
inline constexpr Value valueNil() { return valueFromTag(ValueTag::Nil); }
inline constexpr Value valueBool(bool value) { return valueFromTag(value ? ValueTag::True : ValueTag::False); }
inline constexpr Value valueInteger(int32_t value) { return valueFromTag(ValueTag::Integer, static_cast<uint32_t>(value)); }
inline constexpr Value valueFloatBits(uint32_t bits) { return valueFromTag(ValueTag::Float, bits); }
// New arithmetic result, not a raw load/copy. NaNs canonicalize per operation.
inline Value valueFloat(float value) { return valueFloatBits(luaFloatResultBits(value)); }
inline constexpr Value valueString(StringId id) { return valueFromTag(ValueTag::String, id); }
inline constexpr Value valueTable(uint32_t address) { return valueFromTag(ValueTag::Table, address); }
inline constexpr Value valueClosure(uint32_t reference) { return valueFromTag(ValueTag::Closure, reference); }
inline constexpr Value valueThread(uint32_t reference) { return valueFromTag(ValueTag::Thread, reference); }
inline constexpr Value valueBuiltinFunction(BuiltinFunctionId id) {
	return valueFromTag(ValueTag::BuiltinFunction, static_cast<uint32_t>(id));
}
inline constexpr bool valueTagHasGcEdge(ValueTag tag) {
	return tag >= ValueTag::String && tag <= ValueTag::Thread && tag != ValueTag::BuiltinFunction;
}
inline constexpr bool valueIsInteger(Value value) { return valueTag(value) == ValueTag::Integer; }
inline constexpr bool valueIsFloat(Value value) { return valueTag(value) == ValueTag::Float; }
inline constexpr bool valueIsNumber(Value value) { return valueIsInteger(value) || valueIsFloat(value); }
inline constexpr bool isNil(Value value) { return valueTag(value) == ValueTag::Nil; }
inline constexpr bool isTruthy(Value value) { return valueTag(value) != ValueTag::Nil && valueTag(value) != ValueTag::False; }
inline constexpr bool valueIsString(Value value) { return valueTag(value) == ValueTag::String; }
inline constexpr bool valueIsTable(Value value) { return valueTag(value) == ValueTag::Table; }
inline constexpr bool valueIsClosure(Value value) { return valueTag(value) == ValueTag::Closure; }
inline constexpr bool valueIsThread(Value value) { return valueTag(value) == ValueTag::Thread; }
inline constexpr bool valueIsBuiltinFunction(Value value) { return valueTag(value) == ValueTag::BuiltinFunction; }
inline constexpr bool valueIsBool(Value value) { return valueTag(value) == ValueTag::False || valueTag(value) == ValueTag::True; }
inline constexpr bool valueToBool(Value value) { return valueTag(value) == ValueTag::True; }
inline constexpr int32_t asInteger(Value value) { return static_cast<int32_t>(valuePayload(value)); }
inline float asFloat(Value value) { return f32BitsToNumber(valuePayload(value)); }
inline constexpr StringId asStringId(Value value) { return valuePayload(value); }
inline constexpr BuiltinFunctionId asBuiltinFunctionId(Value value) { return static_cast<BuiltinFunctionId>(valuePayload(value)); }
// Number admission belongs to the instruction; mixed arithmetic converts its
// Integer operand before computing, not after a wider intermediate result.
inline float numberAsFloat(Value value) { return valueIsInteger(value) ? static_cast<float>(asInteger(value)) : asFloat(value); }
inline bool valueToWord(Value value, uint32_t& word) {
	if (valueIsInteger(value)) { word = valuePayload(value); return true; }
	return valueIsFloat(value) && luaFloatToWord(valuePayload(value), word);
}
inline bool valueToInteger(Value value, int32_t& integer) {
	if (valueIsInteger(value)) { integer = asInteger(value); return true; }
	return valueIsFloat(value) && luaFloatToInteger(valuePayload(value), integer);
}
inline NumericOrder compareNumbers(Value left, Value right) {
	if (valueIsInteger(left)) {
		if (!valueIsInteger(right)) return luaCompareIntegerFloat(asInteger(left), asFloat(right));
		return asInteger(left) < asInteger(right) ? NumericOrder::Less : asInteger(left) > asInteger(right) ? NumericOrder::Greater : NumericOrder::Equal;
	}
	if (valueIsInteger(right)) {
		const auto order = luaCompareIntegerFloat(asInteger(right), asFloat(left));
		return order == NumericOrder::Unordered ? order : static_cast<NumericOrder>(-static_cast<int>(order));
	}
	const float a = asFloat(left), b = asFloat(right);
	return a < b ? NumericOrder::Less : a > b ? NumericOrder::Greater : a == b ? NumericOrder::Equal : NumericOrder::Unordered;
}
inline bool valuesEqual(Value left, Value right) {
	if (valueIsNumber(left) && valueIsNumber(right)) return compareNumbers(left, right) == NumericOrder::Equal;
	const auto tag = valueTag(left);
	return tag <= ValueTag::True ? tag == valueTag(right) : left == right;
}
inline Value canonicalTableKey(Value value) {
	if (valueTag(value) <= ValueTag::True) return valueFromTag(valueTag(value));
	if (!valueIsFloat(value)) return value;
	int32_t integer;
	if (luaFloatToInteger(valuePayload(value), integer)) return valueInteger(integer);
	return (valuePayload(value) & 0x7fffffffu) > 0x7f800000u ? valueFloatBits(BLUA32_FLOAT_NAN) : value;
}
struct ValueEq {
	bool operator()(Value left, Value right) const { return canonicalTableKey(left) == canonicalTableKey(right); }
};
inline uint32_t scalarValueHash(Value value) {
	value = canonicalTableKey(value);
	switch (valueTag(value)) {
		case ValueTag::Integer:
		case ValueTag::Float: {
			uint32_t bits = valuePayload(value);
			bits ^= std::rotl(bits, 14); bits *= 0x85ebca6bu; bits ^= bits >> 13;
			return bits;
		}
		case ValueTag::Nil: return 0x27d4eb2du;
		case ValueTag::False: return 0x85ebca6bu;
		case ValueTag::True: return 0x9e3779b9u;
		case ValueTag::String: return valuePayload(value) * 2654435761u;
		case ValueTag::BuiltinFunction: return (valuePayload(value) + 1u) * 0x27d4eb2du;
		default: BMSX_UNREACHABLE();
	}
}
uint32_t asClosure(Value value, const GcHeap& heap);
uint32_t asThread(Value value, const GcHeap& heap);

int appendValueString(std::string& out, Value value, const StringPool& strings);
std::string valueToString(Value value, const StringPool& strings);
const char* valueTypeName(Value value);
const char* valueTypeNameForLua(Value value);
} // namespace bmsx
