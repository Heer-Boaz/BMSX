#pragma once

#include <array>
#include <cstddef>
#include <memory>
#include <utility>
#include <vector>

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
	struct Slab { std::array<Slot, SlotsPerSlab> slots; };

public:
	ObjectStoragePool() = default;
	ObjectStoragePool(const ObjectStoragePool&) = delete;
	ObjectStoragePool& operator=(const ObjectStoragePool&) = delete;

	template <typename... Args>
	T* construct(Args&&... args) {
		if (!m_free) {
			auto slab = std::unique_ptr<Slab>(new Slab);
			auto& slots = slab->slots;
			m_slabs.push_back(std::move(slab));
			for (auto& slot : slots) {
				slot.next = m_free;
				m_free = &slot;
			}
		}
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
	std::vector<std::unique_ptr<Slab>> m_slabs;
	Slot* m_free = nullptr;
};

} // namespace bmsx
