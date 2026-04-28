#ifndef BMSX_ROM_BOOT_MANAGER_H
#define BMSX_ROM_BOOT_MANAGER_H

#include "primitives.h"
#include <vector>

namespace bmsx {

class ConsoleCore;
class Runtime;
struct MachineManifest;
struct RuntimeRomPackage;
struct ResolvedRuntimeTiming;

class RomBootManager {
public:
	explicit RomBootManager(ConsoleCore& console);

	bool loadSystemRom(const u8* data, size_t size);
	bool loadSystemRomOwned(std::vector<u8>&& data);
	bool loadSystemRomFromPath(const char* path);

	bool loadRom(const u8* data, size_t size);
	bool loadRomOwned(std::vector<u8>&& data);
	void unloadRom();

	bool bootLoadedCart();
	bool rebootLoadedRom();
	bool bootWithoutCart();
	bool hasLoadedCartProgram() const;

private:
	ConsoleCore& m_console;

	void activateSystemRom();
	void activateCartRom();
	void setMachineManifest(const MachineManifest& manifest);
	void configureViewForMachine(const MachineManifest& manifest);

	bool loadSystemRomInternal(const u8* data, size_t size);
	bool loadRomInternal(const u8* data, size_t size);
	bool bootSystemStartupProgram(const MachineManifest& runtimeMachine);
	Runtime& prepareRuntimeForActiveCart(const ResolvedRuntimeTiming& timing, const MachineManifest& machine);
	void bootRuntimeFromProgram();
};

} // namespace bmsx

#endif // BMSX_ROM_BOOT_MANAGER_H
