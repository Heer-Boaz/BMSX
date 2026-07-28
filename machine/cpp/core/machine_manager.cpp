/*
 * machine_manager.cpp - Machine manager implementation
 */

#include "machine_manager.h"
#include "../machine/runtime/runtime.h"
#include "machine/model_registry.h"
#include "machine/memory/map.h"
#include "machine/runtime/boot_timing.h"
#include <stdexcept>

namespace bmsx {

MachineManager::MachineManager(RuntimeInputSource& input)
	: m_input(input) {
}

MachineManager::~MachineManager() = default;

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

bool MachineManager::loadSystemRom(std::span<const u8> data) {
	m_runtime.reset();
	m_system_rom_image = parseRomImage(data.data(), data.size(), RomImageDomain::System);
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
		const RomImage& slot = m_cartridge_slots[slotIndex];
		if (slot.bytes.empty()) continue;
		const CartRomHeader& header = slot.header;
		m_cartridge_media[slotIndex] = CartridgeSlotMedia{
			slot.bytes,
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

bool MachineManager::loadCartridgeSlots(
	const std::array<std::span<const u8>, CARTRIDGE_SLOT_COUNT>& data
) {
	unloadRom();
	for (u32 slotIndex = 0; slotIndex < CARTRIDGE_SLOT_COUNT; ++slotIndex) {
		const std::span<const u8> slot = data[slotIndex];
		if (!slot.empty()) {
			m_cartridge_slots[slotIndex] =
				parseRomImage(slot.data(), slot.size(), RomImageDomain::Cartridge);
		}
	}
	return bootLoadedCartridgeSlots();
}

void MachineManager::unloadRom() {
	m_runtime.reset();
	m_cartridge_media = {};
	m_cartridge_slots = {};
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
