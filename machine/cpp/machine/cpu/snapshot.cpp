#include "machine/cpu/snapshot.h"

#include "common/compiler.h"
#include "machine/cpu/gc_heap.h"
#include "machine/cpu/closure.h"
#include "machine/cpu/thread.h"
#include <algorithm>

namespace bmsx {

u32 CpuSnapshot::reserveWords(u32 count) {
	const size_t offset = m_size;
	const size_t size = offset + count;
	if (size > m_words.size()) m_words.resize(std::max({size, m_words.size() * 2, size_t{256}}));
	m_size = size;
	return static_cast<u32>(offset);
}

u32 CpuSnapshot::addObject() {
	if (m_count == m_objects.size()) m_objects.resize(std::max(m_count * 2, size_t{64}));
	return static_cast<u32>(m_count++);
}

Value CpuSnapshotReader::readValue(u32 offset) const {
	const auto tag = static_cast<ValueTag>(snapshot.word(offset));
	u32 payload = snapshot.word(offset + 1);
	switch (tag) {
		case ValueTag::Thread: case ValueTag::Closure:
			payload = m_heap.reference(m_objects[payload]); break;
		default: break;
	}
	return valueFromTag(tag, payload);
}

} // namespace bmsx
