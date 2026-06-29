#include "system.h"

#include "machine/model_registry.h"

namespace bmsx {
namespace {

const MachineManifest SYSTEM_MACHINE_MANIFEST = [] {
	MachineManifest manifest;
	manifest.namespaceName = "bmsx";
	manifest.viewportWidth = PSX_MODEL_PROFILE.biosRenderWidth;
	manifest.viewportHeight = PSX_MODEL_PROFILE.biosRenderHeight;
	manifest.vdpClass = MachineVdpClass::Psx;
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
