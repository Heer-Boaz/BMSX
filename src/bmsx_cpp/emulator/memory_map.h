#pragma once

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

constexpr uint32_t IO_WORD_SIZE = 4;
constexpr uint32_t IO_REGION_SIZE = 0x00004000u; // 16 KB
constexpr uint32_t VDP_OAM_SLOT_COUNT = 5000u;
constexpr uint32_t VDP_OAM_ENTRY_WORDS = 18u;
constexpr uint32_t VDP_OAM_ENTRY_BYTES = VDP_OAM_ENTRY_WORDS * IO_WORD_SIZE;
constexpr uint32_t VDP_OAM_BUFFER_SIZE = VDP_OAM_SLOT_COUNT * VDP_OAM_ENTRY_BYTES;
constexpr uint32_t VDP_OAM_RAM_SIZE = VDP_OAM_BUFFER_SIZE * 2u;
constexpr uint32_t VDP_BGMAP_LAYER_COUNT = 2u;
constexpr uint32_t VDP_BGMAP_HEADER_WORDS = 11u;
constexpr uint32_t VDP_BGMAP_HEADER_BYTES = VDP_BGMAP_HEADER_WORDS * IO_WORD_SIZE;
constexpr uint32_t VDP_BGMAP_ENTRY_WORDS = 7u;
constexpr uint32_t VDP_BGMAP_ENTRY_BYTES = VDP_BGMAP_ENTRY_WORDS * IO_WORD_SIZE;
constexpr uint32_t VDP_BGMAP_TILE_CAPACITY = 4096u;
constexpr uint32_t VDP_BGMAP_LAYER_SIZE = VDP_BGMAP_HEADER_BYTES + VDP_BGMAP_TILE_CAPACITY * VDP_BGMAP_ENTRY_BYTES;
constexpr uint32_t VDP_BGMAP_BUFFER_SIZE = VDP_BGMAP_LAYER_COUNT * VDP_BGMAP_LAYER_SIZE;
constexpr uint32_t VDP_BGMAP_RAM_SIZE = VDP_BGMAP_BUFFER_SIZE * 2u;
constexpr uint32_t VDP_PAT_HEADER_WORDS = 2u;
constexpr uint32_t VDP_PAT_HEADER_BYTES = VDP_PAT_HEADER_WORDS * IO_WORD_SIZE;
constexpr uint32_t VDP_PAT_ENTRY_WORDS = 17u;
constexpr uint32_t VDP_PAT_ENTRY_BYTES = VDP_PAT_ENTRY_WORDS * IO_WORD_SIZE;
constexpr uint32_t VDP_PAT_CAPACITY = 16384u;
constexpr uint32_t VDP_PAT_BUFFER_SIZE = VDP_PAT_HEADER_BYTES + VDP_PAT_CAPACITY * VDP_PAT_ENTRY_BYTES;
constexpr uint32_t VDP_PAT_RAM_SIZE = VDP_PAT_BUFFER_SIZE * 2u;

constexpr uint32_t DEFAULT_STRING_HANDLE_COUNT = 0x40000u; // 256k handles
constexpr uint32_t STRING_HANDLE_ENTRY_SIZE = 16;
constexpr uint32_t DEFAULT_STRING_HEAP_SIZE = 0x02000000u; // 32 MB
constexpr uint32_t DEFAULT_ASSET_TABLE_SIZE = 0x00100000u; // 1 MB

extern uint32_t RAM_SIZE;
extern uint32_t STRING_HANDLE_COUNT;
extern uint32_t STRING_HANDLE_TABLE_SIZE;
extern uint32_t STRING_HEAP_SIZE;

constexpr uint32_t IO_BASE = RAM_BASE;
extern uint32_t VDP_OAM_FRONT_BASE;
extern uint32_t VDP_OAM_BACK_BASE;
extern uint32_t VDP_BGMAP_FRONT_BASE;
extern uint32_t VDP_BGMAP_BACK_BASE;
extern uint32_t VDP_PAT_FRONT_BASE;
extern uint32_t VDP_PAT_BACK_BASE;
extern uint32_t STRING_HANDLE_TABLE_BASE;
extern uint32_t STRING_HEAP_BASE;
extern uint32_t ASSET_RAM_BASE;
extern uint32_t ASSET_RAM_SIZE;
extern uint32_t ASSET_TABLE_BASE;
extern uint32_t ASSET_TABLE_SIZE;
extern uint32_t ASSET_DATA_BASE;
extern uint32_t ASSET_DATA_END;
constexpr uint32_t DEFAULT_VRAM_ATLAS_SLOT_SIZE = 0x01000000u; // 16 MB
constexpr uint32_t DEFAULT_VRAM_STAGING_SIZE = 0x00400000u; // 4 MB
extern uint32_t VRAM_ATLAS_SLOT_SIZE;
extern uint32_t VRAM_STAGING_SIZE;
extern uint32_t VRAM_SECONDARY_ATLAS_BASE;
extern uint32_t VRAM_PRIMARY_ATLAS_BASE;
extern uint32_t VRAM_SYSTEM_ATLAS_BASE;
extern uint32_t VRAM_STAGING_BASE;
extern uint32_t VRAM_SKYBOX_BASE;
extern uint32_t VRAM_SKYBOX_FACE_BYTES;
extern uint32_t VRAM_SKYBOX_SIZE;
extern uint32_t VRAM_SKYBOX_POSX_BASE;
extern uint32_t VRAM_SKYBOX_NEGX_BASE;
extern uint32_t VRAM_SKYBOX_POSY_BASE;
extern uint32_t VRAM_SKYBOX_NEGY_BASE;
extern uint32_t VRAM_SKYBOX_POSZ_BASE;
extern uint32_t VRAM_SKYBOX_NEGZ_BASE;
extern uint32_t VRAM_SYSTEM_ATLAS_SIZE;
extern uint32_t VRAM_PRIMARY_ATLAS_SIZE;
extern uint32_t VRAM_SECONDARY_ATLAS_SIZE;
extern uint32_t ASSET_DATA_ALLOC_END;
extern uint32_t RAM_USED_END;

struct MemoryMapConfig {
	uint32_t ramBytes = DEFAULT_RAM_SIZE;
	uint32_t stringHandleCount = DEFAULT_STRING_HANDLE_COUNT;
	uint32_t stringHeapBytes = DEFAULT_STRING_HEAP_SIZE;
	uint32_t assetTableBytes = DEFAULT_ASSET_TABLE_SIZE;
	uint32_t assetDataBytes = 0;
	uint32_t atlasSlotBytes = DEFAULT_VRAM_ATLAS_SLOT_SIZE;
	uint32_t engineAtlasSlotBytes = DEFAULT_VRAM_ATLAS_SLOT_SIZE;
	uint32_t stagingBytes = DEFAULT_VRAM_STAGING_SIZE;
	uint32_t skyboxFaceBytes = 0;
};

void configureMemoryMap(const MemoryMapConfig& config);

} // namespace bmsx
