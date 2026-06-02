#include "machine/memory/map.h"

#include <cstddef>

namespace bmsx {

namespace {

enum class VramRangeMatch {
	Overlap,
	Contiguous,
};

bool vramRegionMatches(size_t start, size_t end, uint32_t base, uint32_t size, VramRangeMatch match) {
	const size_t regionStart = static_cast<size_t>(base);
	const size_t regionEnd = regionStart + static_cast<size_t>(size);
	if (match == VramRangeMatch::Contiguous) {
		return start >= regionStart && end <= regionEnd;
	}
	return start < regionEnd && end > regionStart;
}

bool vramMappedRangeMatches(uint32_t addr, size_t length, VramRangeMatch match) {
	if (length == 0) {
		return false;
	}
	const size_t start = static_cast<size_t>(addr);
	const size_t end = start + length;
	return vramRegionMatches(start, end, VRAM_STAGING_BASE, VRAM_STAGING_SIZE, match)
		|| vramRegionMatches(start, end, VRAM_SYSTEM_SLOT_BASE, VRAM_SYSTEM_SLOT_SIZE, match)
		|| vramRegionMatches(start, end, VRAM_PRIMARY_SLOT_BASE, VRAM_PRIMARY_SLOT_SIZE, match)
		|| vramRegionMatches(start, end, VRAM_SECONDARY_SLOT_BASE, VRAM_SECONDARY_SLOT_SIZE, match)
		|| vramRegionMatches(start, end, VRAM_FRAMEBUFFER_BASE, VRAM_FRAMEBUFFER_SIZE, match);
}

} // namespace

uint32_t RAM_SIZE = DEFAULT_RAM_SIZE;
uint32_t RAM_END = RAM_BASE + DEFAULT_RAM_SIZE;
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

void configureMemoryMap(const MemoryMapConfig& config) {
	RAM_SIZE = config.ramBytes;
	RAM_END = RAM_BASE + RAM_SIZE;
	VRAM_IMAGE_SLOT_SIZE = config.slotBytes;
	VRAM_STAGING_SIZE = config.stagingBytes;
	VRAM_FRAMEBUFFER_SIZE = config.frameBufferBytes;

	VRAM_STAGING_BASE = VRAM_BASE;
	VRAM_SYSTEM_SLOT_BASE = VRAM_STAGING_BASE + VRAM_STAGING_SIZE;
	VRAM_PRIMARY_SLOT_BASE = VRAM_SYSTEM_SLOT_BASE + config.systemSlotBytes;
	VRAM_SECONDARY_SLOT_BASE = VRAM_PRIMARY_SLOT_BASE + VRAM_IMAGE_SLOT_SIZE;
	VRAM_FRAMEBUFFER_BASE = VRAM_SECONDARY_SLOT_BASE + VRAM_IMAGE_SLOT_SIZE;
	VRAM_SYSTEM_SLOT_SIZE = config.systemSlotBytes;
	VRAM_PRIMARY_SLOT_SIZE = VRAM_IMAGE_SLOT_SIZE;
	VRAM_SECONDARY_SLOT_SIZE = VRAM_IMAGE_SLOT_SIZE;
}

bool isVramMappedRange(uint32_t addr, size_t length) {
	return vramMappedRangeMatches(addr, length, VramRangeMatch::Overlap);
}

bool isVramMappedContiguousRange(uint32_t addr, size_t length) {
	return vramMappedRangeMatches(addr, length, VramRangeMatch::Contiguous);
}

struct MemoryMapInitializer {
	MemoryMapInitializer() {
		MemoryMapConfig config;
		config.ramBytes = DEFAULT_RAM_SIZE;
		configureMemoryMap(config);
	}
};

static MemoryMapInitializer memoryMapInitializer;

} // namespace bmsx
