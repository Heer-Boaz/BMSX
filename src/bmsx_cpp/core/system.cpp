#include "system.h"

#include "machine/runtime/timing/constants.h"

namespace bmsx {
namespace {

const MachineManifest SYSTEM_MACHINE_MANIFEST = [] {
	MachineManifest manifest;
	manifest.namespaceName = "bmsx";
	manifest.viewportWidth = 256;
	manifest.viewportHeight = 212;
	manifest.ufpsScaled = DEFAULT_UFPS_SCALED;
	manifest.cpuHz = 1'000'000;
	manifest.imgDecBytesPerSec = 26'214'400;
	manifest.dmaBytesPerSecIso = 8'388'608;
	manifest.dmaBytesPerSecBulk = 26'214'400;
	manifest.vdpWorkUnitsPerSec = DEFAULT_VDP_WORK_UNITS_PER_SEC;
	manifest.geoWorkUnitsPerSec = DEFAULT_GEO_WORK_UNITS_PER_SEC;
	return manifest;
}();

} // namespace

const MachineManifest& defaultSystemMachineManifest() {
	return SYSTEM_MACHINE_MANIFEST;
}

const char* systemBootEntryPath() {
	return "bios/bootrom";
}

} // namespace bmsx
