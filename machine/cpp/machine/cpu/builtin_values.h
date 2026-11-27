#pragma once

#include <array>
#include <cstring>
#include <iterator>
#include <memory>
#include <utility>
#include <vector>
#include "machine/cpu/value_slots.h"

namespace bmsx {
struct BuiltinFunctionCost {
	uint16_t base = 1;
	uint8_t perArg = 0;
	uint8_t perRet = 0;
};

struct BuiltinFunction {
	BuiltinFunctionId id = BuiltinFunctionId::Next;
	uint16_t cycleBase = 1;
	uint8_t cyclePerArg = 0;
	uint8_t cyclePerRet = 0;
};

inline constexpr std::array<BuiltinFunctionCost, BUILTIN_FUNCTION_COUNT> BUILTIN_FUNCTION_COSTS {{
	{ 2, 0, 0 }, // GetMetatable
	{ 2, 0, 0 }, // StringByte
	{ 1, 0, 0 }, // ToInteger
	{ 1, 0, 0 }, // Next
	{ 1, 0, 0 },
	{ 1, 0, 0 },
	{ 1, 0, 0 },
	{ 1, 0, 0 }, // Type
	{ 2, 0, 0 },
	{ 2, 0, 0 },
	{ 4, 0, 0 },
	{ 4, 0, 0 },
	{ 1, 0, 0 },
	{ 4, 0, 0 },
	{ 4, 0, 0 },
	{ 4, 0, 0 },
	{ 4, 0, 0 },
	{ 4, 0, 0 },
	{ 4, 0, 0 },
	{ 4, 0, 0 },
	{ 1, 0, 0 },
	{ 1, 0, 0 },
	{ 1, 0, 0 }, // FrameCount
	{ 1, 0, 0 }, // GetFrameRegister
	{ 1, 0, 0 }, // SetFrameRegister
	{ 1, 0, 0 }, // GetFrameUpvalue
	{ 1, 0, 0 }, // SetFrameUpvalue
	{ 1, 0, 0 }, // FrameHeader
	{ 1, 0, 0 }, // NumberType
	{ 2, 0, 0 }, // SetMetatable
	{ 2, 0, 0 }, // StringSlice
	{ 2, 0, 0 }, // StringFromBytes
}};

// Builtins consume compact register windows or temporary complete-value
// transports. Neither constructor copies arguments or allocates a backing array.
class BuiltinArgsView {
public:
	BuiltinArgsView() = default;
	explicit BuiltinArgsView(ConstValueSpan slots) : m_slots(slots), m_size(slots.size()) {}
	BuiltinArgsView(const Value* values, size_t size) : m_values(values), m_size(size) {}
	BuiltinArgsView(const std::vector<Value>& values) : m_values(values.data()), m_size(values.size()) {}
	size_t size() const noexcept { return m_size; }
	bool empty() const noexcept { return m_size == 0; }
	Value operator[](size_t index) const noexcept {
		if (index >= m_size) return valueNil(); // Missing language arguments are nil.
		return m_values ? m_values[index] : m_slots.get(index);
	}
	void placeInto(ValueSpan& target, size_t base, size_t copied, size_t padded) const {
		if (!m_values) {
			target.copyFrom(m_slots, base, 0, copied, padded);
			return;
		}
		for (size_t i = 0; i < copied; ++i) target.set(base + i, m_values[i]);
		target.clear(base + copied, padded);
	}
	BuiltinArgsView tailFrom(size_t index) const noexcept {
		if (index >= m_size) return {};
		return m_values ? BuiltinArgsView(m_values + index, m_size - index)
			: BuiltinArgsView(m_slots.subspan(index, m_size - index));
	}
	class iterator {
	public:
		using value_type = Value;
		using difference_type = std::ptrdiff_t;
		using iterator_category = std::forward_iterator_tag;
		using pointer = void;
		using reference = Value;
		iterator() = default;
		iterator(const BuiltinArgsView* view, size_t index) : m_view(view), m_index(index) {}
		Value operator*() const { return (*m_view)[m_index]; }
		iterator& operator++() { ++m_index; return *this; }
		iterator operator++(int) { auto before = *this; ++m_index; return before; }
		bool operator==(const iterator& right) const { return m_view == right.m_view && m_index == right.m_index; }
	private:
		const BuiltinArgsView* m_view = nullptr;
		size_t m_index = 0;
	};
	iterator begin() const { return {this, 0}; }
	iterator end() const { return {this, m_size}; }
private:
	ConstValueSpan m_slots;
	const Value* m_values = nullptr;
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

} // namespace bmsx
