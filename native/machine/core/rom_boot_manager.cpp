#include "core/rom_boot_manager.h"
#include "core/system.h"
#include "rompack/loader.h"

namespace bmsx {

std::unique_ptr<RomBootPlan> RomBootManager::buildBootPlan(
	const u8* systemRom, size_t systemSize,
	const u8* cartridge, size_t cartSize)
{
	auto plan = std::make_unique<RomBootPlan>();

	loadSystemRomPackageFromRom(systemRom, systemSize, plan->systemLayer, nullptr, "system");
	plan->systemLayer.machine = defaultSystemMachineManifest();
	plan->systemLayer.entryPoint = systemBootEntryPath();
	plan->viewportSize = {
		plan->systemLayer.machine.viewportWidth,
		plan->systemLayer.machine.viewportHeight
	};

	if (cartridge != nullptr && cartSize > 0) {
		const MachineManifest cartManifest = peekCartMachineManifest(cartridge, cartSize);
		plan->viewportSize = {
			cartManifest.viewportWidth,
			cartManifest.viewportHeight
		};
	}

	return plan;
}

} // namespace bmsx
