#include "memory_map.h"

#include "../rompack/rompack.h"
#include <stdexcept>

namespace bmsx {

uint32_t RAM_SIZE = DEFAULT_RAM_SIZE;
uint32_t STRING_HANDLE_COUNT = DEFAULT_STRING_HANDLE_COUNT;
uint32_t STRING_HANDLE_TABLE_SIZE = DEFAULT_STRING_HANDLE_COUNT * STRING_HANDLE_ENTRY_SIZE;
uint32_t STRING_HEAP_SIZE = DEFAULT_STRING_HEAP_SIZE;
uint32_t ASSET_TABLE_SIZE = DEFAULT_ASSET_TABLE_SIZE;
uint32_t VDP_OAM_FRONT_BASE = IO_BASE + IO_REGION_SIZE;
uint32_t VDP_OAM_BACK_BASE = VDP_OAM_FRONT_BASE + VDP_OAM_BUFFER_SIZE;
uint32_t STRING_HANDLE_TABLE_BASE = VDP_OAM_BACK_BASE + VDP_OAM_BUFFER_SIZE;
uint32_t STRING_HEAP_BASE = STRING_HANDLE_TABLE_BASE + STRING_HANDLE_TABLE_SIZE;
uint32_t ASSET_RAM_BASE = STRING_HEAP_BASE + STRING_HEAP_SIZE;
uint32_t ASSET_RAM_SIZE = RAM_SIZE - (ASSET_RAM_BASE - RAM_BASE);
uint32_t ASSET_TABLE_BASE = ASSET_RAM_BASE;
uint32_t ASSET_DATA_BASE = ASSET_TABLE_BASE + ASSET_TABLE_SIZE;
uint32_t ASSET_DATA_END = ASSET_RAM_BASE + ASSET_RAM_SIZE;
uint32_t VRAM_ATLAS_SLOT_SIZE = DEFAULT_VRAM_ATLAS_SLOT_SIZE;
uint32_t VRAM_STAGING_SIZE = DEFAULT_VRAM_STAGING_SIZE;
uint32_t VRAM_SECONDARY_ATLAS_BASE = 0;
uint32_t VRAM_PRIMARY_ATLAS_BASE = 0;
uint32_t VRAM_SYSTEM_ATLAS_BASE = 0;
uint32_t VRAM_STAGING_BASE = 0;
uint32_t VRAM_SKYBOX_BASE = 0;
uint32_t VRAM_SKYBOX_FACE_BYTES = 0;
uint32_t VRAM_SKYBOX_SIZE = 0;
uint32_t VRAM_SKYBOX_POSX_BASE = 0;
uint32_t VRAM_SKYBOX_NEGX_BASE = 0;
uint32_t VRAM_SKYBOX_POSY_BASE = 0;
uint32_t VRAM_SKYBOX_NEGY_BASE = 0;
uint32_t VRAM_SKYBOX_POSZ_BASE = 0;
uint32_t VRAM_SKYBOX_NEGZ_BASE = 0;
uint32_t VRAM_SYSTEM_ATLAS_SIZE = 0;
uint32_t VRAM_PRIMARY_ATLAS_SIZE = 0;
uint32_t VRAM_SECONDARY_ATLAS_SIZE = 0;
uint32_t ASSET_DATA_ALLOC_END = 0;
uint32_t RAM_USED_END = RAM_BASE + DEFAULT_RAM_SIZE;

static void recomputeMemoryLayout(const MemoryMapConfig& config) {
	RAM_SIZE = config.ramBytes;
	STRING_HANDLE_COUNT = config.stringHandleCount;
	STRING_HANDLE_TABLE_SIZE = STRING_HANDLE_COUNT * STRING_HANDLE_ENTRY_SIZE;
	STRING_HEAP_SIZE = config.stringHeapBytes;
	ASSET_TABLE_SIZE = config.assetTableBytes;
	VRAM_ATLAS_SLOT_SIZE = config.atlasSlotBytes;
	VRAM_STAGING_SIZE = config.stagingBytes;

	VDP_OAM_FRONT_BASE = IO_BASE + IO_REGION_SIZE;
	VDP_OAM_BACK_BASE = VDP_OAM_FRONT_BASE + VDP_OAM_BUFFER_SIZE;
	STRING_HANDLE_TABLE_BASE = VDP_OAM_BACK_BASE + VDP_OAM_BUFFER_SIZE;
	STRING_HEAP_BASE = STRING_HANDLE_TABLE_BASE + STRING_HANDLE_TABLE_SIZE;
	ASSET_RAM_BASE = STRING_HEAP_BASE + STRING_HEAP_SIZE;
	ASSET_TABLE_BASE = ASSET_RAM_BASE;
	ASSET_DATA_BASE = ASSET_TABLE_BASE + ASSET_TABLE_SIZE;
	ASSET_DATA_END = ASSET_DATA_BASE + config.assetDataBytes;
	ASSET_RAM_SIZE = ASSET_DATA_END - ASSET_RAM_BASE;

	VRAM_STAGING_BASE = ASSET_DATA_END;
	VRAM_SKYBOX_FACE_BYTES = config.skyboxFaceBytes;
	VRAM_SKYBOX_SIZE = VRAM_SKYBOX_FACE_BYTES * 6u;
	VRAM_SKYBOX_BASE = VRAM_STAGING_BASE + VRAM_STAGING_SIZE;
	VRAM_SKYBOX_POSX_BASE = VRAM_SKYBOX_BASE;
	VRAM_SKYBOX_NEGX_BASE = VRAM_SKYBOX_POSX_BASE + VRAM_SKYBOX_FACE_BYTES;
	VRAM_SKYBOX_POSY_BASE = VRAM_SKYBOX_NEGX_BASE + VRAM_SKYBOX_FACE_BYTES;
	VRAM_SKYBOX_NEGY_BASE = VRAM_SKYBOX_POSY_BASE + VRAM_SKYBOX_FACE_BYTES;
	VRAM_SKYBOX_POSZ_BASE = VRAM_SKYBOX_NEGY_BASE + VRAM_SKYBOX_FACE_BYTES;
	VRAM_SKYBOX_NEGZ_BASE = VRAM_SKYBOX_POSZ_BASE + VRAM_SKYBOX_FACE_BYTES;
	VRAM_SYSTEM_ATLAS_BASE = VRAM_SKYBOX_BASE + VRAM_SKYBOX_SIZE;
	VRAM_PRIMARY_ATLAS_BASE = VRAM_SYSTEM_ATLAS_BASE + config.engineAtlasSlotBytes;
	VRAM_SECONDARY_ATLAS_BASE = VRAM_PRIMARY_ATLAS_BASE + VRAM_ATLAS_SLOT_SIZE;
	VRAM_SYSTEM_ATLAS_SIZE = config.engineAtlasSlotBytes;
	VRAM_PRIMARY_ATLAS_SIZE = VRAM_ATLAS_SLOT_SIZE;
	VRAM_SECONDARY_ATLAS_SIZE = VRAM_ATLAS_SLOT_SIZE;
	ASSET_DATA_ALLOC_END = ASSET_DATA_END;
	RAM_USED_END = ASSET_DATA_END;
}

void configureMemoryMap(const MemoryMapConfig& config) {
	if (config.ramBytes == 0) {
		throw std::runtime_error("[MemoryMap] ram_bytes must be greater than 0.");
	}
	if (config.stringHandleCount == 0) {
		throw std::runtime_error("[MemoryMap] string_handle_count must be greater than 0.");
	}
	if (config.stringHeapBytes == 0) {
		throw std::runtime_error("[MemoryMap] string_heap_bytes must be greater than 0.");
	}
	if (config.assetTableBytes == 0) {
		throw std::runtime_error("[MemoryMap] asset_table_bytes must be greater than 0.");
	}
	if (config.atlasSlotBytes == 0) {
		throw std::runtime_error("[MemoryMap] atlas_slot_bytes must be greater than 0.");
	}
	if (config.engineAtlasSlotBytes == 0) {
		throw std::runtime_error("[MemoryMap] system_atlas_slot_bytes must be greater than 0.");
	}
	if (config.stagingBytes == 0) {
		throw std::runtime_error("[MemoryMap] staging_bytes must be greater than 0.");
	}
	if (config.skyboxFaceBytes == 0) {
		throw std::runtime_error("[MemoryMap] skybox_face_bytes must be greater than 0.");
	}
	recomputeMemoryLayout(config);
}

struct MemoryMapInitializer {
	MemoryMapInitializer() {
		MemoryMapConfig config;
		const uint32_t stringHandleTableBytes = config.stringHandleCount * STRING_HANDLE_ENTRY_SIZE;
		const uint32_t assetDataBytes = DEFAULT_RAM_SIZE
			- (IO_REGION_SIZE + VDP_OAM_RAM_SIZE + stringHandleTableBytes + DEFAULT_STRING_HEAP_SIZE + DEFAULT_ASSET_TABLE_SIZE);
		const uint32_t skyboxFaceBytes = static_cast<uint32_t>(SKYBOX_FACE_DEFAULT_SIZE)
			* static_cast<uint32_t>(SKYBOX_FACE_DEFAULT_SIZE)
			* 4u;
		config.assetDataBytes = assetDataBytes;
		config.ramBytes = DEFAULT_RAM_SIZE;
		config.skyboxFaceBytes = skyboxFaceBytes;
		recomputeMemoryLayout(config);
	}
};

static MemoryMapInitializer memoryMapInitializer;

} // namespace bmsx
