#include "machine/machine_specs.h"

#include "machine/runtime/timing.h"
#include "rompack/runtime_assets.h"

#include <stdexcept>

namespace bmsx {

bool tryResolveCpuHz(const MachineManifest& manifest, i64& outHz) {
	if (!manifest.cpuHz) {
		return false;
	}
	const i64 hz = *manifest.cpuHz;
	if (hz <= 0) {
		return false;
	}
	outHz = hz;
	return true;
}

i64 resolveCpuHz(const MachineManifest& manifest) {
	if (!manifest.cpuHz) {
		throw std::runtime_error("[RuntimeMachineSpecs] machine.specs.cpu.cpu_freq_hz is required.");
	}
	const i64 hz = *manifest.cpuHz;
	if (hz <= 0) {
		throw std::runtime_error("[RuntimeMachineSpecs] machine.specs.cpu.cpu_freq_hz must be a positive integer.");
	}
	return hz;
}

i64 resolveImgDecBytesPerSec(const MachineManifest& manifest) {
	if (!manifest.imgDecBytesPerSec) {
		throw std::runtime_error("[RuntimeMachineSpecs] machine.specs.cpu.imgdec_bytes_per_sec is required.");
	}
	const i64 value = *manifest.imgDecBytesPerSec;
	if (value <= 0) {
		throw std::runtime_error("[RuntimeMachineSpecs] machine.specs.cpu.imgdec_bytes_per_sec must be a positive integer.");
	}
	return value;
}

i64 resolveDmaBytesPerSecIso(const MachineManifest& manifest) {
	if (!manifest.dmaBytesPerSecIso) {
		throw std::runtime_error("[RuntimeMachineSpecs] machine.specs.dma.dma_bytes_per_sec_iso is required.");
	}
	const i64 value = *manifest.dmaBytesPerSecIso;
	if (value <= 0) {
		throw std::runtime_error("[RuntimeMachineSpecs] machine.specs.dma.dma_bytes_per_sec_iso must be a positive integer.");
	}
	return value;
}

i64 resolveDmaBytesPerSecBulk(const MachineManifest& manifest) {
	if (!manifest.dmaBytesPerSecBulk) {
		throw std::runtime_error("[RuntimeMachineSpecs] machine.specs.dma.dma_bytes_per_sec_bulk is required.");
	}
	const i64 value = *manifest.dmaBytesPerSecBulk;
	if (value <= 0) {
		throw std::runtime_error("[RuntimeMachineSpecs] machine.specs.dma.dma_bytes_per_sec_bulk must be a positive integer.");
	}
	return value;
}

i64 resolveVdpWorkUnitsPerSec(const MachineManifest& manifest) {
	const i64 value = manifest.vdpWorkUnitsPerSec.value_or(DEFAULT_VDP_WORK_UNITS_PER_SEC);
	if (value <= 0) {
		throw std::runtime_error("[RuntimeMachineSpecs] machine.specs.vdp.work_units_per_sec must be a positive integer.");
	}
	return value;
}

i64 resolveGeoWorkUnitsPerSec(const MachineManifest& manifest) {
	const i64 value = manifest.geoWorkUnitsPerSec.value_or(DEFAULT_GEO_WORK_UNITS_PER_SEC);
	if (value <= 0) {
		throw std::runtime_error("[RuntimeMachineSpecs] machine.specs.geo.work_units_per_sec must be a positive integer.");
	}
	return value;
}

bool tryResolveUfpsScaled(const MachineManifest& manifest, i64& outUfpsScaled) {
	if (!manifest.ufpsScaled) {
		return false;
	}
	const i64 ufpsScaled = *manifest.ufpsScaled;
	if (ufpsScaled <= HZ_SCALE) {
		return false;
	}
	outUfpsScaled = ufpsScaled;
	return true;
}

i64 resolveUfpsScaled(const MachineManifest& manifest) {
	if (!manifest.ufpsScaled) {
		throw std::runtime_error("[RuntimeMachineSpecs] machine.ufps is required.");
	}
	const i64 ufpsScaled = *manifest.ufpsScaled;
	if (ufpsScaled <= HZ_SCALE) {
		throw std::runtime_error("[RuntimeMachineSpecs] machine.ufps must be greater than 1 Hz.");
	}
	return ufpsScaled;
}

} // namespace bmsx
