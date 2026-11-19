#pragma once
#include <cstddef>
#include <cstdint>

namespace bmsx {
class Memory;
inline constexpr uint32_t GC_COLOR_OFFSET = 1;
inline constexpr uint32_t GC_RECORD_SHIFT = 3;
inline constexpr uint32_t GC_RECORD_LINK = 4;
// A four-MiB RAM bank has 19 index bits at eight-byte record alignment.
inline constexpr uint32_t GC_GRAY_INDEX_BITS = 19;
inline constexpr uint32_t GC_GRAY_INDEX_MASK = (1u << GC_GRAY_INDEX_BITS) - 1;
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
	GCObject* next = nullptr;
	GCObject* previous = nullptr;
};

} // namespace bmsx
