/*
 * machine_manager.cpp - Machine manager implementation
 */

#include "machine_manager.h"
#include "host_overlay_menu.h"
#include "render/shared/bitmap_font.h"
#include "input/manager.h"
#include "render/texture_manager.h"
#include "../machine/runtime/runtime.h"
#include "machine/model_registry.h"
#include "machine/devices/gx/gpu_display.h"
#include "machine/memory/map.h"
#include "machine/memory/specs.h"
#include "machine/runtime/boot_timing.h"
#include "render/shared/bmsx_font.h"
#include "rompack/format.h"
#include <cstdio>
#include <cstdlib>
#include <chrono>
#include <cstdarg>
#include <iostream>
#include <span>
#include <stdexcept>
#include <utility>

namespace bmsx {

MachineManager* MachineManager::s_instance = nullptr;

void MachineManager::LoadedCartridgeSlot::clear() {
	image = {};
	file.close();
	owned = std::vector<u8>();
}

MachineManager::MachineManager()
	: m_audio_ufps_scaled(PAL_REFRESH_UFPS_SCALED) {
	s_instance = this;
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
	Vec2 defaultViewport{
		static_cast<f32>(gxGpuDisplayModeScreenWidth(GX_GPU_RESET_DISPLAY_MODE_WORD)),
		static_cast<f32>(gxGpuVerticalVisibleLines(GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD, GX_GPU_RESET_DISPLAY_MODE_WORD))
	};
	ViewportDimensions dims = host->getSize(defaultViewport, defaultViewport);

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
			m_view->viewportScale = m_viewport_scale;
			m_view->canvasScale = m_canvas_scale;
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

	m_texture_manager = std::make_unique<TextureManager>(m_view->backend());
	if (m_view->backend()->readyForTextureUpload()) {
		m_view->initializeDefaultTextures();
	}

	Input::instance().initialize();
	m_focus_sub = host->onFocusChange([](bool) {
		Input::instance().resetInputState();
		hostOverlayMenu().resetInputState();
	});
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
	m_focus_sub.unsubscribe();
	m_resize_sub.unsubscribe();
	Input::instance().shutdown();
	hostOverlayMenu().resetInputState();

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
		m_runtime = std::make_unique<Runtime>(options, Input::instance());
	}
	return *m_runtime;
}

// ============================================================================
// ROM loading and boot orchestration
// ============================================================================

void MachineManager::configureViewForGpuReset() {
	m_view->setRenderTargetSize(
		static_cast<i32>(gxGpuDisplayModeScreenWidth(GX_GPU_RESET_DISPLAY_MODE_WORD)),
		gxGpuVerticalVisibleLines(GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD, GX_GPU_RESET_DISPLAY_MODE_WORD)
	);
}

bool MachineManager::loadSystemRomInternal(const u8* data, size_t size) {
	if (m_texture_manager) {
		m_texture_manager->setBackend(m_view ? m_view->backend() : nullptr);
	}
	m_system_rom_image = parseRomImage(data, size, RomImageDomain::System);
	m_system_rom_loaded = true;
	m_default_font = std::make_unique<Font>();
	m_view->default_font = m_default_font.get();
	return true;
}

bool MachineManager::bootSystemFirmware() {
	if (!m_system_rom_loaded) return false;
	if (m_system_rom_image.header.blua32ImageOffset == 0u) return false;

	const ResolvedRuntimeTiming timing = resolveRuntimeTiming(PSX_MACHINE_SPEC.cpuFreqHz);
	configureRuntimeMemoryMap();
	configureViewForGpuReset();

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
	syncAudioTiming();
	rt.resetForSystemBoot();
	m_screen.reset();
	refreshRenderSurfaces();
	rt.boot();
	return true;
}

bool MachineManager::bootLoadedCartridgeSlots() {
	if (m_texture_manager) {
		m_texture_manager->setBackend(m_view ? m_view->backend() : nullptr);
	}
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
	if (m_rom_loaded) {
		Input::instance().resetInputState();
		hostOverlayMenu().resetInputState();
		if (m_texture_manager) {
			m_texture_manager->clear();
		}
		registry().clear();
	}
	m_runtime.reset();
	m_cartridge_media = {};
	for (LoadedCartridgeSlot& slot : m_cartridge_slots) {
		slot.clear();
	}
	m_rom_loaded = false;
}

bool MachineManager::rebootLoadedRom() {
	if (!m_rom_loaded) return false;

	if (m_texture_manager) m_texture_manager->clear();
	if (m_view && m_view->backend()->readyForTextureUpload()) {
		m_view->initializeDefaultTextures();
	}

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
	start();
	return true;
}

} // namespace bmsx
