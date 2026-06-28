#pragma once

#include "machine/memory/map.h"
#include <cstdint>

namespace bmsx {

struct MachineManifest;

MemoryMapSpecs resolveRuntimeMemoryMapSpecs(
	const MachineManifest& machine,
	const MachineManifest& systemMachine,
	uint32_t systemSlotBytes
);

} // namespace bmsx
