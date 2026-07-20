#pragma once

#include "common/primitives.h"

namespace bmsx {

enum class MemoryRegionKind { Ram, SystemRom, CartRom, ProgramRom, Other };

MemoryRegionKind classifyMemoryRegion(u32 addr);

} // namespace bmsx
