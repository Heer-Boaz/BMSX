#pragma once

#include <type_traits>
#include "machine/cpu/value.h"
#include "machine/cpu/value_storage.h"

namespace bmsx {
// A borrowed logical register window. It is not a contiguous Value* and never
// creates proxy references; reads/writes explicitly transport the two planes.
template<bool Constant> class BasicValueSpan {
	using Word = std::conditional_t<Constant, const uint32_t, uint32_t>;
	using Tag = std::conditional_t<Constant, const uint8_t, uint8_t>;
public:
	BasicValueSpan() = default;
	BasicValueSpan(Word* words, Tag* tags, size_t size) : m_words(words), m_tags(tags), m_size(size) {}
	static constexpr size_t wordsOffset() { return offsetof(BasicValueSpan, m_words); }
	static constexpr size_t tagsOffset() { return offsetof(BasicValueSpan, m_tags); }
	static constexpr size_t sizeOffset() { return offsetof(BasicValueSpan, m_size); }
	template<bool Other> BasicValueSpan(const BasicValueSpan<Other>& other) requires (Constant && !Other) : m_words(other.words()), m_tags(other.tags()), m_size(other.size()) {}
	size_t size() const { return m_size; }
	Word* words() const { return m_words; }
	Tag* tags() const { return m_tags; }
	Value get(size_t index) const { return valueFromTag(static_cast<ValueTag>(m_tags[index]), m_words[index]); }
	void set(size_t index, Value value) requires (!Constant) { m_words[index] = valuePayload(value); m_tags[index] = static_cast<uint8_t>(valueTag(value)); }
	ValueTag tag(size_t index) const { return static_cast<ValueTag>(m_tags[index]); }
	uint32_t payload(size_t index) const { return m_words[index]; }
	BasicValueSpan subspan(size_t first, size_t count) const { return first == 0 ? BasicValueSpan(m_words, m_tags, count) : BasicValueSpan(m_words + first, m_tags + first, count); }
	void clear(size_t first, size_t count) requires (!Constant) {
		if (count == 0) return;
		std::fill_n(m_words + first, count, uint32_t{0}); std::fill_n(m_tags + first, count, uint8_t{0});
	}
	void copyFrom(BasicValueSpan<true> source, size_t destination, size_t first, size_t count) requires (!Constant) {
		if (count == 0) return;
		std::memmove(m_words + destination, source.words() + first, count * sizeof(uint32_t));
		std::memmove(m_tags + destination, source.tags() + first, count);
	}
private:
	Word* m_words = nullptr;
	Tag* m_tags = nullptr;
	size_t m_size = 0;
};
using ValueSpan = BasicValueSpan<false>;
using ConstValueSpan = BasicValueSpan<true>;
class ValueSlots {
public:
	explicit ValueSlots(size_t capacity = 0) : m_storage(capacity) {}
	size_t capacity() const { return m_storage.capacity(); }
	size_t byteLength() const { return m_storage.byteLength(); }
	uint32_t* words() { return m_storage.words(); }
	uint8_t* tags() { return m_storage.tags(); }
	const uint32_t* words() const { return m_storage.words(); }
	const uint8_t* tags() const { return m_storage.tags(); }
	void reserveCapacity(size_t capacity) { if (capacity > m_storage.capacity()) m_storage.resize(std::max({capacity, m_storage.capacity() * 2, size_t{8}})); }
	void resize(size_t capacity) { m_storage.resize(capacity); }
	Value get(size_t index) const { return valueFromTag(static_cast<ValueTag>(m_storage.tags()[index]), m_storage.words()[index]); }
	void set(size_t index, Value value) { view().set(index, value); }
	ConstValueSpan view() const { return {m_storage.words(), m_storage.tags(), m_storage.capacity()}; }
	ValueSpan view() { return {m_storage.words(), m_storage.tags(), m_storage.capacity()}; }
	void clear(size_t first, size_t count) { m_storage.clear(first, count); }
private:
	ValueStorage m_storage;
};
} // namespace bmsx
