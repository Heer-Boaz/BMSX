#ifndef BMSX_ROM_BOOT_MANAGER_H
#define BMSX_ROM_BOOT_MANAGER_H

#include "primitives.h"
#include <vector>

namespace bmsx {

class EngineCore;
class Runtime;
struct MachineManifest;
struct RuntimeAssets;
struct ResolvedRuntimeTiming;

class RomBootManager {
public:
	bool loadEngineAssets(const u8* data, size_t size);
	bool loadEngineAssetsOwned(std::vector<u8>&& data);
	bool loadEngineAssetsFromPath(const char* path);

	bool loadRom(const u8* data, size_t size);
	bool loadRomOwned(std::vector<u8>&& data);
	void unloadRom();

	bool bootLoadedCart();
	bool rebootLoadedRom();
	bool bootWithoutCart();

private:
	void activateEngineAssets();
	void activateCartAssets();
	void setMachineManifest(const MachineManifest& manifest);
	void configureViewForMachine(const MachineManifest& manifest);

	bool loadEngineAssetsInternal(const u8* data, size_t size);
	bool loadRomInternal(const u8* data, size_t size);
	bool bootEngineStartupProgram(const MachineManifest& runtimeMachine, const RuntimeAssets& sizingAssets);
	Runtime& prepareRuntimeForActiveCart(const ResolvedRuntimeTiming& timing, const MachineManifest& machine);
	void bootRuntimeFromProgram();
};

} // namespace bmsx

#endif // BMSX_ROM_BOOT_MANAGER_H
