#include "core/rom_boot_manager.h"
#include "core/system.h"
#include "machine/model_registry.h"
#include "rompack/loader.h"

namespace bmsx {

std::unique_ptr<RomBootPlan> RomBootManager::buildBootPlan(
	const u8* systemRom, size_t systemSize,
	const u8* cartridge, size_t cartSize)
{
	(void)cartridge;
	(void)cartSize;
	auto plan = std::make_unique<RomBootPlan>();

	loadSystemRomPackageFromRom(systemRom, systemSize, plan->systemLayer, nullptr, "system");
	plan->systemLayer.machine = defaultSystemMachineManifest();
	plan->systemLayer.entryPoint = systemBootEntryPath();
	const MachineVdpModeProfile& viewport = VDP_MODE_PSX_PROFILE;
	plan->viewportSize = {
		viewport.renderWidth,
		viewport.renderHeight
	};

	return plan;
}

} // namespace bmsx
