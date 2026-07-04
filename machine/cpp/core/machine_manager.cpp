/*
 * machine_manager.cpp - Machine manager implementation
 */

#include "machine_manager.h"
#include "render/shared/bitmap_font.h"
#include "rom_boot_manager.h"
#include "system.h"
#include "input/manager.h"
#include "render/texture_manager.h"
#include "render/vdp/framebuffer.h"
#include "../machine/runtime/runtime.h"
#include "machine/model_registry.h"
#include "machine/memory/map.h"
#include "machine/memory/specs.h"
#include "machine/runtime/boot_timing.h"
#include "machine/program/linker.h"
#include "render/shared/bmsx_font.h"
#include "rompack/format.h"
#include <cstdio>
#include <cstdlib>
#include <chrono>
#include <cstdarg>
#include <iostream>
#include <stdexcept>
#include <utility>

namespace bmsx {

MachineManager* MachineManager::s_instance = nullptr;

MachineManager::MachineManager()
	: m_audio_ufps_scaled(PAL_REFRESH_UFPS_SCALED) {
	s_instance = this;
	machine_manifest = &defaultSystemMachineManifest();
	m_active_rom = &m_system_rom;
	m_rom_boot_manager = std::make_unique<RomBootManager>();
}

MachineManager::~MachineManager() {
	shutdown();
	if (s_instance == this) {
		s_instance = nullptr;
	}
}

MachineManager& MachineManager::instance() {
	return *s_instance;
}

bool MachineManager::initialize(Platform* platform) {
	if (m_state != MachineManagerState::Uninitialized) {
		return false;
	}

	m_platform = platform;

	// Get viewport size from platform
	auto* host = platform->gameviewHost();
	const MachineVdpModeProfile& systemVdpMode = getMachineVdpModeProfile(PSX_MODEL_PROFILE.biosVdpMode);
	Vec2 defaultViewport{
		static_cast<f32>(systemVdpMode.renderWidth),
		static_cast<f32>(systemVdpMode.renderHeight)
	};
	ViewportDimensions dims = host->getSize(defaultViewport, {defaultViewport.x * 2.0f, defaultViewport.y * 2.0f});

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
	registry().registerObject(m_view.get());

	// Update view with initial size (after backend is set)
	m_view->configureRenderTargets(nullptr, nullptr, nullptr, &m_viewport_scale, &m_canvas_scale);

	m_texture_manager = std::make_unique<TextureManager>(m_view->backend());
	m_view->setVdpTextureState(std::make_unique<VdpFrameBufferTextures>(*m_texture_manager, *m_view));
	if (m_view->backend()->readyForTextureUpload()) {
		m_view->initializeDefaultTextures();
	}

	Input::instance().initialize();
	m_sound_master = std::make_unique<SoundMaster>();
	registry().registerObject(m_sound_master.get());

	m_state = MachineManagerState::Initialized;
	return true;
}

void MachineManager::shutdown() {
	if (m_state == MachineManagerState::Uninitialized) {
		return;
	}

	stop();
		unloadRom();

	m_texture_manager.reset();

	// Dispose view
	if (m_view) {
		m_view->dispose();
		m_view.reset();
	}

	// Clear registry (keeps persistent objects)
	registry().deregister(m_sound_master.get(), true);
	m_sound_master.reset();
	registry().clear();

	m_platform = nullptr;
	m_state = MachineManagerState::Uninitialized;
}

void MachineManager::start() {
	switch (m_state) {
		case MachineManagerState::Initialized:
		case MachineManagerState::Stopped:
			m_state = MachineManagerState::Running;
			runtime().frameScheduler.clearQueuedTime();
			break;
		default:
			break;
	}
}

// start normalized-body-acceptable -- pause/resume deliberately mirror state-transition symmetry.
void MachineManager::pause() {
	switch (m_state) {
		case MachineManagerState::Running:
			m_state = MachineManagerState::Paused;
			m_screen.clearPresentation();
			break;
		default:
			break;
	}
}

void MachineManager::resume() {
	switch (m_state) {
		case MachineManagerState::Paused:
			m_state = MachineManagerState::Running;
			runtime().frameScheduler.clearQueuedTime();
			break;
		default:
			break;
	}
}
// end normalized-body-acceptable

void MachineManager::stop() {
	switch (m_state) {
		case MachineManagerState::Running:
		case MachineManagerState::Paused:
			m_state = MachineManagerState::Stopped;
			break;
		default:
			break;
	}
}

bool MachineManager::acceptHostFrame(f64 deltaTime) const {
	switch (m_state) {
		case MachineManagerState::Running:
		case MachineManagerState::Paused:
			return deltaTime > 0.0;
		default:
			return false;
	}
}

void MachineManager::startLoadedRuntimeFrame(bool romLoaded) {
	if (romLoaded && m_state == MachineManagerState::Initialized) {
		start();
	}
}

void MachineManager::setHostPaused(bool paused, bool romLoaded) {
	if (paused) {
		pause();
		return;
	}

	if (m_state == MachineManagerState::Paused) {
		resume();
	} else {
		startLoadedRuntimeFrame(romLoaded);
	}
}

void MachineManager::syncAudioTiming() {
	const i64 ufpsScaled = runtime().timing.ufpsScaled;
	m_sound_master->setMixerUfpsScaled(ufpsScaled);
	m_audio_ufps_scaled = ufpsScaled;
}

void MachineManager::syncRuntimeAudioTiming() {
	if (runtime().timing.ufpsScaled != m_audio_ufps_scaled) {
		syncAudioTiming();
	}
}

void MachineManager::refreshRenderSurfaces() {
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
	m_view->vdpFrameBufferTextures().initialize(runtime().machine.vdp);
}

void MachineManager::log(LogLevel level, const char* fmt, ...) {
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
		message = "MachineManager::log: formatting error";
	} else {
		message.resize(static_cast<size_t>(written) + 1);
		vsnprintf(message.data(), message.size(), fmt, args_copy);
		message.resize(static_cast<size_t>(written));
	}
	va_end(args_copy);
	m_platform->log(level, message);
}

Runtime& MachineManager::runtime() {
	return *m_runtime;
}

const Runtime& MachineManager::runtime() const {
	return *m_runtime;
}

Runtime& MachineManager::ensureRuntime(const RuntimeOptions& options) {
	if (!m_runtime) {
		m_runtime = std::make_unique<Runtime>(
			options,
			Input::instance(),
			*platform()->microtaskQueue()
		);
	}
	return *m_runtime;
}

// ============================================================================
// ROM loading and boot orchestration (moved from RomBootManager)
// ============================================================================

void MachineManager::activateSystemRom() {
	m_active_rom = &m_system_rom;
}

void MachineManager::activateCartRom() {
	m_active_rom = &m_cart_rom;
}

void MachineManager::setMachineManifest(const MachineManifest& manifest) {
	machine_manifest = &manifest;
}

void MachineManager::configureViewForModel() {
	const MachineVdpModeProfile& vdpMode = getMachineVdpModeProfile(PSX_MODEL_PROFILE.biosVdpMode);
	Vec2 viewportSize{
		static_cast<f32>(vdpMode.renderWidth),
		static_cast<f32>(vdpMode.renderHeight)
	};
	Vec2 offscreenSize{ viewportSize.x * 2.0f, viewportSize.y * 2.0f };
	m_view->configureRenderTargets(&viewportSize, &viewportSize, &offscreenSize, &m_viewport_scale, &m_canvas_scale);
}

MachineManager::LoadedProgramImages MachineManager::loadProgramImagesFromRom(const RuntimeRomPackage& romPackage, const u8* romData) const {
	const RomAssetInfo& imageRecord = *romPackage.programImageRom;
	LoadedProgramImages images;
	images.image = decodeProgramImage(
		romData + static_cast<size_t>(*imageRecord.start),
		static_cast<size_t>(*imageRecord.end - *imageRecord.start)
	);
	if (romPackage.programSymbolsRom) {
		const RomAssetInfo& symbolsRecord = *romPackage.programSymbolsRom;
		images.metadata = decodeProgramSymbolsImage(
			romData + static_cast<size_t>(*symbolsRecord.start),
			static_cast<size_t>(*symbolsRecord.end - *symbolsRecord.start)
		);
	}
	return images;
}

bool MachineManager::loadSystemRomInternal(const u8* data, size_t size) {
	if (m_texture_manager) {
		m_texture_manager->setBackend(m_view ? m_view->backend() : nullptr);
	}
	auto plan = m_rom_boot_manager->buildBootPlan(data, size, nullptr, 0);
	if (!plan) return false;
	m_system_rom = std::move(plan->systemLayer);
	m_system_rom_loaded = true;
	machine_manifest = &m_system_rom.machine;
	m_default_font = std::make_unique<Font>();
	m_view->default_font = m_default_font.get();
	return true;
}

Runtime& MachineManager::prepareRuntimeForActiveCart(const ResolvedRuntimeTiming& timing, const MachineManifest& machine) {
	Runtime& runtime = ensureRuntime(RuntimeOptions{
		Vec2{ static_cast<f32>(timing.viewportWidth), static_cast<f32>(timing.viewportHeight) },
		{ m_system_rom_data, m_system_rom_size },
		{ m_cart_rom_data, m_cart_rom_size },
		&machine,
		timing.regionWord,
		timing.ufpsScaled,
		timing.cpuHz,
		timing.cycleBudgetPerFrame,
		timing.vblankCycles,
		timing.imgDecBytesPerSec,
		timing.dmaBytesPerSecIso,
		timing.dmaBytesPerSecBulk,
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
	syncAudioTiming();
	return runtime;
}

void MachineManager::bootRuntimeFromProgram() {
	if (!activeRom().hasProgram()) {
		return;
	}
	RuntimeRomPackage& romPackage = activeRom();
	const ResolvedRuntimeTiming timing = resolveRuntimeTiming(PSX_MODEL_PROFILE.cpuFreqHz, MACHINE_REGION_PAL_WORD);
	Runtime& rt = ensureRuntime(RuntimeOptions{
		Vec2{ static_cast<f32>(timing.viewportWidth), static_cast<f32>(timing.viewportHeight) },
		{ m_system_rom_data, m_system_rom_size },
		{ m_cart_rom_data, m_cart_rom_size },
		&romPackage.machine,
		timing.regionWord,
		timing.ufpsScaled,
		timing.cpuHz,
		timing.cycleBudgetPerFrame,
		timing.vblankCycles,
		timing.imgDecBytesPerSec,
		timing.dmaBytesPerSecIso,
		timing.dmaBytesPerSecBulk,
		timing.vdpWorkUnitsPerSec,
		timing.geoWorkUnitsPerSec,
	});
	rt.setRuntimeEnvironment(
		romPackage.machine,
		{ m_system_rom_data, m_system_rom_size },
		{ m_cart_rom_data, m_cart_rom_size },
		romPackage,
		m_system_rom,
		m_cart_rom_size > 0 ? &m_cart_rom : nullptr
	);
	applyRuntimeTiming(rt, timing);
	syncAudioTiming();
	rt.resetRuntimeForProgramReload();
	m_screen.reset();
	refreshRenderSurfaces();
	LoadedProgramImages cartImages = loadProgramImagesFromRom(romPackage, m_cart_rom_data);
	if (m_system_rom_loaded && m_system_rom.hasProgram()) {
		LoadedProgramImages systemImages = loadProgramImagesFromRom(m_system_rom, m_system_rom_data);
		auto linked = linkBootProgramImages(
			*systemImages.image,
			systemImages.metadata.get(),
			*cartImages.image,
			cartImages.metadata.get(),
			ProgramBootTarget::Cart
		);
		rt.enterCartProgram();
		rt.bootLinkedProgramImage(std::move(linked));
		flushRuntimeLuaOutput(rt);
		return;
	}
	rt.enterCartProgram();
	rt.boot(*cartImages.image, std::move(cartImages.metadata), cartImages.image->vectors, PROGRAM_STATIC_RAM_BASE, PROGRAM_STATIC_RAM_BASE + static_cast<uint32_t>(cartImages.image->sections.data.bytes.size()), std::span<const std::string>{}, cartImages.image->sections.rodata.staticModulePaths);
	flushRuntimeLuaOutput(rt);
}

bool MachineManager::bootSystemStartupProgram(const MachineManifest& runtimeMachine) {
	if (!m_system_rom_loaded) return false;
	if (!m_system_rom.hasProgram()) return false;

	activateSystemRom();
	setMachineManifest(runtimeMachine);
	const ResolvedRuntimeTiming timing = resolveRuntimeTiming(PSX_MODEL_PROFILE.cpuFreqHz, MACHINE_REGION_PAL_WORD);
	configureMemoryMap(resolveRuntimeMemoryMapSpecs());
	configureViewForModel();

	Runtime& rt = ensureRuntime(RuntimeOptions{
		Vec2{ static_cast<f32>(timing.viewportWidth), static_cast<f32>(timing.viewportHeight) },
		{ m_system_rom_data, m_system_rom_size },
		{ m_cart_rom_data, m_cart_rom_size },
		&runtimeMachine,
		timing.regionWord,
		timing.ufpsScaled,
		timing.cpuHz,
		timing.cycleBudgetPerFrame,
		timing.vblankCycles,
		timing.imgDecBytesPerSec,
		timing.dmaBytesPerSecIso,
		timing.dmaBytesPerSecBulk,
		timing.vdpWorkUnitsPerSec,
		timing.geoWorkUnitsPerSec,
	});
	rt.setRuntimeEnvironment(
		runtimeMachine,
		{ m_system_rom_data, m_system_rom_size },
		{ m_cart_rom_data, m_cart_rom_size },
		activeRom(),
		m_system_rom,
		m_cart_rom_size > 0 ? &m_cart_rom : nullptr
	);
	applyRuntimeTiming(rt, timing);
	syncAudioTiming();
	rt.resetRuntimeForProgramReload();
	m_screen.reset();
	rt.enterSystemFirmware();
	refreshRenderSurfaces();
	LoadedProgramImages systemImages = loadProgramImagesFromRom(m_system_rom, m_system_rom_data);
	if (m_cart_rom_size > 0 && m_cart_rom.hasProgram()) {
		LoadedProgramImages cartImages = loadProgramImagesFromRom(m_cart_rom, m_cart_rom_data);
		auto linked = linkBootProgramImages(
			*systemImages.image,
			systemImages.metadata.get(),
			*cartImages.image,
			cartImages.metadata.get(),
			ProgramBootTarget::System
		);
		rt.bootLinkedProgramImage(std::move(linked));
	} else {
		rt.boot(*systemImages.image, std::move(systemImages.metadata), systemImages.image->vectors, PROGRAM_STATIC_RAM_BASE, PROGRAM_STATIC_RAM_BASE + static_cast<uint32_t>(systemImages.image->sections.data.bytes.size()), systemImages.image->sections.rodata.staticModulePaths, std::span<const std::string>{});
	}
	flushRuntimeLuaOutput(rt);
	return true;
}

bool MachineManager::loadRomInternal(const u8* data, size_t size) {
	if (m_texture_manager) {
		m_texture_manager->setBackend(m_view ? m_view->backend() : nullptr);
	}
	m_cart_rom.clear();
	if (!loadCartRomPackageFromRom(data, size, m_cart_rom, nullptr, "cart")) {
		return false;
	}
	m_loaded_cart_has_program = m_cart_rom.hasProgram();

	const MachineManifest& cartMachine = m_cart_rom.machine;
	configureViewForModel();

	const bool hasSystemProgram = m_system_rom_loaded
		&& m_system_rom.hasProgram();
	if (hasSystemProgram) {
		if (!bootSystemStartupProgram(cartMachine)) {
			return false;
		}
	} else {
		activateCartRom();
		setMachineManifest(cartMachine);
		configureMemoryMap(resolveRuntimeMemoryMapSpecs());
		const ResolvedRuntimeTiming timing = resolveRuntimeTiming(PSX_MODEL_PROFILE.cpuFreqHz, MACHINE_REGION_PAL_WORD);
		prepareRuntimeForActiveCart(timing, cartMachine);
		if (activeRom().hasProgram()) {
			bootRuntimeFromProgram();
		}
	}

	m_rom_loaded = true;
	return true;
}

bool MachineManager::loadSystemRomOwned(std::vector<u8>&& data) {
	m_runtime.reset();
	m_system_rom_file.close();
	m_system_rom_owned = std::move(data);
	m_system_rom_data = m_system_rom_owned.data();
	m_system_rom_size = m_system_rom_owned.size();
	return loadSystemRomInternal(m_system_rom_data, m_system_rom_size);
}

bool MachineManager::loadSystemRomFile(const std::string& path) {
	MmapFile mapped;
	if (!mapped.open(path)) {
		return false;
	}
	m_runtime.reset();
	m_system_rom_owned = std::vector<u8>();
	m_system_rom_file = std::move(mapped);
	m_system_rom_data = m_system_rom_file.data();
	m_system_rom_size = m_system_rom_file.size();
	return loadSystemRomInternal(m_system_rom_data, m_system_rom_size);
}

bool MachineManager::loadRom(const u8* data, size_t size) {
	unloadRom();
	m_runtime.reset();
	m_cart_rom_file.close();
	m_cart_rom_owned = std::vector<u8>();
	m_cart_rom_data = data;
	m_cart_rom_size = size;
	return loadRomInternal(data, size);
}

bool MachineManager::loadRomOwned(std::vector<u8>&& data) {
	unloadRom();
	m_runtime.reset();
	m_cart_rom_file.close();
	m_cart_rom_owned = std::move(data);
	m_cart_rom_data = m_cart_rom_owned.data();
	m_cart_rom_size = m_cart_rom_owned.size();
	return loadRomInternal(m_cart_rom_data, m_cart_rom_size);
}

bool MachineManager::loadRomFile(const std::string& path) {
	unloadRom();
	m_runtime.reset();
	m_cart_rom_file.close();
	m_cart_rom_owned = std::vector<u8>();
	m_cart_rom_data = nullptr;
	m_cart_rom_size = 0;
	MmapFile mapped;
	if (!mapped.open(path)) {
		return false;
	}
	m_cart_rom_file = std::move(mapped);
	m_cart_rom_data = m_cart_rom_file.data();
	m_cart_rom_size = m_cart_rom_file.size();
	return loadRomInternal(m_cart_rom_data, m_cart_rom_size);
}

void MachineManager::unloadRom() {
	if (m_rom_loaded) {
		m_runtime.reset();
		m_active_rom = &m_system_rom;
		machine_manifest = &m_system_rom.machine;
		m_cart_rom.clear();
		m_cart_rom_owned = std::vector<u8>();
		m_cart_rom_file.close();
		m_cart_rom_data = nullptr;
		m_cart_rom_size = 0;
		if (m_texture_manager) {
			m_texture_manager->clear();
		}
		registry().clear();
		m_rom_loaded = false;
		m_loaded_cart_has_program = false;
	}
}

bool MachineManager::rebootLoadedRom() {
	if (!m_rom_loaded) return false;

	if (m_texture_manager) m_texture_manager->clear();
	if (m_view && m_view->backend()->readyForTextureUpload()) {
		m_view->initializeDefaultTextures();
	}

	const MachineManifest* runtimeMachine = &m_system_rom.machine;
	if (m_cart_rom_size > 0 && m_cart_rom.hasProgram()) {
		runtimeMachine = &m_cart_rom.machine;
	}
	return bootSystemStartupProgram(*runtimeMachine);
}

bool MachineManager::bootWithoutCart() {
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
	start();
	return true;
}

} // namespace bmsx
