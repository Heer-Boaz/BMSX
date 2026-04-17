#pragma once

#include "machine/memory/memory_map.h"

namespace bmsx {

struct MachineManifest;
class RuntimeAssets;

MemoryMapConfig resolveRuntimeMemoryMapConfig(
	const MachineManifest& machine,
	const MachineManifest& systemMachine,
	const RuntimeAssets& assets,
	const RuntimeAssets& engineAssets
);

void applyManifestMemorySpecs(
	const MachineManifest& machine,
	const MachineManifest& systemMachine,
	const RuntimeAssets& assets,
	const RuntimeAssets& engineAssets
);

} // namespace bmsx
