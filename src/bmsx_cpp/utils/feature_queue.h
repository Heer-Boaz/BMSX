/*
 * feature_queue.h - Generic double-buffered feature queue
 *
 * Mirrors TypeScript FeatureQueue class.
 * Backed by ScratchBatch for stable capacity and no sparse holes.
 * Supports front/back swap per frame.
 */

#ifndef BMSX_FEATURE_QUEUE_H
#define BMSX_FEATURE_QUEUE_H

#include "scratchbatch.h"
#include <utility>

namespace bmsx {

/**
 * Double-buffered queue for render submissions.
 * - submit() adds to back buffer
 * - swap() moves back to front, clears back
 * - Iteration happens on front buffer after swap
 */
template<typename T>
class FeatureQueue {
public:
	explicit FeatureQueue(size_t initialCapacity = 128)
		: m_front(initialCapacity)
		, m_back(initialCapacity)
		, m_backCapacity(initialCapacity)
	{}

	/**
	 * Reserve capacity by recreating the back buffer with at least the requested capacity.
	 * Front capacity will be adjusted on next swap.
	 */
	void reserve(size_t minCapacity) {
		if (minCapacity <= 0) return;
		if (minCapacity > m_backCapacity) {
			m_back = ScratchBatch<T>(minCapacity);
			m_backCapacity = minCapacity;
		}
	}

	void submit(const T& item) { m_back.push(item); }
	void submit(T&& item) { m_back.push(std::move(item)); }

	size_t sizeBack() const { return m_back.size(); }
	size_t sizeFront() const { return m_front.size(); }

	void swap() {
		std::swap(m_front, m_back);
		m_back.clear(); // reset active window for next frame submissions
	}

	void forEachFront(const std::function<void(T&, size_t)>& fn) { m_front.forEach(fn); }
	void forEachFront(const std::function<void(const T&, size_t)>& fn) const { m_front.forEach(fn); }
	void forEachBack(const std::function<void(T&, size_t)>& fn) { m_back.forEach(fn); }
	void forEachBack(const std::function<void(const T&, size_t)>& fn) const { m_back.forEach(fn); }

	void sortFront(const std::function<bool(const T&, const T&)>& compare) { m_front.sort(compare); }

	// Direct access to front buffer for iteration
	ScratchBatch<T>& front() { return m_front; }
	const ScratchBatch<T>& front() const { return m_front; }

	// Debug-only: return counts without exposing internal storage
	struct DebugCounts { size_t front; size_t back; };
	DebugCounts debugCounts() const { return { m_front.size(), m_back.size() }; }

private:
	ScratchBatch<T> m_front;
	ScratchBatch<T> m_back;
	size_t m_backCapacity;
};

} // namespace bmsx

#endif // BMSX_FEATURE_QUEUE_H
