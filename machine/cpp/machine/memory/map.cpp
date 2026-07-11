#include "machine/memory/map.h"

namespace bmsx {

uint32_t RAM_SIZE = DEFAULT_RAM_SIZE;
uint32_t RAM_END = RAM_BASE + DEFAULT_RAM_SIZE;

void configureMemoryMap(uint32_t ramBytes) {
	RAM_SIZE = ramBytes;
	RAM_END = RAM_BASE + RAM_SIZE;
}

} // namespace bmsx
