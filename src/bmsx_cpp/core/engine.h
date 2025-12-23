/*
 * engine.h - Core engine interface (EngineCore in TypeScript)
 *
 * This mirrors the TypeScript EngineCore class which:
 * - Manages the game loop and frame timing
 * - Holds references to World, Registry, Assets
 * - Provides the global $ accessor pattern
 */

#ifndef BMSX_ENGINE_H
#define BMSX_ENGINE_H

#include "types.h"
#include "world.h"
#include "registry.h"
#include "assets.h"
#include "../platform.h"
#include "../render/gameview.h"
#include "../ecs/ecsystem.h"
#include <memory>

namespace bmsx {

class BFont;

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
    World* world() { return m_world.get(); }
    GameView* view() { return m_view.get(); }
    Registry& registry() { return Registry::instance(); }
    RuntimeAssets& assets() { return m_assets; }
    Clock* clock() { return m_platform ? m_platform->clock() : nullptr; }
    ECSystemManager& systemManager() { return m_system_manager; }

    // Time
    f64 totalTime() const { return m_total_time; }
    f64 deltaTime() const { return m_delta_time; }
    u64 frameCount() const { return m_frame_count; }
    f64 fps() const { return m_fps; }

    // ROM loading
    bool loadEngineAssets(const u8* data, size_t size);  // Load engine.assets.rom first
    bool loadEngineAssetsFromPath(const char* path);     // Load engine assets from file
    bool loadRom(const u8* data, size_t size);            // Load game cartridge ROM
    void unloadRom();
    bool romLoaded() const { return m_rom_loaded; }
    bool engineAssetsLoaded() const { return m_engine_assets_loaded; }

    // Boot engine without cart - uses VM program from engine assets (system_program.lua)
    bool bootWithoutCart();

    // Object spawning (convenience methods like TypeScript $)
    void spawn(WorldObject* obj, const Vec3* pos = nullptr);
    void exile(WorldObject* obj);

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
    void processInput();
    void updateWorld(f64 deltaTime);
    void renderTestPattern();  // Visual test when no ROM loaded
    void uploadTexturesToBackend();  // Upload asset textures to GPU backend
    void registerVMSystems();  // Register BMSX VM systems
    void bootVMFromProgram();  // Boot VM with pre-compiled program from ROM

    Platform* m_platform = nullptr;
    std::unique_ptr<World> m_world;
    std::unique_ptr<GameView> m_view;
    std::unique_ptr<BFont> m_default_font;
    RuntimeAssets m_assets;
    ECSystemManager m_system_manager;
    std::vector<std::unique_ptr<ECSystem>> m_vm_systems;  // Owned VM systems

    EngineState m_state = EngineState::Uninitialized;

    f64 m_total_time = 0.0;
    f64 m_delta_time = 0.0;
    u64 m_frame_count = 0;
    f64 m_fps = 60.0;

    bool m_rom_loaded = false;
    bool m_engine_assets_loaded = false;
    std::vector<u8> m_rom_data;
    std::vector<u8> m_engine_assets_data;
    RuntimeAssets m_engine_assets;  // Base engine assets (fonts, UI sprites, etc.)

    static EngineCore* s_instance;
};

/* ============================================================================
 * Global accessor (mirrors TypeScript $)
 * ============================================================================ */

// Usage: $().world(), $().assets(), etc.
inline EngineCore& $() {
    return EngineCore::instance();
}

} // namespace bmsx

#endif // BMSX_ENGINE_H
