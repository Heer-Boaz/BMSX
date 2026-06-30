#include "system.h"

#include "machine/model_registry.h"

namespace bmsx {
namespace {

const MachineManifest SYSTEM_MACHINE_MANIFEST = [] {
	MachineManifest manifest;
	manifest.namespaceName = "bmsx";
	const MachineVdpModeProfile& vdpMode = getMachineVdpModeProfile(PSX_MODEL_PROFILE.biosVdpMode);
	manifest.viewportWidth = vdpMode.renderWidth;
	manifest.viewportHeight = vdpMode.renderHeight;
	manifest.vdpClass = MachineVdpClass::Psx;
	manifest.vdpMode = PSX_MODEL_PROFILE.biosVdpMode;
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
