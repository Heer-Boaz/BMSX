#pragma once

#include "common/scratchbuffer.h"

#include <unordered_map>
#include <vector>

namespace bmsx {

template<typename T>
class ScratchArrayStack {
public:
	std::vector<T>& acquire() {
		std::vector<T>& values = m_scratch.get(m_index);
		++m_index;
		values.clear();
		return values;
	}

	void release(std::vector<T>& values) {
		values.clear();
		--m_index;
	}

private:
	ScratchBuffer<std::vector<T>> m_scratch;
	size_t m_index = 0;
};

template<typename K, typename V>
class ScratchMapStack {
public:
	std::unordered_map<K, V>& acquire() {
		std::unordered_map<K, V>& values = m_scratch.get(m_index);
		++m_index;
		values.clear();
		return values;
	}

	void release(std::unordered_map<K, V>& values) {
		values.clear();
		--m_index;
	}

private:
	ScratchBuffer<std::unordered_map<K, V>> m_scratch;
	size_t m_index = 0;
};

} // namespace bmsx
