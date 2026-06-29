#pragma once

#include "machine/memory/map.h"
#include <cstdint>

namespace bmsx {

struct MachineManifest;

MemoryMapSpecs resolveRuntimeMemoryMapSpecs(const MachineManifest& machine);

} // namespace bmsx
