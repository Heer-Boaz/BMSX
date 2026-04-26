#pragma once

#include "rompack/assets.h"
#include <cstdint>
#include <string>

namespace bmsx {

class Memory;

uint32_t resolveAtlasSlotFromMemory(const Memory& memory, int32_t atlasId);
ImageSlotSource resolveImageSlotSourceFromAssets(const RuntimeAssets& assets, const Memory& memory, const std::string& imgId);

} // namespace bmsx
