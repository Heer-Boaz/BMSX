/*
 * console.cpp - Console core implementation
 */

#include "console.h"
#include "render/shared/bitmap_font.h"
#include "rom_boot_manager.h"
#include "system.h"
#include "input/manager.h"
#include "input/player.h"
#include "render/texture_manager.h"
#include "render/vdp/context_state.h"
#include "render/vdp/framebuffer.h"
#include "render/vdp/slot_textures.h"
#include "../machine/runtime/runtime.h"
#include "machine/specs.h"
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
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <utility>

namespace bmsx {

ConsoleCore* ConsoleCore::s_instance = nullptr;

ConsoleCore::ConsoleCore() {
	s_instance = this;
	machine_manifest = &defaultSystemMachineManifest();
	m_active_rom = &m_system_rom;
	m_rom_boot_manager = std::make_unique<RomBootManager>();
}

ConsoleCore::~ConsoleCore() {
	shutdown();
	if (s_instance == this) {
		s_instance = nullptr;
	}
}

ConsoleCore& ConsoleCore::instance() {
	return *s_instance;
}

bool ConsoleCore::initialize(Platform* platform) {
	if (m_state != ConsoleState::Uninitialized) {
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
	m_view->setVdpTextureState(
		std::make_unique<VdpFrameBufferTextures>(*m_texture_manager, *m_view),
		std::make_unique<VdpSlotTextures>(*m_texture_manager, *m_view)
	);
	if (m_view->backend()->readyForTextureUpload()) {
		m_view->initializeDefaultTextures();
	}

	Input::instance().initialize();
	m_sound_master = std::make_unique<SoundMaster>();
	registry().registerObject(m_sound_master.get());

	m_state = ConsoleState::Initialized;
	return true;
}

void ConsoleCore::shutdown() {
	if (m_state == ConsoleState::Uninitialized) {
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
	m_sound_master->dispose();
	registry().deregister(m_sound_master.get(), true);
	m_sound_master.reset();
	registry().clear();

	m_platform = nullptr;
	m_state = ConsoleState::Uninitialized;
}

void ConsoleCore::start() {
	switch (m_state) {
		case ConsoleState::Initialized:
		case ConsoleState::Stopped:
			m_state = ConsoleState::Running;
			runtime().frameScheduler.clearQueuedTime();
			break;
		default:
			break;
	}
}

// start normalized-body-acceptable -- pause/resume deliberately mirror state-transition symmetry.
void ConsoleCore::pause() {
	switch (m_state) {
		case ConsoleState::Running:
			m_state = ConsoleState::Paused;
			runtime().screen.clearPresentation();
			break;
		default:
			break;
	}
}

void ConsoleCore::resume() {
	switch (m_state) {
		case ConsoleState::Paused:
			m_state = ConsoleState::Running;
			runtime().frameScheduler.clearQueuedTime();
			break;
		default:
			break;
	}
}
// end normalized-body-acceptable

void ConsoleCore::stop() {
	switch (m_state) {
		case ConsoleState::Running:
		case ConsoleState::Paused:
			m_state = ConsoleState::Stopped;
			break;
		default:
			break;
	}
}

bool ConsoleCore::acceptHostFrame(f64 deltaTime) const {
	switch (m_state) {
		case ConsoleState::Running:
		case ConsoleState::Paused:
			return deltaTime > 0.0;
		default:
			return false;
	}
}

void ConsoleCore::startLoadedRuntimeFrame(bool romLoaded) {
	if (romLoaded && m_state == ConsoleState::Initialized) {
		start();
	}
}

void ConsoleCore::setHostPaused(bool paused, bool romLoaded) {
	if (paused) {
		pause();
		if (m_sound_master) {
			m_sound_master->stopAllVoices();
		}
		return;
	}

	if (m_state == ConsoleState::Paused) {
		resume();
	} else {
		startLoadedRuntimeFrame(romLoaded);
	}
}

void ConsoleCore::refreshRenderSurfaces() {
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
	restoreVdpContextState(runtime().machine.vdp, *m_view);
}

void ConsoleCore::log(LogLevel level, const char* fmt, ...) {
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
		message = "ConsoleCore::log: formatting error";
	} else {
		message.resize(static_cast<size_t>(written) + 1);
		vsnprintf(message.data(), message.size(), fmt, args_copy);
		message.resize(static_cast<size_t>(written));
	}
	va_end(args_copy);
	m_platform->log(level, message);
}

Runtime& ConsoleCore::runtime() {
	return *m_runtime;
}

const Runtime& ConsoleCore::runtime() const {
	return *m_runtime;
}

Runtime& ConsoleCore::ensureRuntime(const RuntimeOptions& options) {
	if (!m_runtime) {
		m_runtime = std::make_unique<Runtime>(
			options,
			*clock(),
			Input::instance(),
			*soundMaster(),
			*platform()->microtaskQueue(),
			*view()
		);
	}
	return *m_runtime;
}

// ============================================================================
// ROM loading and boot orchestration (moved from RomBootManager)
// ============================================================================

void ConsoleCore::activateSystemRom() {
	m_active_rom = &m_system_rom;
}

void ConsoleCore::activateCartRom() {
	m_active_rom = &m_cart_rom;
}

void ConsoleCore::setMachineManifest(const MachineManifest& manifest) {
	machine_manifest = &manifest;
}

void ConsoleCore::configureViewForMachine(const MachineManifest& manifest) {
	Vec2 viewportSize{
		static_cast<f32>(manifest.viewportWidth),
		static_cast<f32>(manifest.viewportHeight)
	};
	Vec2 offscreenSize{ viewportSize.x * 2.0f, viewportSize.y * 2.0f };
	m_view->configureRenderTargets(&viewportSize, &viewportSize, &offscreenSize, &m_viewport_scale, &m_canvas_scale);
}

bool ConsoleCore::loadSystemRomInternal(const u8* data, size_t size) {
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

Runtime& ConsoleCore::prepareRuntimeForActiveCart(const ResolvedRuntimeTiming& timing, const MachineManifest& machine) {
	Runtime& runtime = ensureRuntime(RuntimeOptions{
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
	m_sound_master->setMixerUfpsScaled(runtime.timing.ufpsScaled);
	runtime.refreshMemoryMap();
	return runtime;
}

void ConsoleCore::bootRuntimeFromProgram() {
	if (!activeRom().programImage) {
		return;
	}
	m_linked_program.reset();
	m_linked_program_symbols.reset();
	RuntimeRomPackage& romPackage = activeRom();
	const ResolvedRuntimeTiming timing = resolveRuntimeTiming(romPackage.machine);
	Runtime& rt = ensureRuntime(RuntimeOptions{
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
	rt.setRuntimeEnvironment(
		romPackage.machine,
		{ m_system_rom_data, m_system_rom_size },
		{ m_cart_rom_data, m_cart_rom_size },
		romPackage,
		m_system_rom,
		m_cart_rom_size > 0 ? &m_cart_rom : nullptr
	);
	applyRuntimeTiming(rt, timing);
	m_sound_master->setMixerUfpsScaled(rt.timing.ufpsScaled);
	rt.refreshMemoryMap();
	rt.resetRuntimeForProgramReload();
	refreshRenderSurfaces();
	if (m_system_rom_loaded && m_system_rom.programImage) {
		auto linked = linkProgramImages(
			*m_system_rom.programImage,
			m_system_rom.programSymbols.get(),
			*romPackage.programImage,
			romPackage.programSymbols.get()
		);
		m_linked_program = std::move(linked.programImage);
		m_linked_program_symbols = std::move(linked.metadata);
		rt.setLinkedCartEntry(linked.cartEntryProtoIndex, std::move(linked.cartStaticModulePaths));
		rt.enterCartProgram();
		rt.boot(*m_linked_program, m_linked_program_symbols.get(), m_linked_program->entryProtoIndex, m_linked_program->sections.rodata.staticModulePaths);
		return;
	}
	rt.enterCartProgram();
	rt.boot(*romPackage.programImage, romPackage.programSymbols.get(), romPackage.programImage->entryProtoIndex, romPackage.programImage->sections.rodata.staticModulePaths);
}

bool ConsoleCore::bootSystemStartupProgram(const MachineManifest& runtimeMachine) {
	if (!m_system_rom_loaded) return false;
	if (!m_system_rom.programImage) return false;

	if (m_cart_rom_size == 0) {
		Input::instance().getPlayerInput(DEFAULT_KEYBOARD_PLAYER_INDEX)->setInputMap(Input::DEFAULT_INPUT_MAPPING);
	}
	activateSystemRom();
	setMachineManifest(runtimeMachine);
	const ResolvedRuntimeTiming timing = resolveRuntimeTiming(runtimeMachine);
	applyManifestMemorySpecs(runtimeMachine, m_system_rom.machine, DEFAULT_VRAM_IMAGE_SLOT_SIZE);
	configureViewForMachine(runtimeMachine);

	Runtime& rt = ensureRuntime(RuntimeOptions{
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
	rt.setRuntimeEnvironment(
		runtimeMachine,
		{ m_system_rom_data, m_system_rom_size },
		{ m_cart_rom_data, m_cart_rom_size },
		activeRom(),
		m_system_rom,
		m_cart_rom_size > 0 ? &m_cart_rom : nullptr
	);
	applyRuntimeTiming(rt, timing);
	m_sound_master->setMixerUfpsScaled(rt.timing.ufpsScaled);
	rt.refreshMemoryMap();
	rt.resetRuntimeForProgramReload();
	rt.enterSystemFirmware();
	refreshRenderSurfaces();
	m_linked_program.reset();
	m_linked_program_symbols.reset();
	if (m_cart_rom_size > 0 && m_cart_rom.programImage) {
		auto linked = linkProgramImages(
			*m_system_rom.programImage,
			m_system_rom.programSymbols.get(),
			*m_cart_rom.programImage,
			m_cart_rom.programSymbols.get()
		);
		m_linked_program = std::move(linked.programImage);
		m_linked_program_symbols = std::move(linked.metadata);
		rt.setLinkedCartEntry(linked.cartEntryProtoIndex, std::move(linked.cartStaticModulePaths));
		rt.boot(*m_linked_program, m_linked_program_symbols.get(), linked.systemEntryProtoIndex, linked.systemStaticModulePaths);
	} else {
		rt.boot(*m_system_rom.programImage, m_system_rom.programSymbols.get(), m_system_rom.programImage->entryProtoIndex, m_system_rom.programImage->sections.rodata.staticModulePaths);
	}
	rt.cartBoot.reset();
	return true;
}

bool ConsoleCore::loadRomInternal(const u8* data, size_t size) {
	if (m_texture_manager) {
		m_texture_manager->setBackend(m_view ? m_view->backend() : nullptr);
	}
	m_cart_rom.clear();
	if (!loadCartRomPackageFromRom(data, size, m_cart_rom, nullptr, "cart")) {
		return false;
	}
	m_loaded_cart_has_program = m_cart_rom.programImage != nullptr;

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
			throw std::runtime_error("[ConsoleCore] machine.specs.cpu.cpu_freq_hz is required.");
		}
		std::cerr << "[ConsoleCore] Cart manifest machine.specs.cpu.cpu_freq_hz is required; booting BIOS only." << std::endl;
		cpuHz = systemCpuHz;
		runtimeUfpsScaled = systemUfpsScaled;
	}
	const MachineManifest& transferMachine = cartCpuValid ? cartMachine : m_system_rom.machine;

	configureViewForMachine(cartMachine);

	const bool hasSystemProgram = m_system_rom_loaded
		&& m_system_rom.programImage;
	if (hasSystemProgram) {
		if (!bootSystemStartupProgram(transferMachine)) {
			return false;
		}
	} else {
		if (!cartCpuValid) {
			std::cerr << "[ConsoleCore] Cart manifest machine.specs.cpu.cpu_freq_hz is required; cannot boot cart without BIOS." << std::endl;
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

bool ConsoleCore::loadSystemRomOwned(std::vector<u8>&& data) {
	m_runtime.reset();
	m_system_rom_owned = std::move(data);
	m_system_rom_data = m_system_rom_owned.data();
	m_system_rom_size = m_system_rom_owned.size();
	return loadSystemRomInternal(m_system_rom_data, m_system_rom_size);
}

bool ConsoleCore::loadRom(const u8* data, size_t size) {
	unloadRom();
	m_runtime.reset();
	m_cart_rom_owned.clear();
	m_cart_rom_data = data;
	m_cart_rom_size = size;
	return loadRomInternal(data, size);
}

bool ConsoleCore::loadRomOwned(std::vector<u8>&& data) {
	unloadRom();
	m_runtime.reset();
	m_cart_rom_owned = std::move(data);
	m_cart_rom_data = m_cart_rom_owned.data();
	m_cart_rom_size = m_cart_rom_owned.size();
	return loadRomInternal(m_cart_rom_data, m_cart_rom_size);
}

void ConsoleCore::unloadRom() {
	if (m_rom_loaded) {
		m_runtime.reset();
		m_active_rom = &m_system_rom;
		machine_manifest = &m_system_rom.machine;
		m_cart_rom.clear();
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

bool ConsoleCore::rebootLoadedRom() {
	if (!m_rom_loaded) return false;

	if (m_sound_master) m_sound_master->resetPlaybackState();
	if (m_texture_manager) m_texture_manager->clear();
	if (m_view && m_view->backend()->readyForTextureUpload()) {
		m_view->initializeDefaultTextures();
	}

	const MachineManifest* runtimeMachine = &m_system_rom.machine;
	if (m_cart_rom_size > 0 && m_cart_rom.programImage) {
		runtimeMachine = &m_cart_rom.machine;
	}
	return bootSystemStartupProgram(*runtimeMachine);
}

bool ConsoleCore::bootWithoutCart() {
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
