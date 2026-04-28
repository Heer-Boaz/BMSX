#pragma once

#include "machine/devices/vdp/contracts.h"
#include "rompack/package.h"
#include <cstdint>
#include <string>

namespace bmsx {

class Memory;

uint32_t resolveAtlasSlotFromMemory(const Memory& memory, int32_t atlasId);
VdpSlotSource resolveVdpSlotSourceFromPackage(const RuntimeRomPackage& romPackage, const Memory& memory, const std::string& imgId);

} // namespace bmsx
