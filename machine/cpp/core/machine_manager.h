/*
 * machine_manager.h - BMSX machine manager
 *
 * Owns libretro-facing platform state and runtime boot handoff.
 * ROM loading and boot orchestration live here.
 * Cart-visible hardware belongs under machine.
 */

#ifndef BMSX_MACHINE_MANAGER_H
#define BMSX_MACHINE_MANAGER_H

#include "common/mmap_file.h"
#include "common/primitives.h"
#include "common/registry.h"
#include "machine/devices/cartridge/contracts.h"
#include "spec/bmsx/cartridge.h"
#include "rompack/image.h"
#include "platform/platform.h"
#include "render/presentation_state.h"
#include "audio/soundmaster.h"
#include <array>
#include <chrono>
#include <memory>
#include <string>
#include <vector>

namespace bmsx {

class MachineManager;
class Runtime;
class VideoPresenter;
struct RuntimeOptions;
struct ResolvedRuntimeTiming;

/* ============================================================================
 * Machine manager state
 * ============================================================================ */

enum class MachineManagerState {
	Uninitialized,
	Initialized,
	Running,
	Paused,
	Stopped
};

/* ============================================================================
 * MachineManager - runtime bootstrap and host-frame owner
 * ============================================================================ */

class MachineManager {
public:
	friend class FrameLoopState;

	struct TickTiming {
		f64 totalMs = 0.0;
		f64 inputMs = 0.0;
		f64 workbenchModeInputMs = 0.0;
		f64 runtimeUpdateMs = 0.0;
		f64 workbenchModeMs = 0.0;
		f64 microtaskMs = 0.0;
	};

	MachineManager();
	~MachineManager();

	// Lifecycle
	bool initialize(Platform* platform);
	void shutdown();

	// State control
	void start();
	void pause();
	void resume();
	void stop();
	bool acceptHostFrame(f64 deltaTime) const;
	void startLoadedRuntimeFrame(bool romLoaded);
	void setHostPaused(bool paused, bool romLoaded);
	bool runHostFrame(
		Runtime& runtime,
		MicrotaskQueue& microtasks,
		VideoPresenter& presenter,
		f64 deltaTime,
		bool platformPaused
	);
	void syncAudioTiming();
	void syncRuntimeAudioTiming();

	// State accessors
	MachineManagerState state() const { return m_state; }
	bool isRunning() const { return m_state == MachineManagerState::Running; }
	bool isPaused() const { return m_state == MachineManagerState::Paused; }

	// Core host subsystems
	Platform* platform() { return m_platform; }
	bool hasRuntime() const { return m_runtime != nullptr; }
	Runtime& runtime();
	const Runtime& runtime() const;
	Runtime& ensureRuntime(const RuntimeOptions& options);
	Registry& registry() { return Registry::instance(); }
	HostClock* clock() { return m_platform->clock(); }
	SoundMaster* soundMaster() { return m_sound_master.get(); }
	// ROM loading and boot orchestration
	bool loadSystemRomOwned(std::vector<u8>&& data);
	bool loadSystemRomFile(const std::string& path);
	bool loadCartridgeSlotsOwned(std::array<std::vector<u8>, CARTRIDGE_SLOT_COUNT>&& data);
	bool loadCartridgeSlotFiles(const std::array<std::string, CARTRIDGE_SLOT_COUNT>& paths);
	void unloadRom();
	bool rebootLoadedRom();
	bool bootWithoutCart();
	bool romLoaded() const { return m_rom_loaded; }
	bool systemRomLoaded() const { return m_system_rom_loaded; }
	const RomImage& systemRomImage() const { return m_system_rom_image; }
	const RomImage& cartridgeRomImage(u32 slot) const {
		return m_cartridge_slots[static_cast<size_t>(slot)].image;
	}

	// Time
	f64 totalTime() const { return m_total_time; }
	f64 deltaTime() const { return m_delta_time; }
	u64 frameCount() const { return m_frame_count; }
	f64 fps() const { return m_fps; }
	bool hostShowFps = false;
	const TickTiming& lastTickTiming() const { return m_last_tick_timing; }
	void log(LogLevel level, const char* fmt, ...);

	// Registry shortcuts
	template<typename T = Registerable>
	T* get(const std::string& id) {
		return registry().get<T>(id);
	}

	bool has(const std::string& id) {
		return registry().has(id);
	}

	// Singleton access
	static MachineManager& instance();

private:
	struct LoadedCartridgeSlot {
		MmapFile file;
		std::vector<u8> owned;
		RomImage image;

		void clear();
	};

	Platform* m_platform = nullptr;
	std::unique_ptr<SoundMaster> m_sound_master;
	std::unique_ptr<Runtime> m_runtime;

	// ROM state
	RomImage m_system_rom_image;
	std::array<LoadedCartridgeSlot, CARTRIDGE_SLOT_COUNT> m_cartridge_slots;
	CartridgeSlotMediaPair m_cartridge_media{};
	MmapFile m_system_rom_file;
	std::vector<u8> m_system_rom_owned;
	bool m_rom_loaded = false;
	bool m_system_rom_loaded = false;

	bool loadSystemRomInternal(const u8* data, size_t size);
	bool bootLoadedCartridgeSlots();
	bool bootSystemFirmware();

	MachineManagerState m_state = MachineManagerState::Uninitialized;

	f64 m_total_time = 0.0;
	f64 m_delta_time = 0.0;
	u64 m_frame_count = 0;
	f64 m_fps = 0.0;
	i64 m_audio_ufps_scaled;
	bool m_debugTickReportInitialized = false;
	std::chrono::steady_clock::time_point m_debugTickReportAt;
	u64 m_debugTickHostFrames = 0;
	u64 m_debugTickUpdates = 0;
	i64 m_debugLastUpdateCountTotal = 0;
	TickTiming m_last_tick_timing;
	RenderPresentationState m_screen;

	static MachineManager* s_instance;

};

} // namespace bmsx

#endif // BMSX_MACHINE_MANAGER_H
