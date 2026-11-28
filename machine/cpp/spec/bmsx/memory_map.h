#pragma once

#include <cstdint>

namespace bmsx {

constexpr uint32_t ADDRESS_BITS = 32;

constexpr uint32_t SYSTEM_ROM_BASE = 0x00000000u;
constexpr uint32_t SYSTEM_ROM_SIZE = 0x01000000u; // 16 MB

constexpr uint32_t RAM_BASE = 0x08000000u;
constexpr uint32_t MAIN_RAM_SIZE = 0x00400000u;
// The CPU record port decodes only the installed RAM's aligned word address.
constexpr uint32_t RAM_RECORD_WORD_MASK = MAIN_RAM_SIZE - 4u;
constexpr uint32_t RAM_REFERENCE_MASK = MAIN_RAM_SIZE - 8u;
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
constexpr uint32_t CART_READ_QUALIFIER = 1u << 30u;
constexpr uint32_t CART_READ_SLOT_SHIFT = 31u;
constexpr uint32_t CART_READ_ADDRESS_MASK = CART_READ_QUALIFIER - 1u;

constexpr uint32_t IO_WORD_SIZE = 4;

constexpr uint32_t IO_REGION_SIZE = 0x00040000u; // 256 KB

// The language heap extends from the active image's page-rounded static end to
// the runtime management area at the top of installed RAM.
constexpr uint32_t HEAP_PAGE_SIZE = 0x00001000u; // 4 KB
constexpr uint32_t RUNTIME_MANAGEMENT_SIZE = 0x00004000u; // 16 KB
constexpr uint32_t MIN_RAM_SIZE = IO_REGION_SIZE;
constexpr uint32_t DYNAMIC_RAM_BASE = RAM_BASE + MIN_RAM_SIZE;

// Fixed CPU stack backing is not driven by the ordinary data or fetch bus.
constexpr uint32_t CPU_FIXED_FRAME_OFFSET = 0x880u;
constexpr uint32_t CPU_FIXED_VALUE_OFFSET = 0x1000u;
constexpr uint32_t CPU_FIXED_FRAME_COUNT = 24u;
constexpr uint32_t CPU_FIXED_VALUE_COUNT = 384u;
constexpr uint32_t CPU_FIXED_STACK_BASE = RAM_BASE + MAIN_RAM_SIZE - RUNTIME_MANAGEMENT_SIZE;
constexpr uint32_t CPU_FIXED_FRAME_ADDRESS = CPU_FIXED_STACK_BASE + CPU_FIXED_FRAME_OFFSET;
constexpr uint32_t CPU_FIXED_VALUE_ADDRESS = CPU_FIXED_STACK_BASE + CPU_FIXED_VALUE_OFFSET;
constexpr uint32_t CPU_FIXED_VALUE_END = CPU_FIXED_VALUE_ADDRESS + CPU_FIXED_VALUE_COUNT * 5u;
constexpr uint32_t CPU_RESET_BANK_ADDRESS = 0x083fd880u;
constexpr uint32_t CPU_RESET_BANK_END = CPU_RESET_BANK_ADDRESS + 0x50u;
constexpr uint32_t CPU_INTERRUPTED_CONTEXT_ADDRESS = CPU_RESET_BANK_END;
constexpr uint32_t CPU_INTERRUPT_STATE_ADDRESS = CPU_INTERRUPTED_CONTEXT_ADDRESS + 4u;
constexpr uint32_t CPU_IRQ_VECTOR_ADDRESS = CPU_INTERRUPT_STATE_ADDRESS + 4u;

constexpr uint32_t IO_BASE = RAM_BASE;

} // namespace bmsx
