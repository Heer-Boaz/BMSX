#include "core/rom_boot_manager.h"

#include "core/console.h"
#include "core/system.h"
#include "machine/runtime/runtime.h"
#include "core/vdp_slot_bootstrap.h"
#include "machine/specs.h"
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
namespace {

uint32_t resolveSystemSlotBytes(const RuntimeRomPackage& systemImages) {
	const std::string systemSlotId = generateAtlasAssetId(BIOS_ATLAS_ID);
	const ImgAsset* systemSlot = systemImages.getImg(systemSlotId);
	if (!systemSlot) {
		throw std::runtime_error("[RomBootManager] System ROM slot metadata is missing.");
	}
	const i32 width = systemSlot->meta.width;
	const i32 height = systemSlot->meta.height;
	if (width <= 0 || height <= 0) {
		throw std::runtime_error("[RomBootManager] System ROM slot dimensions must be positive.");
	}
	return static_cast<uint32_t>(width) * static_cast<uint32_t>(height) * 4u;
}

} // namespace

RomBootManager::RomBootManager(ConsoleCore& console)
	: m_console(console) {
}

bool RomBootManager::hasLoadedCartProgram() const {
	return m_console.hasLoadedCartProgram();
}

void RomBootManager::activateSystemRom() {
	ConsoleCore& console = m_console;
	console.m_active_rom = &console.m_system_rom;
}

void RomBootManager::activateCartRom() {
	ConsoleCore& console = m_console;
	console.m_active_rom = &console.m_cart_rom;
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
	console.m_system_rom.clear();
	if (console.m_texture_manager) {
		console.m_texture_manager->setBackend(console.m_view ? console.m_view->backend() : nullptr);
	}

	if (!loadSystemRomPackageFromRom(data, size, console.m_system_rom, nullptr, "system")) {
		return false;
	}

	console.m_system_rom_loaded = true;
	console.m_system_rom.machine = defaultSystemMachineManifest();
	console.m_system_rom.entryPoint = systemBootEntryPath();
	console.m_active_rom = &console.m_system_rom;
	console.m_machine_manifest = &console.m_system_rom.machine;
	console.m_default_font = std::make_unique<Font>();
	console.m_view->default_font = console.m_default_font.get();
	return true;
}

Runtime& RomBootManager::prepareRuntimeForActiveCart(const ResolvedRuntimeTiming& timing, const MachineManifest& machine) {
	ConsoleCore& console = m_console;
	Runtime& runtime = console.ensureRuntime(RuntimeOptions{
			1,
			Vec2{ static_cast<f32>(timing.viewportWidth), static_cast<f32>(timing.viewportHeight) },
			&console.m_system_rom,
			&console.m_cart_rom,
			&console.m_cart_rom,
			{ console.m_system_rom_data, console.m_system_rom_size },
			{ console.m_cart_rom_data, console.m_cart_rom_size },
			&machine,
			timing.ufpsScaled,
			timing.cpuHz,
			timing.cycleBudgetPerFrame,
			timing.vblankCycles,
			timing.vdpWorkUnitsPerSec,
			timing.geoWorkUnitsPerSec,
		});
	runtime.setRuntimeEnvironment(
		console.m_system_rom,
		console.activeRom(),
		console.activeRom().machine,
		&console.m_cart_rom,
		{ console.m_system_rom_data, console.m_system_rom_size },
		{ console.m_cart_rom_data, console.m_cart_rom_size }
	);
	applyRuntimeTiming(runtime, timing);
	runtime.refreshMemoryMap();
	return runtime;
}

void RomBootManager::bootRuntimeFromProgram() {
	ConsoleCore& console = m_console;
	if (!console.activeRom().programImage || !console.activeRom().programImage->program) {
		return;
	}
	console.m_linked_program.reset();
	console.m_linked_program_symbols.reset();
	RuntimeRomPackage& activeRom = console.activeRom();
	const ResolvedRuntimeTiming timing = resolveRuntimeTiming(activeRom.machine);
	Runtime& runtime = console.ensureRuntime(RuntimeOptions{
			1,
			Vec2{ static_cast<f32>(timing.viewportWidth), static_cast<f32>(timing.viewportHeight) },
			&console.m_system_rom,
			&activeRom,
			console.m_cart_rom_size > 0 ? &console.m_cart_rom : nullptr,
			{ console.m_system_rom_data, console.m_system_rom_size },
			{ console.m_cart_rom_data, console.m_cart_rom_size },
			&activeRom.machine,
			timing.ufpsScaled,
			timing.cpuHz,
			timing.cycleBudgetPerFrame,
			timing.vblankCycles,
			timing.vdpWorkUnitsPerSec,
			timing.geoWorkUnitsPerSec,
		});
	runtime.setRuntimeEnvironment(
		console.m_system_rom,
		activeRom,
		activeRom.machine,
		console.m_cart_rom_size > 0 ? &console.m_cart_rom : nullptr,
		{ console.m_system_rom_data, console.m_system_rom_size },
		{ console.m_cart_rom_data, console.m_cart_rom_size }
	);
	applyRuntimeTiming(runtime, timing);
	runtime.refreshMemoryMap();
	runtime.setProgramSource(Runtime::ProgramSource::Cart);
	runtime.resetRuntimeForProgramReload();
	console.refreshRenderSurfaces();
	if (console.m_system_rom_loaded && console.m_system_rom.programImage && console.m_system_rom.programImage->program) {
		auto linked = linkProgramImages(
			*console.m_system_rom.programImage,
			console.m_system_rom.programSymbols.get(),
			*activeRom.programImage,
			activeRom.programSymbols.get()
		);
		console.m_linked_program = std::move(linked.program);
		console.m_linked_program_symbols = std::move(linked.metadata);
		runtime.boot(*console.m_linked_program, console.m_linked_program_symbols.get());
		return;
	}
	runtime.boot(*activeRom.programImage, activeRom.programSymbols.get());
}

bool RomBootManager::bootSystemStartupProgram(const MachineManifest& runtimeMachine) {
	ConsoleCore& console = m_console;
	if (!console.m_system_rom_loaded) {
		return false;
	}
	if (!console.m_system_rom.programImage || !console.m_system_rom.programImage->program) {
		return false;
	}

	activateSystemRom();
	setMachineManifest(runtimeMachine);
	const ResolvedRuntimeTiming timing = resolveRuntimeTiming(runtimeMachine);
	applyManifestMemorySpecs(runtimeMachine, console.m_system_rom.machine, resolveSystemSlotBytes(console.m_system_rom));
	configureViewForMachine(runtimeMachine);

	Runtime& runtime = console.ensureRuntime(RuntimeOptions{
			1,
			Vec2{ static_cast<f32>(timing.viewportWidth), static_cast<f32>(timing.viewportHeight) },
			&console.m_system_rom,
			&console.m_system_rom,
			console.m_cart_rom_size > 0 ? &console.m_cart_rom : nullptr,
			{ console.m_system_rom_data, console.m_system_rom_size },
			{ console.m_cart_rom_data, console.m_cart_rom_size },
			&runtimeMachine,
			timing.ufpsScaled,
			timing.cpuHz,
			timing.cycleBudgetPerFrame,
			timing.vblankCycles,
			timing.vdpWorkUnitsPerSec,
			timing.geoWorkUnitsPerSec,
		});
	runtime.setRuntimeEnvironment(
		console.m_system_rom,
		console.m_system_rom,
		runtimeMachine,
		console.m_cart_rom_size > 0 ? &console.m_cart_rom : nullptr,
		{ console.m_system_rom_data, console.m_system_rom_size },
		{ console.m_cart_rom_data, console.m_cart_rom_size }
	);
	applyRuntimeTiming(runtime, timing);
	runtime.refreshMemoryMap();
	runtime.setProgramSource(Runtime::ProgramSource::System);
	configureVdpSlots(runtime, console.m_system_rom, console.m_system_rom);
	runtime.resetRuntimeForProgramReload();
	console.refreshRenderSurfaces();
	runtime.boot(*console.m_system_rom.programImage, console.m_system_rom.programSymbols.get());
	runtime.cartBoot.reset();
	return true;
}

bool RomBootManager::loadRomInternal(const u8* data, size_t size) {
	ConsoleCore& console = m_console;
	if (console.m_texture_manager) {
		console.m_texture_manager->setBackend(console.m_view ? console.m_view->backend() : nullptr);
	}

	console.m_cart_rom.clear();
	if (!loadCartRomPackageFromRom(data, size, console.m_cart_rom, nullptr, "cart")) {
		return false;
	}
	console.m_loaded_cart_has_program = console.m_cart_rom.programImage && console.m_cart_rom.programImage->program;

	const MachineManifest& cartMachine = console.m_cart_rom.machine;
	const i64 cartUfpsScaled = resolveUfpsScaled(cartMachine);
	i64 cpuHz = 0;
	const bool cartCpuValid = tryResolveCpuHz(cartMachine, cpuHz);
	i64 runtimeUfpsScaled = cartUfpsScaled;
	if (!cartCpuValid) {
		i64 systemUfpsScaled = 0;
		i64 systemCpuHz = 0;
		if (!console.m_system_rom_loaded
			|| !tryResolveCpuHz(console.m_system_rom.machine, systemCpuHz)
			|| !tryResolveUfpsScaled(console.m_system_rom.machine, systemUfpsScaled)) {
			throw std::runtime_error("[RomBootManager] machine.specs.cpu.cpu_freq_hz is required.");
		}
		std::cerr << "[RomBootManager] Cart manifest machine.specs.cpu.cpu_freq_hz is required; booting BIOS only." << std::endl;
		cpuHz = systemCpuHz;
		runtimeUfpsScaled = systemUfpsScaled;
	}
	const MachineManifest& transferMachine = cartCpuValid ? cartMachine : console.m_system_rom.machine;

	configureViewForMachine(cartMachine);

	const bool hasSystemProgram = console.m_system_rom_loaded
		&& console.m_system_rom.programImage
		&& console.m_system_rom.programImage->program;
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
		applyManifestMemorySpecs(console.activeRom().machine, console.m_system_rom.machine, resolveSystemSlotBytes(console.m_system_rom));
		const ResolvedRuntimeTiming timing = resolveRuntimeTiming(console.activeRom().machine, transferMachine, cpuHz, runtimeUfpsScaled);
		Runtime& runtime = prepareRuntimeForActiveCart(timing, cartMachine);
		configureVdpSlots(runtime, console.m_system_rom, console.activeRom());
		if (console.activeRom().hasProgram()) {
			bootRuntimeFromProgram();
		}
	}

	console.m_rom_loaded = true;
	return true;
}

bool RomBootManager::loadSystemRom(const u8* data, size_t size) {
	ConsoleCore& console = m_console;
	console.m_system_rom_owned.clear();
	console.m_system_rom_data = data;
	console.m_system_rom_size = size;
	return loadSystemRomInternal(data, size);
}

bool RomBootManager::loadSystemRomOwned(std::vector<u8>&& data) {
	ConsoleCore& console = m_console;
	console.m_system_rom_owned = std::move(data);
	console.m_system_rom_data = console.m_system_rom_owned.data();
	console.m_system_rom_size = console.m_system_rom_owned.size();
	return loadSystemRomInternal(console.m_system_rom_data, console.m_system_rom_size);
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
	ConsoleCore& console = m_console;
	unloadRom();
	console.m_cart_rom_owned.clear();
	console.m_cart_rom_data = data;
	console.m_cart_rom_size = size;
	return loadRomInternal(data, size);
}

bool RomBootManager::loadRomOwned(std::vector<u8>&& data) {
	ConsoleCore& console = m_console;
	unloadRom();
	console.m_cart_rom_owned = std::move(data);
	console.m_cart_rom_data = console.m_cart_rom_owned.data();
	console.m_cart_rom_size = console.m_cart_rom_owned.size();
	return loadRomInternal(console.m_cart_rom_data, console.m_cart_rom_size);
}

void RomBootManager::unloadRom() {
	ConsoleCore& console = m_console;
	if (console.m_rom_loaded) {
		console.m_active_rom = &console.m_system_rom;
		console.m_machine_manifest = &console.m_system_rom.machine;
		console.m_cart_rom.clear();
		console.m_linked_program.reset();
		console.m_linked_program_symbols.reset();
		console.m_cart_rom_owned.clear();
		console.m_cart_rom_data = nullptr;
		console.m_cart_rom_size = 0;
		if (console.m_texture_manager) {
			console.m_texture_manager->clear();
		}
		console.m_sound_master->resetPlaybackState();
		console.registry().clear();
		console.m_rom_loaded = false;
		console.m_loaded_cart_has_program = false;
	}
}

bool RomBootManager::bootLoadedCart() {
	ConsoleCore& console = m_console;
	if (!console.m_rom_loaded) {
		return false;
	}

	if (console.m_cart_rom_size == 0) {
		return false;
	}
	activateCartRom();
	setMachineManifest(console.m_cart_rom.machine);

	if (!console.activeRom().programImage || !console.activeRom().programImage->program) {
		std::cerr << "[RomBootManager] Loaded cart has no program image." << std::endl;
		return false;
	}

	const ResolvedRuntimeTiming timing = resolveRuntimeTiming(console.activeRom().machine);
	applyManifestMemorySpecs(console.activeRom().machine, console.m_system_rom.machine, resolveSystemSlotBytes(console.m_system_rom));
	configureViewForMachine(console.activeRom().machine);

	Runtime& runtime = prepareRuntimeForActiveCart(timing, console.m_cart_rom.machine);
	configureVdpSlots(runtime, console.m_system_rom, console.activeRom());
	runtime.resetRuntimeForProgramReload();
	console.refreshRenderSurfaces();
	bootRuntimeFromProgram();
	return true;
}

bool RomBootManager::rebootLoadedRom() {
	ConsoleCore& console = m_console;
	if (!console.m_rom_loaded) {
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

	const MachineManifest* runtimeMachine = &console.m_system_rom.machine;
	if (console.m_cart_rom_size > 0 && console.m_cart_rom.programImage && console.m_cart_rom.programImage->program) {
		runtimeMachine = &console.m_cart_rom.machine;
	}
	return bootSystemStartupProgram(*runtimeMachine);
}

bool RomBootManager::bootWithoutCart() {
	ConsoleCore& console = m_console;
	if (!console.m_system_rom_loaded) {
		throw std::runtime_error("[BMSX] bootWithoutCart: system ROM not loaded");
	}

	if (!console.m_system_rom.hasProgram()) {
		throw std::runtime_error("[BMSX] bootWithoutCart: no program in system ROM");
	}

	std::cout << "[BMSX] bootWithoutCart: program found, booting..." << std::endl;
	if (!bootSystemStartupProgram(console.m_system_rom.machine)) {
		return false;
	}

	console.m_rom_loaded = true;
	console.start();
	return true;
}

} // namespace bmsx
