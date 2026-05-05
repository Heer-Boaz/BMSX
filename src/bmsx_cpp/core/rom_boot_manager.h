#ifndef BMSX_ROM_BOOT_MANAGER_H
#define BMSX_ROM_BOOT_MANAGER_H

#include "common/primitives.h"
#include "rompack/loader.h"
#include <memory>
#include <vector>

namespace bmsx {

class ConsoleCore;
class Runtime;
struct MachineManifest;
struct ResolvedRuntimeTiming;

class RomBootManager {
public:
	explicit RomBootManager(ConsoleCore& console);
	~RomBootManager();

	bool loadSystemRom(const u8* data, size_t size);
	bool loadSystemRomOwned(std::vector<u8>&& data);
	bool loadSystemRomFromPath(const char* path);

	bool loadRom(const u8* data, size_t size);
	bool loadRomOwned(std::vector<u8>&& data);
	void unloadRom();

	bool rebootLoadedRom();
	bool bootWithoutCart();
	bool hasLoadedCartProgram() const;
	bool romLoaded() const { return m_rom_loaded; }
	bool systemRomLoaded() const { return m_system_rom_loaded; }

	RuntimeRomPackage& activeRom() { return *m_active_rom; }
	const RuntimeRomPackage& activeRom() const { return *m_active_rom; }
	RuntimeRomPackage& systemRom() { return m_system_rom; }
	const RuntimeRomPackage& systemRom() const { return m_system_rom; }
	RuntimeRomPackage& cartRom() { return m_cart_rom; }
	const RuntimeRomPackage& cartRom() const { return m_cart_rom; }

private:
	ConsoleCore& m_console;
	RuntimeRomPackage* m_active_rom = nullptr;
	RuntimeRomPackage m_system_rom;
	RuntimeRomPackage m_cart_rom;
	std::vector<u8> m_system_rom_owned;
	const u8* m_system_rom_data = nullptr;
	size_t m_system_rom_size = 0;
	std::vector<u8> m_cart_rom_owned;
	const u8* m_cart_rom_data = nullptr;
	size_t m_cart_rom_size = 0;
	bool m_rom_loaded = false;
	bool m_loaded_cart_has_program = false;
	bool m_system_rom_loaded = false;
	std::unique_ptr<ProgramImage> m_linked_program;
	std::unique_ptr<ProgramMetadata> m_linked_program_symbols;

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
