#include "machine/memory/map.h"
#include "spec/bmsx/memory_map.h"

namespace bmsx {

uint32_t RAM_SIZE = BMSX_RAM_BYTES;
uint32_t RAM_END = RAM_BASE + RAM_SIZE;

void configureMemoryMap(uint32_t ramBytes) {
	RAM_SIZE = ramBytes;
	RAM_END = RAM_BASE + RAM_SIZE;
}

} // namespace bmsx
