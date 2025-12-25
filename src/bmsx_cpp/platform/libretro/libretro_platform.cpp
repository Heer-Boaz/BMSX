/*
 * libretro_platform.cpp - BMSX Platform implementation for libretro
 */

#include "libretro_platform.h"
#include "../../core/types.h"
#include "../../input/input.h"
#include "../../input/gamepadinput.h"
#include "../../input/keyboardinput.h"
#include <cstring>
#include <cstdarg>
#include <fstream>
#include <algorithm>

namespace bmsx {

/* ============================================================================
 * LibretroPlatform implementation
 * ============================================================================ */

LibretroPlatform::LibretroPlatform() {
    // Initialize framebuffer with default size
    m_framebuffer.resize(256, 224);

    // Reserve audio buffer for one frame at 44100Hz / 60fps = ~735 samples
    m_audio_buffer.reserve(1024);

    // Create platform components
    m_clock = std::make_unique<LibretroClock>();
    m_frame_loop = std::make_unique<LibretroFrameLoop>();
    m_lifecycle = std::make_unique<DefaultLifecycle>();
    m_input_hub = std::make_unique<LibretroInputHub>(this);
    m_audio_service = std::make_unique<LibretroAudioService>(this);
    m_gameview_host = std::make_unique<LibretroGameViewHost>(m_framebuffer);
    m_microtask_queue = std::make_unique<DefaultMicrotaskQueue>();

    // Initialize controller devices
    m_controller_devices.fill(RETRO_DEVICE_JOYPAD);

    // Create and initialize the engine
    m_engine = std::make_unique<EngineCore>();
    m_engine->initialize(this);

    m_keyboard_input = std::make_unique<KeyboardInput>("keyboard:0");
    Input::instance().registerKeyboard("keyboard:0", m_keyboard_input.get());

    for (size_t i = 0; i < InputState::MAX_PLAYERS; i++) {
        std::string deviceId = "gamepad:" + std::to_string(i);
        auto gamepad = std::make_unique<GamepadInput>(deviceId, "libretro");
        Input::instance().registerGamepad(deviceId, gamepad.get());
        Input::instance().assignGamepadToPlayer(gamepad.get(), static_cast<i32>(i + 1));
        m_gamepad_inputs[i] = std::move(gamepad);
    }

    log(RETRO_LOG_INFO, "[BMSX] Platform initialized\n");
}

LibretroPlatform::~LibretroPlatform() {
    unloadRom();

    // Shutdown engine before destroying platform components
    if (m_engine) {
        m_engine->shutdown();
        m_engine.reset();
    }

    log(RETRO_LOG_INFO, "[BMSX] Platform destroyed\n");
}

void LibretroPlatform::setInputPollCallback(retro_input_poll_t cb) {
    m_input_poll_cb = cb;
    static_cast<LibretroInputHub*>(m_input_hub.get())->setInputPollCallback(cb);
}

void LibretroPlatform::setInputStateCallback(retro_input_state_t cb) {
    m_input_state_cb = cb;
    static_cast<LibretroInputHub*>(m_input_hub.get())->setInputStateCallback(cb);
}

void LibretroPlatform::setAVInfo(const retro_system_av_info& info) {
    m_av_info = info;
    m_framebuffer.resize(info.geometry.base_width, info.geometry.base_height);

    auto* view = m_engine->view();
    view->setViewportSize(static_cast<i32>(info.geometry.base_width), static_cast<i32>(info.geometry.base_height));
    auto* backend = static_cast<SoftwareBackend*>(view->backend());
    static_cast<LibretroGameViewHost*>(m_gameview_host.get())->updateBackendFramebuffer(backend);

    if (auto* audioService = dynamic_cast<LibretroAudioService*>(m_audio_service.get())) {
        audioService->setTiming(info.timing.sample_rate, info.timing.fps);
    }
}

void LibretroPlatform::setControllerDevice(unsigned port, unsigned device) {
    if (port < m_controller_devices.size()) {
        m_controller_devices[port] = device;
    }
}

bool LibretroPlatform::loadRom(const uint8_t* data, size_t size) {
    unloadRom();

    m_rom_data.assign(data, data + size);

    // Load ROM into engine
    if (m_engine && !m_engine->loadRom(data, size)) {
        log(RETRO_LOG_ERROR, "[BMSX] Failed to load ROM into engine\n");
        m_rom_data.clear();
        return false;
    }

    m_rom_loaded = true;
    log(RETRO_LOG_INFO, "[BMSX] ROM loaded (%zu bytes)\n", size);
    return true;
}

void LibretroPlatform::tryLoadEngineAssets(const char* romPath) {
    // Extract directory from ROM path
    std::string pathStr(romPath);
    size_t lastSlash = pathStr.find_last_of("/\\");
    std::string directory = (lastSlash != std::string::npos) ? pathStr.substr(0, lastSlash + 1) : "";
    std::string engineAssetsPath = directory + "engine.assets.rom";

    // Try to load engine assets (optional - not fatal if missing)
    std::ifstream engineFile(engineAssetsPath, std::ios::binary | std::ios::ate);
    if (engineFile) {
        size_t engineSize = engineFile.tellg();
        engineFile.seekg(0);
        std::vector<uint8_t> engineData(engineSize);
        if (engineFile.read(reinterpret_cast<char*>(engineData.data()), engineSize)) {
            if (m_engine && m_engine->loadEngineAssets(engineData.data(), engineData.size())) {
                log(RETRO_LOG_INFO, "[BMSX] Engine assets loaded (%zu bytes) from: %s\n", engineSize, engineAssetsPath.c_str());
            } else {
                log(RETRO_LOG_WARN, "[BMSX] Failed to parse engine assets: %s\n", engineAssetsPath.c_str());
            }
        }
    } else {
        log(RETRO_LOG_INFO, "[BMSX] No engine assets found at: %s (continuing without)\n", engineAssetsPath.c_str());
    }
}

bool LibretroPlatform::loadRomFromPath(const char* path) {
    // Load engine assets first (if available in same directory)
    tryLoadEngineAssets(path);

    // Load the game ROM
    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file) {
        log(RETRO_LOG_ERROR, "[BMSX] Failed to open ROM file: %s\n", path);
        return false;
    }

    size_t size = file.tellg();
    file.seekg(0);

    std::vector<uint8_t> data(size);
    if (!file.read(reinterpret_cast<char*>(data.data()), size)) {
        log(RETRO_LOG_ERROR, "[BMSX] Failed to read ROM file: %s\n", path);
        return false;
    }

    return loadRom(data.data(), data.size());
}

bool LibretroPlatform::loadEmptyCart() {
    unloadRom();

    // Try to load engine assets from dist directory (default location)
    // TODO: Make this configurable via core options
    const char* engineAssetsPaths[] = {
        "dist/engine.assets.rom",
        "./engine.assets.rom",
        "../engine.assets.rom",
        nullptr
    };

    bool assetsLoaded = false;
    for (int i = 0; engineAssetsPaths[i] != nullptr; i++) {
        std::ifstream file(engineAssetsPaths[i], std::ios::binary | std::ios::ate);
        if (file) {
            size_t size = file.tellg();
            file.seekg(0);
            std::vector<uint8_t> data(size);
            if (file.read(reinterpret_cast<char*>(data.data()), size)) {
                if (m_engine && m_engine->loadEngineAssets(data.data(), data.size())) {
                    log(RETRO_LOG_INFO, "[BMSX] Engine assets loaded from: %s\n", engineAssetsPaths[i]);
                    assetsLoaded = true;
                    break;
                }
            }
        }
    }

    if (!assetsLoaded) {
        log(RETRO_LOG_WARN, "[BMSX] No engine assets found, running without system program\n");
    }

    // Boot engine with engine assets (runs system_program.lua)
    if (assetsLoaded && m_engine && m_engine->bootWithoutCart()) {
        log(RETRO_LOG_INFO, "[BMSX] Booted with engine system program\n");
        m_rom_loaded = true;
        return true;
    }

    // Fallback: just mark as loaded to show test pattern
    m_rom_loaded = true;
    log(RETRO_LOG_INFO, "[BMSX] Empty cart loaded (test pattern mode)\n");
    return true;
}

void LibretroPlatform::unloadRom() {
    if (m_rom_loaded) {
        // Unload from engine
        if (m_engine) {
            m_engine->unloadRom();
        }
        m_rom_data.clear();
        m_rom_loaded = false;
        log(RETRO_LOG_INFO, "[BMSX] ROM unloaded\n");
    }
}

void LibretroPlatform::reset() {
    // Reset engine state
    if (m_engine && m_rom_loaded) {
        m_engine->stop();
        // Re-initialize world, keep ROM loaded
        m_engine->start();
    }
    log(RETRO_LOG_INFO, "[BMSX] Game reset\n");
}

void LibretroPlatform::runFrame() {
    if (!m_rom_loaded || !m_engine) return;

    // Clear audio buffer
    m_audio_buffer.clear();

    // Poll input
    pollInput();

    // Advance clock
    if (auto* clock = dynamic_cast<LibretroClock*>(m_clock.get())) {
        clock->advanceFrame(m_av_info.timing.fps);
    }

    // Calculate delta time (1/fps in seconds)
    f64 dt = m_av_info.timing.fps > 0 ? 1.0 / m_av_info.timing.fps : 1.0 / 60.0;

    // Start engine if not running
    if (!m_engine->isRunning() && m_engine->state() == EngineState::Initialized) {
        m_engine->start();
    }

    // Update game logic
    m_engine->tick(dt);

    // Render
    m_engine->render();

    // Collect audio
    processAudio();
}

void LibretroPlatform::pollInput() {
    static_cast<LibretroInputHub*>(m_input_hub.get())->poll();
}

void LibretroPlatform::processAudio() {
    if (auto* audioService = dynamic_cast<LibretroAudioService*>(m_audio_service.get())) {
        audioService->collectSamples(m_audio_buffer);
    }
}

void LibretroPlatform::log(retro_log_level level, const char* fmt, ...) {
    if (m_log_cb) {
        va_list args;
        va_start(args, fmt);
        char buffer[1024];
        vsnprintf(buffer, sizeof(buffer), fmt, args);
        va_end(args);
        m_log_cb(level, "%s", buffer);
    }
}

size_t LibretroPlatform::getStateSize() const {
    // TODO: Calculate actual state size
    return 0;
}

bool LibretroPlatform::saveState(void* data, size_t size) {
    // TODO: Serialize game state
    (void)data;
    (void)size;
    return false;
}

bool LibretroPlatform::loadState(const void* data, size_t size) {
    // TODO: Deserialize game state
    (void)data;
    (void)size;
    return false;
}

void LibretroPlatform::resetCheats() {
    // TODO: Clear all cheats
}

void LibretroPlatform::setCheat(unsigned index, bool enabled, const char* code) {
    // TODO: Parse and apply cheat code
    (void)index;
    (void)enabled;
    (void)code;
}

void* LibretroPlatform::getSaveRAM() {
    return m_save_ram.empty() ? nullptr : m_save_ram.data();
}

size_t LibretroPlatform::getSaveRAMSize() const {
    return m_save_ram.size();
}

void* LibretroPlatform::getSystemRAM() {
    return m_system_ram.empty() ? nullptr : m_system_ram.data();
}

size_t LibretroPlatform::getSystemRAMSize() const {
    return m_system_ram.size();
}

/* ============================================================================
 * LibretroInputHub implementation
 * ============================================================================ */

LibretroInputHub::LibretroInputHub(LibretroPlatform* platform)
    : m_platform(platform) {
}

namespace {

constexpr std::array<const char*, InputState::BUTTONS_PER_PLAYER> kLibretroButtonIds = {
    "a",      // RETRO_DEVICE_ID_JOYPAD_B
    "x",      // RETRO_DEVICE_ID_JOYPAD_Y
    "select", // RETRO_DEVICE_ID_JOYPAD_SELECT
    "start",  // RETRO_DEVICE_ID_JOYPAD_START
    "up",     // RETRO_DEVICE_ID_JOYPAD_UP
    "down",   // RETRO_DEVICE_ID_JOYPAD_DOWN
    "left",   // RETRO_DEVICE_ID_JOYPAD_LEFT
    "right",  // RETRO_DEVICE_ID_JOYPAD_RIGHT
    "b",      // RETRO_DEVICE_ID_JOYPAD_A
    "y",      // RETRO_DEVICE_ID_JOYPAD_X
    "l1",     // RETRO_DEVICE_ID_JOYPAD_L
    "r1",     // RETRO_DEVICE_ID_JOYPAD_R
    "l2",     // RETRO_DEVICE_ID_JOYPAD_L2
    "r2",     // RETRO_DEVICE_ID_JOYPAD_R2
    "l3",     // RETRO_DEVICE_ID_JOYPAD_L3
    "r3"      // RETRO_DEVICE_ID_JOYPAD_R3
};

f32 normalizeAxis(i16 value) {
    return static_cast<f32>(value) / 32767.0f;
}

} // namespace

void LibretroInputHub::poll() {
    m_input_poll_cb();

    InputState new_state;

    // Poll all players
    for (unsigned player = 0; player < InputState::MAX_PLAYERS; player++) {
        const std::string deviceId = "gamepad:" + std::to_string(player);
        uint16_t buttons = 0;

        // Poll digital buttons
        for (unsigned btn = 0; btn < InputState::BUTTONS_PER_PLAYER; btn++) {
            if (m_input_state_cb(player, RETRO_DEVICE_JOYPAD, 0, btn)) {
                buttons |= (1 << btn);
            }
        }
        new_state.buttons[player] = buttons;

        // Poll analog sticks
        new_state.analog[player * 4 + 0] = m_input_state_cb(player, RETRO_DEVICE_ANALOG,
            RETRO_DEVICE_INDEX_ANALOG_LEFT, RETRO_DEVICE_ID_ANALOG_X);
        new_state.analog[player * 4 + 1] = m_input_state_cb(player, RETRO_DEVICE_ANALOG,
            RETRO_DEVICE_INDEX_ANALOG_LEFT, RETRO_DEVICE_ID_ANALOG_Y);
        new_state.analog[player * 4 + 2] = m_input_state_cb(player, RETRO_DEVICE_ANALOG,
            RETRO_DEVICE_INDEX_ANALOG_RIGHT, RETRO_DEVICE_ID_ANALOG_X);
        new_state.analog[player * 4 + 3] = m_input_state_cb(player, RETRO_DEVICE_ANALOG,
            RETRO_DEVICE_INDEX_ANALOG_RIGHT, RETRO_DEVICE_ID_ANALOG_Y);

        // Generate events for button changes
        uint16_t changed = new_state.buttons[player] ^ m_prev_state.buttons[player];

        for (unsigned btn = 0; btn < InputState::BUTTONS_PER_PLAYER; btn++) {
            if (changed & (1 << btn)) {
                bool pressed = (new_state.buttons[player] & (1 << btn)) != 0;

                InputEvt evt;
                evt.type = pressed ? InputEvtType::ButtonDown : InputEvtType::ButtonUp;
                evt.deviceId = deviceId;
                evt.code = kLibretroButtonIds[btn];
                evt.value = pressed ? 1.0f : 0.0f;

                m_event_queue.push_back(evt);

                // Notify handlers
                for (const auto& handler : m_handlers) {
                    handler(evt);
                }
            }
        }

        const size_t analogBase = player * 4;
        bool leftChanged = new_state.analog[analogBase] != m_prev_state.analog[analogBase] ||
            new_state.analog[analogBase + 1] != m_prev_state.analog[analogBase + 1];
        if (leftChanged) {
            InputEvt evt;
            evt.type = InputEvtType::AxisMove;
            evt.deviceId = deviceId;
            evt.code = "leftstick";
            evt.x = normalizeAxis(new_state.analog[analogBase]);
            evt.y = normalizeAxis(new_state.analog[analogBase + 1]);
            m_event_queue.push_back(evt);
            for (const auto& handler : m_handlers) {
                handler(evt);
            }
        }

        bool rightChanged = new_state.analog[analogBase + 2] != m_prev_state.analog[analogBase + 2] ||
            new_state.analog[analogBase + 3] != m_prev_state.analog[analogBase + 3];
        if (rightChanged) {
            InputEvt evt;
            evt.type = InputEvtType::AxisMove;
            evt.deviceId = deviceId;
            evt.code = "rightstick";
            evt.x = normalizeAxis(new_state.analog[analogBase + 2]);
            evt.y = normalizeAxis(new_state.analog[analogBase + 3]);
            m_event_queue.push_back(evt);
            for (const auto& handler : m_handlers) {
                handler(evt);
            }
        }
    }

    m_prev_state = new_state;
}

SubscriptionHandle LibretroInputHub::subscribe(std::function<void(const InputEvt&)> handler) {
    m_handlers.push_back(handler);
    size_t idx = m_handlers.size() - 1;

    return SubscriptionHandle::create([this, idx]() {
        if (idx < m_handlers.size()) {
            m_handlers.erase(m_handlers.begin() + static_cast<ptrdiff_t>(idx));
        }
    });
}

std::optional<InputEvt> LibretroInputHub::nextEvt() {
    if (m_event_queue.empty()) {
        return std::nullopt;
    }
    InputEvt evt = m_event_queue.front();
    m_event_queue.erase(m_event_queue.begin());
    return evt;
}

void LibretroInputHub::clearEvtQ() {
    m_event_queue.clear();
}

/* ============================================================================
 * LibretroAudioService implementation
 * ============================================================================ */

LibretroAudioService::LibretroAudioService(LibretroPlatform* platform)
    : m_platform(platform) {
}

void LibretroAudioService::setTiming(double sampleRate, double fps) {
    m_sample_rate = sampleRate;
    m_frame_rate = fps;
    m_sample_accumulator = 0.0;
}

void LibretroAudioService::collectSamples(AudioBuffer& buffer) {
    const double samplesPerFrame = m_sample_rate / m_frame_rate;
    m_sample_accumulator += samplesPerFrame;
    const size_t frames = static_cast<size_t>(m_sample_accumulator);
    if (frames == 0) {
        buffer.clear();
        return;
    }
    m_sample_accumulator -= frames;

    const size_t totalSamples = frames * 2;
    if (m_mix_buffer.size() < totalSamples) {
        m_mix_buffer.resize(totalSamples);
    }

    m_platform->engine()->soundMaster()->renderSamples(m_mix_buffer.data(), frames, static_cast<i32>(m_sample_rate));

    buffer.write(m_mix_buffer.data(), frames);
}

Voice* LibretroAudioService::createVoice() {
    // TODO: Create and return a voice for audio playback
    return nullptr;
}

void LibretroAudioService::destroyVoice(Voice* voice) {
    // TODO: Destroy voice
    (void)voice;
}

/* ============================================================================
 * LibretroClock implementation
 * ============================================================================ */

LibretroClock::LibretroClock() = default;

void LibretroClock::advanceFrame(double fps) {
    m_current_time += 1000.0 / fps;
}

/* ============================================================================
 * LibretroFrameLoop implementation
 * ============================================================================ */

void LibretroFrameLoop::tick(std::function<void()> callback) {
    if (m_running && callback) {
        callback();
    }
    if (m_running && m_callback) {
        // TODO: Pass proper timestamps
        m_callback(0.0, 1.0 / 60.0);
    }
}

void LibretroFrameLoop::start(std::function<void(double, double)> callback) {
    m_callback = callback;
    m_running = true;
}

void LibretroFrameLoop::stop() {
    m_running = false;
}

/* ============================================================================
 * LibretroGameViewHost implementation
 * ============================================================================ */

LibretroGameViewHost::LibretroGameViewHost(Framebuffer& framebuffer)
    : m_framebuffer(framebuffer) {
}

std::unique_ptr<GPUBackend> LibretroGameViewHost::createBackend() {
    return std::make_unique<SoftwareBackend>(
        m_framebuffer.data,
        static_cast<i32>(m_framebuffer.width),
        static_cast<i32>(m_framebuffer.height),
        static_cast<i32>(m_framebuffer.pitch)
    );
}

void LibretroGameViewHost::updateBackendFramebuffer(SoftwareBackend* backend) {
    backend->setFramebuffer(
        m_framebuffer.data,
        static_cast<i32>(m_framebuffer.width),
        static_cast<i32>(m_framebuffer.height),
        static_cast<i32>(m_framebuffer.pitch)
    );
}

void* LibretroGameViewHost::getCapability(std::string_view name) {
    // TODO: Return capabilities like viewport-metrics, etc.
    (void)name;
    return nullptr;
}

SubscriptionHandle LibretroGameViewHost::onResize(std::function<void(const ResizeEvt&)> handler) {
    // Libretro doesn't really have dynamic resizing, but we keep the interface
    (void)handler;
    return SubscriptionHandle::create([](){});
}

SubscriptionHandle LibretroGameViewHost::onFocusChange(std::function<void(bool)> handler) {
    // Libretro handles focus at frontend level
    (void)handler;
    return SubscriptionHandle::create([](){});
}

} // namespace bmsx
