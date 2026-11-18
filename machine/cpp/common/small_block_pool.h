#pragma once

#include <array>
#include <cstddef>
#include <memory>
#include <new>

namespace bmsx {

// Single-owner, sized storage recycling. Callers construct/destroy their values
// and return nonempty blocks with the same requested byte count. Large blocks
// and excess free storage go directly back to the system allocator.
class SmallBlockPool {
	struct FreeBlock { FreeBlock* next; };

public:
	static constexpr size_t SIZE_STEP = 16;
	static constexpr size_t MAX_BLOCK_BYTES = 1024;
	static constexpr size_t MAX_RETAINED_BYTES = 512 * 1024;
	static_assert(sizeof(FreeBlock) <= SIZE_STEP);

	SmallBlockPool() = default;
	SmallBlockPool(const SmallBlockPool&) = delete;
	SmallBlockPool& operator=(const SmallBlockPool&) = delete;
	~SmallBlockPool() {
		for (auto* block : m_free) {
			while (block) {
				auto* next = block->next;
				::operator delete(block);
				block = next;
			}
		}
	}

	void* allocate(size_t byteCount) {
		if (byteCount > MAX_BLOCK_BYTES) return ::operator new(byteCount);
		const size_t index = (byteCount - 1) / SIZE_STEP;
		const size_t blockBytes = (index + 1) * SIZE_STEP;
		if (auto* block = m_free[index]) {
			m_free[index] = block->next;
			m_retainedBytes -= blockBytes;
			std::destroy_at(block);
			return block;
		}
		return ::operator new(blockBytes);
	}

	void deallocate(void* storage, size_t byteCount) noexcept {
		if (byteCount > MAX_BLOCK_BYTES) {
			::operator delete(storage);
			return;
		}
		const size_t index = (byteCount - 1) / SIZE_STEP;
		const size_t blockBytes = (index + 1) * SIZE_STEP;
		if (blockBytes > MAX_RETAINED_BYTES - m_retainedBytes) {
			::operator delete(storage);
			return;
		}
		auto* block = std::construct_at(static_cast<FreeBlock*>(storage), FreeBlock{m_free[index]});
		m_free[index] = block;
		m_retainedBytes += blockBytes;
	}

private:
	std::array<FreeBlock*, MAX_BLOCK_BYTES / SIZE_STEP> m_free{};
	size_t m_retainedBytes = 0;
};

} // namespace bmsx
