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
	bool loadEngineAssets(EngineCore& engine, const u8* data, size_t size);
	bool loadEngineAssetsOwned(EngineCore& engine, std::vector<u8>&& data);
	bool loadEngineAssetsFromPath(EngineCore& engine, const char* path);

	bool loadRom(EngineCore& engine, const u8* data, size_t size);
	bool loadRomOwned(EngineCore& engine, std::vector<u8>&& data);
	void unloadRom(EngineCore& engine);

	bool bootLoadedCart(EngineCore& engine);
	bool rebootLoadedRom(EngineCore& engine);
	bool bootWithoutCart(EngineCore& engine);

private:
	void activateEngineAssets(EngineCore& engine);
	void activateCartAssets(EngineCore& engine);
	void setMachineManifest(EngineCore& engine, const MachineManifest& manifest);
	void configureViewForMachine(EngineCore& engine, const MachineManifest& manifest);

	bool loadEngineAssetsInternal(EngineCore& engine, const u8* data, size_t size);
	bool loadRomInternal(EngineCore& engine, const u8* data, size_t size);
	bool bootEngineStartupProgram(EngineCore& engine, const MachineManifest& runtimeMachine, const RuntimeAssets& sizingAssets);
	Runtime& prepareRuntimeForActiveCart(EngineCore& engine, const ResolvedRuntimeTiming& timing, const MachineManifest& machine);
	void bootRuntimeFromProgram(EngineCore& engine);
};

} // namespace bmsx

#endif // BMSX_ROM_BOOT_MANAGER_H
