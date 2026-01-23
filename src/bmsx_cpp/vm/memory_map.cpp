#include "memory_map.h"

#include <stdexcept>

namespace bmsx {

uint32_t VRAM_ATLAS_SLOT_SIZE = DEFAULT_VRAM_ATLAS_SLOT_SIZE;
uint32_t VRAM_STAGING_SIZE = DEFAULT_VRAM_STAGING_SIZE;
uint32_t VRAM_SECONDARY_ATLAS_BASE = 0;
uint32_t VRAM_PRIMARY_ATLAS_BASE = 0;
uint32_t VRAM_ENGINE_ATLAS_BASE = 0;
uint32_t VRAM_STAGING_BASE = 0;
uint32_t VRAM_ENGINE_ATLAS_SIZE = 0;
uint32_t VRAM_PRIMARY_ATLAS_SIZE = 0;
uint32_t VRAM_SECONDARY_ATLAS_SIZE = 0;
uint32_t ASSET_DATA_ALLOC_END = 0;

static void recomputeVramLayout() {
	VRAM_SECONDARY_ATLAS_BASE = ASSET_DATA_END - VRAM_ATLAS_SLOT_SIZE;
	VRAM_PRIMARY_ATLAS_BASE = VRAM_SECONDARY_ATLAS_BASE - VRAM_ATLAS_SLOT_SIZE;
	VRAM_ENGINE_ATLAS_BASE = VRAM_PRIMARY_ATLAS_BASE - VRAM_ATLAS_SLOT_SIZE;
	VRAM_STAGING_BASE = VRAM_ENGINE_ATLAS_BASE - VRAM_STAGING_SIZE;
	VRAM_ENGINE_ATLAS_SIZE = VRAM_ATLAS_SLOT_SIZE;
	VRAM_PRIMARY_ATLAS_SIZE = VRAM_ATLAS_SLOT_SIZE;
	VRAM_SECONDARY_ATLAS_SIZE = VRAM_ATLAS_SLOT_SIZE;
	ASSET_DATA_ALLOC_END = VRAM_STAGING_BASE;
	if (ASSET_DATA_ALLOC_END < ASSET_DATA_BASE) {
		throw std::runtime_error("[MemoryMap] VRAM layout exceeds asset RAM.");
	}
}

void configureMemoryMap(uint32_t atlasSlotBytes, uint32_t stagingBytes) {
	if (atlasSlotBytes == 0) {
		throw std::runtime_error("[MemoryMap] atlas_slot_bytes must be greater than 0.");
	}
	if (stagingBytes == 0) {
		throw std::runtime_error("[MemoryMap] staging_bytes must be greater than 0.");
	}
	VRAM_ATLAS_SLOT_SIZE = atlasSlotBytes;
	VRAM_STAGING_SIZE = stagingBytes;
	recomputeVramLayout();
}

struct MemoryMapInitializer {
	MemoryMapInitializer() {
		recomputeVramLayout();
	}
};

static MemoryMapInitializer memoryMapInitializer;

} // namespace bmsx
