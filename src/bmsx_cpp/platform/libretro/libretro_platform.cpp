/*
 * libretro_platform.cpp - BMSX Platform implementation for libretro
 */

#include "libretro_platform.h"
#include "../../core/types.h"
#include "../../input/input.h"
#include "../../input/gamepadinput.h"
#include "../../input/keyboardinput.h"
#include "../../render/renderpasslib.h"
#if BMSX_ENABLE_GLES2
#include "../../render/gles2_backend.h"
#include "../../render/sprites_pipeline_gles2.h"
#include "../../render/crt_pipeline_gles2.h"
#endif
#include <chrono>
#include <cstring>
#include <cstdarg>
#include <fstream>
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <string>

namespace bmsx {
namespace {
constexpr double kAudioLeadFrames = 8.0;
constexpr double kFrameSpikeMultiplier = 1.2;

std::string buildEngineAssetsPath(const std::string& directory) {
    if (directory.empty()) {
        return {};
    }
    std::string path = directory;
    const char last = path.back();
    if (last != '/' && last != '\\') {
        path.push_back('/');
    }
    path.append("engine.assets.rom");
    return path;
}
}

/* ============================================================================
 * LibretroPlatform implementation
 * ============================================================================ */

LibretroPlatform::LibretroPlatform(bool use_hw_render)
    : m_use_hw_render(use_hw_render) {
#if !BMSX_ENABLE_GLES2
    m_use_hw_render = false;
#endif
    // Initialize framebuffer with default size
    m_framebuffer.resize(0, 0);

    // Reserve audio buffer for ten frames at 48000Hz / 50fps = 9600 samples
    m_audio_buffer.reserve(9600);

    // Create platform components
    m_clock = std::make_unique<LibretroClock>();
    m_frame_loop = std::make_unique<LibretroFrameLoop>();
    m_lifecycle = std::make_unique<DefaultLifecycle>();
    m_input_hub = std::make_unique<LibretroInputHub>(this);
    m_audio_service = std::make_unique<LibretroAudioService>(this);
    m_gameview_host = std::make_unique<LibretroGameViewHost>(m_framebuffer, m_use_hw_render);
    m_microtask_queue = std::make_unique<DefaultMicrotaskQueue>();

    // Initialize controller devices
    m_controller_devices.fill(RETRO_DEVICE_JOYPAD);

    // Create and initialize the engine
    m_engine = std::make_unique<EngineCore>();
    m_engine->initialize(this);
    if (m_use_hw_render) {
        m_engine->view()->crt_postprocessing_enabled = false;
    }

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
    Input::instance().shutdown();

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

void LibretroPlatform::setHwRenderCallbacks(retro_hw_get_current_framebuffer_t get_current_framebuffer) {
#if BMSX_ENABLE_GLES2
    m_hw_get_current_framebuffer = get_current_framebuffer;
    auto* backend = static_cast<OpenGLES2Backend*>(m_engine->view()->backend());
    backend->setFramebufferGetter(m_hw_get_current_framebuffer);
#else
    (void)get_current_framebuffer;
    throw std::runtime_error("[LibretroPlatform] OpenGLES2 backend disabled at compile time.");
#endif
}

void LibretroPlatform::onContextReset() {
#if BMSX_ENABLE_GLES2
    auto* view = m_engine->view();
    auto* backend = static_cast<OpenGLES2Backend*>(view->backend());
    backend->setFramebufferGetter(m_hw_get_current_framebuffer);
    backend->onContextReset();
    static_cast<LibretroGameViewHost*>(m_gameview_host.get())->updateBackend(backend);

    auto registry = std::make_unique<RenderPassLibrary>(backend);
    registry->registerBuiltin();
    view->setPipelineRegistry(std::move(registry));
    view->rebuildGraph();
    m_engine->refreshRenderAssets();
#else
    throw std::runtime_error("[LibretroPlatform] OpenGLES2 backend disabled at compile time.");
#endif
}

void LibretroPlatform::onContextDestroy() {
#if BMSX_ENABLE_GLES2
    auto* view = m_engine->view();
    auto* backend = static_cast<OpenGLES2Backend*>(view->backend());
    SpritesPipeline::shutdownGLES2(backend);
    CRTPipeline::shutdownGLES2(backend);
    backend->onContextDestroy();
    view->setPipelineRegistry(std::unique_ptr<RenderPassLibrary>());
#else
    throw std::runtime_error("[LibretroPlatform] OpenGLES2 backend disabled at compile time.");
#endif
}

void LibretroPlatform::setAVInfo(const retro_system_av_info& info) {
    m_av_info = info;
    m_has_av_info = true;
    m_frame_time_sec = 1.0 / info.timing.fps;
    m_framebuffer.resize(info.geometry.base_width, info.geometry.base_height);
    log(RETRO_LOG_INFO, "[BMSX] AV Info set: %ux%u @ %.2fHz, Sample Rate: %.2fHz\n",
        info.geometry.base_width,
        info.geometry.base_height,
        info.timing.fps,
        info.timing.sample_rate
    );
    log(RETRO_LOG_INFO, "[BMSX] Frame time set: %.3fms (fps %.2f)\n",
        m_frame_time_sec * 1000.0,
        info.timing.fps
    );

    auto* view = m_engine->view();
    Vec2 renderTargetSize{
        static_cast<f32>(info.geometry.base_width),
        static_cast<f32>(info.geometry.base_height)
    };
    Vec2 offscreenSize{
        renderTargetSize.x * 2.0f,
        renderTargetSize.y * 2.0f
    };
    view->configureRenderTargets(&renderTargetSize, &renderTargetSize, &offscreenSize);
    auto* backend = view->backend();
    static_cast<LibretroGameViewHost*>(m_gameview_host.get())->updateBackend(backend);

    if (auto* audioService = dynamic_cast<LibretroAudioService*>(m_audio_service.get())) {
        audioService->setTiming(info.timing.sample_rate, info.timing.fps);
    }
}

void LibretroPlatform::setFrameTimeUsec(retro_usec_t usec) {
    const double nextFrameTimeSec = static_cast<double>(usec) / 1000000.0;
    static double lastLoggedFrameTimeSec = -1.0;
    m_frame_time_sec = nextFrameTimeSec;
    if (nextFrameTimeSec != lastLoggedFrameTimeSec) {
        log(RETRO_LOG_INFO, "[BMSX] Frame time override: %llu usec -> %.3fms (fps %.2f)\n",
            static_cast<unsigned long long>(usec),
            nextFrameTimeSec * 1000.0,
            1.0 / nextFrameTimeSec
        );
        lastLoggedFrameTimeSec = nextFrameTimeSec;
    }
    if (auto* audioService = dynamic_cast<LibretroAudioService*>(m_audio_service.get())) {
        audioService->setFrameTimeSec(m_frame_time_sec);
    }
}

void LibretroPlatform::setControllerDevice(unsigned port, unsigned device) {
    if (port < m_controller_devices.size()) {
        m_controller_devices[port] = device;
    }
}

void LibretroPlatform::applyManifestViewport() {
    const auto& manifest = m_engine->assets().manifest;
    m_pending_viewport = {
        static_cast<f32>(manifest.viewportWidth),
        static_cast<f32>(manifest.viewportHeight)
    };
    m_has_pending_viewport = true;
    if (!m_has_av_info) {
        return;
    }

    retro_system_av_info nextInfo = m_av_info;
    nextInfo.geometry.base_width = static_cast<unsigned>(m_pending_viewport.x);
    nextInfo.geometry.base_height = static_cast<unsigned>(m_pending_viewport.y);
    nextInfo.geometry.max_width = nextInfo.geometry.base_width;
    nextInfo.geometry.max_height = nextInfo.geometry.base_height;
    nextInfo.geometry.aspect_ratio = static_cast<float>(nextInfo.geometry.base_width)
        / static_cast<float>(nextInfo.geometry.base_height);

    m_has_pending_viewport = false;
    m_environ_cb(RETRO_ENVIRONMENT_SET_GEOMETRY, &nextInfo.geometry);
    setAVInfo(nextInfo);
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

    applyManifestViewport();
    m_rom_loaded = true;
    log(RETRO_LOG_INFO, "[BMSX] ROM loaded (%zu bytes)\n", size);
    return true;
}

void LibretroPlatform::tryLoadEngineAssets(const char* romPath) {
    // Extract directory from ROM path
    std::string pathStr(romPath);
    size_t lastSlash = pathStr.find_last_of("/\\");
    std::string directory = (lastSlash != std::string::npos) ? pathStr.substr(0, lastSlash + 1) : "";
    std::string engineAssetsPath = buildEngineAssetsPath(directory);
    std::string systemAssetsPath = buildEngineAssetsPath(m_system_dir);

    if (!engineAssetsPath.empty() && loadEngineAssetsFromFile(engineAssetsPath)) {
        return;
    }
    if (!systemAssetsPath.empty() && loadEngineAssetsFromFile(systemAssetsPath)) {
        return;
    }

    if (!engineAssetsPath.empty()) {
        log(RETRO_LOG_INFO, "[BMSX] No engine assets found at: %s (continuing without)\n", engineAssetsPath.c_str());
    }
    if (!systemAssetsPath.empty()) {
        log(RETRO_LOG_INFO, "[BMSX] No engine assets found in system dir: %s (continuing without)\n", systemAssetsPath.c_str());
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
    std::vector<std::string> engineAssetsPaths;
    std::string systemAssetsPath = buildEngineAssetsPath(m_system_dir);
    if (!systemAssetsPath.empty()) {
        engineAssetsPaths.push_back(systemAssetsPath);
    }
    engineAssetsPaths.emplace_back("dist/engine.assets.rom");
    engineAssetsPaths.emplace_back("./engine.assets.rom");
    engineAssetsPaths.emplace_back("../engine.assets.rom");

    bool assetsLoaded = false;
    for (const auto& path : engineAssetsPaths) {
        if (loadEngineAssetsFromFile(path)) {
            assetsLoaded = true;
            break;
        }
    }

    if (!assetsLoaded) {
        for (const auto& path : engineAssetsPaths) {
            log(RETRO_LOG_INFO, "[BMSX] No engine assets found at: %s\n", path.c_str());
        }
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

bool LibretroPlatform::loadEngineAssetsFromFile(const std::string& path) {
    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file) {
        return false;
    }

    size_t size = file.tellg();
    file.seekg(0);

    std::vector<uint8_t> data(size);
    if (!file.read(reinterpret_cast<char*>(data.data()), size)) {
        log(RETRO_LOG_WARN, "[BMSX] Failed to read engine assets: %s\n", path.c_str());
        return false;
    }

    if (!m_engine->loadEngineAssets(data.data(), data.size())) {
        log(RETRO_LOG_WARN, "[BMSX] Failed to parse engine assets: %s\n", path.c_str());
        return false;
    }

    log(RETRO_LOG_INFO, "[BMSX] Engine assets loaded (%zu bytes) from: %s\n", size, path.c_str());
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
    m_engine->stop();
    static_cast<LibretroAudioService*>(m_audio_service.get())->resetQueue();
    m_audio_buffer.clear();

    if (!m_rom_data.empty()) {
        std::vector<uint8_t> romData = m_rom_data;
        if (!loadRom(romData.data(), romData.size())) {
            log(RETRO_LOG_ERROR, "[BMSX] Reset failed: ROM reload failed\n");
            return;
        }
    } else {
        if (!loadEmptyCart()) {
            log(RETRO_LOG_ERROR, "[BMSX] Reset failed: empty cart boot failed\n");
            return;
        }
    }

    m_engine->start();
    log(RETRO_LOG_INFO, "[BMSX] Game reset (reloaded)\n");
}

void LibretroPlatform::runFrame() {
    if (!m_rom_loaded || !m_engine) return;

    const auto frameStart = std::chrono::steady_clock::now();

    // Clear audio buffer
    m_audio_buffer.clear();

    // Poll input
    const auto pollStart = std::chrono::steady_clock::now();
    pollInput();
    const auto pollEnd = std::chrono::steady_clock::now();

    // Advance clock
    if (auto* clock = dynamic_cast<LibretroClock*>(m_clock.get())) {
        clock->advanceFrame(1.0 / m_frame_time_sec);
    }

    // Calculate delta time in seconds
    f64 dt = m_frame_time_sec;

    // Start engine if not running
    if (!m_engine->isRunning() && m_engine->state() == EngineState::Initialized) {
        m_engine->start();
    }

    // Update game logic
    const auto tickStart = std::chrono::steady_clock::now();
    m_engine->tick(dt);
    const auto tickEnd = std::chrono::steady_clock::now();

    // Render
    const auto renderStart = std::chrono::steady_clock::now();
    m_engine->render();
    const auto renderEnd = std::chrono::steady_clock::now();

    // Collect audio
    const auto audioStart = std::chrono::steady_clock::now();
    processAudio();
    const auto audioEnd = std::chrono::steady_clock::now();

    const auto frameEnd = std::chrono::steady_clock::now();

    const double budgetMs = m_frame_time_sec * 1000.0;
    const double pollMs = std::chrono::duration<double, std::milli>(pollEnd - pollStart).count();
    const double tickMs = std::chrono::duration<double, std::milli>(tickEnd - tickStart).count();
    const double renderMs = std::chrono::duration<double, std::milli>(renderEnd - renderStart).count();
    const double audioMs = std::chrono::duration<double, std::milli>(audioEnd - audioStart).count();
    const double totalMs = std::chrono::duration<double, std::milli>(frameEnd - frameStart).count();
    const auto& tickTiming = m_engine->lastTickTiming();
    const auto& renderTiming = m_engine->lastRenderTiming();

    if (totalMs > budgetMs * kFrameSpikeMultiplier) {
        const char* slowest = "poll";
        double slowestMs = pollMs;
        if (tickMs > slowestMs) { slowest = "tick"; slowestMs = tickMs; }
        if (renderMs > slowestMs) { slowest = "render"; slowestMs = renderMs; }
        if (audioMs > slowestMs) { slowest = "audio"; slowestMs = audioMs; }
        log(RETRO_LOG_WARN,
            "[BMSX] frame spike %.2fms (budget %.2f) poll=%.2f tick=%.2f render=%.2f audio=%.2f slowest=%s %.2fms\n",
            totalMs,
            budgetMs,
            pollMs,
            tickMs,
            renderMs,
            audioMs,
            slowest,
            slowestMs);
        log(RETRO_LOG_WARN,
            "[BMSX] tick ms total=%.2f input=%.2f ide_in=%.2f term_in=%.2f update=%.2f ide=%.2f term=%.2f micro=%.2f\n",
            tickTiming.totalMs,
            tickTiming.inputMs,
            tickTiming.vmIdeInputMs,
            tickTiming.vmTerminalInputMs,
            tickTiming.vmUpdateMs,
            tickTiming.vmIdeMs,
            tickTiming.vmTerminalMs,
            tickTiming.microtaskMs);
        log(RETRO_LOG_WARN,
            "[BMSX] render ms total=%.2f begin=%.2f test=%.2f vm_draw=%.2f vm_ide=%.2f vm_term=%.2f draw=%.2f end=%.2f\n",
            renderTiming.totalMs,
            renderTiming.beginFrameMs,
            renderTiming.testPatternMs,
            renderTiming.vmDrawMs,
            renderTiming.vmIdeDrawMs,
            renderTiming.vmTerminalDrawMs,
            renderTiming.drawGameMs,
            renderTiming.endFrameMs);
    }
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
    m_frame_time_sec = 1.0 / fps;
    m_sample_accumulator = 0.0;
    m_queue_start_samples = 0;
    m_queue_samples = 0;
    m_sample_queue.clear();
    const double framesPerFrame = m_sample_rate * m_frame_time_sec;
    m_target_buffer_frames = static_cast<size_t>(std::ceil(framesPerFrame * kAudioLeadFrames));
}

void LibretroAudioService::setFrameTimeSec(double seconds) {
    m_frame_time_sec = seconds;
    const double framesPerFrame = m_sample_rate * m_frame_time_sec;
    m_target_buffer_frames = static_cast<size_t>(std::ceil(framesPerFrame * kAudioLeadFrames));
}

void LibretroAudioService::resetQueue() {
    m_sample_accumulator = 0.0;
    m_queue_start_samples = 0;
    m_queue_samples = 0;
    m_sample_queue.clear();
}

void LibretroAudioService::collectSamples(AudioBuffer& buffer) {
    // Drive sample count from frame timing and buffer a small lead to smooth jitter.
    const double samplesPerFrame = m_sample_rate * m_frame_time_sec;
    m_sample_accumulator += samplesPerFrame;
    const size_t frames = static_cast<size_t>(m_sample_accumulator);
    if (frames == 0) {
        buffer.clear();
        return;
    }
    m_sample_accumulator -= frames;

    const size_t queuedFrames = m_queue_samples / 2;
    const size_t targetFrames = frames + m_target_buffer_frames;
    if (queuedFrames < targetFrames) {
        const size_t renderFrames = targetFrames - queuedFrames;
        const size_t renderSamples = renderFrames * 2;
        if (m_mix_buffer.size() < renderSamples) {
            m_mix_buffer.resize(renderSamples);
        }
        m_platform->engine()->soundMaster()->renderSamples(m_mix_buffer.data(), renderFrames, static_cast<i32>(m_sample_rate));

        size_t neededSamples = m_queue_start_samples + m_queue_samples + renderSamples;
        if (m_queue_start_samples > 0 && neededSamples > m_sample_queue.size()) {
            std::memmove(m_sample_queue.data(), m_sample_queue.data() + m_queue_start_samples, m_queue_samples * sizeof(int16_t));
            m_queue_start_samples = 0;
            neededSamples = m_queue_samples + renderSamples;
        }
        if (m_sample_queue.size() < neededSamples) {
            m_sample_queue.resize(neededSamples);
        }
        std::memcpy(m_sample_queue.data() + m_queue_start_samples + m_queue_samples, m_mix_buffer.data(), renderSamples * sizeof(int16_t));
        m_queue_samples += renderSamples;
    }

    buffer.write(m_sample_queue.data() + m_queue_start_samples, frames);
    m_queue_start_samples += frames * 2;
    m_queue_samples -= frames * 2;
    if (m_queue_samples == 0) {
        m_queue_start_samples = 0;
    }
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

LibretroGameViewHost::LibretroGameViewHost(Framebuffer& framebuffer, bool use_hw_render)
    : m_framebuffer(framebuffer)
    , m_use_hw_render(use_hw_render) {
}

std::unique_ptr<GPUBackend> LibretroGameViewHost::createBackend() {
    if (m_use_hw_render) {
#if BMSX_ENABLE_GLES2
        return std::make_unique<OpenGLES2Backend>(
            static_cast<i32>(m_framebuffer.width),
            static_cast<i32>(m_framebuffer.height)
        );
#else
        throw std::runtime_error("[LibretroGameViewHost] OpenGLES2 backend disabled at compile time.");
#endif
    }
    return std::make_unique<SoftwareBackend>(
        m_framebuffer.data,
        static_cast<i32>(m_framebuffer.width),
        static_cast<i32>(m_framebuffer.height),
        static_cast<i32>(m_framebuffer.pitch)
    );
}

void LibretroGameViewHost::updateBackend(GPUBackend* backend) {
#if BMSX_ENABLE_GLES2
    if (backend->type() == BackendType::OpenGLES2) {
        auto* glBackend = static_cast<OpenGLES2Backend*>(backend);
        glBackend->setViewportSize(static_cast<i32>(m_framebuffer.width),
                                   static_cast<i32>(m_framebuffer.height));
        return;
    }
#else
    if (backend->type() == BackendType::OpenGLES2) {
        throw std::runtime_error("[LibretroGameViewHost] OpenGLES2 backend disabled at compile time.");
    }
#endif
    auto* softBackend = static_cast<SoftwareBackend*>(backend);
    softBackend->setFramebuffer(
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
