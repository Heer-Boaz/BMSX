/*
 * scratchbuffer.h - Reusable scratch buffer for mutable record slots
 *
 * Mirrors the TypeScript ScratchBuffer utility.
 * Goals:
 * - Avoid hot-path allocations by retaining backing storage.
 * - Provide a mutable active window for small record-like buffers.
 */

#ifndef BMSX_SCRATCHBUFFER_H
#define BMSX_SCRATCHBUFFER_H

#include <cstddef>
#include <deque>
#include <utility>
#include <vector>

namespace bmsx {

template<typename T>
class ScratchBuffer {
public:
	explicit ScratchBuffer(size_t initialCapacity = 0) {
		reserve(initialCapacity);
	}

	size_t size() const { return m_size; }
	size_t length() const { return m_size; }

	void clear() { m_size = 0; }

	void reserve(size_t capacity) {
		while (m_items.size() < capacity) {
			m_items.emplace_back();
		}
	}

	T& get(size_t index) {
		if (index >= m_items.size()) {
			reserve(index + 1);
		}
		if (index >= m_size) {
			m_size = index + 1;
		}
		return m_items[index];
	}

	const T& get(size_t index) const { return m_items[index]; }

	const T& peek(size_t index) const { return m_items[index]; }

	void set(size_t index, const T& value) {
		if (index >= m_items.size()) {
			reserve(index + 1);
		}
		m_items[index] = value;
		if (index >= m_size) {
			m_size = index + 1;
		}
	}

	void set(size_t index, T&& value) {
		if (index >= m_items.size()) {
			reserve(index + 1);
		}
		m_items[index] = std::move(value);
		if (index >= m_size) {
			m_size = index + 1;
		}
	}

	T& next() { return get(m_size); }

	void push(const T& value) {
		if (m_size >= m_items.size()) {
			m_items.push_back(value);
		} else {
			m_items[m_size] = value;
		}
		++m_size;
	}

	void push(T&& value) {
		if (m_size >= m_items.size()) {
			m_items.push_back(std::move(value));
		} else {
			m_items[m_size] = std::move(value);
		}
		++m_size;
	}

	template<typename Fn>
	void forEach(Fn&& fn) {
		for (size_t i = 0; i < m_size; ++i) {
			fn(m_items[i], i);
		}
	}

	template<typename Fn>
	void forEach(Fn&& fn) const {
		for (size_t i = 0; i < m_size; ++i) {
			fn(m_items[i], i);
		}
	}

	void replaceInto(std::vector<T>& target, size_t startIndex, size_t deleteCount) const {
		const size_t insertCount = m_size;
		const size_t oldLength = target.size();
		const size_t shift = insertCount >= deleteCount ? insertCount - deleteCount : deleteCount - insertCount;
		if (insertCount > deleteCount) {
			const size_t newLength = oldLength + shift;
			target.reserve(newLength);
			target.resize(newLength);
			for (size_t index = oldLength; index-- > startIndex + deleteCount; ) {
				target[index + shift] = target[index];
			}
		} else if (insertCount < deleteCount) {
			for (size_t index = startIndex + deleteCount; index < oldLength; ++index) {
				target[index - shift] = target[index];
			}
			target.resize(oldLength - shift);
		}
		for (size_t index = 0; index < insertCount; ++index) {
			target[startIndex + index] = m_items[index];
		}
	}

	auto begin() { return m_items.begin(); }
	auto end() { return m_items.begin() + m_size; }
	auto begin() const { return m_items.begin(); }
	auto end() const { return m_items.begin() + m_size; }

private:
	std::deque<T> m_items;
	size_t m_size = 0;
};

} // namespace bmsx

#endif // BMSX_SCRATCHBUFFER_H
