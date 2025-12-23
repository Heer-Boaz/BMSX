/*
 * scratchbatch.h - Lightweight reusable scratch collections for per-frame batching
 *
 * Mirrors TypeScript ScratchBatch class.
 * Goals:
 * - Avoid per-frame allocations by retaining backing storage.
 * - Offer a simple, consistent API across systems.
 */

#ifndef BMSX_SCRATCHBATCH_H
#define BMSX_SCRATCHBATCH_H

#include "../core/types.h"
#include <vector>
#include <algorithm>
#include <functional>

namespace bmsx {

/**
 * A lightweight, reusable collection that avoids per-frame allocations.
 * Items are pushed during the frame and cleared at the end without deallocating.
 */
template<typename T>
class ScratchBatch {
public:
    explicit ScratchBatch(size_t initialCapacity = 0) {
        if (initialCapacity > 0) {
            m_items.reserve(initialCapacity);
        }
    }

    size_t size() const { return m_size; }
    size_t length() const { return m_size; } // For convenience

    void clear() { m_size = 0; }

    void push(const T& v) {
        if (m_size >= m_items.size()) {
            m_items.push_back(v);
        } else {
            m_items[m_size] = v;
        }
        ++m_size;
    }

    void push(T&& v) {
        if (m_size >= m_items.size()) {
            m_items.push_back(std::move(v));
        } else {
            m_items[m_size] = std::move(v);
        }
        ++m_size;
    }

    T& get(size_t index) { return m_items[index]; }
    const T& get(size_t index) const { return m_items[index]; }

    T& operator[](size_t index) { return m_items[index]; }
    const T& operator[](size_t index) const { return m_items[index]; }

    void forEach(const std::function<void(T&, size_t)>& fn) {
        for (size_t i = 0; i < m_size; ++i) {
            fn(m_items[i], i);
        }
    }

    void forEach(const std::function<void(const T&, size_t)>& fn) const {
        for (size_t i = 0; i < m_size; ++i) {
            fn(m_items[i], i);
        }
    }

    // Sort only the active window; avoids copying.
    void sort(const std::function<bool(const T&, const T&)>& compareFn) {
        std::sort(m_items.begin(), m_items.begin() + m_size, compareFn);
    }

    // Iterator support
    auto begin() { return m_items.begin(); }
    auto end() { return m_items.begin() + m_size; }
    auto begin() const { return m_items.begin(); }
    auto end() const { return m_items.begin() + m_size; }

private:
    std::vector<T> m_items;
    size_t m_size = 0;
};

} // namespace bmsx

#endif // BMSX_SCRATCHBATCH_H
