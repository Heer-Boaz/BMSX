#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <memory>
#include <utility>

namespace bmsx {

// Dense slot backing: all 32-bit payloads, then all byte tags. Numeric typing
// and object-reference encoding belong to the value/heap owners, not storage.
inline constexpr size_t VALUE_STORAGE_SLOT_BYTES = sizeof(uint32_t) + sizeof(uint8_t);

class ValueStorage {
public:
	explicit ValueStorage(size_t capacity = 0) { resize(capacity); }
	ValueStorage(const ValueStorage&) = delete;
	ValueStorage& operator=(const ValueStorage&) = delete;

	ValueStorage(ValueStorage&& other) noexcept
		: m_storage(std::move(other.m_storage)), m_tags(std::exchange(other.m_tags, nullptr)), m_capacity(std::exchange(other.m_capacity, 0)) {}
	ValueStorage& operator=(ValueStorage&& other) noexcept {
		m_storage = std::move(other.m_storage);
		m_tags = std::exchange(other.m_tags, nullptr); m_capacity = std::exchange(other.m_capacity, 0);
		return *this;
	}

	size_t capacity() const noexcept { return m_capacity; }
	size_t byteLength() const noexcept { return m_capacity * VALUE_STORAGE_SLOT_BYTES; }
	uint32_t* words() noexcept { return reinterpret_cast<uint32_t*>(m_storage.get()); }
	const uint32_t* words() const noexcept { return reinterpret_cast<const uint32_t*>(m_storage.get()); }
	uint8_t* tags() noexcept { return m_tags; }
	const uint8_t* tags() const noexcept { return m_tags; }

	// Resizing invalidates borrowed planes. New slots start with zero payload
	// and tag; retained slots are copied as words, including every NaN bit.
	void resize(size_t capacity) {
		if (capacity == m_capacity) return;
		if (capacity == 0) {
			m_storage.reset();
			m_tags = nullptr;
			m_capacity = 0;
			return;
		}
		std::unique_ptr<std::byte[]> next(new std::byte[capacity * VALUE_STORAGE_SLOT_BYTES]);
		auto* nextWords = reinterpret_cast<uint32_t*>(next.get());
		auto* nextTags = reinterpret_cast<uint8_t*>(next.get() + capacity * sizeof(uint32_t));
		const size_t retained = std::min(m_capacity, capacity);
		if (retained != 0) {
			std::memcpy(next.get(), words(), retained * sizeof(uint32_t));
			std::memcpy(nextTags, tags(), retained);
		}
		std::fill_n(nextWords + retained, capacity - retained, uint32_t{0});
		std::fill_n(nextTags + retained, capacity - retained, uint8_t{0});
		m_storage = std::move(next);
		m_tags = nextTags;
		m_capacity = capacity;
	}

	void clear(size_t first, size_t count) noexcept {
		if (count == 0) return;
		std::fill_n(words() + first, count, uint32_t{0});
		std::fill_n(tags() + first, count, uint8_t{0});
	}

	void copyWithin(size_t destination, size_t source, size_t count) noexcept {
		if (count == 0) return;
		std::memmove(words() + destination, words() + source, count * sizeof(uint32_t));
		std::memmove(tags() + destination, tags() + source, count);
	}

	// Inter-owner copies use disjoint allocations; overlap uses copyWithin.
	void copyFrom(const ValueStorage& source, size_t destination, size_t first, size_t count) noexcept {
		if (count == 0) return;
		std::memcpy(words() + destination, source.words() + first, count * sizeof(uint32_t));
		std::memcpy(tags() + destination, source.tags() + first, count);
	}

private:
	std::unique_ptr<std::byte[]> m_storage;
	uint8_t* m_tags = nullptr;
	size_t m_capacity = 0;
};

} // namespace bmsx
