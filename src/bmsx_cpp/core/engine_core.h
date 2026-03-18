/*
 * engine_core.h - Core engine interface (EngineCore in TypeScript)
 *
 * This mirrors the TypeScript EngineCore class which:
 * - Manages the game loop and frame timing
 * - Holds references to Registry, Assets
 * - Provides the global $ accessor pattern
 */

#ifndef BMSX_ENGINE_CORE_H
#define BMSX_ENGINE_CORE_H

#include "types.h"
#include "registry.h"
#include "../rompack/runtime_assets.h"
#include "../platform.h"
#include "../render/gameview.h"
#include "../audio/soundmaster.h"
#include <chrono>
#include <memory>

namespace bmsx {

constexpr i64 HZ_SCALE = 1'000'000;
constexpr i64 DEFAULT_UFPS = 50;
constexpr i64 DEFAULT_UFPS_SCALED = DEFAULT_UFPS * HZ_SCALE;

int calcCyclesPerFrame(i64 cpuHz, i64 refreshHzScaled);

class BFont;
class TextureManager;
class Runtime;
struct ProgramAsset;
struct ProgramMetadata;

/* ============================================================================
 * Engine state
 * ============================================================================ */

enum class EngineState {
	Uninitialized,
	Initialized,
	Running,
	Paused,
	Stopped
};

/* ============================================================================
 * EngineCore - Main game engine (mirrors TypeScript EngineCore)
 * ============================================================================ */

class EngineCore {
public:
	struct TickTiming {
		f64 totalMs = 0.0;
		f64 inputMs = 0.0;
		f64 runtimeIdeInputMs = 0.0;
		f64 runtimeTerminalInputMs = 0.0;
		f64 runtimeUpdateMs = 0.0;
		f64 runtimeIdeMs = 0.0;
		f64 runtimeTerminalMs = 0.0;
		f64 microtaskMs = 0.0;
	};

	struct RenderTiming {
		f64 totalMs = 0.0;
		f64 beginFrameMs = 0.0;
		f64 testPatternMs = 0.0;
		f64 runtimeDrawMs = 0.0;
		f64 runtimeIdeDrawMs = 0.0;
		f64 runtimeTerminalDrawMs = 0.0;
		f64 drawGameMs = 0.0;
		f64 endFrameMs = 0.0;
	};

	EngineCore();
	~EngineCore();

	// Lifecycle
	bool initialize(Platform* platform);
	void shutdown();

	// Main loop
	void tick(f64 deltaTime);
	void render();

	// State control
	void start();
	void pause();
	void resume();
	void stop();

	// State accessors
	EngineState state() const { return m_state; }
	bool isRunning() const { return m_state == EngineState::Running; }
	bool isPaused() const { return m_state == EngineState::Paused; }

	// Core subsystems (like TypeScript $)
	Platform* platform() { return m_platform; }
	GameView* view() { return m_view.get(); }
	Registry& registry() { return Registry::instance(); }
	RuntimeAssets& assets() { return m_assets; }
	Clock* clock() { return m_platform ? m_platform->clock() : nullptr; }
	SoundMaster* soundMaster() { return m_sound_master.get(); }
	TextureManager* texmanager() { return m_texture_manager.get(); }
	struct RomView {
		const u8* data;
		size_t size;
	};
	RomView engineRomView() const { return { m_engine_rom_data, m_engine_rom_size }; }
	RomView cartRomView() const { return { m_cart_rom_data, m_cart_rom_size }; }

	// Time
	f64 totalTime() const { return m_total_time; }
	f64 deltaTime() const { return m_delta_time; }
	u64 frameCount() const { return m_frame_count; }
	f64 fps() const { return m_fps; }
	f64 ufps() const { return static_cast<f64>(m_ufps_scaled) / static_cast<f64>(HZ_SCALE); }
	i64 ufpsScaled() const { return m_ufps_scaled; }
	const TickTiming& lastTickTiming() const { return m_last_tick_timing; }
	const RenderTiming& lastRenderTiming() const { return m_last_render_timing; }
	void setUfps(f64 ufps);
	void setUfpsScaled(i64 ufpsScaled);

	void refreshRenderAssets();
	void log(LogLevel level, const char* fmt, ...);

	// Input helpers (mirror TypeScript EngineCore)
	bool action_triggered(int playerIndex, const std::string& action);
	void consume_action(int playerIndex, const std::string& action);

	// Skybox helpers (mirror TypeScript EngineCore)
	void set_skybox_imgs(const SkyboxImageIds& ids);

	// ROM loading
	bool loadEngineAssets(const u8* data, size_t size);  // Load bmsx-bios.rom first
	bool loadEngineAssetsOwned(std::vector<u8>&& data);  // Load engine assets without extra copy
	bool loadEngineAssetsFromPath(const char* path);     // Load engine assets from file
	bool loadRom(const u8* data, size_t size);            // Load game cartridge ROM
	bool loadRomOwned(std::vector<u8>&& data);            // Load game cartridge ROM without extra copy
	void unloadRom();
	bool resetLoadedRom();
	bool romLoaded() const { return m_rom_loaded; }
	bool engineAssetsLoaded() const { return m_engine_assets_loaded; }
	void prepareLoadedRomAssets();

	// Boot engine without cart - uses program from engine assets (bootrom.lua)
	bool bootWithoutCart();

	// Registry shortcuts (like TypeScript $)
	template<typename T = Registerable>
	T* get(const std::string& id) {
		return registry().get<T>(id);
	}

	bool has(const std::string& id) {
		return registry().has(id);
	}

	void registerObj(Registerable* obj) {
		registry().registerObject(obj);
	}

	// Singleton access (global $ pattern)
	static EngineCore& instance();
	static EngineCore* instancePtr();

private:
	void applyRuntimeCycleBudget(Runtime& runtime);
	void renderTestPattern();  // Visual test when no ROM loaded
	void bootRuntimeFromProgram();  // Boot runtime with pre-compiled program from ROM
	void refreshAudioAssets();
	void refreshAudioAssets(const RuntimeAssets& assets);

	Platform* m_platform = nullptr;
	std::unique_ptr<GameView> m_view;
	std::unique_ptr<BFont> m_default_font;
	std::unique_ptr<SoundMaster> m_sound_master;
	std::unique_ptr<TextureManager> m_texture_manager;
	RuntimeAssets m_assets;

	EngineState m_state = EngineState::Uninitialized;

	f64 m_total_time = 0.0;
	f64 m_delta_time = 0.0;
	u64 m_frame_count = 0;
	f64 m_fps = DEFAULT_UFPS;
	i64 m_ufps_scaled = DEFAULT_UFPS_SCALED;
	f64 m_update_interval_ms = 1000.0 / static_cast<f64>(DEFAULT_UFPS);
	f64 m_accumulated_time = 0.0;
	bool m_debugTickReportInitialized = false;
	std::chrono::steady_clock::time_point m_debugTickReportAt;
	u64 m_debugTickHostFrames = 0;
	u64 m_debugTickUpdates = 0;
	i64 m_debugLastUpdateCountTotal = 0;
	i64 m_cycleCarry = 0;
	int m_lastGrantedBaseBudget = 0;
	bool m_presentation_pending = false;
	GameView::PresentationMode m_presentation_mode = GameView::PresentationMode::Completed;
	bool m_commit_presented_frame = false;

	bool m_rom_loaded = false;
	bool m_engine_assets_loaded = false;
	RuntimeAssets m_engine_assets;  // Base engine assets (fonts, UI sprites, etc.)
	std::vector<u8> m_engine_rom_owned;
	const u8* m_engine_rom_data = nullptr;
	size_t m_engine_rom_size = 0;
	std::vector<u8> m_cart_rom_owned;
	const u8* m_cart_rom_data = nullptr;
	size_t m_cart_rom_size = 0;
	std::unique_ptr<ProgramAsset> m_linked_program;
	std::unique_ptr<ProgramMetadata> m_linked_program_symbols;
	TickTiming m_last_tick_timing;
	RenderTiming m_last_render_timing;

	static EngineCore* s_instance;

	bool loadEngineAssetsInternal(const u8* data, size_t size);
	bool loadRomInternal(const u8* data, size_t size);

	f32 m_viewport_scale = 1.0f;
	f32 m_canvas_scale = 1.0f;
	SubscriptionHandle m_resize_sub;
};

/* ============================================================================
 * Global accessor (mirrors TypeScript $)
 * ============================================================================ */

// Usage: $().assets(), $().view(), etc.
inline EngineCore& $() {
	return EngineCore::instance();
}

} // namespace bmsx

#endif // BMSX_ENGINE_CORE_H
