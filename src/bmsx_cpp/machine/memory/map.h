#pragma once

#include <cstddef>
#include <cstdint>

namespace bmsx {

constexpr uint32_t ADDRESS_BITS = 32;

constexpr uint32_t SYSTEM_ROM_BASE = 0x00000000u;
constexpr uint32_t SYSTEM_ROM_SIZE = 0x01000000u; // 16 MB

constexpr uint32_t CART_ROM_BASE = 0x01000000u;
constexpr uint32_t CART_ROM_SIZE = 0x05000000u; // 80 MB
constexpr uint32_t CART_ROM_MAGIC_OFFSET = 0x00000000u;
constexpr uint32_t CART_ROM_MAGIC_ADDR = CART_ROM_BASE + CART_ROM_MAGIC_OFFSET;

constexpr uint32_t OVERLAY_ROM_BASE = 0x06000000u;
constexpr uint32_t OVERLAY_ROM_SIZE = 0x02000000u; // 32 MB

constexpr uint32_t RAM_BASE = 0x08000000u;
constexpr uint32_t DEFAULT_RAM_SIZE = 0x08000000u; // 128 MB

constexpr uint32_t PROGRAM_ROM_BASE = 0x10000000u;
constexpr uint32_t PROGRAM_ROM_SIZE = 0x01000000u; // 16 MB
constexpr uint32_t IO_WORD_SIZE = 4;
constexpr uint32_t CART_PROGRAM_START_OFFSET = 0x00080000u;
constexpr uint32_t CART_PROGRAM_START_ADDR = PROGRAM_ROM_BASE + CART_PROGRAM_START_OFFSET;
constexpr uint32_t CART_PROGRAM_VECTOR_OFFSET = CART_PROGRAM_START_OFFSET - IO_WORD_SIZE;
constexpr uint32_t CART_PROGRAM_VECTOR_ADDR = PROGRAM_ROM_BASE + CART_PROGRAM_VECTOR_OFFSET;

constexpr uint32_t IO_REGION_SIZE = 0x00040000u; // 256 KB

constexpr uint32_t DEFAULT_STRING_HANDLE_COUNT = 0x40000u; // 256k handles
constexpr uint32_t STRING_HANDLE_ENTRY_SIZE = 16;
constexpr uint32_t DEFAULT_STRING_HEAP_SIZE = 0x02000000u; // 32 MB
constexpr uint32_t DEFAULT_GEO_SCRATCH_SIZE = 0x00080000u; // 512 KB
constexpr uint32_t DEFAULT_VRAM_FRAMEBUFFER_SIZE = 256u * 212u * 4u;
constexpr uint32_t VDP_CMD_ARG_COUNT = 19u;
constexpr uint32_t VDP_STREAM_CAPACITY_WORDS = 16384u;
constexpr uint32_t VDP_STREAM_BUFFER_SIZE = VDP_STREAM_CAPACITY_WORDS * IO_WORD_SIZE;

extern uint32_t RAM_SIZE;
extern uint32_t STRING_HANDLE_COUNT;
extern uint32_t STRING_HANDLE_TABLE_SIZE;
extern uint32_t STRING_HEAP_SIZE;

constexpr uint32_t IO_BASE = RAM_BASE;
extern uint32_t STRING_HANDLE_TABLE_BASE;
extern uint32_t STRING_HEAP_BASE;
extern uint32_t GEO_SCRATCH_BASE;
extern uint32_t GEO_SCRATCH_SIZE;
extern uint32_t VDP_STREAM_BUFFER_BASE;
constexpr uint32_t DEFAULT_VRAM_IMAGE_SLOT_SIZE = 0x01000000u; // 16 MB
constexpr uint32_t DEFAULT_VRAM_STAGING_SIZE = 0x00400000u; // 4 MB
extern uint32_t VRAM_IMAGE_SLOT_SIZE;
extern uint32_t VRAM_STAGING_SIZE;
extern uint32_t VRAM_FRAMEBUFFER_SIZE;
extern uint32_t VRAM_SECONDARY_SLOT_BASE;
extern uint32_t VRAM_PRIMARY_SLOT_BASE;
extern uint32_t VRAM_SYSTEM_SLOT_BASE;
extern uint32_t VRAM_STAGING_BASE;
extern uint32_t VRAM_FRAMEBUFFER_BASE;
extern uint32_t VRAM_SYSTEM_SLOT_SIZE;
extern uint32_t VRAM_PRIMARY_SLOT_SIZE;
extern uint32_t VRAM_SECONDARY_SLOT_SIZE;
extern uint32_t RAM_USED_END;

struct MemoryMapConfig {
	uint32_t ramBytes = DEFAULT_RAM_SIZE;
	uint32_t stringHandleCount = DEFAULT_STRING_HANDLE_COUNT;
	uint32_t stringHeapBytes = DEFAULT_STRING_HEAP_SIZE;
	uint32_t slotBytes = DEFAULT_VRAM_IMAGE_SLOT_SIZE;
	uint32_t systemSlotBytes = DEFAULT_VRAM_IMAGE_SLOT_SIZE;
	uint32_t stagingBytes = DEFAULT_VRAM_STAGING_SIZE;
	uint32_t frameBufferBytes = DEFAULT_VRAM_FRAMEBUFFER_SIZE;
};

void configureMemoryMap(const MemoryMapConfig& config);
bool isVramMappedRange(uint32_t addr, size_t length);

} // namespace bmsx
