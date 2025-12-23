/*
 * engine.cpp - Core engine implementation
 */

#include "engine.h"
#include <algorithm>

namespace bmsx {

EngineCore* EngineCore::s_instance = nullptr;

EngineCore::EngineCore() {
    s_instance = this;
    m_world = std::make_unique<World>();
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

    // Register World in the registry
    registry().registerObject(m_world.get());

    m_state = EngineState::Initialized;
    return true;
}

void EngineCore::shutdown() {
    if (m_state == EngineState::Uninitialized) {
        return;
    }

    stop();
    unloadRom();

    // Clear the world
    m_world->clearAllSpaces();

    // Clear registry (keeps persistent objects)
    registry().clear();

    m_platform = nullptr;
    m_state = EngineState::Uninitialized;
}

void EngineCore::start() {
    if (m_state == EngineState::Initialized || m_state == EngineState::Stopped) {
        m_state = EngineState::Running;
    }
}

void EngineCore::pause() {
    if (m_state == EngineState::Running) {
        m_state = EngineState::Paused;
        m_world->paused = true;
    }
}

void EngineCore::resume() {
    if (m_state == EngineState::Paused) {
        m_state = EngineState::Running;
        m_world->paused = false;
    }
}

void EngineCore::stop() {
    if (m_state == EngineState::Running || m_state == EngineState::Paused) {
        m_state = EngineState::Stopped;
        m_world->paused = true;
    }
}

void EngineCore::tick(f64 deltaTime) {
    if (m_state != EngineState::Running) {
        return;
    }

    m_delta_time = deltaTime;
    m_total_time += deltaTime;
    m_frame_count++;

    // Calculate FPS
    if (deltaTime > 0.0) {
        m_fps = 1.0 / deltaTime;
    }

    // Process input
    processInput();

    // Update world
    updateWorld(deltaTime);

    // Process microtasks
    if (m_platform && m_platform->microtaskQueue()) {
        m_platform->microtaskQueue()->flush();
    }
}

void EngineCore::render() {
    if (m_state != EngineState::Running && m_state != EngineState::Paused) {
        return;
    }

    // Sort by depth before rendering
    if (m_world->activeSpace) {
        m_world->activeSpace->sortByDepth();
    }

    // TODO: Actual rendering through platform/GameViewHost
}

void EngineCore::processInput() {
    if (!m_platform || !m_platform->inputHub()) {
        return;
    }

    auto* inputHub = m_platform->inputHub();

    // Process all pending input events
    while (auto evt = inputHub->nextEvt()) {
        // TODO: Dispatch input event to game systems
        (void)evt;
    }
}

void EngineCore::updateWorld(f64 deltaTime) {
    m_world->tick(deltaTime);
}

bool EngineCore::loadRom(const u8* data, size_t size) {
    unloadRom();

    m_rom_data.assign(data, data + size);

    // Load assets from ROM
    if (!loadAssetsFromRom(data, size, m_assets)) {
        m_rom_data.clear();
        return false;
    }

    // Update world viewport from manifest
    m_world->viewportWidth = m_assets.manifest.viewportWidth;
    m_world->viewportHeight = m_assets.manifest.viewportHeight;

    m_rom_loaded = true;
    return true;
}

void EngineCore::unloadRom() {
    if (m_rom_loaded) {
        m_rom_data.clear();
        m_assets.clear();
        m_world->clearAllSpaces();
        registry().clear();
        m_rom_loaded = false;
    }
}

void EngineCore::spawn(WorldObject* obj, const Vec3* pos) {
    m_world->spawn(obj, pos);
}

void EngineCore::exile(WorldObject* obj) {
    m_world->despawnFromAllSpaces(obj);
}

} // namespace bmsx
