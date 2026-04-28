#include "machine/memory/map.h"

#include "machine/common/align.h"
#include <cstddef>
#include <stdexcept>

namespace bmsx {

uint32_t RAM_SIZE = DEFAULT_RAM_SIZE;
uint32_t STRING_HANDLE_COUNT = DEFAULT_STRING_HANDLE_COUNT;
uint32_t STRING_HANDLE_TABLE_SIZE = DEFAULT_STRING_HANDLE_COUNT * STRING_HANDLE_ENTRY_SIZE;
uint32_t STRING_HEAP_SIZE = DEFAULT_STRING_HEAP_SIZE;
uint32_t STRING_HANDLE_TABLE_BASE = IO_BASE + IO_REGION_SIZE;
uint32_t STRING_HEAP_BASE = STRING_HANDLE_TABLE_BASE + STRING_HANDLE_TABLE_SIZE;
uint32_t GEO_SCRATCH_BASE = 0;
uint32_t GEO_SCRATCH_SIZE = DEFAULT_GEO_SCRATCH_SIZE;
uint32_t VDP_STREAM_BUFFER_BASE = 0;
uint32_t VRAM_IMAGE_SLOT_SIZE = DEFAULT_VRAM_IMAGE_SLOT_SIZE;
uint32_t VRAM_STAGING_SIZE = DEFAULT_VRAM_STAGING_SIZE;
uint32_t VRAM_FRAMEBUFFER_SIZE = DEFAULT_VRAM_FRAMEBUFFER_SIZE;
uint32_t VRAM_SECONDARY_SLOT_BASE = 0;
uint32_t VRAM_PRIMARY_SLOT_BASE = 0;
uint32_t VRAM_SYSTEM_SLOT_BASE = 0;
uint32_t VRAM_STAGING_BASE = 0;
uint32_t VRAM_FRAMEBUFFER_BASE = 0;
uint32_t VRAM_SYSTEM_SLOT_SIZE = 0;
uint32_t VRAM_PRIMARY_SLOT_SIZE = 0;
uint32_t VRAM_SECONDARY_SLOT_SIZE = 0;
uint32_t RAM_USED_END = RAM_BASE + DEFAULT_RAM_SIZE;

static void recomputeMemoryLayout(const MemoryMapConfig& config) {
	RAM_SIZE = config.ramBytes;
	STRING_HANDLE_COUNT = config.stringHandleCount;
	STRING_HANDLE_TABLE_SIZE = STRING_HANDLE_COUNT * STRING_HANDLE_ENTRY_SIZE;
	STRING_HEAP_SIZE = config.stringHeapBytes;
	VRAM_IMAGE_SLOT_SIZE = config.slotBytes;
	VRAM_STAGING_SIZE = config.stagingBytes;
	VRAM_FRAMEBUFFER_SIZE = config.frameBufferBytes;

	STRING_HANDLE_TABLE_BASE = IO_BASE + IO_REGION_SIZE;
	STRING_HEAP_BASE = STRING_HANDLE_TABLE_BASE + STRING_HANDLE_TABLE_SIZE;
	GEO_SCRATCH_BASE = alignUp(STRING_HEAP_BASE + STRING_HEAP_SIZE, IO_WORD_SIZE);
	GEO_SCRATCH_SIZE = DEFAULT_GEO_SCRATCH_SIZE;
	VDP_STREAM_BUFFER_BASE = GEO_SCRATCH_BASE + GEO_SCRATCH_SIZE;

	VRAM_STAGING_BASE = VDP_STREAM_BUFFER_BASE + VDP_STREAM_BUFFER_SIZE;
	VRAM_SYSTEM_SLOT_BASE = VRAM_STAGING_BASE + VRAM_STAGING_SIZE;
	VRAM_PRIMARY_SLOT_BASE = VRAM_SYSTEM_SLOT_BASE + config.systemSlotBytes;
	VRAM_SECONDARY_SLOT_BASE = VRAM_PRIMARY_SLOT_BASE + VRAM_IMAGE_SLOT_SIZE;
	VRAM_FRAMEBUFFER_BASE = VRAM_SECONDARY_SLOT_BASE + VRAM_IMAGE_SLOT_SIZE;
	VRAM_SYSTEM_SLOT_SIZE = config.systemSlotBytes;
	VRAM_PRIMARY_SLOT_SIZE = VRAM_IMAGE_SLOT_SIZE;
	VRAM_SECONDARY_SLOT_SIZE = VRAM_IMAGE_SLOT_SIZE;
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
	if (config.slotBytes == 0) {
		throw std::runtime_error("[MemoryMap] slot_bytes must be greater than 0.");
	}
	if (config.systemSlotBytes == 0) {
		throw std::runtime_error("[MemoryMap] system_slot_bytes must be greater than 0.");
	}
	if (config.stagingBytes == 0) {
		throw std::runtime_error("[MemoryMap] staging_bytes must be greater than 0.");
	}
	if (config.frameBufferBytes == 0) {
		throw std::runtime_error("[MemoryMap] framebuffer_bytes must be greater than 0.");
	}
	recomputeMemoryLayout(config);
}

bool isVramMappedRange(uint32_t addr, size_t length) {
	if (length == 0) {
		return false;
	}
	const uint32_t end = addr + static_cast<uint32_t>(length);
	const auto overlaps = [addr, end](uint32_t base, uint32_t size) -> bool {
		return addr < base + size && end > base;
	};
	return overlaps(VRAM_STAGING_BASE, VRAM_STAGING_SIZE)
		|| overlaps(VRAM_SYSTEM_SLOT_BASE, VRAM_SYSTEM_SLOT_SIZE)
		|| overlaps(VRAM_PRIMARY_SLOT_BASE, VRAM_PRIMARY_SLOT_SIZE)
		|| overlaps(VRAM_SECONDARY_SLOT_BASE, VRAM_SECONDARY_SLOT_SIZE)
		|| overlaps(VRAM_FRAMEBUFFER_BASE, VRAM_FRAMEBUFFER_SIZE);
}

struct MemoryMapInitializer {
	MemoryMapInitializer() {
		MemoryMapConfig config;
		config.ramBytes = DEFAULT_RAM_SIZE;
		recomputeMemoryLayout(config);
	}
};

static MemoryMapInitializer memoryMapInitializer;

} // namespace bmsx
