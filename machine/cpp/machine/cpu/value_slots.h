#pragma once

#include "machine/cpu/value.h"
#include "machine/cpu/value_storage.h"

namespace bmsx {
// A borrowed logical register window. It is not a contiguous Value* and never
// creates proxy references; reads/writes explicitly transport the two planes.
class ValueSpan {
public:
	ValueSpan() = default;
	ValueSpan(uint32_t* words, uint8_t* tags, size_t size) : m_words(words), m_tags(tags), m_size(size) {}
	static constexpr size_t wordsOffset() { return offsetof(ValueSpan, m_words); }
	static constexpr size_t tagsOffset() { return offsetof(ValueSpan, m_tags); }
	static constexpr size_t sizeOffset() { return offsetof(ValueSpan, m_size); }
	size_t size() const { return m_size; }
	uint32_t* words() const { return m_words; }
	uint8_t* tags() const { return m_tags; }
	Value get(size_t index) const { return valueFromTag(static_cast<ValueTag>(m_tags[index]), m_words[index]); }
	void set(size_t index, Value value) { m_words[index] = valuePayload(value); m_tags[index] = static_cast<uint8_t>(valueTag(value)); }
	ValueTag tag(size_t index) const { return static_cast<ValueTag>(m_tags[index]); }
	uint32_t payload(size_t index) const { return m_words[index]; }
	ValueSpan subspan(size_t first, size_t count) const { return first == 0 ? ValueSpan(m_words, m_tags, count) : ValueSpan(m_words + first, m_tags + first, count); }
	void clear(size_t first, size_t count) {
		if (count == 0) return;
		std::fill_n(m_words + first, count, uint32_t{0}); std::fill_n(m_tags + first, count, uint8_t{0});
	}
	void copyFrom(ValueSpan source, size_t destination, size_t first, size_t count) {
		if (count == 0) return;
		std::memmove(m_words + destination, source.m_words + first, count * sizeof(uint32_t));
		std::memmove(m_tags + destination, source.m_tags + first, count);
	}
private:
	uint32_t* m_words = nullptr;
	uint8_t* m_tags = nullptr;
	size_t m_size = 0;
};
class ValueSlots {
public:
	explicit ValueSlots(size_t capacity = 0) : m_storage(capacity) {}
	size_t capacity() const { return m_storage.capacity(); }
	size_t byteLength() const { return m_storage.byteLength(); }
	uint32_t* words() { return m_storage.words(); }
	uint8_t* tags() { return m_storage.tags(); }
	const uint32_t* words() const { return m_storage.words(); }
	const uint8_t* tags() const { return m_storage.tags(); }
	void resize(size_t capacity) { m_storage.resize(capacity); }
	Value get(size_t index) const { return valueFromTag(static_cast<ValueTag>(m_storage.tags()[index]), m_storage.words()[index]); }
	void set(size_t index, Value value) { view().set(index, value); }
	ValueSpan view() { return {m_storage.words(), m_storage.tags(), m_storage.capacity()}; }
	void clear(size_t first, size_t count) { m_storage.clear(first, count); }
private:
	ValueStorage m_storage;
};
} // namespace bmsx
