#include "system.h"

#include "machine/model_registry.h"

namespace bmsx {
namespace {

const MachineManifest SYSTEM_MACHINE_MANIFEST = [] {
	const MachineRegionTiming region = getMachineRegionTiming(MachineRegion::Pal);

	MachineManifest manifest;
	manifest.namespaceName = "bmsx";
	manifest.viewportWidth = PSX_MODEL_PROFILE.biosRenderWidth;
	manifest.viewportHeight = PSX_MODEL_PROFILE.biosRenderHeight;
	manifest.ufpsScaled = region.refreshUfpsScaled;
	manifest.cpuHz = PSX_MODEL_PROFILE.cpuFreqHz;
	manifest.imgDecBytesPerSec = PSX_MODEL_PROFILE.imgDecBytesPerSec;
	manifest.dmaBytesPerSecIso = PSX_MODEL_PROFILE.dmaBytesPerSecIso;
	manifest.dmaBytesPerSecBulk = PSX_MODEL_PROFILE.dmaBytesPerSecBulk;
	manifest.vdpWorkUnitsPerSec = PSX_VDP_CLASS_PROFILE.vdpWorkUnitsPerSec;
	manifest.geoWorkUnitsPerSec = PSX_VDP_CLASS_PROFILE.geoWorkUnitsPerSec;
	manifest.ramBytes = static_cast<i32>(PSX_MODEL_PROFILE.ramBytes);
	manifest.slotBytes = static_cast<i32>(PSX_MODEL_PROFILE.slotBytes);
	manifest.systemSlotBytes = static_cast<i32>(PSX_MODEL_PROFILE.slotBytes);
	manifest.stagingBytes = static_cast<i32>(PSX_MODEL_PROFILE.stagingBytes);
	return manifest;
}();

} // namespace

const MachineManifest& defaultSystemMachineManifest() {
	return SYSTEM_MACHINE_MANIFEST;
}

const char* systemBootEntryPath() {
	return "bios/bootrom.lua";
}

} // namespace bmsx
