/*
 * machine_manager.h - BMSX machine manager
 *
 * Owns runtime boot handoff and ROM loading orchestration.
 * Cart-visible hardware belongs under machine.
 */

#ifndef BMSX_MACHINE_MANAGER_H
#define BMSX_MACHINE_MANAGER_H

#include "common/mmap_file.h"
#include "common/primitives.h"
#include "machine/devices/cartridge/contracts.h"
#include "spec/bmsx/cartridge.h"
#include "rompack/image.h"
#include <array>
#include <memory>
#include <string>
#include <vector>

namespace bmsx {

class Runtime;
class RuntimeInputSource;
struct RuntimeOptions;

/* ============================================================================
 * MachineManager - runtime bootstrap and ROM owner
 * ============================================================================ */

class MachineManager {
public:
	explicit MachineManager(RuntimeInputSource& input);
	~MachineManager();

	bool hasRuntime() const { return m_runtime != nullptr; }
	Runtime& runtime();
	const Runtime& runtime() const;
	Runtime& ensureRuntime(const RuntimeOptions& options);
	// ROM loading and boot orchestration
	bool loadSystemRomOwned(std::vector<u8>&& data);
	bool loadSystemRomFile(const std::string& path);
	bool loadCartridgeSlotsOwned(std::array<std::vector<u8>, CARTRIDGE_SLOT_COUNT>&& data);
	bool loadCartridgeSlotFiles(const std::array<std::string, CARTRIDGE_SLOT_COUNT>& paths);
	void unloadRom();
	bool rebootLoadedRom();
	bool bootWithoutCart();
	bool romLoaded() const { return m_rom_loaded; }
	bool systemRomLoaded() const { return m_system_rom_loaded; }
	const RomImage& systemRomImage() const { return m_system_rom_image; }
	const RomImage& cartridgeRomImage(u32 slot) const {
		return m_cartridge_slots[static_cast<size_t>(slot)].image;
	}

private:
	struct LoadedCartridgeSlot {
		MmapFile file;
		std::vector<u8> owned;
		RomImage image;

		void clear();
	};

	RuntimeInputSource& m_input;
	std::unique_ptr<Runtime> m_runtime;

	// ROM state
	RomImage m_system_rom_image;
	std::array<LoadedCartridgeSlot, CARTRIDGE_SLOT_COUNT> m_cartridge_slots;
	CartridgeSlotMediaPair m_cartridge_media{};
	MmapFile m_system_rom_file;
	std::vector<u8> m_system_rom_owned;
	bool m_rom_loaded = false;
	bool m_system_rom_loaded = false;

	bool loadSystemRomInternal(const u8* data, size_t size);
	bool bootLoadedCartridgeSlots();
	bool bootSystemFirmware();

};

} // namespace bmsx

#endif // BMSX_MACHINE_MANAGER_H
