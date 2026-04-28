#pragma once

#include "machine/memory/map.h"
#include <cstdint>

namespace bmsx {

struct MachineManifest;

MemoryMapConfig resolveRuntimeMemoryMapConfig(
	const MachineManifest& machine,
	const MachineManifest& systemMachine,
	uint32_t systemSlotBytes
);

void applyManifestMemorySpecs(
	const MachineManifest& machine,
	const MachineManifest& systemMachine,
	uint32_t systemSlotBytes
);

} // namespace bmsx
