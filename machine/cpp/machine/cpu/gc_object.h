#pragma once
#include <cstddef>
#include <cstdint>

namespace bmsx {
enum class ObjType : uint8_t {
	Table,
	Closure,
	Upvalue,
	Thread,
	Garbage,
};

struct GCObject {
	ObjType type;
	// 0/1 alternate white generations; 2 is queued gray, 3 is scanned black.
	uint8_t gcColor = 0;
	bool restored = false;
	uint32_t hashId = 0;
	// Heap-local slot; no host pointer is carried in a Value word.
	uint32_t referenceId = 0;
	GCObject* next = nullptr;
	GCObject* previous = nullptr;
	GCObject* grayNext = nullptr;
	GCObject** grayHead = nullptr;
	void writeBarrier() {
		if (gcColor != 3) return;
		gcColor = 2;
		grayNext = *grayHead;
		*grayHead = this;
	}
};

// A sweep snapshot keeps the allocation's retirement work, not dead pointers.
struct GarbageAllocation : GCObject {
	GarbageAllocation(size_t bytes, uint32_t storage) : bytes(bytes), storage(storage) {}
	size_t bytes;
	uint32_t storage;
};

} // namespace bmsx
