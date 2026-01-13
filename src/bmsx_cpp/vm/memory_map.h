#pragma once

#include <cstdint>

namespace bmsx {

constexpr uint32_t ADDRESS_BITS = 32;

constexpr uint32_t ENGINE_ROM_BASE = 0x00000000u;
constexpr uint32_t ENGINE_ROM_SIZE = 0x01000000u; // 16 MB

constexpr uint32_t CART_ROM_BASE = 0x01000000u;
constexpr uint32_t CART_ROM_SIZE = 0x05000000u; // 80 MB
constexpr uint32_t CART_ROM_MAGIC_OFFSET = 0x00000000u;
constexpr uint32_t CART_ROM_MAGIC_ADDR = CART_ROM_BASE + CART_ROM_MAGIC_OFFSET;

constexpr uint32_t OVERLAY_ROM_BASE = 0x06000000u;
constexpr uint32_t OVERLAY_ROM_SIZE = 0x02000000u; // 32 MB

constexpr uint32_t RAM_BASE = 0x08000000u;
constexpr uint32_t RAM_SIZE = 0x08000000u; // 128 MB

constexpr uint32_t IO_WORD_SIZE = 8;
constexpr uint32_t IO_REGION_SIZE = 0x00004000u; // 16 KB

constexpr uint32_t STRING_HANDLE_COUNT = 0x40000u; // 256k handles
constexpr uint32_t STRING_HANDLE_ENTRY_SIZE = 16;
constexpr uint32_t STRING_HANDLE_TABLE_SIZE = STRING_HANDLE_COUNT * STRING_HANDLE_ENTRY_SIZE;
constexpr uint32_t ENGINE_STRING_HANDLE_LIMIT = 0x8000u; // 32k reserved for engine/system

constexpr uint32_t STRING_HEAP_SIZE = 0x02000000u; // 32 MB

constexpr uint32_t IO_BASE = RAM_BASE;
constexpr uint32_t STRING_HANDLE_TABLE_BASE = IO_BASE + IO_REGION_SIZE;
constexpr uint32_t STRING_HEAP_BASE = STRING_HANDLE_TABLE_BASE + STRING_HANDLE_TABLE_SIZE;
constexpr uint32_t ASSET_RAM_BASE = STRING_HEAP_BASE + STRING_HEAP_SIZE;
constexpr uint32_t ASSET_RAM_SIZE = RAM_SIZE - (ASSET_RAM_BASE - RAM_BASE);
constexpr uint32_t ASSET_TABLE_BASE = ASSET_RAM_BASE;
constexpr uint32_t ASSET_TABLE_SIZE = 0x00100000u; // 1 MB
constexpr uint32_t ASSET_DATA_BASE = ASSET_TABLE_BASE + ASSET_TABLE_SIZE;
constexpr uint32_t ASSET_DATA_END = ASSET_RAM_BASE + ASSET_RAM_SIZE;
constexpr uint32_t RAM_USED_END = RAM_BASE + RAM_SIZE;

} // namespace bmsx
