#pragma once
#include <cstddef>
#include <cstdint>

namespace bmsx {
class Memory;
inline constexpr uint32_t GC_COLOR_OFFSET = 1;
enum class ObjType : uint8_t {
	Table,
	Closure,
	Upvalue,
	Thread,
};

struct GCObject {
	ObjType type;
	// The second byte of the guest header, not a copy of its mark bits.
	uint8_t* gcRecord = nullptr;
	Memory* gcMemory = nullptr;
	uint8_t gcColor() const { return gcRecord[GC_COLOR_OFFSET]; }
	void setGcColor(uint8_t color);
	bool restored = false;
	uint32_t hashId = 0;
	// Heap-local slot; no host pointer is carried in a Value word.
	uint32_t referenceId = 0;
	GCObject* next = nullptr;
	GCObject* previous = nullptr;
	GCObject* grayNext = nullptr;
	GCObject** grayHead = nullptr;
	void writeBarrier();
};

// A sweep snapshot keeps the allocation's retirement work, not dead pointers.

} // namespace bmsx
