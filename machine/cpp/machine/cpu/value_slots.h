#pragma once

#include <type_traits>
#include <bit>
#include <cstring>
#include "machine/memory/memory.h"
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
	BasicValueSpan(Memory& ram, u32 wordStart, u32 tagStart, size_t size, bool requirePort = false)
		: m_words(reinterpret_cast<Word*>(ram.ramData() + (wordStart & RAM_RECORD_WORD_MASK))),
		  m_tags(ram.ramData() + (tagStart & (MAIN_RAM_SIZE - 1u))), m_size(size), m_ram(&ram),
		  m_mirrored(requirePort || size > (MAIN_RAM_SIZE - (wordStart & RAM_RECORD_WORD_MASK)) / sizeof(u32)
			|| size > MAIN_RAM_SIZE - (tagStart & (MAIN_RAM_SIZE - 1u))) {}
	static constexpr size_t wordsOffset() { return offsetof(BasicValueSpan, m_words); }
	static constexpr size_t tagsOffset() { return offsetof(BasicValueSpan, m_tags); }
	static constexpr size_t sizeOffset() { return offsetof(BasicValueSpan, m_size); }
	static constexpr size_t ramOffset() { return offsetof(BasicValueSpan, m_ram); }
	static constexpr size_t mirroredOffset() { return offsetof(BasicValueSpan, m_mirrored); }
	template<bool Other> BasicValueSpan(const BasicValueSpan<Other>& other) requires (Constant && !Other) : m_words(other.words()), m_tags(other.tags()), m_size(other.size()), m_ram(other.ram()), m_mirrored(other.mirrored()) {}
	Memory* ram() const { return m_ram; }
	bool mirrored() const { return m_mirrored; }
	u32 wordAddress() const { return static_cast<u32>(reinterpret_cast<const u8*>(m_words) - m_ram->ramData()); }
	u32 tagAddress() const { return static_cast<u32>(m_tags - m_ram->ramData()); }
	size_t size() const { return m_size; }
	bool containsRange(size_t first, size_t count) const { return count == 0 || first + count <= m_size; }
	Word* words() const { return m_words; }
	Tag* tags() const { return m_tags; }
	Value get(size_t index) const {
		if (m_mirrored) {
			const u32 word = wordAddress() + static_cast<u32>(index) * sizeof(u32);
			const u32 byte = tagAddress() + static_cast<u32>(index);
			return valueFromTag(static_cast<ValueTag>(m_ram->readRamRecordByte(byte)), m_ram->readRamRecordWord(word));
		}
		return valueFromTag(static_cast<ValueTag>(m_tags[index]), linearPayload(index));
	}
	void set(size_t index, Value value) requires (!Constant) {
		if (m_mirrored) {
			const u32 word = wordAddress() + static_cast<u32>(index) * sizeof(u32), byte = tagAddress() + static_cast<u32>(index);
			m_ram->writeRamRecordWord(word, valuePayload(value));
			m_ram->writeRamRecordByte(byte, static_cast<u8>(valueTag(value)));
			return;
		}
		auto* const word = m_words + index;
		auto* const byte = m_tags + index;
		if constexpr (std::endian::native == std::endian::big) {
			if (m_ram) writeLE32(reinterpret_cast<u8*>(word), valuePayload(value));
			else *word = valuePayload(value);
		} else *word = valuePayload(value);
		*byte = static_cast<u8>(valueTag(value));
		if (m_ram) m_ram->invalidateRamValueSlot(word, byte);
	}
	ValueTag tag(size_t index) const {
		return static_cast<ValueTag>(m_mirrored ? m_ram->readRamRecordByte(tagAddress() + static_cast<u32>(index)) : m_tags[index]);
	}
	uint32_t payload(size_t index) const {
		if (m_mirrored) return m_ram->readRamRecordWord(wordAddress() + static_cast<u32>(index) * sizeof(u32));
		return linearPayload(index);
	}
	BasicValueSpan subspan(size_t first, size_t count) const {
		if (m_ram) return BasicValueSpan(*m_ram, wordAddress() + static_cast<u32>(first) * sizeof(u32),
			tagAddress() + static_cast<u32>(first), count, m_mirrored || first + count > m_size);
		return first == 0 ? BasicValueSpan(m_words, m_tags, count) : BasicValueSpan(m_words + first, m_tags + first, count);
	}
	void clear(size_t first, size_t count) requires (!Constant) {
		if (count == 0) return;
		if (m_mirrored) {
			const u32 word = wordAddress() + static_cast<u32>(first) * sizeof(u32);
			const u32 byte = tagAddress() + static_cast<u32>(first);
			const size_t words = std::min(count, static_cast<size_t>(MAIN_RAM_SIZE / sizeof(u32)));
			const size_t tags = std::min(count, static_cast<size_t>(MAIN_RAM_SIZE));
			for (size_t i = 0; i < words; ++i) m_ram->writeRamRecordWord(word + static_cast<u32>(i) * sizeof(u32), 0);
			for (size_t i = 0; i < tags; ++i) m_ram->writeRamRecordByte(byte + static_cast<u32>(i), 0);
			return;
		}
		clearLinear(first, count);
		reportWrite(first, count);
	}
	void copyFrom(BasicValueSpan<true> source, size_t destination, size_t first, size_t count) requires (!Constant) {
		if (count == 0) return;
		if (!m_mirrored && m_ram && destination + count > m_size) {
			subspan(destination, count).copyFrom(source, 0, first, count);
			return;
		}
		if (!source.mirrored() && source.ram() && first + count > source.size()) {
			source = source.subspan(first, count);
			first = 0;
		}
		if (m_mirrored || source.mirrored()) {
			// Within a bank the source/destination ordering is the logical
			// payload displacement, including windows straddling RAM's end.
			const u32 delta = m_ram && m_ram == source.ram()
				? (wordAddress() + static_cast<u32>(destination) * 4u - source.wordAddress()
					- static_cast<u32>(first) * 4u) & RAM_RECORD_WORD_MASK
				: 0u;
			if (delta > 0u && (delta >> 2u) < count)
				for (size_t i = count; i-- > 0;) set(destination + i, source.get(first + i));
			else
				for (size_t i = 0; i < count; ++i) set(destination + i, source.get(first + i));
			return;
		}
		if constexpr (std::endian::native == std::endian::big) {
			if ((m_ram == nullptr) != (source.ram() == nullptr)) {
				for (size_t i = 0; i < count; ++i) set(destination + i, source.get(first + i));
				return;
			}
		}
		copyLinearFrom(destination, source, first, count);
		if (count == 1) {
			if (m_ram) m_ram->invalidateRamValueSlot(m_words + destination, m_tags + destination);
			return;
		}
		reportWrite(destination, count);
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	// The CPU grant has already admitted and accounted for the linear RAM
	// ranges. These operations do not call out to the bus or its observers.
	BasicValueSpan admittedSubspan(size_t first, size_t count) const {
		BasicValueSpan result(m_words + first, m_tags + first, count);
		result.m_ram = m_ram;
		return result;
	}
	u32 admittedPayload(size_t index) const {
		return readLE32(reinterpret_cast<const u8*>(m_words + index));
	}
	void setAdmitted(size_t index, Value value) requires (!Constant) {
		writeLE32(reinterpret_cast<u8*>(m_words + index), valuePayload(value));
		m_tags[index] = static_cast<u8>(valueTag(value));
	}
	void clearAdmitted(size_t first, size_t count) requires (!Constant) {
		if (count != 0) clearLinear(first, count);
	}
	void placeAdmitted(size_t destination, BasicValueSpan<true> source, size_t first, size_t copied,
		size_t padded) requires (!Constant) {
		if (copied != 0) copyLinearFrom(destination, source, first, copied);
		if (padded != 0) clearLinear(destination + copied, padded);
	}

#endif

private:
	void copyLinearFrom(size_t destination, BasicValueSpan<true> source, size_t first, size_t count) requires (!Constant) {
		if (count == 1) {
			m_words[destination] = source.words()[first];
			m_tags[destination] = source.tags()[first];
		} else {
			std::memmove(m_words + destination, source.words() + first, count * sizeof(uint32_t));
			std::memmove(m_tags + destination, source.tags() + first, count);
		}
	}
	void clearLinear(size_t first, size_t count) requires (!Constant) {
		if (count == 1) {
			m_words[first] = 0;
			m_tags[first] = 0;
		} else {
			std::fill_n(m_words + first, count, uint32_t{0});
			std::fill_n(m_tags + first, count, uint8_t{0});
		}
	}

	u32 linearPayload(size_t index) const {
		if constexpr (std::endian::native == std::endian::big)
			if (m_ram) return readLE32(reinterpret_cast<const u8*>(m_words + index));
		return m_words[index];
	}
	void reportWrite(size_t first, size_t count) {
		if (!m_ram) return; // Runtime scratch and constants have no RAM address.
		const auto word = wordAddress() + first * sizeof(u32), byte = tagAddress() + first;
		m_ram->invalidateRamWrite(word, count * sizeof(u32));
		m_ram->invalidateRamWrite(byte, count);
	}
	Word* m_words = nullptr;
	Tag* m_tags = nullptr;
	size_t m_size = 0;
	Memory* m_ram = nullptr;
	bool m_mirrored = false;
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
	void set(size_t index, Value value) {
		m_storage.words()[index] = valuePayload(value);
		m_storage.tags()[index] = static_cast<u8>(valueTag(value));
	}
	ConstValueSpan view() const { return {m_storage.words(), m_storage.tags(), m_storage.capacity()}; }
	ValueSpan view() { return {m_storage.words(), m_storage.tags(), m_storage.capacity()}; }
	void clear(size_t first, size_t count) { m_storage.clear(first, count); }
private:
	ValueStorage m_storage;
};
} // namespace bmsx
