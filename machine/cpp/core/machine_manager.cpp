/*
 * machine_manager.cpp - Machine manager implementation
 */

#include "machine_manager.h"
#include "../machine/runtime/runtime.h"
#include "machine/model_registry.h"
#include "machine/memory/map.h"
#include "machine/runtime/boot_timing.h"
#include <span>
#include <stdexcept>
#include <utility>

namespace bmsx {

void MachineManager::LoadedCartridgeSlot::clear() {
	image = {};
	file.close();
	owned = std::vector<u8>();
}

MachineManager::MachineManager(RuntimeInputSource& input)
	: m_input(input) {
}

MachineManager::~MachineManager() {
	unloadRom();
}

Runtime& MachineManager::runtime() {
	return *m_runtime;
}

const Runtime& MachineManager::runtime() const {
	return *m_runtime;
}

Runtime& MachineManager::ensureRuntime(const RuntimeOptions& options) {
	if (!m_runtime) {
		m_runtime = std::make_unique<Runtime>(options, m_input);
	}
	return *m_runtime;
}

// ============================================================================
// ROM loading and boot orchestration
// ============================================================================

bool MachineManager::loadSystemRomInternal(const u8* data, size_t size) {
	m_system_rom_image = parseRomImage(data, size, RomImageDomain::System);
	m_system_rom_loaded = true;
	return true;
}

bool MachineManager::bootSystemFirmware() {
	if (!m_system_rom_loaded) return false;
	if (m_system_rom_image.header.blua32ImageOffset == 0u) return false;

	const ResolvedRuntimeTiming timing = resolveRuntimeTiming(PSX_MACHINE_SPEC.cpuFreqHz);
	configureMemoryMap(static_cast<uint32_t>(PSX_MACHINE_SPEC.ramBytes));

	Runtime& rt = ensureRuntime(RuntimeOptions{
		m_system_rom_image.bytes,
		m_cartridge_media,
		timing.pcrtcRunning,
		timing.ufpsScaled,
		timing.cpuHz,
		timing.cycleBudgetPerFrame,
		timing.totalHalfLines,
		timing.activeDisplayHalfLines,
		timing.geoWorkUnitsPerSec,
	});
	rt.resetForSystemBoot();
	rt.boot();
	return true;
}

bool MachineManager::bootLoadedCartridgeSlots() {
	for (u32 slotIndex = 0; slotIndex < CARTRIDGE_SLOT_COUNT; ++slotIndex) {
		const LoadedCartridgeSlot& slot = m_cartridge_slots[slotIndex];
		if (slot.image.bytes.empty()) continue;
		const CartRomHeader& header = slot.image.header;
		m_cartridge_media[slotIndex] = CartridgeSlotMedia{
			slot.image.bytes,
			header.cartridgeBoardWord,
			header.cartridgeRamByteCount,
			true,
		};
	}
	if (!m_system_rom_loaded || m_system_rom_image.header.blua32ImageOffset == 0u) {
		return false;
	}
	if (!bootSystemFirmware()) {
		return false;
	}

	m_rom_loaded = true;
	return true;
}

bool MachineManager::loadSystemRomOwned(std::vector<u8>&& data) {
	m_runtime.reset();
	m_system_rom_file.close();
	m_system_rom_owned = std::move(data);
	return loadSystemRomInternal(m_system_rom_owned.data(), m_system_rom_owned.size());
}

bool MachineManager::loadSystemRomFile(const std::string& path) {
	MmapFile mapped;
	if (!mapped.open(path)) {
		return false;
	}
	m_runtime.reset();
	m_system_rom_owned = std::vector<u8>();
	m_system_rom_file = std::move(mapped);
	return loadSystemRomInternal(m_system_rom_file.data(), m_system_rom_file.size());
}

bool MachineManager::loadCartridgeSlotsOwned(std::array<std::vector<u8>, CARTRIDGE_SLOT_COUNT>&& data) {
	unloadRom();
	for (u32 slotIndex = 0; slotIndex < CARTRIDGE_SLOT_COUNT; ++slotIndex) {
		LoadedCartridgeSlot& slot = m_cartridge_slots[slotIndex];
		slot.owned = std::move(data[slotIndex]);
		if (!slot.owned.empty()) {
			slot.image = parseRomImage(slot.owned.data(), slot.owned.size(), RomImageDomain::Cartridge);
		}
	}
	return bootLoadedCartridgeSlots();
}

bool MachineManager::loadCartridgeSlotFiles(const std::array<std::string, CARTRIDGE_SLOT_COUNT>& paths) {
	unloadRom();
	for (u32 slotIndex = 0; slotIndex < CARTRIDGE_SLOT_COUNT; ++slotIndex) {
		if (paths[slotIndex].empty()) {
			continue;
		}
		LoadedCartridgeSlot& slot = m_cartridge_slots[slotIndex];
		if (!slot.file.open(paths[slotIndex])) {
			return false;
		}
		slot.image = parseRomImage(slot.file.data(), slot.file.size(), RomImageDomain::Cartridge);
	}
	return bootLoadedCartridgeSlots();
}

void MachineManager::unloadRom() {
	m_runtime.reset();
	m_cartridge_media = {};
	for (LoadedCartridgeSlot& slot : m_cartridge_slots) {
		slot.clear();
	}
	m_rom_loaded = false;
}

bool MachineManager::rebootLoadedRom() {
	if (!m_rom_loaded) return false;

	return bootSystemFirmware();
}

bool MachineManager::bootWithoutCart() {
	if (!m_system_rom_loaded) {
		throw std::runtime_error("System ROM is not loaded.");
	}
	if (m_system_rom_image.header.blua32ImageOffset == 0u) {
		throw std::runtime_error("System ROM has no BLua32 image.");
	}
	if (!bootSystemFirmware()) {
		return false;
	}
	m_rom_loaded = true;
	return true;
}

} // namespace bmsx
