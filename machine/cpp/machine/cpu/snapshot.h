#pragma once

#include "common/types.h"
#include "machine/cpu/value.h"
#include <bit>
#include <functional>
#include <span>

namespace bmsx {

constexpr u32 CPU_SNAPSHOT_VALUE_WORDS = 3;
// Matches the TS register tag column; native Value uses NaN-boxed tags.
enum class CpuSnapshotValueTag : u32 { Nil, False, True, Number, String, Table, Closure, BuiltinFunction };
enum class CpuSnapshotObjectKind : u32 { Table, Closure, Upvalue };
enum CpuSnapshotTable : u32 {
	SNAP_TABLE_KIND, SNAP_TABLE_HASH_ID, SNAP_TABLE_ARRAY_LENGTH, SNAP_TABLE_ARRAY_CAPACITY,
	SNAP_TABLE_HASH_SIZE, SNAP_TABLE_HASH_FREE, SNAP_TABLE_METATABLE,
	SNAP_TABLE_DATA = SNAP_TABLE_METATABLE + CPU_SNAPSHOT_VALUE_WORDS,
};
enum CpuSnapshotClosure : u32 {
	SNAP_CLOSURE_KIND, SNAP_CLOSURE_HASH_ID, SNAP_CLOSURE_FUNCTION_ADDRESS,
	SNAP_CLOSURE_CANONICAL, SNAP_CLOSURE_UPVALUE_COUNT, SNAP_CLOSURE_DATA,
};
enum CpuSnapshotUpvalue : u32 {
	SNAP_UPVALUE_KIND, SNAP_UPVALUE_HASH_ID, SNAP_UPVALUE_OPEN,
	SNAP_UPVALUE_INDEX, SNAP_UPVALUE_FRAME_INDEX, SNAP_UPVALUE_VALUE,
};
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
	void setNumber(u32 offset, f64 value) {
		const auto bits = std::bit_cast<u64>(value);
		m_words[offset] = static_cast<u32>(bits);
		m_words[offset + 1] = static_cast<u32>(bits >> 32);
	}
	f64 number(u32 offset) const {
		return std::bit_cast<f64>(static_cast<u64>(m_words[offset]) | (static_cast<u64>(m_words[offset + 1]) << 32));
	}
private:
	std::vector<u32> m_words;
	std::vector<u32> m_objects;
	size_t m_size = 0;
	size_t m_count = 0;
};

class CpuSnapshotReader {
public:
	CpuSnapshotReader(const CpuSnapshot& snapshot, std::span<GCObject* const> objects, std::span<BuiltinFunction> builtins)
		: snapshot(snapshot), m_objects(objects), m_builtins(builtins) {}
	Value readValue(u32 offset) const;
	const CpuSnapshot& snapshot;
private:
	std::span<GCObject* const> m_objects;
	std::span<BuiltinFunction> m_builtins;
};

} // namespace bmsx
