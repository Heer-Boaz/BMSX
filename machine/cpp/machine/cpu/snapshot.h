#pragma once

#include "common/types.h"
#include "machine/cpu/value.h"
#include <cstring>
#include <functional>
#include <span>

namespace bmsx {

constexpr u32 CPU_SNAPSHOT_VALUE_WORDS = 2;
struct GCObject;
// The snapshot transports the same explicit tag and one raw payload word.
using CpuSnapshotValueTag = ValueTag;
enum class CpuSnapshotObjectKind : u32 { Table, Closure, Upvalue, Thread };
enum CpuSnapshotTable : u32 { SNAP_TABLE_KIND, SNAP_TABLE_HASH_ID, SNAP_TABLE_RECORD, SNAP_TABLE_SIZE };
enum CpuSnapshotClosure : u32 {
	SNAP_CLOSURE_KIND, SNAP_CLOSURE_HASH_ID, SNAP_CLOSURE_FUNCTION_ADDRESS,
	SNAP_CLOSURE_CANONICAL, SNAP_CLOSURE_UPVALUE_COUNT,
	SNAP_CLOSURE_CODE_ADDRESS, SNAP_CLOSURE_NUM_PARAMS, SNAP_CLOSURE_MAX_STACK,
	SNAP_CLOSURE_FLAGS, SNAP_CLOSURE_UPVALUE_TABLE_ADDRESS, SNAP_CLOSURE_RECORD_UPVALUE_COUNT,
	SNAP_CLOSURE_EXECUTION_DOMAIN_ID, SNAP_CLOSURE_RECORD, SNAP_CLOSURE_SIZE,
};
enum CpuSnapshotUpvalue : u32 {
	SNAP_UPVALUE_KIND, SNAP_UPVALUE_HASH_ID, SNAP_UPVALUE_ADDRESS, SNAP_UPVALUE_SIZE,
};
enum CpuSnapshotThread : u32 { SNAP_THREAD_KIND, SNAP_THREAD_HASH_ID, SNAP_THREAD_RECORD, SNAP_THREAD_SIZE };
using CpuSnapshotValueWriter = std::function<void(u32, Value)>;

class CpuSnapshot {
public:
	CpuSnapshot() = default;
	CpuSnapshot(std::vector<u32> words, std::vector<u32> objectWords)
		: m_words(std::move(words)), m_objects(std::move(objectWords)), m_size(m_words.size()), m_count(m_objects.size()) {}
	std::span<const u32> words() const { return {m_words.data(), m_size}; }
	std::span<const u32> objectWords() const { return {m_objects.data(), m_count}; }
	size_t objectCount() const { return m_count; }
	size_t capacityBytes() const { return (m_words.capacity() + m_objects.capacity()) * sizeof(u32); }
	void reset() { m_size = 0; m_count = 0; }
	u32 reserveWords(u32 count);
	u32 addObject();
	void setObjectWord(u32 id, u32 offset) { m_objects[id] = offset; }
	u32 objectWord(u32 id) const { return m_objects[id]; }
	u32 word(u32 offset) const { return m_words[offset]; }
	i32 integer(u32 offset) const { return static_cast<i32>(m_words[offset]); }
	void setWord(u32 offset, u32 value) { m_words[offset] = value; }

private:
	std::vector<u32> m_words;
	std::vector<u32> m_objects;
	size_t m_size = 0;
	size_t m_count = 0;
};

class CpuSnapshotReader {
public:
	explicit CpuSnapshotReader(const CpuSnapshot& snapshot) : snapshot(snapshot) {}
	Value readValue(u32 offset) const;
	const CpuSnapshot& snapshot;
};

} // namespace bmsx
