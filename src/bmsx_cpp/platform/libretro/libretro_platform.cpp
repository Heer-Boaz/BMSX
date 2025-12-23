/*
 * libretro_platform.cpp - BMSX Platform implementation for libretro
 */

#include "libretro_platform.h"
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

    log(RETRO_LOG_INFO, "[BMSX] Platform initialized\n");
}

LibretroPlatform::~LibretroPlatform() {
    unloadRom();
    log(RETRO_LOG_INFO, "[BMSX] Platform destroyed\n");
}

void LibretroPlatform::setAVInfo(const retro_system_av_info& info) {
    m_av_info = info;
    m_framebuffer.resize(info.geometry.base_width, info.geometry.base_height);

    if (auto* audio = dynamic_cast<LibretroAudioService*>(m_audio_service.get())) {
        // Update sample rate if needed
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
    m_rom_loaded = true;

    // TODO: Parse ROM header, initialize game state
    // This is where you'd integrate with the actual BMSX engine

    log(RETRO_LOG_INFO, "[BMSX] ROM loaded (%zu bytes)\n", size);
    return true;
}

bool LibretroPlatform::loadRomFromPath(const char* path) {
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
    m_rom_loaded = true;

    // Initialize with empty cart state
    log(RETRO_LOG_INFO, "[BMSX] Empty cart loaded\n");
    return true;
}

void LibretroPlatform::unloadRom() {
    if (m_rom_loaded) {
        m_rom_data.clear();
        m_rom_loaded = false;
        log(RETRO_LOG_INFO, "[BMSX] ROM unloaded\n");
    }
}

void LibretroPlatform::reset() {
    // TODO: Reset game state
    log(RETRO_LOG_INFO, "[BMSX] Game reset\n");
}

void LibretroPlatform::runFrame() {
    if (!m_rom_loaded) return;

    // Clear audio buffer
    m_audio_buffer.clear();

    // Poll input
    pollInput();

    // Advance clock
    if (auto* clock = dynamic_cast<LibretroClock*>(m_clock.get())) {
        clock->advanceFrame(m_av_info.timing.fps);
    }

    // Process microtasks
    m_microtask_queue->flush();

    // Run frame logic
    if (auto* frameLoop = dynamic_cast<LibretroFrameLoop*>(m_frame_loop.get())) {
        frameLoop->tick([this]() {
            // TODO: Actual game update logic
        });
    }

    // Render
    renderFrame();

    // Collect audio
    processAudio();
}

void LibretroPlatform::pollInput() {
    if (auto* inputHub = dynamic_cast<LibretroInputHub*>(m_input_hub.get())) {
        inputHub->poll();
    }
}

void LibretroPlatform::renderFrame() {
    // TODO: Render actual game graphics to m_framebuffer
    // For now, just fill with a test pattern

    uint32_t* fb = m_framebuffer.data;
    unsigned w = m_framebuffer.width;
    unsigned h = m_framebuffer.height;

    static uint8_t frame_counter = 0;
    frame_counter++;

    for (unsigned y = 0; y < h; y++) {
        for (unsigned x = 0; x < w; x++) {
            // Simple test pattern: gradient with animated offset
            uint8_t r = static_cast<uint8_t>((x + frame_counter) & 0xFF);
            uint8_t g = static_cast<uint8_t>((y + frame_counter) & 0xFF);
            uint8_t b = static_cast<uint8_t>(((x ^ y) + frame_counter) & 0xFF);
            fb[y * w + x] = (r << 16) | (g << 8) | b;
        }
    }
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

void LibretroInputHub::poll() {
    if (!m_input_state_cb) return;

    InputState new_state;

    // Poll all players
    for (unsigned player = 0; player < InputState::MAX_PLAYERS; player++) {
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
    }

    // Generate events for button changes
    for (unsigned player = 0; player < InputState::MAX_PLAYERS; player++) {
        uint16_t changed = new_state.buttons[player] ^ m_prev_state.buttons[player];

        for (unsigned btn = 0; btn < InputState::BUTTONS_PER_PLAYER; btn++) {
            if (changed & (1 << btn)) {
                bool pressed = (new_state.buttons[player] & (1 << btn)) != 0;

                InputEvt evt;
                evt.type = pressed ? InputEvtType::ButtonDown : InputEvtType::ButtonUp;
                evt.player = player;
                evt.button = btn;
                evt.value = pressed ? 1.0f : 0.0f;

                m_event_queue.push_back(evt);

                // Notify handlers
                for (const auto& handler : m_handlers) {
                    handler(evt);
                }
            }
        }
    }

    m_prev_state = new_state;
}

SubscriptionHandle LibretroInputHub::subscribe(std::function<void(const InputEvt&)> handler) {
    int id = m_next_handle_id++;
    m_handlers.push_back(handler);

    return SubscriptionHandle::create(id, [this, idx = m_handlers.size() - 1]() {
        if (idx < m_handlers.size()) {
            m_handlers.erase(m_handlers.begin() + idx);
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

void LibretroAudioService::collectSamples(AudioBuffer& buffer) {
    // TODO: Mix audio from all voices
    // For now, generate silence

    constexpr size_t SAMPLES_PER_FRAME = 735; // ~44100 / 60
    static std::vector<int16_t> silence(SAMPLES_PER_FRAME * 2, 0);

    buffer.write(silence.data(), SAMPLES_PER_FRAME);
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
    m_current_time += 1.0 / fps;
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

void* LibretroGameViewHost::getCapability(std::string_view name) {
    // TODO: Return capabilities like viewport-metrics, etc.
    (void)name;
    return nullptr;
}

SubscriptionHandle LibretroGameViewHost::onResize(std::function<void(const ResizeEvt&)> handler) {
    // Libretro doesn't really have dynamic resizing, but we keep the interface
    (void)handler;
    return SubscriptionHandle::create(0, [](){});
}

SubscriptionHandle LibretroGameViewHost::onFocusChange(std::function<void(bool)> handler) {
    // Libretro handles focus at frontend level
    (void)handler;
    return SubscriptionHandle::create(0, [](){});
}

/* ============================================================================
 * DefaultLifecycle implementation (for completeness)
 * ============================================================================ */

DefaultLifecycle::DefaultLifecycle() = default;
DefaultLifecycle::~DefaultLifecycle() = default;

SubscriptionHandle DefaultLifecycle::onWillExit(std::function<void()> handler) {
    int id = m_next_handle_id++;
    m_handlers.push_back(handler);

    return SubscriptionHandle::create(id, [this, idx = m_handlers.size() - 1]() {
        if (idx < m_handlers.size()) {
            m_handlers.erase(m_handlers.begin() + idx);
        }
    });
}

void DefaultLifecycle::triggerExit() {
    for (const auto& handler : m_handlers) {
        handler();
    }
}

} // namespace bmsx
