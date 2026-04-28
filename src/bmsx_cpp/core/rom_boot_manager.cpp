#include "core/rom_boot_manager.h"

#include "core/engine.h"
#include "core/system.h"
#include "machine/runtime/runtime.h"
#include "machine/memory/asset_memory.h"
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

void RomBootManager::activateEngineAssets() {
	EngineCore& engine = EngineCore::instance();
	engine.m_active_assets = &engine.m_engine_assets;
}

void RomBootManager::activateCartAssets() {
	EngineCore& engine = EngineCore::instance();
	engine.m_active_assets = &engine.m_cart_assets;
}

void RomBootManager::setMachineManifest(const MachineManifest& manifest) {
	EngineCore& engine = EngineCore::instance();
	engine.m_machine_manifest = &manifest;
}

void RomBootManager::configureViewForMachine(const MachineManifest& manifest) {
	EngineCore& engine = EngineCore::instance();
	Vec2 viewportSize{
		static_cast<f32>(manifest.viewportWidth),
		static_cast<f32>(manifest.viewportHeight)
	};
	Vec2 offscreenSize{
		viewportSize.x * 2.0f,
		viewportSize.y * 2.0f
	};
	engine.m_view->configureRenderTargets(&viewportSize, &viewportSize, &offscreenSize, &engine.m_viewport_scale, &engine.m_canvas_scale);
}

bool RomBootManager::loadEngineAssetsInternal(const u8* data, size_t size) {
	EngineCore& engine = EngineCore::instance();
	engine.m_engine_assets.clear();
	if (engine.m_texture_manager) {
		engine.m_texture_manager->setBackend(engine.m_view ? engine.m_view->backend() : nullptr);
	}

	if (!loadSystemAssetsFromRom(data, size, engine.m_engine_assets, nullptr, "system")) {
		return false;
	}

	engine.m_engine_assets_loaded = true;
	engine.m_engine_assets.machine = defaultSystemMachineManifest();
	engine.m_engine_assets.entryPoint = systemBootEntryPath();
	engine.m_active_assets = &engine.m_engine_assets;
	engine.m_machine_manifest = &engine.m_engine_assets.machine;
	engine.m_default_font = std::make_unique<Font>(engine.m_engine_assets);
	engine.m_view->default_font = engine.m_default_font.get();
	return true;
}

Runtime& RomBootManager::prepareRuntimeForActiveCart(const ResolvedRuntimeTiming& timing, const MachineManifest& machine) {
	EngineCore& engine = EngineCore::instance();
	if (!Runtime::hasInstance()) {
		Runtime::createInstance(RuntimeOptions{
			1,
			{ timing.viewportWidth, timing.viewportHeight },
			&engine.m_engine_assets,
			&engine.m_cart_assets,
			&engine.m_cart_assets,
			{ engine.m_engine_rom_data, engine.m_engine_rom_size },
			{ engine.m_cart_rom_data, engine.m_cart_rom_size },
			&machine,
			timing.ufpsScaled,
			timing.cpuHz,
			timing.cycleBudgetPerFrame,
			timing.vblankCycles,
			timing.vdpWorkUnitsPerSec,
			timing.geoWorkUnitsPerSec,
		});
	}
	Runtime& runtime = Runtime::instance();
	runtime.setRuntimeEnvironment(
		engine.m_engine_assets,
		engine.assets(),
		engine.assets().machine,
		&engine.m_cart_assets,
		{ engine.m_engine_rom_data, engine.m_engine_rom_size },
		{ engine.m_cart_rom_data, engine.m_cart_rom_size }
	);
	applyRuntimeTiming(runtime, timing);
	runtime.refreshMemoryMap();
	return runtime;
}

void RomBootManager::bootRuntimeFromProgram() {
	EngineCore& engine = EngineCore::instance();
	if (!engine.assets().programAsset || !engine.assets().programAsset->program) {
		return;
	}
	engine.m_linked_program.reset();
	engine.m_linked_program_symbols.reset();
	RuntimeAssets& activeAssets = engine.assets();
	const ResolvedRuntimeTiming timing = resolveRuntimeTiming(activeAssets.machine);
	if (!Runtime::hasInstance()) {
		Runtime::createInstance(RuntimeOptions{
			1,
			{ timing.viewportWidth, timing.viewportHeight },
			&engine.m_engine_assets,
			&activeAssets,
			engine.m_cart_rom_size > 0 ? &engine.m_cart_assets : nullptr,
			{ engine.m_engine_rom_data, engine.m_engine_rom_size },
			{ engine.m_cart_rom_data, engine.m_cart_rom_size },
			&activeAssets.machine,
			timing.ufpsScaled,
			timing.cpuHz,
			timing.cycleBudgetPerFrame,
			timing.vblankCycles,
			timing.vdpWorkUnitsPerSec,
			timing.geoWorkUnitsPerSec,
		});
	}
	Runtime& runtime = Runtime::instance();
	runtime.setRuntimeEnvironment(
		engine.m_engine_assets,
		activeAssets,
		activeAssets.machine,
		engine.m_cart_rom_size > 0 ? &engine.m_cart_assets : nullptr,
		{ engine.m_engine_rom_data, engine.m_engine_rom_size },
		{ engine.m_cart_rom_data, engine.m_cart_rom_size }
	);
	applyRuntimeTiming(runtime, timing);
	runtime.refreshMemoryMap();
	runtime.setProgramSource(Runtime::ProgramSource::Cart);
	runtime.resetRuntimeForProgramReload();
	engine.refreshRenderAssets();
	if (engine.m_engine_assets_loaded && engine.m_engine_assets.programAsset && engine.m_engine_assets.programAsset->program) {
		auto linked = linkProgramAssets(
			*engine.m_engine_assets.programAsset,
			engine.m_engine_assets.programSymbols.get(),
			*activeAssets.programAsset,
			activeAssets.programSymbols.get()
		);
		engine.m_linked_program = std::move(linked.program);
		engine.m_linked_program_symbols = std::move(linked.metadata);
		runtime.boot(*engine.m_linked_program, engine.m_linked_program_symbols.get());
		return;
	}
	runtime.boot(*activeAssets.programAsset, activeAssets.programSymbols.get());
}

bool RomBootManager::bootEngineStartupProgram(const MachineManifest& runtimeMachine, const RuntimeAssets& sizingAssets) {
	EngineCore& engine = EngineCore::instance();
	if (!engine.m_engine_assets_loaded) {
		return false;
	}
	if (!engine.m_engine_assets.programAsset || !engine.m_engine_assets.programAsset->program) {
		return false;
	}

	activateEngineAssets();
	setMachineManifest(runtimeMachine);
	const ResolvedRuntimeTiming timing = resolveRuntimeTiming(runtimeMachine);
	applyManifestMemorySpecs(runtimeMachine, engine.m_engine_assets.machine, sizingAssets, engine.m_engine_assets);
	configureViewForMachine(runtimeMachine);

	if (!Runtime::hasInstance()) {
		Runtime::createInstance(RuntimeOptions{
			1,
			{ timing.viewportWidth, timing.viewportHeight },
			&engine.m_engine_assets,
			&engine.m_engine_assets,
			engine.m_cart_rom_size > 0 ? &engine.m_cart_assets : nullptr,
			{ engine.m_engine_rom_data, engine.m_engine_rom_size },
			{ engine.m_cart_rom_data, engine.m_cart_rom_size },
			&runtimeMachine,
			timing.ufpsScaled,
			timing.cpuHz,
			timing.cycleBudgetPerFrame,
			timing.vblankCycles,
			timing.vdpWorkUnitsPerSec,
			timing.geoWorkUnitsPerSec,
		});
	}
	Runtime& runtime = Runtime::instance();
	runtime.setRuntimeEnvironment(
		engine.m_engine_assets,
		engine.m_engine_assets,
		runtimeMachine,
		engine.m_cart_rom_size > 0 ? &engine.m_cart_assets : nullptr,
		{ engine.m_engine_rom_data, engine.m_engine_rom_size },
		{ engine.m_cart_rom_data, engine.m_cart_rom_size }
	);
	applyRuntimeTiming(runtime, timing);
	runtime.refreshMemoryMap();
	runtime.setProgramSource(Runtime::ProgramSource::Engine);
	buildAssetMemory(runtime, engine.m_engine_assets, engine.m_engine_assets);
	runtime.machine().memory().sealEngineAssets();
	runtime.resetRuntimeForProgramReload();
	engine.refreshRenderAssets();
	runtime.boot(*engine.m_engine_assets.programAsset, engine.m_engine_assets.programSymbols.get());
	runtime.cartBoot.reset();
	return true;
}

bool RomBootManager::loadRomInternal(const u8* data, size_t size) {
	EngineCore& engine = EngineCore::instance();
	if (engine.m_texture_manager) {
		engine.m_texture_manager->setBackend(engine.m_view ? engine.m_view->backend() : nullptr);
	}

	engine.m_cart_assets.clear();
	if (!loadCartAssetsFromRom(data, size, engine.m_cart_assets, nullptr, "cart")) {
		return false;
	}
	engine.m_loaded_cart_has_program = engine.m_cart_assets.programAsset && engine.m_cart_assets.programAsset->program;

	const MachineManifest& cartMachine = engine.m_cart_assets.machine;
	const i64 cartUfpsScaled = resolveUfpsScaled(cartMachine);
	i64 cpuHz = 0;
	const bool cartCpuValid = tryResolveCpuHz(cartMachine, cpuHz);
	i64 runtimeUfpsScaled = cartUfpsScaled;
	if (!cartCpuValid) {
		i64 engineUfpsScaled = 0;
		i64 engineCpuHz = 0;
		if (!engine.m_engine_assets_loaded
			|| !tryResolveCpuHz(engine.m_engine_assets.machine, engineCpuHz)
			|| !tryResolveUfpsScaled(engine.m_engine_assets.machine, engineUfpsScaled)) {
			throw std::runtime_error("[EngineCore] machine.specs.cpu.cpu_freq_hz is required.");
		}
		std::cerr << "[EngineCore] Cart manifest machine.specs.cpu.cpu_freq_hz is required; booting BIOS only." << std::endl;
		cpuHz = engineCpuHz;
		runtimeUfpsScaled = engineUfpsScaled;
	}
	const MachineManifest& transferMachine = cartCpuValid ? cartMachine : engine.m_engine_assets.machine;

	configureViewForMachine(cartMachine);

	const bool hasEngineProgram = engine.m_engine_assets_loaded
		&& engine.m_engine_assets.programAsset
		&& engine.m_engine_assets.programAsset->program;
	if (hasEngineProgram) {
		if (!bootEngineStartupProgram(transferMachine, engine.m_cart_assets)) {
			return false;
		}
	} else {
		if (!cartCpuValid) {
			std::cerr << "[EngineCore] Cart manifest machine.specs.cpu.cpu_freq_hz is required; cannot boot cart without BIOS." << std::endl;
			return false;
		}
		activateCartAssets();
		setMachineManifest(cartMachine);
		applyManifestMemorySpecs(engine.assets().machine, engine.m_engine_assets.machine, engine.assets(), engine.m_engine_assets);
		const ResolvedRuntimeTiming timing = resolveRuntimeTiming(engine.assets().machine, transferMachine, cpuHz, runtimeUfpsScaled);
		Runtime& runtime = prepareRuntimeForActiveCart(timing, cartMachine);
		buildAssetMemory(runtime, engine.m_engine_assets, engine.assets());
		if (engine.assets().hasProgram()) {
			bootRuntimeFromProgram();
		}
	}

	engine.m_rom_loaded = true;
	return true;
}

bool RomBootManager::loadEngineAssets(const u8* data, size_t size) {
	EngineCore& engine = EngineCore::instance();
	engine.m_engine_rom_owned.clear();
	engine.m_engine_rom_data = data;
	engine.m_engine_rom_size = size;
	return loadEngineAssetsInternal(data, size);
}

bool RomBootManager::loadEngineAssetsOwned(std::vector<u8>&& data) {
	EngineCore& engine = EngineCore::instance();
	engine.m_engine_rom_owned = std::move(data);
	engine.m_engine_rom_data = engine.m_engine_rom_owned.data();
	engine.m_engine_rom_size = engine.m_engine_rom_owned.size();
	return loadEngineAssetsInternal(engine.m_engine_rom_data, engine.m_engine_rom_size);
}

bool RomBootManager::loadEngineAssetsFromPath(const char* path) {
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

	return loadEngineAssetsOwned(std::move(data));
}

bool RomBootManager::loadRom(const u8* data, size_t size) {
	EngineCore& engine = EngineCore::instance();
	unloadRom();
	engine.m_cart_rom_owned.clear();
	engine.m_cart_rom_data = data;
	engine.m_cart_rom_size = size;
	return loadRomInternal(data, size);
}

bool RomBootManager::loadRomOwned(std::vector<u8>&& data) {
	EngineCore& engine = EngineCore::instance();
	unloadRom();
	engine.m_cart_rom_owned = std::move(data);
	engine.m_cart_rom_data = engine.m_cart_rom_owned.data();
	engine.m_cart_rom_size = engine.m_cart_rom_owned.size();
	return loadRomInternal(engine.m_cart_rom_data, engine.m_cart_rom_size);
}

void RomBootManager::unloadRom() {
	EngineCore& engine = EngineCore::instance();
	if (engine.m_rom_loaded) {
		engine.m_active_assets = &engine.m_engine_assets;
		engine.m_machine_manifest = &engine.m_engine_assets.machine;
		engine.m_cart_assets.clear();
		engine.m_linked_program.reset();
		engine.m_linked_program_symbols.reset();
		engine.m_cart_rom_owned.clear();
		engine.m_cart_rom_data = nullptr;
		engine.m_cart_rom_size = 0;
		if (engine.m_texture_manager) {
			engine.m_texture_manager->clear();
		}
		engine.m_sound_master->resetPlaybackState();
		engine.registry().clear();
		engine.m_rom_loaded = false;
		engine.m_loaded_cart_has_program = false;
	}
}

bool RomBootManager::bootLoadedCart() {
	EngineCore& engine = EngineCore::instance();
	if (!engine.m_rom_loaded) {
		return false;
	}

	if (engine.m_cart_rom_size == 0) {
		return false;
	}
	activateCartAssets();
	setMachineManifest(engine.m_cart_assets.machine);

	if (!engine.assets().programAsset || !engine.assets().programAsset->program) {
		std::cerr << "[EngineCore] Loaded cart has no program asset." << std::endl;
		return false;
	}

	const ResolvedRuntimeTiming timing = resolveRuntimeTiming(engine.assets().machine);
	applyManifestMemorySpecs(engine.assets().machine, engine.m_engine_assets.machine, engine.assets(), engine.m_engine_assets);
	configureViewForMachine(engine.assets().machine);

	Runtime& runtime = prepareRuntimeForActiveCart(timing, engine.m_cart_assets.machine);
	buildAssetMemory(runtime, engine.m_engine_assets, engine.assets(), RuntimeAssetBuildMode::Cart);
	runtime.resetRuntimeForProgramReload();
	engine.refreshRenderAssets();
	bootRuntimeFromProgram();
	return true;
}

bool RomBootManager::rebootLoadedRom() {
	EngineCore& engine = EngineCore::instance();
	if (!engine.m_rom_loaded) {
		return false;
	}

	if (engine.m_sound_master) {
		engine.m_sound_master->resetPlaybackState();
	}
	if (engine.m_texture_manager) {
		engine.m_texture_manager->clear();
	}
	if (engine.m_view) {
		engine.m_view->reset();
		if (engine.m_view->backend()->readyForTextureUpload()) {
			engine.m_view->initializeDefaultTextures();
		}
	}

	const MachineManifest* runtimeMachine = &engine.m_engine_assets.machine;
	const RuntimeAssets* sizingAssets = &engine.m_engine_assets;
	if (engine.m_cart_rom_size > 0 && engine.m_cart_assets.programAsset && engine.m_cart_assets.programAsset->program) {
		runtimeMachine = &engine.m_cart_assets.machine;
		sizingAssets = &engine.m_cart_assets;
	}
	return bootEngineStartupProgram(*runtimeMachine, *sizingAssets);
}

bool RomBootManager::bootWithoutCart() {
	EngineCore& engine = EngineCore::instance();
	if (!engine.m_engine_assets_loaded) {
		throw std::runtime_error("[BMSX] bootWithoutCart: engine assets not loaded");
	}

	if (!engine.m_engine_assets.hasProgram()) {
		throw std::runtime_error("[BMSX] bootWithoutCart: no program in engine assets");
	}

	std::cout << "[BMSX] bootWithoutCart: program found, booting..." << std::endl;
	if (!bootEngineStartupProgram(engine.m_engine_assets.machine, engine.m_engine_assets)) {
		return false;
	}

	engine.m_rom_loaded = true;
	engine.start();
	return true;
}

} // namespace bmsx
