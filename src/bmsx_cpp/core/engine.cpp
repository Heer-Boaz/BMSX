/*
 * engine.cpp - Core engine implementation
 */

#include "engine.h"
#include "system.h"
#include "input/manager.h"
#include "render/texture_manager.h"
#include "../machine/runtime/runtime.h"
#include "../machine/memory/asset_memory.h"
#include "../machine/specs.h"
#include "../machine/memory/specs.h"
#include "../machine/runtime/timing_config.h"
#include "../machine/program/linker.h"
#include "../machine/firmware/font.h"
#include "rompack/format.h"
#include "render/shared/queues.h"
#include <cstdio>
#include <cstdlib>
#include <chrono>
#include <cmath>
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
		Runtime::instance().restoreVramSlotTextures();
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

bool EngineCore::action_triggered(int playerIndex, const std::string& action) {
	return Input::instance().getPlayerInput(playerIndex)->checkActionTriggered(action);
}

void EngineCore::consume_action(int playerIndex, const std::string& action) {
	Input::instance().getPlayerInput(playerIndex)->consumeAction(action);
}

void EngineCore::set_skybox_imgs(const SkyboxImageIds& ids) {
	Runtime::instance().machine().vdp().setSkyboxImages(ids);
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
	const i64 ufpsScaled = resolveUfpsScaled(runtimeMachine);
	applyManifestMemorySpecs(runtimeMachine, m_engine_assets.machine, sizingAssets, m_engine_assets);
	configureViewForMachine(runtimeMachine);

	const i64 cpuHz = resolveCpuHz(runtimeMachine);
	const i64 imgDecBytesPerSec = resolveImgDecBytesPerSec(runtimeMachine);
	const i64 dmaBytesPerSecIso = resolveDmaBytesPerSecIso(runtimeMachine);
	const i64 dmaBytesPerSecBulk = resolveDmaBytesPerSecBulk(runtimeMachine);
	const int vdpWorkUnitsPerSec = static_cast<int>(resolveVdpWorkUnitsPerSec(runtimeMachine));
	const int geoWorkUnitsPerSec = static_cast<int>(resolveGeoWorkUnitsPerSec(runtimeMachine));
	const int cycleBudget = calcCyclesPerFrame(cpuHz, ufpsScaled);
	const i64 vblankCycles = resolveVblankCycles(cpuHz, ufpsScaled, runtimeMachine.viewportHeight);

	if (!Runtime::hasInstance()) {
		RuntimeOptions options;
		options.playerIndex = 1;
		options.viewport.x = runtimeMachine.viewportWidth;
		options.viewport.y = runtimeMachine.viewportHeight;
		options.canonicalization = m_engine_assets.machine.canonicalization;
		options.ufpsScaled = ufpsScaled;
		options.cpuHz = cpuHz;
		options.cycleBudgetPerFrame = cycleBudget;
		options.vblankCycles = static_cast<int>(vblankCycles);
		options.vdpWorkUnitsPerSec = vdpWorkUnitsPerSec;
		options.geoWorkUnitsPerSec = geoWorkUnitsPerSec;
		Runtime::createInstance(options);
	}

	Runtime& runtime = Runtime::instance();
	runtime.timing.applyUfpsScaled(ufpsScaled);
	setCpuHz(runtime, cpuHz);
	setCycleBudgetPerFrame(runtime, cycleBudget);
	runtime.vblank.setVblankCycles(runtime, static_cast<int>(vblankCycles));
	setTransferRatesFromManifest(runtime, { imgDecBytesPerSec, dmaBytesPerSecIso, dmaBytesPerSecBulk, vdpWorkUnitsPerSec, geoWorkUnitsPerSec });
	runtime.refreshMemoryMap();
	runtime.setProgramSource(Runtime::ProgramSource::Engine);
	runtime.setCanonicalization(m_engine_assets.machine.canonicalization);
	buildAssetMemory(runtime, m_engine_assets, true);
	runtime.machine().memory().sealEngineAssets();
	refreshAudioAssets(m_engine_assets);
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
	const int cycleBudget = calcCyclesPerFrame(cpuHz, runtimeUfpsScaled);
	const MachineManifest& transferMachine = cartCpuValid ? cartMachine : m_engine_assets.machine;
	const i64 vblankCycles = resolveVblankCycles(cpuHz, runtimeUfpsScaled, transferMachine.viewportHeight);
	const i64 imgDecBytesPerSec = resolveImgDecBytesPerSec(transferMachine);
	const i64 dmaBytesPerSecIso = resolveDmaBytesPerSecIso(transferMachine);
	const i64 dmaBytesPerSecBulk = resolveDmaBytesPerSecBulk(transferMachine);
	const int vdpWorkUnitsPerSec = static_cast<int>(resolveVdpWorkUnitsPerSec(transferMachine));
	const int geoWorkUnitsPerSec = static_cast<int>(resolveGeoWorkUnitsPerSec(transferMachine));

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
		// Boot the runtime if we have a pre-compiled program
		if (assets().hasProgram()) {
			if (!Runtime::hasInstance()) {
				RuntimeOptions options;
				options.playerIndex = 1;
				options.viewport.x = assets().machine.viewportWidth;
				options.viewport.y = assets().machine.viewportHeight;
				options.canonicalization = assets().machine.canonicalization;
				options.ufpsScaled = runtimeUfpsScaled;
				options.cpuHz = cpuHz;
				options.cycleBudgetPerFrame = cycleBudget;
				options.vblankCycles = static_cast<int>(vblankCycles);
				options.vdpWorkUnitsPerSec = vdpWorkUnitsPerSec;
				options.geoWorkUnitsPerSec = geoWorkUnitsPerSec;
				Runtime::createInstance(options);
			}
			Runtime& runtime = Runtime::instance();
			runtime.timing.applyUfpsScaled(runtimeUfpsScaled);
			setCpuHz(runtime, cpuHz);
			setCycleBudgetPerFrame(runtime, cycleBudget);
			runtime.vblank.setVblankCycles(runtime, static_cast<int>(vblankCycles));
			setTransferRatesFromManifest(runtime, { imgDecBytesPerSec, dmaBytesPerSecIso, dmaBytesPerSecBulk, vdpWorkUnitsPerSec, geoWorkUnitsPerSec });
			runtime.refreshMemoryMap();
			buildAssetMemory(runtime, assets(), false);
			refreshAudioAssets();
			bootRuntimeFromProgram();
		} else {
			if (!Runtime::hasInstance()) {
				RuntimeOptions options;
				options.playerIndex = 1;
				options.viewport.x = assets().machine.viewportWidth;
				options.viewport.y = assets().machine.viewportHeight;
				options.canonicalization = assets().machine.canonicalization;
				options.ufpsScaled = runtimeUfpsScaled;
				options.cpuHz = cpuHz;
				options.cycleBudgetPerFrame = cycleBudget;
				options.vblankCycles = static_cast<int>(vblankCycles);
				options.vdpWorkUnitsPerSec = vdpWorkUnitsPerSec;
				options.geoWorkUnitsPerSec = geoWorkUnitsPerSec;
				Runtime::createInstance(options);
			}
			Runtime& runtime = Runtime::instance();
			runtime.timing.applyUfpsScaled(runtimeUfpsScaled);
			setCpuHz(runtime, cpuHz);
			setCycleBudgetPerFrame(runtime, cycleBudget);
			runtime.vblank.setVblankCycles(runtime, static_cast<int>(vblankCycles));
			setTransferRatesFromManifest(runtime, { imgDecBytesPerSec, dmaBytesPerSecIso, dmaBytesPerSecBulk, vdpWorkUnitsPerSec, geoWorkUnitsPerSec });
			runtime.refreshMemoryMap();
			buildAssetMemory(runtime, assets(), false);
			refreshAudioAssets();
		}
	}

	m_rom_loaded = true;
	return true;
}

void EngineCore::prepareLoadedRomAssets() {
	Runtime& runtime = Runtime::instance();
	buildAssetMemory(runtime, m_cart_assets, false, RuntimeAssetBuildMode::Cart);
	refreshAudioAssets();
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

	const i64 cpuHz = resolveCpuHz(assets().machine);
	const i64 ufpsScaled = resolveUfpsScaled(assets().machine);
	const i64 imgDecBytesPerSec = resolveImgDecBytesPerSec(assets().machine);
	const i64 dmaBytesPerSecIso = resolveDmaBytesPerSecIso(assets().machine);
	const i64 dmaBytesPerSecBulk = resolveDmaBytesPerSecBulk(assets().machine);
	const int vdpWorkUnitsPerSec = static_cast<int>(resolveVdpWorkUnitsPerSec(assets().machine));
	const int geoWorkUnitsPerSec = static_cast<int>(resolveGeoWorkUnitsPerSec(assets().machine));
	applyManifestMemorySpecs(assets().machine, m_engine_assets.machine, assets(), m_engine_assets);
	configureViewForMachine(assets().machine);
	const int cycleBudget = calcCyclesPerFrame(cpuHz, ufpsScaled);
	const i64 vblankCycles = resolveVblankCycles(cpuHz, ufpsScaled, assets().machine.viewportHeight);

	if (!Runtime::hasInstance()) {
		RuntimeOptions options;
		options.playerIndex = 1;
		options.viewport.x = assets().machine.viewportWidth;
		options.viewport.y = assets().machine.viewportHeight;
		options.canonicalization = assets().machine.canonicalization;
		options.ufpsScaled = ufpsScaled;
		options.cpuHz = cpuHz;
		options.cycleBudgetPerFrame = cycleBudget;
		options.vblankCycles = static_cast<int>(vblankCycles);
		options.vdpWorkUnitsPerSec = vdpWorkUnitsPerSec;
		options.geoWorkUnitsPerSec = geoWorkUnitsPerSec;
		Runtime::createInstance(options);
	}

	Runtime& runtime = Runtime::instance();
	runtime.timing.applyUfpsScaled(ufpsScaled);
	setCpuHz(runtime, cpuHz);
	setCycleBudgetPerFrame(runtime, cycleBudget);
	runtime.vblank.setVblankCycles(runtime, static_cast<int>(vblankCycles));
	setTransferRatesFromManifest(runtime, { imgDecBytesPerSec, dmaBytesPerSecIso, dmaBytesPerSecBulk, vdpWorkUnitsPerSec, geoWorkUnitsPerSec });
	runtime.refreshMemoryMap();
	buildAssetMemory(runtime, assets(), false, RuntimeAssetBuildMode::Cart);
	runtime.resetRuntimeForProgramReload();
	refreshAudioAssets();
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

void EngineCore::renderTestPattern() {
	// Draw a simple test pattern to verify rendering works
	// This is shown when no ROM is loaded

	f32 t = static_cast<f32>(m_total_time);
	i32 w = static_cast<i32>(m_view->viewportSize.x);
	i32 h = static_cast<i32>(m_view->viewportSize.y);

	// Background gradient using filled rects
	for (i32 y = 0; y < h; y += 8) {
		f32 intensity = static_cast<f32>(y) / static_cast<f32>(h);
		Color bgColor{0.1f, 0.1f * intensity, 0.2f + 0.1f * intensity, 1.0f};
		m_view->fillRectangle({0.0f, static_cast<f32>(y), static_cast<f32>(w), static_cast<f32>(y + 8)}, bgColor);
	}

	// Bouncing box
	f32 boxX = (w / 2.0f) + std::sin(t * 2.0f) * (w / 3.0f);
	f32 boxY = (h / 2.0f) + std::cos(t * 1.5f) * (h / 4.0f);
	f32 boxSize = 32.0f + std::sin(t * 3.0f) * 8.0f;

	// Box shadow
	m_view->fillRectangle(
		{boxX - boxSize/2 + 4, boxY - boxSize/2 + 4, boxX + boxSize/2 + 4, boxY + boxSize/2 + 4},
		{0.0f, 0.0f, 0.0f, 0.5f}
	);

	// Main box (cycling colors)
	Color boxColor{
		0.5f + 0.5f * std::sin(t * 2.0f),
		0.5f + 0.5f * std::sin(t * 2.0f + 2.0f),
		0.5f + 0.5f * std::sin(t * 2.0f + 4.0f),
		1.0f
	};
	m_view->fillRectangle(
		{boxX - boxSize/2, boxY - boxSize/2, boxX + boxSize/2, boxY + boxSize/2},
		boxColor
	);

	// Box outline
	m_view->drawRectangle(
		{boxX - boxSize/2, boxY - boxSize/2, boxX + boxSize/2, boxY + boxSize/2},
		Color::white()
	);

	// Corner markers
	f32 cornerSize = 16.0f;
	m_view->fillRectangle({0, 0, cornerSize, cornerSize}, Color::red());
	m_view->fillRectangle({static_cast<f32>(w) - cornerSize, 0, static_cast<f32>(w), cornerSize}, Color::green());
	m_view->fillRectangle({0, static_cast<f32>(h) - cornerSize, cornerSize, static_cast<f32>(h)}, Color::blue());
	m_view->fillRectangle({static_cast<f32>(w) - cornerSize, static_cast<f32>(h) - cornerSize, static_cast<f32>(w), static_cast<f32>(h)}, {1.0f, 1.0f, 0.0f, 1.0f});

	// Draw some lines
	for (int i = 0; i < 8; i++) {
		f32 angle = t + i * 0.8f;
		f32 cx = w / 2.0f;
		f32 cy = h / 2.0f;
		f32 len = 40.0f + 20.0f * std::sin(t * 2.0f + i);
		Color lineColor{1.0f, 1.0f, 1.0f, 0.3f + 0.2f * std::sin(t + i)};
		m_view->drawLine(
			static_cast<i32>(cx),
			static_cast<i32>(cy),
			static_cast<i32>(cx + std::cos(angle) * len),
			static_cast<i32>(cy + std::sin(angle) * len),
			lineColor
		);
	}

	// "BMSX" text position indicator (since we don't have font rendering yet)
	f32 textY = 20.0f;
	f32 textX = 10.0f;
	// Draw placeholder rectangles for "BMSX" letters
	for (int i = 0; i < 4; i++) {
		m_view->fillRectangle(
			{textX + i * 14.0f, textY, textX + i * 14.0f + 10.0f, textY + 12.0f},
			Color::white()
		);
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
	const i64 cpuHz = resolveCpuHz(activeAssets.machine);
	const i64 imgDecBytesPerSec = resolveImgDecBytesPerSec(activeAssets.machine);
	const i64 dmaBytesPerSecIso = resolveDmaBytesPerSecIso(activeAssets.machine);
	const i64 dmaBytesPerSecBulk = resolveDmaBytesPerSecBulk(activeAssets.machine);
	const int vdpWorkUnitsPerSec = static_cast<int>(resolveVdpWorkUnitsPerSec(activeAssets.machine));
	const int geoWorkUnitsPerSec = static_cast<int>(resolveGeoWorkUnitsPerSec(activeAssets.machine));
	const i64 ufpsScaled = resolveUfpsScaled(activeAssets.machine);
	const int cycleBudget = calcCyclesPerFrame(cpuHz, ufpsScaled);
	const i64 vblankCycles = resolveVblankCycles(cpuHz, ufpsScaled, activeAssets.machine.viewportHeight);

	// Create Runtime instance if it doesn't exist
	if (!Runtime::hasInstance()) {
		RuntimeOptions options;
		options.playerIndex = 1;
		options.viewport.x = activeAssets.machine.viewportWidth;
		options.viewport.y = activeAssets.machine.viewportHeight;
		options.canonicalization = activeAssets.machine.canonicalization;
		options.ufpsScaled = ufpsScaled;
		options.cpuHz = cpuHz;
		options.cycleBudgetPerFrame = cycleBudget;
		options.vblankCycles = static_cast<int>(vblankCycles);
		options.vdpWorkUnitsPerSec = vdpWorkUnitsPerSec;
		options.geoWorkUnitsPerSec = geoWorkUnitsPerSec;
		Runtime::createInstance(options);
	}

	// Boot the runtime with the pre-compiled program
	Runtime& runtime = Runtime::instance();
	runtime.timing.applyUfpsScaled(ufpsScaled);
	setCpuHz(runtime, cpuHz);
	setCycleBudgetPerFrame(runtime, cycleBudget);
	runtime.vblank.setVblankCycles(runtime, static_cast<int>(vblankCycles));
	setTransferRatesFromManifest(runtime, { imgDecBytesPerSec, dmaBytesPerSecIso, dmaBytesPerSecBulk, vdpWorkUnitsPerSec, geoWorkUnitsPerSec });
	runtime.refreshMemoryMap();
	runtime.setProgramSource(Runtime::ProgramSource::Cart);
	runtime.setCanonicalization(activeAssets.machine.canonicalization);
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

void EngineCore::refreshAudioAssets() {
	refreshAudioAssets(assets());
}

void EngineCore::refreshAudioAssets(const RuntimeAssets& assets) {
	const f32 volume = m_sound_master->masterVolume();
	auto audioResolver = [this, &assets](const AssetId& id) -> AudioDataView {
		Runtime& runtime = Runtime::instance();
		if (runtime.machine().memory().hasAsset(id)) {
			const auto& entry = runtime.machine().memory().getAssetEntry(id);
			if (entry.type == Memory::AssetType::Audio && entry.baseSize > 0) {
				return AudioDataView{ runtime.machine().memory().getAudioData(entry), entry.frames };
			}
		}
		const AudioAsset* asset = assets.getAudio(id);
		if (!asset) {
			throw BMSX_RUNTIME_ERROR("Audio asset not found: " + id);
		}
		if (!asset->bytes.empty()) {
			return AudioDataView{ asset->bytes.data() + asset->dataOffset, asset->frames };
		}
		const std::string payloadId = asset->rom.payloadId.value();
		RomView view{};
		if (payloadId == "system") {
			view = engineRomView();
		} else if (payloadId == "cart") {
			view = cartRomView();
		} else {
			throw BMSX_RUNTIME_ERROR("Unsupported audio payload id: " + payloadId);
		}
		const i32 start = asset->rom.start.value();
		const u8* wavBase = view.data + static_cast<size_t>(start);
		return AudioDataView{ wavBase + asset->dataOffset, asset->frames };
	};
	m_sound_master->init(assets, volume, audioResolver);
	const MachineManifest& machineManifest = this->machineManifest();
	const int maxSfx = machineManifest.maxVoicesSfx ? static_cast<int>(*machineManifest.maxVoicesSfx) : 1;
	const int maxMusic = machineManifest.maxVoicesMusic ? static_cast<int>(*machineManifest.maxVoicesMusic) : 1;
	const int maxUi = machineManifest.maxVoicesUi ? static_cast<int>(*machineManifest.maxVoicesUi) : 1;
	m_sound_master->setMaxVoicesByType(maxSfx, maxMusic, maxUi);
}

} // namespace bmsx
