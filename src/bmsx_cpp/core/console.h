/*
 * console.h - C++ host shell for BMSX
 *
 * Owns libretro-facing platform state and runtime boot handoff.
 * ROM loading and boot orchestration live here; RomBootManager is a stateless plan builder.
 * Cart-visible hardware belongs under machine.
 */

#ifndef BMSX_CONSOLE_CORE_H
#define BMSX_CONSOLE_CORE_H

#include "common/primitives.h"
#include "common/registry.h"
#include "rompack/format.h"
#include "rompack/loader.h"
#include "platform/platform.h"
#include "render/gameview.h"
#include "audio/soundmaster.h"
#include <chrono>
#include <memory>
#include <vector>

namespace bmsx {

class BFont;
class ConsoleCore;
class RomBootManager;
class TextureManager;
class Runtime;
struct RuntimeOptions;
struct ProgramImage;
struct ProgramMetadata;
struct ResolvedRuntimeTiming;

/* ============================================================================
 * Console state
 * ============================================================================ */

enum class ConsoleState {
	Uninitialized,
	Initialized,
	Running,
	Paused,
	Stopped
};

/* ============================================================================
 * ConsoleCore - libretro host shell and runtime bootstrap owner
 * ============================================================================ */

class ConsoleCore {
public:
	friend class FrameLoopState;
	friend class RenderPresentationState;

	struct TickTiming {
		f64 totalMs = 0.0;
		f64 inputMs = 0.0;
		f64 workbenchModeInputMs = 0.0;
		f64 runtimeTerminalInputMs = 0.0;
		f64 runtimeUpdateMs = 0.0;
		f64 workbenchModeMs = 0.0;
		f64 runtimeTerminalMs = 0.0;
		f64 microtaskMs = 0.0;
	};

	struct RenderTiming {
		f64 totalMs = 0.0;
		f64 beginFrameMs = 0.0;
		f64 testPatternMs = 0.0;
		f64 runtimeDrawMs = 0.0;
		f64 workbenchModeDrawMs = 0.0;
		f64 runtimeTerminalDrawMs = 0.0;
		f64 endFrameMs = 0.0;
	};

	ConsoleCore();
	~ConsoleCore();

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
	void runHostFrame(
		Runtime& runtime,
		MicrotaskQueue& microtasks,
		f64 deltaTime,
		bool platformPaused
	);

	// State accessors
	ConsoleState state() const { return m_state; }
	bool isRunning() const { return m_state == ConsoleState::Running; }
	bool isPaused() const { return m_state == ConsoleState::Paused; }

	// Core host subsystems
	Platform* platform() { return m_platform; }
	GameView* view() { return m_view.get(); }
	bool hasRuntime() const { return m_runtime != nullptr; }
	Runtime& runtime();
	const Runtime& runtime() const;
	Runtime& ensureRuntime(const RuntimeOptions& options);
	Registry& registry() { return Registry::instance(); }
	const MachineManifest& machineManifest() const { return *machine_manifest; }
	Clock* clock() { return m_platform->clock(); }
	SoundMaster* soundMaster() { return m_sound_master.get(); }
	TextureManager* texmanager() { return m_texture_manager.get(); }
	RomBootManager& romBootManager() { return *m_rom_boot_manager; }

	// ROM loading and boot orchestration
	bool loadSystemRomOwned(std::vector<u8>&& data);
	bool loadRom(const u8* data, size_t size);
	bool loadRomOwned(std::vector<u8>&& data);
	void unloadRom();
	bool rebootLoadedRom();
	bool bootWithoutCart();
	bool romLoaded() const { return m_rom_loaded; }
	bool systemRomLoaded() const { return m_system_rom_loaded; }
	bool hasLoadedCartProgram() const { return m_loaded_cart_has_program; }
	RuntimeRomPackage& activeRom() { return *m_active_rom; }
	const RuntimeRomPackage& activeRom() const { return *m_active_rom; }
	RuntimeRomPackage& systemRom() { return m_system_rom; }
	const RuntimeRomPackage& systemRom() const { return m_system_rom; }
	RuntimeRomPackage& cartRom() { return m_cart_rom; }
	const RuntimeRomPackage& cartRom() const { return m_cart_rom; }

	// Time
	f64 totalTime() const { return m_total_time; }
	f64 deltaTime() const { return m_delta_time; }
	u64 frameCount() const { return m_frame_count; }
	f64 fps() const { return m_fps; }
	bool hostShowFps = false;
	const TickTiming& lastTickTiming() const { return m_last_tick_timing; }
	const RenderTiming& lastRenderTiming() const { return m_last_render_timing; }

	void refreshRenderSurfaces();
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
	static ConsoleCore& instance();

private:
	Platform* m_platform = nullptr;
	std::unique_ptr<GameView> m_view;
	std::unique_ptr<BFont> m_default_font;
	std::unique_ptr<SoundMaster> m_sound_master;
	std::unique_ptr<TextureManager> m_texture_manager;
	std::unique_ptr<RomBootManager> m_rom_boot_manager;
	std::unique_ptr<Runtime> m_runtime;

	// ROM state (orchestration moved from RomBootManager)
	RuntimeRomPackage m_system_rom;
	RuntimeRomPackage m_cart_rom;
	RuntimeRomPackage* m_active_rom = nullptr;
	std::vector<u8> m_system_rom_owned;
	const u8* m_system_rom_data = nullptr;
	size_t m_system_rom_size = 0;
	std::vector<u8> m_cart_rom_owned;
	const u8* m_cart_rom_data = nullptr;
	size_t m_cart_rom_size = 0;
	bool m_rom_loaded = false;
	bool m_loaded_cart_has_program = false;
	bool m_system_rom_loaded = false;
	std::unique_ptr<ProgramImage> m_linked_program;
	std::unique_ptr<ProgramMetadata> m_linked_program_symbols;

	// Boot helpers (moved from RomBootManager)
	void activateSystemRom();
	void activateCartRom();
	void setMachineManifest(const MachineManifest& manifest);
	void configureViewForMachine(const MachineManifest& manifest);
	bool loadSystemRomInternal(const u8* data, size_t size);
	bool loadRomInternal(const u8* data, size_t size);
	bool bootSystemStartupProgram(const MachineManifest& runtimeMachine);
	Runtime& prepareRuntimeForActiveCart(const ResolvedRuntimeTiming& timing, const MachineManifest& machine);
	void bootRuntimeFromProgram();

	ConsoleState m_state = ConsoleState::Uninitialized;

	f64 m_total_time = 0.0;
	f64 m_delta_time = 0.0;
	u64 m_frame_count = 0;
	f64 m_fps = 50.0;
	bool m_debugTickReportInitialized = false;
	std::chrono::steady_clock::time_point m_debugTickReportAt;
	u64 m_debugTickHostFrames = 0;
	u64 m_debugTickUpdates = 0;
	i64 m_debugLastUpdateCountTotal = 0;
	const MachineManifest* machine_manifest = nullptr;
	TickTiming m_last_tick_timing;
	RenderTiming m_last_render_timing;

	static ConsoleCore* s_instance;

	f32 m_viewport_scale = 1.0f;
	f32 m_canvas_scale = 1.0f;
	SubscriptionHandle m_resize_sub;
};

/* ============================================================================
 * Global console accessor
 * ============================================================================ */

// Usage: $().view(), $().runtime(), etc.
inline ConsoleCore& $() {
	return ConsoleCore::instance();
}

} // namespace bmsx

#endif // BMSX_CONSOLE_CORE_H
