/*
 * console.h - C++ host shell for BMSX
 *
 * Owns libretro-facing platform state and runtime boot handoff.
 * ROM package loading belongs to RomBootManager; cart-visible hardware belongs under machine.
 */

#ifndef BMSX_CONSOLE_CORE_H
#define BMSX_CONSOLE_CORE_H

#include "primitives.h"
#include "registry.h"
#include "rompack/format.h"
#include "../platform.h"
#include "render/gameview.h"
#include "audio/soundmaster.h"
#include <chrono>
#include <memory>

namespace bmsx {

class BFont;
class ConsoleCore;
class RomBootManager;
class TextureManager;
class Runtime;
struct RuntimeOptions;

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
	friend class RomBootManager;

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
		f64 drawGameMs = 0.0;
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
	const MachineManifest& machineManifest() const { return *m_machine_manifest; }
	Clock* clock() { return m_platform->clock(); }
	SoundMaster* soundMaster() { return m_sound_master.get(); }
	TextureManager* texmanager() { return m_texture_manager.get(); }
	RomBootManager& romBootManager() { return *m_rom_boot_manager; }

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

		// disable-next-line single_line_method_pattern -- console object registration is the public core registry pin.
		void registerObj(Registerable* obj) {
			registry().registerObject(obj);
		}

	// Singleton access
	static ConsoleCore& instance();
	static ConsoleCore* instancePtr();

private:
	Platform* m_platform = nullptr;
	std::unique_ptr<GameView> m_view;
	std::unique_ptr<BFont> m_default_font;
	std::unique_ptr<SoundMaster> m_sound_master;
	std::unique_ptr<TextureManager> m_texture_manager;
	std::unique_ptr<RomBootManager> m_rom_boot_manager;
	std::unique_ptr<Runtime> m_runtime;

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
	const MachineManifest* m_machine_manifest = nullptr;
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
