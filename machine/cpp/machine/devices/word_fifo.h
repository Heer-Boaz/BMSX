#pragma once

#include "common/endian.h"

#include <algorithm>
#include <array>
#include <vector>

namespace bmsx {

template <size_t Capacity>
class WordFifo {
public:
	size_t count() const { return m_wordCount; }
	size_t free() const { return Capacity - m_wordCount; }
	bool empty() const { return m_wordCount == 0u; }
	bool full() const { return m_wordCount == Capacity; }

	void reset() {
		m_readIndex = 0u;
		m_wordCount = 0u;
	}

	void writeWord(u32 word) {
		m_words[(m_readIndex + m_wordCount) & (Capacity - 1u)] = word;
		m_wordCount += 1u;
	}

	// count words fit the available target space.
	void writeWords(const u32* source, size_t count) {
		const size_t writeIndex = (m_readIndex + m_wordCount) & (Capacity - 1u);
		const size_t first = std::min(count, Capacity - writeIndex);
		std::copy_n(source, first, m_words.data() + writeIndex);
		std::copy_n(source + first, count - first, m_words.data());
		m_wordCount += count;
	}

	// A mapped source contains bytes, not live u32 objects. Convert directly
	// into the owned ring; on little-endian hosts this is one copy per span.
	void writeLittleEndianWords(const u8* source, size_t count) {
		const size_t writeIndex = (m_readIndex + m_wordCount) & (Capacity - 1u);
		const size_t first = std::min(count, Capacity - writeIndex);
		if constexpr (std::endian::native == std::endian::little) {
			std::memcpy(m_words.data() + writeIndex, source, first * sizeof(u32));
			std::memcpy(m_words.data(), source + first * sizeof(u32), (count - first) * sizeof(u32));
		} else {
			for (size_t i = 0; i < first; ++i) m_words[writeIndex + i] = readLE32(source + i * sizeof(u32));
			for (size_t i = first; i < count; ++i) m_words[i - first] = readLE32(source + i * sizeof(u32));
		}
		m_wordCount += count;
	}

	u32 peek(size_t index = 0u) const {
		return m_words[(m_readIndex + index) & (Capacity - 1u)];
	}

	u32 pop() {
		const u32 word = m_words[m_readIndex];
		m_readIndex = (m_readIndex + 1u) & (Capacity - 1u);
		m_wordCount -= 1u;
		return word;
	}

	// count words are available; target has room for the complete range.
	void readWords(u32* target, size_t count) {
		const size_t first = std::min(count, Capacity - m_readIndex);
		std::copy_n(m_words.data() + m_readIndex, first, target);
		std::copy_n(m_words.data(), count - first, target + first);
		m_readIndex = (m_readIndex + count) & (Capacity - 1u);
		m_wordCount -= count;
	}

	// Distinct FIFOs; count fits the available source words and target space.
	template <size_t TargetCapacity>
	void transferWords(WordFifo<TargetCapacity>& target, size_t count) {
		const size_t writeIndex = (target.m_readIndex + target.m_wordCount) & (TargetCapacity - 1u);
		const size_t first = std::min(count, TargetCapacity - writeIndex);
		readWords(target.m_words.data() + writeIndex, first);
		readWords(target.m_words.data(), count - first);
		target.m_wordCount += count;
	}

	std::vector<u32> captureWords() const {
		std::vector<u32> words(m_wordCount);
		for (size_t index = 0u; index < m_wordCount; index += 1u) {
			words[index] = peek(index);
		}
		return words;
	}

	void restoreWords(const std::vector<u32>& words) {
		reset();
		for (u32 word : words) {
			writeWord(word);
		}
	}

private:
	template <size_t> friend class WordFifo;
	std::array<u32, Capacity> m_words{};
	size_t m_readIndex = 0u;
	size_t m_wordCount = 0u;
};

} // namespace bmsx
