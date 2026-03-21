#pragma once

#include <cstddef>
#include <cstdint>
#include <string_view>
#include <vector>

#include "memory_map.h"

namespace bmsx {

class Memory;

constexpr uint32_t HEAP_OBJECT_HEADER_SIZE = 12;
constexpr uint32_t STRING_OBJECT_HASH_LO_OFFSET = HEAP_OBJECT_HEADER_SIZE;
constexpr uint32_t STRING_OBJECT_HASH_HI_OFFSET = STRING_OBJECT_HASH_LO_OFFSET + 4;
constexpr uint32_t STRING_OBJECT_BYTE_LENGTH_OFFSET = STRING_OBJECT_HASH_HI_OFFSET + 4;
constexpr uint32_t STRING_OBJECT_CODEPOINT_COUNT_OFFSET = STRING_OBJECT_BYTE_LENGTH_OFFSET + 4;
constexpr uint32_t STRING_OBJECT_DATA_OFFSET = STRING_OBJECT_CODEPOINT_COUNT_OFFSET + 4;
constexpr uint32_t STRING_OBJECT_HEADER_SIZE = STRING_OBJECT_DATA_OFFSET;
constexpr uint32_t TABLE_OBJECT_METATABLE_ID_OFFSET = HEAP_OBJECT_HEADER_SIZE;
constexpr uint32_t TABLE_OBJECT_ARRAY_STORE_ID_OFFSET = TABLE_OBJECT_METATABLE_ID_OFFSET + 4;
constexpr uint32_t TABLE_OBJECT_HASH_STORE_ID_OFFSET = TABLE_OBJECT_ARRAY_STORE_ID_OFFSET + 4;
constexpr uint32_t TABLE_OBJECT_ARRAY_LENGTH_OFFSET = TABLE_OBJECT_HASH_STORE_ID_OFFSET + 4;
constexpr uint32_t TABLE_OBJECT_HEADER_SIZE = TABLE_OBJECT_ARRAY_LENGTH_OFFSET + 4;
constexpr uint32_t ARRAY_STORE_OBJECT_CAPACITY_OFFSET = HEAP_OBJECT_HEADER_SIZE;
constexpr uint32_t ARRAY_STORE_OBJECT_HEADER_SIZE = ARRAY_STORE_OBJECT_CAPACITY_OFFSET + 4;
constexpr uint32_t ARRAY_STORE_OBJECT_DATA_OFFSET = ARRAY_STORE_OBJECT_HEADER_SIZE;
constexpr uint32_t HASH_STORE_OBJECT_CAPACITY_OFFSET = HEAP_OBJECT_HEADER_SIZE;
constexpr uint32_t HASH_STORE_OBJECT_FREE_OFFSET = HASH_STORE_OBJECT_CAPACITY_OFFSET + 4;
constexpr uint32_t HASH_STORE_OBJECT_HEADER_SIZE = HASH_STORE_OBJECT_FREE_OFFSET + 4;
constexpr uint32_t HASH_STORE_OBJECT_DATA_OFFSET = HASH_STORE_OBJECT_HEADER_SIZE;
constexpr uint32_t CLOSURE_OBJECT_PROTO_INDEX_OFFSET = HEAP_OBJECT_HEADER_SIZE;
constexpr uint32_t CLOSURE_OBJECT_UPVALUE_COUNT_OFFSET = CLOSURE_OBJECT_PROTO_INDEX_OFFSET + 4;
constexpr uint32_t CLOSURE_OBJECT_UPVALUE_IDS_OFFSET = CLOSURE_OBJECT_UPVALUE_COUNT_OFFSET + 4;
constexpr uint32_t CLOSURE_OBJECT_HEADER_SIZE = CLOSURE_OBJECT_UPVALUE_IDS_OFFSET;
constexpr uint32_t NATIVE_OBJECT_METATABLE_ID_OFFSET = HEAP_OBJECT_HEADER_SIZE;
constexpr uint32_t NATIVE_OBJECT_HEADER_SIZE = NATIVE_OBJECT_METATABLE_ID_OFFSET + 4;
constexpr uint32_t UPVALUE_OBJECT_STATE_OFFSET = HEAP_OBJECT_HEADER_SIZE;
constexpr uint32_t UPVALUE_OBJECT_FRAME_DEPTH_OFFSET = UPVALUE_OBJECT_STATE_OFFSET + 4;
constexpr uint32_t UPVALUE_OBJECT_REGISTER_INDEX_OFFSET = UPVALUE_OBJECT_FRAME_DEPTH_OFFSET + 4;
constexpr uint32_t UPVALUE_OBJECT_CLOSED_VALUE_OFFSET = UPVALUE_OBJECT_REGISTER_INDEX_OFFSET + 4;
constexpr uint32_t UPVALUE_OBJECT_HEADER_SIZE = UPVALUE_OBJECT_CLOSED_VALUE_OFFSET + 12;
constexpr uint32_t UPVALUE_OBJECT_STATE_CLOSED = 0;
constexpr uint32_t UPVALUE_OBJECT_STATE_OPEN = 1;
constexpr uint32_t TAGGED_VALUE_SLOT_TAG_OFFSET = 0;
constexpr uint32_t TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET = TAGGED_VALUE_SLOT_TAG_OFFSET + 4;
constexpr uint32_t TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET = TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET + 4;
constexpr uint32_t TAGGED_VALUE_SLOT_SIZE = TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET + 4;
constexpr uint32_t HASH_NODE_KEY_OFFSET = 0;
constexpr uint32_t HASH_NODE_VALUE_OFFSET = HASH_NODE_KEY_OFFSET + TAGGED_VALUE_SLOT_SIZE;
constexpr uint32_t HASH_NODE_NEXT_OFFSET = HASH_NODE_VALUE_OFFSET + TAGGED_VALUE_SLOT_SIZE;
constexpr uint32_t HASH_NODE_SIZE = HASH_NODE_NEXT_OFFSET + 4;

enum class HeapObjectType : uint32_t {
	String = 1,
	Table = 2,
	ArrayStore = 3,
	HashStore = 4,
	Closure = 5,
	NativeFunction = 6,
	NativeObject = 7,
	Upvalue = 8,
};

enum class TaggedValueTag : uint32_t {
	Nil = 0,
	False = 1,
	True = 2,
	Number = 3,
	String = 4,
	Table = 5,
	Closure = 6,
	NativeFunction = 7,
	NativeObject = 8,
	Upvalue = 9,
};

struct ObjectHandleEntry {
	uint32_t addr = 0;
	uint32_t sizeBytes = 0;
	uint32_t type = 0;
	uint32_t flags = 0;
	uint32_t reserved = 0;
};

struct ObjectAllocation {
	uint32_t id = 0;
	uint32_t addr = 0;
	uint32_t sizeBytes = 0;
	uint32_t type = 0;
	uint32_t flags = 0;
};

struct ObjectHandleTableState {
	uint32_t nextHandle = 1;
	uint32_t heapUsedBytes = 0;
	std::vector<uint8_t> handleTableBytes;
	std::vector<uint8_t> heapBytes;
};

class ObjectHeap {
public:
	ObjectHeap() = default;
	uint32_t allocate(uint32_t sizeBytes);
	void reset();
	uint32_t usedBytes() const;
	void restore(uint32_t usedBytes);

private:
	uint32_t m_cursor = GC_HEAP_BASE;
};

class ObjectHandleTable {
public:
	explicit ObjectHandleTable(Memory& memory);

	void reserveHandles(uint32_t minHandle);
	ObjectAllocation allocateObject(uint32_t type, uint32_t sizeBytes, uint32_t flags = 0);
	void writeEntry(uint32_t id, uint32_t addr, uint32_t sizeBytes, uint32_t type, uint32_t flags, uint32_t reserved);
	void writeU32(uint32_t addr, uint32_t value);
	uint32_t readU32(uint32_t addr) const;
	void writeBytes(uint32_t addr, const uint8_t* data, size_t length);
	void readBytes(uint32_t addr, uint8_t* data, size_t length) const;
	ObjectHandleEntry readEntry(uint32_t id) const;
	void resetHeap();
	ObjectHandleTableState captureState() const;
	void restoreState(const ObjectHandleTableState& state);

private:
	void writeHeapHeader(uint32_t addr, uint32_t type, uint32_t flags, uint32_t sizeBytes);

	Memory& m_memory;
	ObjectHeap m_heap;
	uint32_t m_nextHandle = 1;
};

} // namespace bmsx
