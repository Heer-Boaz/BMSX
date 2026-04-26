#include "machine/memory/map.h"

#include "machine/common/align.h"
#include <stdexcept>

namespace bmsx {

uint32_t RAM_SIZE = DEFAULT_RAM_SIZE;
uint32_t STRING_HANDLE_COUNT = DEFAULT_STRING_HANDLE_COUNT;
uint32_t STRING_HANDLE_TABLE_SIZE = DEFAULT_STRING_HANDLE_COUNT * STRING_HANDLE_ENTRY_SIZE;
uint32_t STRING_HEAP_SIZE = DEFAULT_STRING_HEAP_SIZE;
uint32_t ASSET_TABLE_SIZE = DEFAULT_ASSET_TABLE_SIZE;
uint32_t STRING_HANDLE_TABLE_BASE = IO_BASE + IO_REGION_SIZE;
uint32_t STRING_HEAP_BASE = STRING_HANDLE_TABLE_BASE + STRING_HANDLE_TABLE_SIZE;
uint32_t ASSET_RAM_BASE = STRING_HEAP_BASE + STRING_HEAP_SIZE;
uint32_t ASSET_RAM_SIZE = RAM_SIZE - (ASSET_RAM_BASE - RAM_BASE);
uint32_t ASSET_TABLE_BASE = ASSET_RAM_BASE;
uint32_t ASSET_DATA_BASE = ASSET_TABLE_BASE + ASSET_TABLE_SIZE;
uint32_t ASSET_DATA_END = ASSET_RAM_BASE + ASSET_RAM_SIZE;
uint32_t GEO_SCRATCH_BASE = 0;
uint32_t GEO_SCRATCH_SIZE = DEFAULT_GEO_SCRATCH_SIZE;
uint32_t VDP_STREAM_BUFFER_BASE = 0;
uint32_t VRAM_ATLAS_SLOT_SIZE = DEFAULT_VRAM_ATLAS_SLOT_SIZE;
uint32_t VRAM_STAGING_SIZE = DEFAULT_VRAM_STAGING_SIZE;
uint32_t VRAM_FRAMEBUFFER_SIZE = DEFAULT_VRAM_FRAMEBUFFER_SIZE;
uint32_t VRAM_SECONDARY_ATLAS_BASE = 0;
uint32_t VRAM_PRIMARY_ATLAS_BASE = 0;
uint32_t VRAM_SYSTEM_ATLAS_BASE = 0;
uint32_t VRAM_STAGING_BASE = 0;
uint32_t VRAM_FRAMEBUFFER_BASE = 0;
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
	VRAM_ATLAS_SLOT_SIZE = config.textpageSlotBytes;
	VRAM_STAGING_SIZE = config.stagingBytes;
	VRAM_FRAMEBUFFER_SIZE = config.frameBufferBytes;

	STRING_HANDLE_TABLE_BASE = IO_BASE + IO_REGION_SIZE;
	STRING_HEAP_BASE = STRING_HANDLE_TABLE_BASE + STRING_HANDLE_TABLE_SIZE;
	ASSET_RAM_BASE = STRING_HEAP_BASE + STRING_HEAP_SIZE;
	ASSET_TABLE_BASE = ASSET_RAM_BASE;
	ASSET_DATA_BASE = alignUp(ASSET_TABLE_BASE + ASSET_TABLE_SIZE, IO_WORD_SIZE);
	ASSET_DATA_END = ASSET_DATA_BASE + config.assetDataBytes;
	ASSET_RAM_SIZE = ASSET_DATA_END - ASSET_RAM_BASE;
	GEO_SCRATCH_BASE = ASSET_DATA_END;
	GEO_SCRATCH_SIZE = DEFAULT_GEO_SCRATCH_SIZE;
	VDP_STREAM_BUFFER_BASE = GEO_SCRATCH_BASE + GEO_SCRATCH_SIZE;

	VRAM_STAGING_BASE = VDP_STREAM_BUFFER_BASE + VDP_STREAM_BUFFER_SIZE;
	VRAM_SYSTEM_ATLAS_BASE = VRAM_STAGING_BASE + VRAM_STAGING_SIZE;
	VRAM_PRIMARY_ATLAS_BASE = VRAM_SYSTEM_ATLAS_BASE + config.engineAtlasSlotBytes;
	VRAM_SECONDARY_ATLAS_BASE = VRAM_PRIMARY_ATLAS_BASE + VRAM_ATLAS_SLOT_SIZE;
	VRAM_FRAMEBUFFER_BASE = VRAM_SECONDARY_ATLAS_BASE + VRAM_ATLAS_SLOT_SIZE;
	VRAM_SYSTEM_ATLAS_SIZE = config.engineAtlasSlotBytes;
	VRAM_PRIMARY_ATLAS_SIZE = VRAM_ATLAS_SLOT_SIZE;
	VRAM_SECONDARY_ATLAS_SIZE = VRAM_ATLAS_SLOT_SIZE;
	ASSET_DATA_ALLOC_END = ASSET_DATA_END;
	RAM_USED_END = VDP_STREAM_BUFFER_BASE + VDP_STREAM_BUFFER_SIZE;
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
	if (config.textpageSlotBytes == 0) {
		throw std::runtime_error("[MemoryMap] textpage_slot_bytes must be greater than 0.");
	}
	if (config.engineAtlasSlotBytes == 0) {
		throw std::runtime_error("[MemoryMap] system_textpage_slot_bytes must be greater than 0.");
	}
	if (config.stagingBytes == 0) {
		throw std::runtime_error("[MemoryMap] staging_bytes must be greater than 0.");
	}
	if (config.frameBufferBytes == 0) {
		throw std::runtime_error("[MemoryMap] framebuffer_bytes must be greater than 0.");
	}
	recomputeMemoryLayout(config);
}

struct MemoryMapInitializer {
	MemoryMapInitializer() {
		MemoryMapConfig config;
		const uint32_t stringHandleTableBytes = config.stringHandleCount * STRING_HANDLE_ENTRY_SIZE;
		const uint32_t assetDataBaseOffset = IO_REGION_SIZE
			+ stringHandleTableBytes
			+ DEFAULT_STRING_HEAP_SIZE
			+ DEFAULT_ASSET_TABLE_SIZE;
		const uint32_t assetDataBasePadding = alignUp(assetDataBaseOffset, IO_WORD_SIZE) - assetDataBaseOffset;
		const uint32_t assetDataBytes = DEFAULT_RAM_SIZE
			- (assetDataBaseOffset + assetDataBasePadding + DEFAULT_GEO_SCRATCH_SIZE + VDP_STREAM_BUFFER_SIZE);
		config.assetDataBytes = assetDataBytes;
		config.ramBytes = DEFAULT_RAM_SIZE;
		recomputeMemoryLayout(config);
	}
};

static MemoryMapInitializer memoryMapInitializer;

} // namespace bmsx
