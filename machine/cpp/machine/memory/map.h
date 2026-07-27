#pragma once

#include <cstdint>

namespace bmsx {

constexpr uint32_t DEFAULT_RAM_SIZE = 0x00400000u; // 4 MB

extern uint32_t RAM_SIZE;
extern uint32_t RAM_END;

void configureMemoryMap(uint32_t ramBytes);

} // namespace bmsx
