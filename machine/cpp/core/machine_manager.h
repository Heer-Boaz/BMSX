/*
 * machine_manager.h - BMSX machine manager
 *
 * Owns runtime boot handoff and ROM loading orchestration.
 * Cart-visible hardware belongs under machine.
 */

#ifndef BMSX_MACHINE_MANAGER_H
#define BMSX_MACHINE_MANAGER_H

#include "common/primitives.h"
#include "machine/devices/cartridge/contracts.h"
#include "spec/bmsx/cartridge.h"
#include "rompack/image.h"
#include <array>
#include <memory>
#include <span>

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
	bool loadSystemRom(std::span<const u8> data);
	bool loadCartridgeSlots(const std::array<std::span<const u8>, CARTRIDGE_SLOT_COUNT>& data);
	void unloadRom();
	bool rebootLoadedRom();
	bool bootWithoutCart();
	bool romLoaded() const { return m_rom_loaded; }
	bool systemRomLoaded() const { return m_system_rom_loaded; }
	const RomImage& systemRomImage() const { return m_system_rom_image; }
	const RomImage& cartridgeRomImage(u32 slot) const {
		return m_cartridge_slots[static_cast<size_t>(slot)];
	}

private:
	RuntimeInputSource& m_input;
	std::unique_ptr<Runtime> m_runtime;

	RomImage m_system_rom_image;
	std::array<RomImage, CARTRIDGE_SLOT_COUNT> m_cartridge_slots;
	CartridgeSlotMediaPair m_cartridge_media{};
	bool m_rom_loaded = false;
	bool m_system_rom_loaded = false;

	bool bootLoadedCartridgeSlots();
	bool bootSystemFirmware();
};

} // namespace bmsx

#endif // BMSX_MACHINE_MANAGER_H
