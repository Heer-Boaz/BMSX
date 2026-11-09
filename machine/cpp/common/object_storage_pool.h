#pragma once

#include <array>
#include <cstddef>
#include <memory>
#include <utility>

namespace bmsx {

// Stable object storage with an intrusive free list. The owner destroys its
// live objects before the pool; slabs retain storage, not constructed values.
template <typename T, size_t SlotsPerSlab = 64>
class ObjectStoragePool {
	static_assert(SlotsPerSlab > 0);
	union Slot {
		T object;
		Slot* next;
		Slot() noexcept {}
		~Slot() {}
	};
	struct Slab {
		Slab* next;
		std::array<Slot, SlotsPerSlab> slots;
	};

public:
	ObjectStoragePool() = default;
	ObjectStoragePool(const ObjectStoragePool&) = delete;
	ObjectStoragePool& operator=(const ObjectStoragePool&) = delete;
	~ObjectStoragePool() {
		while (m_slabs) {
			Slab* slab = m_slabs;
			m_slabs = slab->next;
			delete slab;
		}
	}

	template <typename... Args>
	T* construct(Args&&... args) {
		if (!m_free) [[unlikely]] grow();
		Slot* slot = m_free;
		m_free = slot->next;
		return std::construct_at(&slot->object, std::forward<Args>(args)...);
	}

	void destroy(T* object) {
		std::destroy_at(object);
		auto* slot = reinterpret_cast<Slot*>(object);
		std::construct_at(&slot->next, m_free);
		m_free = slot;
	}

private:
	[[gnu::noinline]] void grow() {
		auto* slab = new Slab;
		slab->next = m_slabs;
		m_slabs = slab;
		for (auto& slot : slab->slots) {
			slot.next = m_free;
			m_free = &slot;
		}
	}

	Slab* m_slabs = nullptr;
	Slot* m_free = nullptr;
};

} // namespace bmsx
