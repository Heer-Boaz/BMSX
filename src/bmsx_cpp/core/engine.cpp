/*
 * engine.cpp - Core engine implementation
 */

#include "engine.h"
#include "system.h"
#include "input/manager.h"
#include "audio/resources.h"
#include "render/texture_manager.h"
#include "../machine/runtime/runtime.h"
#include "../machine/memory/asset_memory.h"
#include "../machine/specs.h"
#include "../machine/memory/specs.h"
#include "../machine/runtime/boot_timing.h"
#include "../machine/program/linker.h"
#include "../machine/firmware/font.h"
#include "rompack/format.h"
#include <cstdio>
#include <cstdlib>
#include <chrono>
#include <cstdarg>
#include <fstream>
#include <iostream>
#include <vector>
#include <stdexcept>

namespace bmsx {

EngineCore* EngineCore::s_instance = nullptr;

EngineCore::EngineCore() {
	s_instance = this;
	m_active_assets = &m_engine_assets;
	m_machine_manifest = &m_engine_assets.machine;
}

EngineCore::~EngineCore() {
	shutdown();
	if (s_instance == this) {
		s_instance = nullptr;
	}
}

EngineCore& EngineCore::instance() {
	return *s_instance;
}

EngineCore* EngineCore::instancePtr() {
	return s_instance;
}

bool EngineCore::initialize(Platform* platform) {
	if (m_state != EngineState::Uninitialized) {
		return false;
	}

	m_platform = platform;

	// Get viewport size from platform
	auto* host = platform->gameviewHost();
	const MachineManifest& systemMachine = defaultSystemMachineManifest();
	Vec2 defaultViewport{
		static_cast<f32>(systemMachine.viewportWidth),
		static_cast<f32>(systemMachine.viewportHeight)
	};
	ViewportDimensions dims = host->getSize(defaultViewport, defaultViewport * 2.0f);

	// Create GameView with logical viewport
	m_view = std::make_unique<GameView>(host, static_cast<i32>(defaultViewport.x), static_cast<i32>(defaultViewport.y));
	m_view->viewportScale = dims.viewportScale;
	m_view->canvasScale = dims.canvasScale;
	m_viewport_scale = dims.viewportScale;
	m_canvas_scale = dims.canvasScale;

	// Subscribe to resize events
	m_resize_sub = host->onResize([this](const ViewportDimensions& dims) {
		m_viewport_scale = dims.viewportScale;
		m_canvas_scale = dims.canvasScale;
		if (m_view) {
			m_view->configureRenderTargets(nullptr, nullptr, nullptr, &m_viewport_scale, &m_canvas_scale);
		}
	});

	// Get backend from platform (SoftwareBackend for libretro)
	if (host) {
		auto backend = host->createBackend();
		if (backend) {
			m_view->setBackend(std::move(backend));
		}
	}
	m_view->bind();

	// Update view with initial size (after backend is set)
	m_view->configureRenderTargets(nullptr, nullptr, nullptr, &m_viewport_scale, &m_canvas_scale);

	m_texture_manager = std::make_unique<TextureManager>(m_view->backend());
	m_texture_manager->bind();
	if (m_view->backend()->readyForTextureUpload()) {
		m_view->initializeDefaultTextures();
	}

	Input::instance().initialize();
	m_sound_master = std::make_unique<SoundMaster>();
	registry().registerObject(m_sound_master.get());

	m_state = EngineState::Initialized;
	return true;
}

void EngineCore::shutdown() {
	if (m_state == EngineState::Uninitialized) {
		return;
	}

	stop();
	unloadRom();

	if (m_texture_manager) {
		m_texture_manager->dispose();
		m_texture_manager.reset();
	}

	// Dispose view
	if (m_view) {
		m_view->dispose();
		m_view.reset();
	}

	// Clear registry (keeps persistent objects)
	m_sound_master->dispose();
	registry().deregister(m_sound_master.get(), true);
	m_sound_master.reset();
	registry().clear();

	m_platform = nullptr;
	m_state = EngineState::Uninitialized;
}

void EngineCore::start() {
	if (m_state == EngineState::Initialized || m_state == EngineState::Stopped) {
		m_state = EngineState::Running;
		if (Runtime::hasInstance()) {
			Runtime::instance().frameScheduler.clearQueuedTime();
		}
	}
}

void EngineCore::pause() {
	if (m_state == EngineState::Running) {
		m_state = EngineState::Paused;
		if (Runtime::hasInstance()) {
			Runtime::instance().screen.clearPresentation();
		}
	}
}

void EngineCore::resume() {
	if (m_state == EngineState::Paused) {
		m_state = EngineState::Running;
		if (Runtime::hasInstance()) {
			Runtime::instance().frameScheduler.clearQueuedTime();
		}
	}
}

void EngineCore::stop() {
	if (m_state == EngineState::Running || m_state == EngineState::Paused) {
		m_state = EngineState::Stopped;
	}
}

void EngineCore::refreshRenderAssets() {
	if (m_texture_manager) {
		m_texture_manager->setBackend(m_view ? m_view->backend() : nullptr);
	}
	if (!m_view || !m_view->backend() || !m_texture_manager) {
		return;
	}
	auto* backend = m_view->backend();
	if (!backend->readyForTextureUpload()) {
		return;
	}
	m_view->initializeDefaultTextures();
	if (Runtime::hasInstance()) {
		Runtime::instance().machine().vdp().restoreVramSlotTextures();
	}
}

void EngineCore::log(LogLevel level, const char* fmt, ...) {
	va_list args;
	va_start(args, fmt);
	va_list args_copy;
	va_copy(args_copy, args);

	char stack_buffer[2048];
	const int written = vsnprintf(stack_buffer, sizeof(stack_buffer), fmt, args);
	va_end(args);

	if (written >= 0 && static_cast<size_t>(written) < sizeof(stack_buffer)) {
		va_end(args_copy);
		m_platform->log(level, std::string_view(stack_buffer, static_cast<size_t>(written)));
		return;
	}

	std::string message;
	if (written < 0) {
		message = "EngineCore::log: formatting error";
	} else {
		message.resize(static_cast<size_t>(written) + 1);
		vsnprintf(message.data(), message.size(), fmt, args_copy);
		message.resize(static_cast<size_t>(written));
	}
	va_end(args_copy);
	m_platform->log(level, message);
}

bool EngineCore::loadEngineAssets(const u8* data, size_t size) {
	m_engine_rom_owned.clear();
	m_engine_rom_data = data;
	m_engine_rom_size = size;
	return loadEngineAssetsInternal(data, size);
}

bool EngineCore::loadEngineAssetsOwned(std::vector<u8>&& data) {
	m_engine_rom_owned = std::move(data);
	m_engine_rom_data = m_engine_rom_owned.data();
	m_engine_rom_size = m_engine_rom_owned.size();
	return loadEngineAssetsInternal(m_engine_rom_data, m_engine_rom_size);
}

bool EngineCore::loadEngineAssetsInternal(const u8* data, size_t size) {
	m_engine_assets.clear();
	if (m_texture_manager) {
		m_texture_manager->setBackend(m_view ? m_view->backend() : nullptr);
	}

	if (!loadSystemAssetsFromRom(data, size, m_engine_assets, nullptr, "system")) {
		return false;
	}

	m_engine_assets_loaded = true;
	m_engine_assets.machine = defaultSystemMachineManifest();
	m_engine_assets.entryPoint = systemBootEntryPath();
	m_active_assets = &m_engine_assets;
	m_machine_manifest = &m_engine_assets.machine;
	m_default_font = std::make_unique<Font>(m_engine_assets);
	m_view->default_font = m_default_font.get();
	return true;
}

bool EngineCore::loadEngineAssetsFromPath(const char* path) {
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

ImgAsset* EngineCore::resolveImgAsset(const AssetId& id) {
	ImgAsset* asset = assets().getImg(id);
	if (asset) {
		return asset;
	}
	return m_engine_assets.getImg(id);
}

const ImgAsset* EngineCore::resolveImgAsset(const AssetId& id) const {
	const ImgAsset* asset = assets().getImg(id);
	if (asset) {
		return asset;
	}
	return m_engine_assets.getImg(id);
}

void EngineCore::activateEngineAssets() {
	m_active_assets = &m_engine_assets;
}

void EngineCore::activateCartAssets() {
	m_active_assets = &m_cart_assets;
}

void EngineCore::setMachineManifest(const MachineManifest& manifest) {
	m_machine_manifest = &manifest;
}

void EngineCore::configureViewForMachine(const MachineManifest& manifest) {
	Vec2 viewportSize{
		static_cast<f32>(manifest.viewportWidth),
		static_cast<f32>(manifest.viewportHeight)
	};
	Vec2 offscreenSize{
		viewportSize.x * 2.0f,
		viewportSize.y * 2.0f
	};
	m_view->configureRenderTargets(&viewportSize, &viewportSize, &offscreenSize, &m_viewport_scale, &m_canvas_scale);
}

bool EngineCore::bootEngineStartupProgram(const MachineManifest& runtimeMachine, const RuntimeAssets& sizingAssets) {
	if (!m_engine_assets_loaded) {
		return false;
	}
	if (!m_engine_assets.programAsset || !m_engine_assets.programAsset->program) {
		return false;
	}

	activateEngineAssets();
	setMachineManifest(runtimeMachine);
	const ResolvedRuntimeTiming timing = resolveRuntimeTiming(runtimeMachine);
	applyManifestMemorySpecs(runtimeMachine, m_engine_assets.machine, sizingAssets, m_engine_assets);
	configureViewForMachine(runtimeMachine);

	if (!Runtime::hasInstance()) {
		Runtime::createInstance(RuntimeOptions{
			1,
			{ timing.viewportWidth, timing.viewportHeight },
			timing.ufpsScaled,
			timing.cpuHz,
			timing.cycleBudgetPerFrame,
			timing.vblankCycles,
			timing.vdpWorkUnitsPerSec,
			timing.geoWorkUnitsPerSec,
		});
	}
	Runtime& runtime = Runtime::instance();
	applyRuntimeTiming(runtime, timing);
	runtime.refreshMemoryMap();
	runtime.setProgramSource(Runtime::ProgramSource::Engine);
	buildAssetMemory(runtime, m_engine_assets, true);
	runtime.machine().memory().sealEngineAssets();
	refreshAudioResources(*m_sound_master, runtime, m_engine_assets, runtimeMachine, m_engine_rom_data, m_cart_rom_data);
	runtime.resetRuntimeForProgramReload();
	runtime.boot(*m_engine_assets.programAsset, m_engine_assets.programSymbols.get());
	runtime.cartBoot.reset(runtime);
	return true;
}

bool EngineCore::bootWithoutCart() {
	// Boot engine with only engine assets (no cartridge)
	// This runs bootrom.lua which displays the boot screen

	if (!m_engine_assets_loaded) {
		std::cerr << "[BMSX] bootWithoutCart: engine assets not loaded" << std::endl;
		return false;
	}

	// Check if engine assets have a program
	if (!m_engine_assets.hasProgram()) {
		std::cerr << "[BMSX] bootWithoutCart: no program in engine assets" << std::endl;
		return false;
	}

	std::cerr << "[BMSX] bootWithoutCart: program found, booting..." << std::endl;
	if (!bootEngineStartupProgram(m_engine_assets.machine, m_engine_assets)) {
		return false;
	}

	m_rom_loaded = true;  // Engine is running (with system program)
	start();  // Start the engine tick/render loop
	return true;
}

bool EngineCore::loadRom(const u8* data, size_t size) {
	unloadRom();
	m_cart_rom_owned.clear();
	m_cart_rom_data = data;
	m_cart_rom_size = size;
	return loadRomInternal(data, size);
}

bool EngineCore::loadRomOwned(std::vector<u8>&& data) {
	unloadRom();
	m_cart_rom_owned = std::move(data);
	m_cart_rom_data = m_cart_rom_owned.data();
	m_cart_rom_size = m_cart_rom_owned.size();
	return loadRomInternal(m_cart_rom_data, m_cart_rom_size);
}

bool EngineCore::loadRomInternal(const u8* data, size_t size) {
	if (m_texture_manager) {
		m_texture_manager->setBackend(m_view ? m_view->backend() : nullptr);
	}

	m_cart_assets.clear();
	if (!loadCartAssetsFromRom(data, size, m_cart_assets, nullptr, "cart")) {
		return false;
	}
	m_loaded_cart_has_program = m_cart_assets.programAsset && m_cart_assets.programAsset->program;

	const MachineManifest& cartMachine = m_cart_assets.machine;
	const i64 cartUfpsScaled = resolveUfpsScaled(cartMachine);
	i64 cpuHz = 0;
	const bool cartCpuValid = tryResolveCpuHz(cartMachine, cpuHz);
	i64 runtimeUfpsScaled = cartUfpsScaled;
	if (!cartCpuValid) {
		i64 engineUfpsScaled = 0;
		i64 engineCpuHz = 0;
		if (!m_engine_assets_loaded
			|| !tryResolveCpuHz(m_engine_assets.machine, engineCpuHz)
			|| !tryResolveUfpsScaled(m_engine_assets.machine, engineUfpsScaled)) {
			throw std::runtime_error("[EngineCore] machine.specs.cpu.cpu_freq_hz is required.");
		}
		std::cerr << "[EngineCore] Cart manifest machine.specs.cpu.cpu_freq_hz is required; booting BIOS only." << std::endl;
		cpuHz = engineCpuHz;
		runtimeUfpsScaled = engineUfpsScaled;
	}
	const MachineManifest& transferMachine = cartCpuValid ? cartMachine : m_engine_assets.machine;

	configureViewForMachine(cartMachine);

	const bool hasEngineProgram = m_engine_assets_loaded
		&& m_engine_assets.programAsset
		&& m_engine_assets.programAsset->program;
	if (hasEngineProgram) {
		if (!bootEngineStartupProgram(transferMachine, m_cart_assets)) {
			return false;
		}
	} else {
		if (!cartCpuValid) {
			std::cerr << "[EngineCore] Cart manifest machine.specs.cpu.cpu_freq_hz is required; cannot boot cart without BIOS." << std::endl;
			return false;
		}
		activateCartAssets();
		setMachineManifest(cartMachine);
		applyManifestMemorySpecs(assets().machine, m_engine_assets.machine, assets(), m_engine_assets);
		const ResolvedRuntimeTiming timing = resolveRuntimeTiming(assets().machine, transferMachine, cpuHz, runtimeUfpsScaled);
			if (!Runtime::hasInstance()) {
				Runtime::createInstance(RuntimeOptions{
					1,
					{ timing.viewportWidth, timing.viewportHeight },
					timing.ufpsScaled,
					timing.cpuHz,
					timing.cycleBudgetPerFrame,
					timing.vblankCycles,
					timing.vdpWorkUnitsPerSec,
					timing.geoWorkUnitsPerSec,
				});
			}
			Runtime& runtime = Runtime::instance();
		applyRuntimeTiming(runtime, timing);
		runtime.refreshMemoryMap();
		buildAssetMemory(runtime, assets(), false);
		refreshAudioResources(*m_sound_master, runtime, assets(), assets().machine, m_engine_rom_data, m_cart_rom_data);
		if (assets().hasProgram()) {
			bootRuntimeFromProgram();
		}
	}

	m_rom_loaded = true;
	return true;
}

bool EngineCore::bootLoadedCart() {
	if (!m_rom_loaded) {
		return false;
	}

	if (m_cart_rom_size == 0) {
		return false;
	}
	activateCartAssets();
	setMachineManifest(m_cart_assets.machine);

	if (!assets().programAsset || !assets().programAsset->program) {
		std::cerr << "[EngineCore] Loaded cart has no program asset." << std::endl;
		return false;
	}

	const ResolvedRuntimeTiming timing = resolveRuntimeTiming(assets().machine);
	applyManifestMemorySpecs(assets().machine, m_engine_assets.machine, assets(), m_engine_assets);
	configureViewForMachine(assets().machine);

		if (!Runtime::hasInstance()) {
			Runtime::createInstance(RuntimeOptions{
				1,
				{ timing.viewportWidth, timing.viewportHeight },
				timing.ufpsScaled,
				timing.cpuHz,
				timing.cycleBudgetPerFrame,
				timing.vblankCycles,
				timing.vdpWorkUnitsPerSec,
				timing.geoWorkUnitsPerSec,
			});
		}
		Runtime& runtime = Runtime::instance();
	applyRuntimeTiming(runtime, timing);
	runtime.refreshMemoryMap();
	buildAssetMemory(runtime, assets(), false, RuntimeAssetBuildMode::Cart);
	runtime.resetRuntimeForProgramReload();
	refreshAudioResources(*m_sound_master, runtime, assets(), assets().machine, m_engine_rom_data, m_cart_rom_data);
	bootRuntimeFromProgram();
	return true;
}

bool EngineCore::rebootLoadedRom() {
	if (!m_rom_loaded) {
		return false;
	}

	if (m_sound_master) {
		m_sound_master->resetPlaybackState();
	}
	if (m_texture_manager) {
		m_texture_manager->clear();
	}
	if (m_view) {
		m_view->reset();
		if (m_view->backend()->readyForTextureUpload()) {
			m_view->initializeDefaultTextures();
		}
	}

	const MachineManifest* runtimeMachine = &m_engine_assets.machine;
	const RuntimeAssets* sizingAssets = &m_engine_assets;
	if (m_cart_rom_size > 0 && m_cart_assets.programAsset && m_cart_assets.programAsset->program) {
		runtimeMachine = &m_cart_assets.machine;
		sizingAssets = &m_cart_assets;
	}
	return bootEngineStartupProgram(*runtimeMachine, *sizingAssets);
}

void EngineCore::unloadRom() {
	if (m_rom_loaded) {
		m_active_assets = &m_engine_assets;
		m_machine_manifest = &m_engine_assets.machine;
		m_cart_assets.clear();
		m_linked_program.reset();
		m_linked_program_symbols.reset();
		m_cart_rom_owned.clear();
		m_cart_rom_data = nullptr;
		m_cart_rom_size = 0;
		if (m_texture_manager) {
			m_texture_manager->clear();
		}
		m_sound_master->resetPlaybackState();
		registry().clear();
		m_rom_loaded = false;
		m_loaded_cart_has_program = false;
	}
}

void EngineCore::bootRuntimeFromProgram() {
	// Get the pre-compiled program from assets
	if (!assets().programAsset || !assets().programAsset->program) {
		return;
	}
	m_linked_program.reset();
	m_linked_program_symbols.reset();
	const RuntimeAssets& activeAssets = assets();
	const ResolvedRuntimeTiming timing = resolveRuntimeTiming(activeAssets.machine);
		if (!Runtime::hasInstance()) {
			Runtime::createInstance(RuntimeOptions{
				1,
				{ timing.viewportWidth, timing.viewportHeight },
				timing.ufpsScaled,
				timing.cpuHz,
				timing.cycleBudgetPerFrame,
				timing.vblankCycles,
				timing.vdpWorkUnitsPerSec,
				timing.geoWorkUnitsPerSec,
			});
		}
		Runtime& runtime = Runtime::instance();
	applyRuntimeTiming(runtime, timing);
	runtime.refreshMemoryMap();
	runtime.setProgramSource(Runtime::ProgramSource::Cart);
	runtime.resetRuntimeForProgramReload();
	if (m_engine_assets_loaded && m_engine_assets.programAsset && m_engine_assets.programAsset->program) {
		auto linked = linkProgramAssets(
			*m_engine_assets.programAsset,
			m_engine_assets.programSymbols.get(),
			*activeAssets.programAsset,
			activeAssets.programSymbols.get()
		);
		m_linked_program = std::move(linked.program);
		m_linked_program_symbols = std::move(linked.metadata);
		runtime.boot(*m_linked_program, m_linked_program_symbols.get());
		return;
	}
	runtime.boot(*activeAssets.programAsset, activeAssets.programSymbols.get());
}

} // namespace bmsx
