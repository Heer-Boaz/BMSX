#include "machine/cpu/snapshot.h"
#include "machine/cpu/table.h"
#include "machine/cpu/closure.h"
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
	switch (static_cast<CpuSnapshotValueTag>(snapshot.word(offset))) {
		case CpuSnapshotValueTag::Nil: return valueNil();
		case CpuSnapshotValueTag::False: return valueBool(false);
		case CpuSnapshotValueTag::True: return valueBool(true);
		case CpuSnapshotValueTag::Number: return valueNumber(snapshot.number(offset + 1));
		case CpuSnapshotValueTag::String: return valueString(snapshot.word(offset + 1));
		case CpuSnapshotValueTag::BuiltinFunction: return valueBuiltinFunction(&m_builtins[snapshot.word(offset + 1)]);
		case CpuSnapshotValueTag::Table: return valueTable(static_cast<Table*>(m_objects[snapshot.word(offset + 1)]));
		case CpuSnapshotValueTag::Closure: return valueClosure(static_cast<Closure*>(m_objects[snapshot.word(offset + 1)]));
	}
	__builtin_unreachable();
}

} // namespace bmsx
