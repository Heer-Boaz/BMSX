#pragma once

#include <cstdint>

namespace bmsx {

extern uint32_t RAM_SIZE;
extern uint32_t RAM_END;

void configureMemoryMap(uint32_t ramBytes);

} // namespace bmsx
