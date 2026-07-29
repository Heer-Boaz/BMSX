#pragma once

#include <cstdint>

namespace bmsx {

constexpr uint32_t ADDRESS_BITS = 32;

constexpr uint32_t SYSTEM_ROM_BASE = 0x00000000u;
constexpr uint32_t SYSTEM_ROM_SIZE = 0x01000000u; // 16 MB

constexpr uint32_t RAM_BASE = 0x08000000u;
constexpr uint32_t MAX_RAM_SIZE = 0x08000000u; // 128 MB address window

constexpr uint32_t CART_ROM_BASE = RAM_BASE + MAX_RAM_SIZE;
constexpr uint32_t CART_ROM_SIZE = 0x20000000u; // 512 MB address window
constexpr uint32_t CART_ROM_END = CART_ROM_BASE + CART_ROM_SIZE;
constexpr uint32_t CART_ROM_MAGIC_OFFSET = 0x00000000u;
constexpr uint32_t CART_ROM_MAGIC_ADDR = CART_ROM_BASE + CART_ROM_MAGIC_OFFSET;

constexpr uint32_t CART_RAM_BASE = CART_ROM_END;
constexpr uint32_t CART_RAM_SIZE = 0x00f00000u; // 15 MB
constexpr uint32_t CART_RAM_END = CART_RAM_BASE + CART_RAM_SIZE;
constexpr uint32_t CART_MMIO_BASE = CART_RAM_BASE + CART_RAM_SIZE;
constexpr uint32_t CART_MMIO_SIZE = 0x00100000u; // 1 MB
constexpr uint32_t CART_MMIO_END = CART_MMIO_BASE + CART_MMIO_SIZE;
constexpr uint32_t CART_BUS_END = CART_MMIO_END;

constexpr uint32_t IO_WORD_SIZE = 4;

constexpr uint32_t IO_REGION_SIZE = 0x00040000u; // 256 KB

constexpr uint32_t GEO_SCRATCH_SIZE = 0x00080000u; // 512 KB
constexpr uint32_t MIN_RAM_SIZE = IO_REGION_SIZE + GEO_SCRATCH_SIZE;
constexpr uint32_t BASE_RAM_USED_SIZE = GEO_SCRATCH_SIZE;
constexpr uint32_t DYNAMIC_RAM_BASE = RAM_BASE + MIN_RAM_SIZE;

constexpr uint32_t IO_BASE = RAM_BASE;
constexpr uint32_t GEO_SCRATCH_BASE = IO_BASE + IO_REGION_SIZE;

} // namespace bmsx
