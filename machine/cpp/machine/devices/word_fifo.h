#pragma once

#include "common/primitives.h"

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
