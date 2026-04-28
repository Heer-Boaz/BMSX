#include "machine/memory/specs.h"

#include "rompack/format.h"

#include <iomanip>
#include <iostream>
#include <limits>
#include <stdexcept>

namespace bmsx {
namespace {

uint64_t alignUpU64(uint64_t value, uint64_t alignment) {
	const uint64_t mask = alignment - 1u;
	return (value + mask) & ~mask;
}

} // namespace

MemoryMapConfig resolveRuntimeMemoryMapConfig(const MachineManifest& machine, const MachineManifest& systemMachine, uint32_t systemSlotBytes) {
	MemoryMapConfig config;
	if (machine.slotBytes) {
		const i32 value = *machine.slotBytes;
		if (value <= 0) {
			throw std::runtime_error("[RuntimeMemorySpecs] slot_bytes must be greater than 0.");
		}
		config.slotBytes = static_cast<uint32_t>(value);
	}
	if (systemMachine.systemSlotBytes) {
		const i32 value = *systemMachine.systemSlotBytes;
		if (value <= 0) {
			throw std::runtime_error("[RuntimeMemorySpecs] system_slot_bytes must be greater than 0.");
		}
		config.systemSlotBytes = static_cast<uint32_t>(value);
	} else {
		if (systemSlotBytes == 0) {
			throw std::runtime_error("[RuntimeMemorySpecs] system slot slot bytes must be greater than 0.");
		}
		config.systemSlotBytes = systemSlotBytes;
	}
	if (machine.stagingBytes) {
		const i32 value = *machine.stagingBytes;
		if (value <= 0) {
			throw std::runtime_error("[RuntimeMemorySpecs] staging_bytes must be greater than 0.");
		}
		config.stagingBytes = static_cast<uint32_t>(value);
	}
	const uint32_t frameBufferWidth = static_cast<uint32_t>(machine.viewportWidth);
	const uint32_t frameBufferHeight = static_cast<uint32_t>(machine.viewportHeight);
	config.frameBufferBytes = frameBufferWidth * frameBufferHeight * 4u;

	const uint32_t stringHandleTableBytes = config.stringHandleCount * STRING_HANDLE_ENTRY_SIZE;
	const uint64_t runtimeRamBaseOffset = static_cast<uint64_t>(IO_REGION_SIZE)
		+ static_cast<uint64_t>(stringHandleTableBytes)
		+ static_cast<uint64_t>(config.stringHeapBytes);
	const uint64_t runtimeRamBasePadding = alignUpU64(runtimeRamBaseOffset, static_cast<uint64_t>(IO_WORD_SIZE)) - runtimeRamBaseOffset;
	const uint64_t fixedRamBytes = runtimeRamBaseOffset
		+ runtimeRamBasePadding
		+ static_cast<uint64_t>(DEFAULT_GEO_SCRATCH_SIZE)
		+ static_cast<uint64_t>(VDP_STREAM_BUFFER_SIZE);
	const uint64_t requiredRamBytes = fixedRamBytes;
	if (requiredRamBytes > std::numeric_limits<uint32_t>::max()) {
		throw std::runtime_error("[RuntimeMemorySpecs] ram_bytes exceeds addressable range.");
	}
	const uint32_t minimumRamBytes = static_cast<uint32_t>(requiredRamBytes);
	if (machine.ramBytes) {
		const i32 value = *machine.ramBytes;
		if (value <= 0) {
			throw std::runtime_error("[RuntimeMemorySpecs] ram_bytes must be greater than 0.");
		}
		const uint32_t resolved = static_cast<uint32_t>(value);
		if (resolved < minimumRamBytes) {
			throw std::runtime_error("[RuntimeMemorySpecs] ram_bytes must be at least required size.");
		}
		config.ramBytes = resolved;
	} else {
		config.ramBytes = minimumRamBytes;
	}
	const double ramMiB = static_cast<double>(config.ramBytes) / (1024.0 * 1024.0);
	std::cerr
		<< "[RuntimeMemorySpecs] memory footprint: ram=" << config.ramBytes << " bytes ("
		<< std::fixed << std::setprecision(2) << ramMiB << " MiB) "
		<< "(io=" << IO_REGION_SIZE
		<< ", string_handles=" << config.stringHandleCount
		<< ", string_heap=" << config.stringHeapBytes
		<< ", geo_scratch=" << DEFAULT_GEO_SCRATCH_SIZE
		<< ", vdp_stream=" << VDP_STREAM_BUFFER_SIZE
		<< ", vram_staging=" << config.stagingBytes
		<< ", framebuffer=" << config.frameBufferBytes
		<< ", system_slot=" << config.systemSlotBytes
		<< ", slot=" << config.slotBytes << "x2=" << (config.slotBytes * 2u)
		<< ")." << std::endl;
	return config;
}

void applyManifestMemorySpecs(const MachineManifest& machine, const MachineManifest& systemMachine, uint32_t systemSlotBytes) {
	const MemoryMapConfig config = resolveRuntimeMemoryMapConfig(machine, systemMachine, systemSlotBytes);
	configureMemoryMap(config);
}

} // namespace bmsx
