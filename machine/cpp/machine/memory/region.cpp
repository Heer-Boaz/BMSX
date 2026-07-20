#include "machine/memory/region.h"

#include "machine/memory/map.h"

namespace bmsx {

namespace {
inline bool inRange(u32 addr, u32 base, u32 size) {
	return addr >= base && addr - base < size;
}
} // namespace

MemoryRegionKind classifyMemoryRegion(u32 addr) {
	if (addr >= RAM_BASE && addr < RAM_END) {
		// The IO register window (mapped DMA/GX/APU/etc. ports) is carved out
		// of the RAM address window; those addresses are intercepted by
		// device logic before reaching the RAM array and have no DRAM row
		// behavior, so they must not classify as Ram.
		if (inRange(addr, IO_BASE, IO_REGION_SIZE)) {
			return MemoryRegionKind::Other;
		}
		return MemoryRegionKind::Ram;
	}
	if (inRange(addr, SYSTEM_ROM_BASE, SYSTEM_ROM_SIZE)) {
		return MemoryRegionKind::SystemRom;
	}
	if (inRange(addr, CART_ROM_BASE, CART_ROM_SIZE)) {
		return MemoryRegionKind::CartRom;
	}
	if (inRange(addr, PROGRAM_ROM_BASE, PROGRAM_ROM_SIZE)) {
		return MemoryRegionKind::ProgramRom;
	}
	return MemoryRegionKind::Other;
}

} // namespace bmsx
