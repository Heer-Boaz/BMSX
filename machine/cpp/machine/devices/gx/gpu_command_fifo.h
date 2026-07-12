#pragma once

#include "common/primitives.h"

#include <array>

namespace bmsx {

constexpr size_t GX_GPU_COMMAND_FIFO_WORD_CAPACITY = 16u;
constexpr size_t GX_GPU_COMMAND_FIFO_STORAGE_WORD_CAPACITY = 32u;

class GxGpuCommandFifo {
public:
	size_t count() const { return m_wordCount; }
	bool empty() const { return m_wordCount == 0u; }

	void reset() {
		m_readIndex = 0u;
		m_wordCount = 0u;
	}

	void push(u32 word) {
		m_words[(m_readIndex + m_wordCount) & (GX_GPU_COMMAND_FIFO_STORAGE_WORD_CAPACITY - 1u)] = word;
		m_wordCount += 1u;
	}

	u32 peek(size_t index = 0u) const {
		return m_words[(m_readIndex + index) & (GX_GPU_COMMAND_FIFO_STORAGE_WORD_CAPACITY - 1u)];
	}

	u32 pop() {
		const u32 word = m_words[m_readIndex];
		m_readIndex = (m_readIndex + 1u) & (GX_GPU_COMMAND_FIFO_STORAGE_WORD_CAPACITY - 1u);
		m_wordCount -= 1u;
		return word;
	}

private:
	std::array<u32, GX_GPU_COMMAND_FIFO_STORAGE_WORD_CAPACITY> m_words{};
	size_t m_readIndex = 0u;
	size_t m_wordCount = 0u;
};

} // namespace bmsx
