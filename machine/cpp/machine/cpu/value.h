#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <iterator>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "machine/cpu/string_pool.h"
#include "spec/blua32/builtin.h"

namespace bmsx {

struct Table;
struct Closure;
struct Upvalue;

struct BuiltinFunctionCost {
	uint16_t base = 1;
	uint8_t perArg = 0;
	uint8_t perRet = 0;
};

using Value = uint64_t;

enum class ValueTag : uint8_t {
	Nil = 0,
	False = 1,
	True = 2,
	String = 3,
	Table = 4,
	Closure = 5,
	BuiltinFunction = 6,
	Upvalue = 7,
};

enum class ObjType : uint8_t {
	Table,
	Closure,
	Upvalue,
};

struct GCObject {
	ObjType type;
	bool marked = false;
	uint32_t hashId = 0;
	GCObject* next = nullptr;
};

struct BuiltinFunction {
	BuiltinFunctionId id = BuiltinFunctionId::Next;
	uint16_t cycleBase = 1;
	uint8_t cyclePerArg = 0;
	uint8_t cyclePerRet = 0;
};

inline constexpr std::array<BuiltinFunctionCost, BUILTIN_FUNCTION_COUNT> BUILTIN_FUNCTION_COSTS {{
	{ 1, 0, 0 },
	{ 1, 0, 0 },
	{ 2, 0, 0 },
	{ 2, 0, 0 },
	{ 1, 0, 0 },
	{ 1, 0, 0 },
	{ 1, 0, 0 },
	{ 2, 0, 0 },
	{ 2, 0, 0 },
	{ 2, 0, 0 },
	{ 4, 0, 0 },
	{ 4, 0, 0 },
	{ 1, 0, 0 },
}};

constexpr uint64_t VALUE_QNAN_MASK = 0x7ff8000000000000ULL;
constexpr uint64_t VALUE_SIGN_BIT = 0x8000000000000000ULL;
constexpr uint64_t VALUE_PAYLOAD_MASK = 0x0000ffffffffffffULL;

inline bool valueIsNumber(Value v) {
	if ((v & VALUE_QNAN_MASK) != VALUE_QNAN_MASK) {
		return true;
	}
	const uint64_t tag = ((v >> 48) & 0x7ULL) | ((v & VALUE_SIGN_BIT) ? 0x8ULL : 0ULL);
	return tag == 0;
}

inline bool valueIsTagged(Value v) {
	if ((v & VALUE_QNAN_MASK) != VALUE_QNAN_MASK) {
		return false;
	}
	const uint64_t tag = ((v >> 48) & 0x7ULL) | ((v & VALUE_SIGN_BIT) ? 0x8ULL : 0ULL);
	return tag != 0;
}

inline uint64_t valuePayload(Value v) {
	return v & VALUE_PAYLOAD_MASK;
}

inline ValueTag valueTag(Value v) {
	const uint64_t tag = ((v >> 48) & 0x7ULL) | ((v & VALUE_SIGN_BIT) ? 0x8ULL : 0ULL);
	return static_cast<ValueTag>(tag - 1);
}

inline Value valueFromTag(ValueTag tag, uint64_t payload = 0) {
	const uint64_t tagBits = static_cast<uint64_t>(tag) + 1;
	const uint64_t hi = (tagBits & 0x7ULL) << 48;
	const uint64_t sign = (tagBits & 0x8ULL) ? VALUE_SIGN_BIT : 0ULL;
	return VALUE_QNAN_MASK | hi | sign | (payload & VALUE_PAYLOAD_MASK);
}

inline Value valueFromNumber(double value) {
	if (value != value) {
		return VALUE_QNAN_MASK;
	}
	Value out = 0;
	std::memcpy(&out, &value, sizeof(double));
	return out;
}

inline double asNumber(Value v) {
	double out = 0.0;
	std::memcpy(&out, &v, sizeof(double));
	return out;
}

inline Value valueNil() {
	return valueFromTag(ValueTag::Nil);
}

inline Value valueBool(bool value) {
	return valueFromTag(value ? ValueTag::True : ValueTag::False);
}

inline Value valueNumber(double value) {
	return valueFromNumber(value);
}

inline Value valueString(StringId id) {
	return valueFromTag(ValueTag::String, id);
}

inline Value valueTable(Table* table) {
	return valueFromTag(ValueTag::Table, reinterpret_cast<uint64_t>(table));
}

inline Value valueClosure(Closure* closure) {
	return valueFromTag(ValueTag::Closure, reinterpret_cast<uint64_t>(closure));
}

inline Value valueBuiltinFunction(BuiltinFunction* fn) {
	return valueFromTag(ValueTag::BuiltinFunction, reinterpret_cast<uint64_t>(fn));
}

inline Value valueUpvalue(Upvalue* upvalue) {
	return valueFromTag(ValueTag::Upvalue, reinterpret_cast<uint64_t>(upvalue));
}

inline bool isNil(Value v) {
	return valueIsTagged(v) && valueTag(v) == ValueTag::Nil;
}

inline bool isTruthy(Value v) {
	if (isNil(v)) return false;
	if (valueIsTagged(v)) return valueTag(v) != ValueTag::False;
	return true;
}

inline uint32_t toU32(double value) {
	if (value >= -4294967296.0 && value < 4294967296.0) {
		return static_cast<uint32_t>(static_cast<int64_t>(value));
	}
	uint64_t bits = 0;
	std::memcpy(&bits, &value, sizeof(double));
	const uint32_t encodedExponent = static_cast<uint32_t>((bits >> 52) & 0x7ffULL);
	if (encodedExponent < 1023u || encodedExponent == 0x7ffu) {
		return 0u;
	}
	const uint32_t exponent = encodedExponent - 1023u;
	if (exponent >= 84u) {
		return 0u;
	}
	const uint64_t significand = (bits & 0x000fffffffffffffULL) | 0x0010000000000000ULL;
	const uint32_t word = exponent < 52u
		? static_cast<uint32_t>(significand >> (52u - exponent))
		: static_cast<uint32_t>(significand) << (exponent - 52u);
	return (bits & VALUE_SIGN_BIT) == 0u ? word : 0u - word;
}

inline uint32_t toU32(Value value) {
	return toU32(asNumber(value));
}

inline int32_t toI32(double value) {
	return static_cast<int32_t>(toU32(value));
}

inline int32_t toI32(Value value) {
	return static_cast<int32_t>(toU32(value));
}

inline StringId asStringId(Value v) {
	return static_cast<StringId>(valuePayload(v));
}

inline Table* asTable(Value v) {
	return reinterpret_cast<Table*>(valuePayload(v));
}

inline Closure* asClosure(Value v) {
	return reinterpret_cast<Closure*>(valuePayload(v));
}

inline BuiltinFunction* asBuiltinFunction(Value v) {
	return reinterpret_cast<BuiltinFunction*>(valuePayload(v));
}

inline Upvalue* asUpvalue(Value v) {
	return reinterpret_cast<Upvalue*>(valuePayload(v));
}

inline bool valueIsString(Value v) {
	return valueIsTagged(v) && valueTag(v) == ValueTag::String;
}

inline bool valueIsBool(Value v) {
	if (!valueIsTagged(v)) {
		return false;
	}
	const ValueTag tag = valueTag(v);
	return tag == ValueTag::True || tag == ValueTag::False;
}

inline bool valueToBool(Value v) {
	return valueTag(v) == ValueTag::True;
}

inline bool valueIsTable(Value v) {
	return valueIsTagged(v) && valueTag(v) == ValueTag::Table;
}

inline bool valueIsClosure(Value v) {
	return valueIsTagged(v) && valueTag(v) == ValueTag::Closure;
}

inline bool valueIsBuiltinFunction(Value v) {
	return valueIsTagged(v) && valueTag(v) == ValueTag::BuiltinFunction;
}

inline bool valueIsUpvalue(Value v) {
	return valueIsTagged(v) && valueTag(v) == ValueTag::Upvalue;
}

inline uint32_t valueObjectHashId(Value value) {
	return reinterpret_cast<const GCObject*>(valuePayload(value))->hashId;
}

inline uint32_t valueBuiltinFunctionHashId(Value value) {
	return static_cast<uint32_t>(asBuiltinFunction(value)->id) + 1u;
}

struct ValueHash {
	size_t operator()(Value v) const noexcept {
		if (valueIsNumber(v)) {
			double num = asNumber(v);
			if (num == 0.0) {
				num = 0.0;
			}
			uint64_t bits = 0;
			std::memcpy(&bits, &num, sizeof(double));
			return static_cast<size_t>(bits ^ (bits >> 32));
		}
		if (valueIsString(v)) {
			return static_cast<size_t>(static_cast<uint64_t>(asStringId(v)) * 2654435761ULL);
		}
		if (valueIsBool(v)) {
			return valueToBool(v) ? static_cast<size_t>(0x9e3779b9u) : static_cast<size_t>(0x85ebca6bu);
		}
		if (isNil(v)) {
			return static_cast<size_t>(0x27d4eb2du);
		}
		if (valueIsBuiltinFunction(v)) {
			return static_cast<size_t>(valueBuiltinFunctionHashId(v) * 0x27d4eb2du);
		}
		if (valueIsTable(v) || valueIsClosure(v) || valueIsUpvalue(v)) {
			return static_cast<size_t>(static_cast<uint64_t>(valueObjectHashId(v)) * 2654435761ULL);
		}
		const uint64_t payload = valuePayload(v);
		return static_cast<size_t>(payload * 2654435761ULL);
	}
};

struct ValueEq {
	bool operator()(Value lhs, Value rhs) const noexcept {
		if (valueIsNumber(lhs) && valueIsNumber(rhs)) {
			return lhs == rhs || asNumber(lhs) == asNumber(rhs);
		}
		return lhs == rhs;
	}
};

class BuiltinArgsView {
public:
	BuiltinArgsView() = default;
	BuiltinArgsView(const Value* data, size_t size)
		: m_data(data)
		, m_size(size) {
	}
	BuiltinArgsView(const std::vector<Value>& values)
		: m_data(values.data())
		, m_size(values.size()) {
	}

	size_t size() const noexcept { return m_size; }
	bool empty() const noexcept { return m_size == 0; }
	const Value* data() const noexcept { return m_data; }
	const Value* begin() const noexcept { return m_data; }
	const Value* end() const noexcept { return m_size == 0 ? m_data : m_data + m_size; }
	Value operator[](size_t index) const noexcept { return index < m_size ? m_data[index] : valueNil(); }
	BuiltinArgsView tailFrom(size_t index) const noexcept {
		return index < m_size ? BuiltinArgsView(m_data + index, m_size - index) : BuiltinArgsView(m_data + m_size, 0);
	}

private:
	const Value* m_data = nullptr;
	size_t m_size = 0;
};

class BuiltinResults {
public:
	class iterator {
	public:
		enum class Position : uint8_t {
			Begin,
			End,
		};

		explicit iterator(Position position)
			: m_position(position) {
		}

		Position position() const noexcept { return m_position; }

	private:
		Position m_position;
	};

	BuiltinResults() = default;
	BuiltinResults(BuiltinResults&&) noexcept = default;
	BuiltinResults& operator=(BuiltinResults&&) noexcept = default;
	BuiltinResults(const BuiltinResults&) = delete;
	BuiltinResults& operator=(const BuiltinResults&) = delete;

	void clear() noexcept { m_size = 0; }
	size_t size() const noexcept { return m_size; }
	bool empty() const noexcept { return m_size == 0; }
	const Value* data() const noexcept { return m_data.get(); }
	Value* data() noexcept { return m_data.get(); }
	const Value& operator[](size_t index) const noexcept { return m_data[index]; }
	Value& operator[](size_t index) noexcept { return m_data[index]; }
	iterator begin() const noexcept { return iterator(iterator::Position::Begin); }
	iterator end() const noexcept { return iterator(iterator::Position::End); }

	void push_back(Value value) {
		ensureCapacity(m_size + 1);
		m_data[m_size++] = value;
	}

	void prepend(Value value) {
		ensureCapacity(m_size + 1);
		if (m_size > 0) {
			std::memmove(m_data.get() + 1, m_data.get(), m_size * sizeof(Value));
		}
		m_data[0] = value;
		++m_size;
	}

	void append(const Value* values, size_t count) {
		if (count == 0) {
			return;
		}
		ensureCapacity(m_size + count);
		std::memcpy(m_data.get() + m_size, values, count * sizeof(Value));
		m_size += count;
	}

	void insert(iterator position, Value value) {
		if (position.position() == iterator::Position::Begin) {
			prepend(value);
			return;
		}
		push_back(value);
	}

	template <typename InputIt>
	void insert(iterator position, InputIt first, InputIt last) {
		const size_t count = static_cast<size_t>(std::distance(first, last));
		if (count == 0) {
			return;
		}
		ensureCapacity(m_size + count);
		if (position.position() == iterator::Position::Begin) {
			std::memmove(m_data.get() + count, m_data.get(), m_size * sizeof(Value));
			size_t index = 0;
			for (; first != last; ++first, ++index) {
				m_data[index] = static_cast<Value>(*first);
			}
			m_size += count;
			return;
		}
		for (; first != last; ++first) {
			m_data[m_size++] = static_cast<Value>(*first);
		}
	}

	void ensureCapacity(size_t needed) {
		if (needed <= m_capacity) {
			return;
		}
		size_t nextCapacity = m_capacity == 0 ? 8 : m_capacity;
		while (nextCapacity < needed) {
			nextCapacity <<= 1;
		}
		std::unique_ptr<Value[]> next = std::make_unique<Value[]>(nextCapacity);
		if (m_size > 0) {
			std::memcpy(next.get(), m_data.get(), m_size * sizeof(Value));
		}
		m_data = std::move(next);
		m_capacity = nextCapacity;
	}

private:
	std::unique_ptr<Value[]> m_data;
	size_t m_size = 0;
	size_t m_capacity = 0;
};

std::string valueToString(Value value, const StringPool& stringPool);

inline const char* valueTypeName(Value value) {
	if (valueIsNumber(value)) return "number";
	if (!valueIsTagged(value)) return "unknown";
	switch (valueTag(value)) {
		case ValueTag::Nil: return "nil";
		case ValueTag::False: return "boolean";
		case ValueTag::True: return "boolean";
		case ValueTag::String: return "string";
		case ValueTag::Table: return "table";
		case ValueTag::Closure: return "closure";
		case ValueTag::BuiltinFunction: return "builtin_function";
		case ValueTag::Upvalue: return "upvalue";
		default: return "unknown";
	}
}

inline const char* valueTypeNameForLua(Value value) {
	if (isNil(value)) return "nil";
	if (valueIsBool(value)) return "boolean";
	if (valueIsNumber(value)) return "number";
	if (valueIsString(value)) return "string";
	if (valueIsTable(value)) return "table";
	return "function";
}

} // namespace bmsx
