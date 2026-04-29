#include "core/rom_boot_manager.h"

#include "core/console.h"
#include "core/system.h"
#include "machine/runtime/runtime.h"
#include "machine/specs.h"
#include "machine/memory/map.h"
#include "machine/memory/specs.h"
#include "machine/runtime/boot_timing.h"
#include "machine/program/linker.h"
#include "machine/firmware/font.h"
#include "render/texture_manager.h"
#include "rompack/format.h"

#include <fstream>
#include <iostream>
#include <stdexcept>
#include <utility>

namespace bmsx {

RomBootManager::RomBootManager(ConsoleCore& console)
	: m_console(console)
	, m_active_rom(&m_system_rom) {
}

RomBootManager::~RomBootManager() = default;

bool RomBootManager::hasLoadedCartProgram() const {
	return m_loaded_cart_has_program;
}

void RomBootManager::activateSystemRom() {
	m_active_rom = &m_system_rom;
}

void RomBootManager::activateCartRom() {
	m_active_rom = &m_cart_rom;
}

void RomBootManager::setMachineManifest(const MachineManifest& manifest) {
	ConsoleCore& console = m_console;
	console.m_machine_manifest = &manifest;
}

void RomBootManager::configureViewForMachine(const MachineManifest& manifest) {
	ConsoleCore& console = m_console;
	Vec2 viewportSize{
		static_cast<f32>(manifest.viewportWidth),
		static_cast<f32>(manifest.viewportHeight)
	};
	Vec2 offscreenSize{
		viewportSize.x * 2.0f,
		viewportSize.y * 2.0f
	};
	console.m_view->configureRenderTargets(&viewportSize, &viewportSize, &offscreenSize, &console.m_viewport_scale, &console.m_canvas_scale);
}

bool RomBootManager::loadSystemRomInternal(const u8* data, size_t size) {
	ConsoleCore& console = m_console;
	m_system_rom.clear();
	if (console.m_texture_manager) {
		console.m_texture_manager->setBackend(console.m_view ? console.m_view->backend() : nullptr);
	}

	if (!loadSystemRomPackageFromRom(data, size, m_system_rom, nullptr, "system")) {
		return false;
	}

	m_system_rom_loaded = true;
	m_system_rom.machine = defaultSystemMachineManifest();
	m_system_rom.entryPoint = systemBootEntryPath();
	m_active_rom = &m_system_rom;
	console.m_machine_manifest = &m_system_rom.machine;
	console.m_default_font = std::make_unique<Font>();
	console.m_view->default_font = console.m_default_font.get();
	return true;
}

Runtime& RomBootManager::prepareRuntimeForActiveCart(const ResolvedRuntimeTiming& timing, const MachineManifest& machine) {
	ConsoleCore& console = m_console;
	Runtime& runtime = console.ensureRuntime(RuntimeOptions{
			1,
			Vec2{ static_cast<f32>(timing.viewportWidth), static_cast<f32>(timing.viewportHeight) },
			{ m_system_rom_data, m_system_rom_size },
			{ m_cart_rom_data, m_cart_rom_size },
			&machine,
			timing.ufpsScaled,
			timing.cpuHz,
			timing.cycleBudgetPerFrame,
			timing.vblankCycles,
			timing.vdpWorkUnitsPerSec,
			timing.geoWorkUnitsPerSec,
	});
	runtime.setRuntimeEnvironment(
		activeRom().machine,
		{ m_system_rom_data, m_system_rom_size },
		{ m_cart_rom_data, m_cart_rom_size },
		activeRom(),
		m_system_rom,
		m_cart_rom_size > 0 ? &m_cart_rom : nullptr
	);
	applyRuntimeTiming(runtime, timing);
	runtime.refreshMemoryMap();
	return runtime;
}

void RomBootManager::bootRuntimeFromProgram() {
	ConsoleCore& console = m_console;
	if (!activeRom().programImage || !activeRom().programImage->program) {
		return;
	}
	m_linked_program.reset();
	m_linked_program_symbols.reset();
	RuntimeRomPackage& romPackage = activeRom();
	const ResolvedRuntimeTiming timing = resolveRuntimeTiming(romPackage.machine);
	Runtime& runtime = console.ensureRuntime(RuntimeOptions{
			1,
			Vec2{ static_cast<f32>(timing.viewportWidth), static_cast<f32>(timing.viewportHeight) },
			{ m_system_rom_data, m_system_rom_size },
			{ m_cart_rom_data, m_cart_rom_size },
			&romPackage.machine,
			timing.ufpsScaled,
			timing.cpuHz,
			timing.cycleBudgetPerFrame,
			timing.vblankCycles,
			timing.vdpWorkUnitsPerSec,
			timing.geoWorkUnitsPerSec,
	});
	runtime.setRuntimeEnvironment(
		romPackage.machine,
		{ m_system_rom_data, m_system_rom_size },
		{ m_cart_rom_data, m_cart_rom_size },
		romPackage,
		m_system_rom,
		m_cart_rom_size > 0 ? &m_cart_rom : nullptr
	);
	applyRuntimeTiming(runtime, timing);
	runtime.refreshMemoryMap();
	runtime.resetRuntimeForProgramReload();
	console.refreshRenderSurfaces();
	if (m_system_rom_loaded && m_system_rom.programImage && m_system_rom.programImage->program) {
		auto linked = linkProgramImages(
			*m_system_rom.programImage,
			m_system_rom.programSymbols.get(),
			*romPackage.programImage,
			romPackage.programSymbols.get()
		);
		m_linked_program = std::move(linked.program);
		m_linked_program_symbols = std::move(linked.metadata);
		runtime.setCartEntry(linked.cartEntryProtoIndex, std::move(linked.cartStaticModulePaths));
		runtime.enterCartProgram();
		runtime.boot(*m_linked_program, m_linked_program_symbols.get());
		return;
	}
	runtime.enterCartProgram();
	runtime.boot(*romPackage.programImage, romPackage.programSymbols.get());
}

bool RomBootManager::bootSystemStartupProgram(const MachineManifest& runtimeMachine) {
	ConsoleCore& console = m_console;
	if (!m_system_rom_loaded) {
		return false;
	}
	if (!m_system_rom.programImage || !m_system_rom.programImage->program) {
		return false;
	}

	activateSystemRom();
	setMachineManifest(runtimeMachine);
	const ResolvedRuntimeTiming timing = resolveRuntimeTiming(runtimeMachine);
	applyManifestMemorySpecs(runtimeMachine, m_system_rom.machine, DEFAULT_VRAM_IMAGE_SLOT_SIZE);
	configureViewForMachine(runtimeMachine);

	Runtime& runtime = console.ensureRuntime(RuntimeOptions{
			1,
			Vec2{ static_cast<f32>(timing.viewportWidth), static_cast<f32>(timing.viewportHeight) },
			{ m_system_rom_data, m_system_rom_size },
			{ m_cart_rom_data, m_cart_rom_size },
			&runtimeMachine,
			timing.ufpsScaled,
			timing.cpuHz,
			timing.cycleBudgetPerFrame,
			timing.vblankCycles,
			timing.vdpWorkUnitsPerSec,
			timing.geoWorkUnitsPerSec,
	});
	runtime.setRuntimeEnvironment(
		runtimeMachine,
		{ m_system_rom_data, m_system_rom_size },
		{ m_cart_rom_data, m_cart_rom_size },
		activeRom(),
		m_system_rom,
		m_cart_rom_size > 0 ? &m_cart_rom : nullptr
	);
	applyRuntimeTiming(runtime, timing);
	runtime.refreshMemoryMap();
	runtime.resetRuntimeForProgramReload();
	runtime.enterSystemFirmware();
	console.refreshRenderSurfaces();
	m_linked_program.reset();
	m_linked_program_symbols.reset();
	if (m_cart_rom_size > 0 && m_cart_rom.programImage && m_cart_rom.programImage->program) {
		auto linked = linkProgramImages(
			*m_system_rom.programImage,
			m_system_rom.programSymbols.get(),
			*m_cart_rom.programImage,
			m_cart_rom.programSymbols.get()
		);
		m_linked_program = std::move(linked.program);
		m_linked_program_symbols = std::move(linked.metadata);
		runtime.setCartEntry(linked.cartEntryProtoIndex, std::move(linked.cartStaticModulePaths));
		runtime.boot(*m_linked_program, m_linked_program_symbols.get(), linked.systemEntryProtoIndex, linked.systemStaticModulePaths);
	} else {
		runtime.boot(*m_system_rom.programImage, m_system_rom.programSymbols.get());
	}
	runtime.cartBoot.reset();
	return true;
}

bool RomBootManager::loadRomInternal(const u8* data, size_t size) {
	ConsoleCore& console = m_console;
	if (console.m_texture_manager) {
		console.m_texture_manager->setBackend(console.m_view ? console.m_view->backend() : nullptr);
	}

	m_cart_rom.clear();
	if (!loadCartRomPackageFromRom(data, size, m_cart_rom, nullptr, "cart")) {
		return false;
	}
	m_loaded_cart_has_program = m_cart_rom.programImage && m_cart_rom.programImage->program;

	const MachineManifest& cartMachine = m_cart_rom.machine;
	const i64 cartUfpsScaled = resolveUfpsScaled(cartMachine);
	i64 cpuHz = 0;
	const bool cartCpuValid = tryResolveCpuHz(cartMachine, cpuHz);
	i64 runtimeUfpsScaled = cartUfpsScaled;
	if (!cartCpuValid) {
		i64 systemUfpsScaled = 0;
		i64 systemCpuHz = 0;
		if (!m_system_rom_loaded
			|| !tryResolveCpuHz(m_system_rom.machine, systemCpuHz)
			|| !tryResolveUfpsScaled(m_system_rom.machine, systemUfpsScaled)) {
			throw std::runtime_error("[RomBootManager] machine.specs.cpu.cpu_freq_hz is required.");
		}
		std::cerr << "[RomBootManager] Cart manifest machine.specs.cpu.cpu_freq_hz is required; booting BIOS only." << std::endl;
		cpuHz = systemCpuHz;
		runtimeUfpsScaled = systemUfpsScaled;
	}
	const MachineManifest& transferMachine = cartCpuValid ? cartMachine : m_system_rom.machine;

	configureViewForMachine(cartMachine);

	const bool hasSystemProgram = m_system_rom_loaded
		&& m_system_rom.programImage
		&& m_system_rom.programImage->program;
	if (hasSystemProgram) {
		if (!bootSystemStartupProgram(transferMachine)) {
			return false;
		}
	} else {
		if (!cartCpuValid) {
			std::cerr << "[RomBootManager] Cart manifest machine.specs.cpu.cpu_freq_hz is required; cannot boot cart without BIOS." << std::endl;
			return false;
		}
		activateCartRom();
		setMachineManifest(cartMachine);
		applyManifestMemorySpecs(activeRom().machine, m_system_rom.machine, DEFAULT_VRAM_IMAGE_SLOT_SIZE);
		const ResolvedRuntimeTiming timing = resolveRuntimeTiming(activeRom().machine, transferMachine, cpuHz, runtimeUfpsScaled);
		prepareRuntimeForActiveCart(timing, cartMachine);
		if (activeRom().hasProgram()) {
			bootRuntimeFromProgram();
		}
	}

	m_rom_loaded = true;
	return true;
}

bool RomBootManager::loadSystemRom(const u8* data, size_t size) {
	m_system_rom_owned.clear();
	m_system_rom_data = data;
	m_system_rom_size = size;
	return loadSystemRomInternal(data, size);
}

bool RomBootManager::loadSystemRomOwned(std::vector<u8>&& data) {
	m_system_rom_owned = std::move(data);
	m_system_rom_data = m_system_rom_owned.data();
	m_system_rom_size = m_system_rom_owned.size();
	return loadSystemRomInternal(m_system_rom_data, m_system_rom_size);
}

bool RomBootManager::loadSystemRomFromPath(const char* path) {
	std::ifstream file(path, std::ios::binary | std::ios::ate);
	if (!file) {
		return false;
	}

	size_t size = file.tellg();
	file.seekg(0);

	std::vector<u8> data(size);
	if (!file.read(reinterpret_cast<char*>(data.data()), size)) {
		return false;
	}

	return loadSystemRomOwned(std::move(data));
}

bool RomBootManager::loadRom(const u8* data, size_t size) {
	unloadRom();
	m_cart_rom_owned.clear();
	m_cart_rom_data = data;
	m_cart_rom_size = size;
	return loadRomInternal(data, size);
}

bool RomBootManager::loadRomOwned(std::vector<u8>&& data) {
	unloadRom();
	m_cart_rom_owned = std::move(data);
	m_cart_rom_data = m_cart_rom_owned.data();
	m_cart_rom_size = m_cart_rom_owned.size();
	return loadRomInternal(m_cart_rom_data, m_cart_rom_size);
}

void RomBootManager::unloadRom() {
	ConsoleCore& console = m_console;
	if (m_rom_loaded) {
		m_active_rom = &m_system_rom;
		console.m_machine_manifest = &m_system_rom.machine;
		m_cart_rom.clear();
		m_linked_program.reset();
		m_linked_program_symbols.reset();
		m_cart_rom_owned.clear();
		m_cart_rom_data = nullptr;
		m_cart_rom_size = 0;
		if (console.m_texture_manager) {
			console.m_texture_manager->clear();
		}
		console.m_sound_master->resetPlaybackState();
		console.registry().clear();
		m_rom_loaded = false;
		m_loaded_cart_has_program = false;
	}
}

bool RomBootManager::rebootLoadedRom() {
	ConsoleCore& console = m_console;
	if (!m_rom_loaded) {
		return false;
	}

	if (console.m_sound_master) {
		console.m_sound_master->resetPlaybackState();
	}
	if (console.m_texture_manager) {
		console.m_texture_manager->clear();
	}
	if (console.m_view) {
		console.m_view->reset();
		if (console.m_view->backend()->readyForTextureUpload()) {
			console.m_view->initializeDefaultTextures();
		}
	}

	const MachineManifest* runtimeMachine = &m_system_rom.machine;
	if (m_cart_rom_size > 0 && m_cart_rom.programImage && m_cart_rom.programImage->program) {
		runtimeMachine = &m_cart_rom.machine;
	}
	return bootSystemStartupProgram(*runtimeMachine);
}

bool RomBootManager::bootWithoutCart() {
	ConsoleCore& console = m_console;
	if (!m_system_rom_loaded) {
		throw std::runtime_error("[BMSX] bootWithoutCart: system ROM not loaded");
	}

	if (!m_system_rom.hasProgram()) {
		throw std::runtime_error("[BMSX] bootWithoutCart: no program in system ROM");
	}

	std::cout << "[BMSX] bootWithoutCart: program found, booting..." << std::endl;
	if (!bootSystemStartupProgram(m_system_rom.machine)) {
		return false;
	}

	m_rom_loaded = true;
	console.start();
	return true;
}

} // namespace bmsx
