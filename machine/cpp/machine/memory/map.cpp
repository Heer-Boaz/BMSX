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

uint32_t vramRegionRemainingBytes(uint32_t addr, uint32_t base, uint32_t size) {
	const uint32_t end = base + size;
	if (addr >= base && addr < end) {
		return end - addr;
	}
	return 0u;
}

bool vramMappedRangeMatches(uint32_t addr, size_t length, VramRangeMatch match) {
	if (length == 0) {
		return false;
	}
	const size_t start = static_cast<size_t>(addr);
	const size_t end = start + length;
	return vramRegionMatches(start, end, VRAM_STAGING_BASE, VRAM_STAGING_SIZE, match)
		|| vramRegionMatches(start, end, VRAM_TEXTURE_BASE, VRAM_TEXTURE_SIZE, match)
		|| vramRegionMatches(start, end, VRAM_FRAMEBUFFER_BASE, VRAM_FRAMEBUFFER_SIZE, match);
}

} // namespace

uint32_t RAM_SIZE = DEFAULT_RAM_SIZE;
uint32_t RAM_END = RAM_BASE + DEFAULT_RAM_SIZE;
uint32_t VRAM_TEXTURE_SIZE = DEFAULT_VRAM_TEXTURE_SIZE;
uint32_t VRAM_STAGING_SIZE = DEFAULT_VRAM_STAGING_SIZE;
uint32_t VRAM_FRAMEBUFFER_SIZE = DEFAULT_VRAM_FRAMEBUFFER_SIZE;
uint32_t VRAM_STAGING_BASE = 0;
uint32_t VRAM_TEXTURE_BASE = 0;
uint32_t VRAM_FRAMEBUFFER_BASE = 0;

void configureMemoryMap(const MemoryMapSpecs& specs) {
	RAM_SIZE = specs.ramBytes;
	RAM_END = RAM_BASE + RAM_SIZE;
	VRAM_TEXTURE_SIZE = specs.textureBytes;
	VRAM_STAGING_SIZE = specs.stagingBytes;
	VRAM_FRAMEBUFFER_SIZE = specs.frameBufferBytes;

	VRAM_STAGING_BASE = VRAM_BASE;
	VRAM_TEXTURE_BASE = VRAM_STAGING_BASE + VRAM_STAGING_SIZE;
	VRAM_FRAMEBUFFER_BASE = VRAM_TEXTURE_BASE + VRAM_TEXTURE_SIZE;
}

bool isVramMappedRange(uint32_t addr, size_t length) {
	return vramMappedRangeMatches(addr, length, VramRangeMatch::Overlap);
}

bool isVramMappedContiguousRange(uint32_t addr, size_t length) {
	return vramMappedRangeMatches(addr, length, VramRangeMatch::Contiguous);
}

uint32_t vramMappedRemainingBytes(uint32_t addr) {
	if (const uint32_t remaining = vramRegionRemainingBytes(addr, VRAM_STAGING_BASE, VRAM_STAGING_SIZE)) {
		return remaining;
	}
	if (const uint32_t remaining = vramRegionRemainingBytes(addr, VRAM_TEXTURE_BASE, VRAM_TEXTURE_SIZE)) {
		return remaining;
	}
	return vramRegionRemainingBytes(addr, VRAM_FRAMEBUFFER_BASE, VRAM_FRAMEBUFFER_SIZE);
}

struct MemoryMapInitializer {
	MemoryMapInitializer() {
		MemoryMapSpecs specs;
		specs.ramBytes = DEFAULT_RAM_SIZE;
		configureMemoryMap(specs);
	}
};

static MemoryMapInitializer memoryMapInitializer;

} // namespace bmsx
