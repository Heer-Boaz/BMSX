#include "system_machine.h"

namespace bmsx {
namespace {

const MachineManifest SYSTEM_MACHINE_MANIFEST = [] {
	MachineManifest manifest;
	manifest.namespaceName = "bmsx";
	manifest.viewportWidth = 256;
	manifest.viewportHeight = 212;
	manifest.canonicalization = CanonicalizationType::Lower;
	manifest.ufpsScaled = 50'000'000;
	manifest.cpuHz = 1'000'000;
	manifest.imgDecBytesPerSec = 26'214'400;
	manifest.dmaBytesPerSecIso = 8'388'608;
	manifest.dmaBytesPerSecBulk = 26'214'400;
	manifest.vdpRenderBudgetPerFrame = DEFAULT_VDP_RENDER_BUDGET_PER_FRAME;
	return manifest;
}();

} // namespace

const MachineManifest& defaultSystemMachineManifest() {
	return SYSTEM_MACHINE_MANIFEST;
}

const char* systemBootEntryPath() {
	return "res/bios/bootrom.lua";
}

} // namespace bmsx
