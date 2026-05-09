#include "machine/memory/map.h"

#include <cstddef>

namespace bmsx {

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

static void recomputeMemoryLayout(const MemoryMapConfig& config) {
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

void configureMemoryMap(const MemoryMapConfig& config) {
	recomputeMemoryLayout(config);
}

bool isVramMappedRange(uint32_t addr, size_t length) {
	if (length == 0) {
		return false;
	}
	const size_t start = static_cast<size_t>(addr);
	const size_t end = start + length;
	const auto overlaps = [addr, end](uint32_t base, uint32_t size) -> bool {
		const size_t regionStart = static_cast<size_t>(base);
		const size_t regionEnd = regionStart + static_cast<size_t>(size);
		return static_cast<size_t>(addr) < regionEnd && end > regionStart;
	};
	return overlaps(VRAM_STAGING_BASE, VRAM_STAGING_SIZE)
		|| overlaps(VRAM_SYSTEM_SLOT_BASE, VRAM_SYSTEM_SLOT_SIZE)
		|| overlaps(VRAM_PRIMARY_SLOT_BASE, VRAM_PRIMARY_SLOT_SIZE)
		|| overlaps(VRAM_SECONDARY_SLOT_BASE, VRAM_SECONDARY_SLOT_SIZE)
		|| overlaps(VRAM_FRAMEBUFFER_BASE, VRAM_FRAMEBUFFER_SIZE);
}

bool isVramMappedContiguousRange(uint32_t addr, size_t length) {
	if (length == 0) {
		return false;
	}
	const size_t start = static_cast<size_t>(addr);
	const size_t end = start + length;
	const auto contained = [start, end](uint32_t base, uint32_t size) -> bool {
		const size_t regionStart = static_cast<size_t>(base);
		const size_t regionEnd = regionStart + static_cast<size_t>(size);
		return start >= regionStart && end <= regionEnd;
	};
	return contained(VRAM_STAGING_BASE, VRAM_STAGING_SIZE)
		|| contained(VRAM_SYSTEM_SLOT_BASE, VRAM_SYSTEM_SLOT_SIZE)
		|| contained(VRAM_PRIMARY_SLOT_BASE, VRAM_PRIMARY_SLOT_SIZE)
		|| contained(VRAM_SECONDARY_SLOT_BASE, VRAM_SECONDARY_SLOT_SIZE)
		|| contained(VRAM_FRAMEBUFFER_BASE, VRAM_FRAMEBUFFER_SIZE);
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
