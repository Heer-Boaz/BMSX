#include "machine/memory/specs.h"

#include "machine/memory/map.h"
#include "machine/model_registry.h"

#include <iomanip>
#include <iostream>

namespace bmsx {

void configureRuntimeMemoryMap() {
	const uint32_t ramBytes = static_cast<uint32_t>(PSX_MACHINE_SPEC.ramBytes);
	const double ramMiB = static_cast<double>(ramBytes) / (1024.0 * 1024.0);
	const uint32_t dynamicRamBytes = ramBytes - MIN_RAM_SIZE;
	std::cerr
		<< "[RuntimeMemorySpecs] memory footprint: ram=" << ramBytes << " bytes ("
		<< std::fixed << std::setprecision(2) << ramMiB << " MiB) "
		<< "(io=" << IO_REGION_SIZE
		<< ", base_ram_used=" << BASE_RAM_USED_SIZE
		<< ", dynamic_ram=" << dynamicRamBytes
		<< ", geo_scratch=" << DEFAULT_GEO_SCRATCH_SIZE
		<< ")." << std::endl;
	configureMemoryMap(ramBytes);
}

} // namespace bmsx
