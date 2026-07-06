#include "machine/memory/specs.h"

#include "machine/model_registry.h"

#include <iomanip>
#include <iostream>

namespace bmsx {

MemoryMapSpecs resolveRuntimeMemoryMapSpecs() {
	MemoryMapSpecs config;
	config.textureBytes = static_cast<uint32_t>(PSX_MACHINE_SPEC.textureBytes);
	config.stagingBytes = static_cast<uint32_t>(PSX_MACHINE_SPEC.stagingBytes);
	const PsxGpuDisplaySizeSpec& renderSize = PSX_GPU_DISPLAY_SIZE_SPEC;
	const uint32_t frameBufferWidth = static_cast<uint32_t>(renderSize.renderWidth);
	const uint32_t frameBufferHeight = static_cast<uint32_t>(renderSize.renderHeight);
	config.frameBufferBytes = frameBufferWidth * frameBufferHeight * 4u;
	config.ramBytes = static_cast<uint32_t>(PSX_MACHINE_SPEC.ramBytes);
	const double ramMiB = static_cast<double>(config.ramBytes) / (1024.0 * 1024.0);
	const uint32_t dynamicRamBytes = config.ramBytes - MIN_RAM_SIZE;
	std::cerr
		<< "[RuntimeMemorySpecs] memory footprint: ram=" << config.ramBytes << " bytes ("
		<< std::fixed << std::setprecision(2) << ramMiB << " MiB) "
		<< "(io=" << IO_REGION_SIZE
		<< ", base_ram_used=" << BASE_RAM_USED_SIZE
		<< ", dynamic_ram=" << dynamicRamBytes
		<< ", geo_scratch=" << DEFAULT_GEO_SCRATCH_SIZE
		<< ", vdp_stream=" << VDP_STREAM_BUFFER_SIZE
		<< ", vram_staging=" << config.stagingBytes
		<< ", framebuffer=" << config.frameBufferBytes
		<< ", texture_vram=" << config.textureBytes
		<< ")." << std::endl;
	return config;
}

} // namespace bmsx
