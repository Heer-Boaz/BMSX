#pragma once

#include "machine/cpu/value.h"
#include "spec/bmsx/memory_map.h"

namespace bmsx {
class Memory;

inline constexpr u32 UPVALUE_HEAP_BYTES = 16;
inline constexpr u8 UPVALUE_RECORD_KIND = 11;
inline constexpr u32 UPVALUE_FLAGS = 2;
inline constexpr u8 UPVALUE_OPEN = 1;
inline constexpr u32 UPVALUE_VALUE_TAG = 3;
inline constexpr u32 UPVALUE_VALUE_WORD = 4;
inline constexpr u32 UPVALUE_OWNER = 8;
inline constexpr u32 UPVALUE_NEXT = 12;
inline constexpr u32 UPVALUE_CHAIN_LIMIT = MAIN_RAM_SIZE / UPVALUE_HEAP_BYTES;

namespace Upvalue {
bool isOpen(const Memory& memory, u32 address);
void close(Memory& memory, u32 address);
Value load(const Memory& memory, u32 address);
bool tryStoreDirect(Memory& memory, u32 cell, Value value);
} // namespace Upvalue
} // namespace bmsx
