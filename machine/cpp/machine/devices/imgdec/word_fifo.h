#pragma once

#include "common/primitives.h"

#include <array>
#include <vector>

namespace bmsx {

template <size_t Capacity>
class ImgDecWordFifo {
public:
	size_t count() const { return m_wordCount; }
	size_t free() const { return Capacity - m_wordCount; }
	bool empty() const { return m_wordCount == 0u; }

	void reset() {
		m_readIndex = 0u;
		m_wordCount = 0u;
	}

	void writeWord(u32 word) {
		m_words[(m_readIndex + m_wordCount) & (Capacity - 1u)] = word;
		m_wordCount += 1u;
	}

	void writeBusWord(u32 word) {
		if (m_wordCount == Capacity) {
			return;
		}
		writeWord(word);
	}

	u32 pop() {
		const u32 word = m_words[m_readIndex];
		m_readIndex = (m_readIndex + 1u) & (Capacity - 1u);
		m_wordCount -= 1u;
		return word;
	}

	std::vector<u32> captureWords() const {
		std::vector<u32> words(m_wordCount);
		for (size_t index = 0u; index < m_wordCount; index += 1u) {
			words[index] = m_words[(m_readIndex + index) & (Capacity - 1u)];
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
	std::array<u32, Capacity> m_words{};
	size_t m_readIndex = 0u;
	size_t m_wordCount = 0u;
};

} // namespace bmsx
