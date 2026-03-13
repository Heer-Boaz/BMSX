/*
 * libretro_platform.h - BMSX Platform implementation for libretro
 *
 * This header defines the LibretroPlatform class that bridges the BMSX engine
 * with the libretro API, allowing the engine to run in RetroArch and other
 * libretro frontends.
 */

#ifndef BMSX_LIBRETRO_PLATFORM_H
#define BMSX_LIBRETRO_PLATFORM_H

#include "libretro.h"
#include "../../platform.h"
#include "../../core/engine_core.h"
#include "../../render/backend/backend.h"
#include <vector>
#include <array>
#include <memory>
#include <unordered_map>
#include <unordered_set>

namespace bmsx {

class GamepadInput;
class KeyboardInput;
class PointerInput;
class LibretroInputHub;

/* ============================================================================
 * Framebuffer for video output
 * ============================================================================ */

struct Framebuffer {
	uint32_t* data = nullptr;
	unsigned width = 0;
	unsigned height = 0;
	size_t pitch = 0;

	void resize(unsigned w, unsigned h) {
		width = w;
		height = h;
		pitch = w * sizeof(uint32_t);
		buffer.resize(w * h);
		data = buffer.data();
	}

private:
	std::vector<uint32_t> buffer;
};

/* ============================================================================
 * LibretroGameViewHost - GameView host for libretro
 * ============================================================================ */

class LibretroGameViewHost : public GameViewHost {
public:
	LibretroGameViewHost(Framebuffer& framebuffer, BackendType backend_type);

	// GameViewHost interface
	void* getCapability(std::string_view name) override;
	ViewportDimensions getSize(Vec2 viewportSize, Vec2 canvasSize) override;
	SubscriptionHandle onResize(std::function<void(const ViewportDimensions&)> handler) override;
	SubscriptionHandle onFocusChange(std::function<void(bool)> handler) override;

	// Create a backend for this platform
	std::unique_ptr<GPUBackend> createBackend() override;

	// Update backend when framebuffer changes
	void updateBackend(GPUBackend* backend);
	void notifyFocusChange(bool focused);

private:
	Framebuffer& m_framebuffer;
	BackendType m_backend_type;
	std::unordered_map<uint32_t, std::function<void(bool)>> m_focus_handlers;
	uint32_t m_next_focus_handler_id = 1;
};

/* ============================================================================
 * Audio buffer for audio output
 * ============================================================================ */

struct AudioBuffer {
	const int16_t* data = nullptr;
	size_t samples = 0;

	void clear() {
		samples = 0;
	}

	void write(const int16_t* src, size_t num_samples) {
		if (num_samples > buffer.size() / 2) {
			buffer.resize(num_samples * 2);
		}
		std::copy(src, src + num_samples * 2, buffer.begin());
		data = buffer.data();
		samples = num_samples;
	}

	void reserve(size_t max_samples) {
		buffer.resize(max_samples * 2); // stereo
	}

private:
	std::vector<int16_t> buffer;
};

/* ============================================================================
 * Input state management
 * ============================================================================ */

struct InputState {
	static constexpr unsigned MAX_PLAYERS = 4;
	static constexpr unsigned BUTTONS_PER_PLAYER = 16;

	// Current button state per player
	std::array<uint16_t, MAX_PLAYERS> buttons{};

	// Analog stick state per player (-32768 to 32767)
	std::array<int16_t, MAX_PLAYERS * 4> analog{}; // left X, left Y, right X, right Y

	void clear() {
		buttons.fill(0);
		analog.fill(0);
	}

	bool isPressed(unsigned player, unsigned button) const {
		if (player >= MAX_PLAYERS || button >= BUTTONS_PER_PLAYER) return false;
		return (buttons[player] & (1 << button)) != 0;
	}

	void setButton(unsigned player, unsigned button, bool pressed) {
		if (player >= MAX_PLAYERS || button >= BUTTONS_PER_PLAYER) return;
		if (pressed) {
			buttons[player] |= (1 << button);
		} else {
			buttons[player] &= ~(1 << button);
		}
	}
};

/* ============================================================================
 * LibretroPlatform - Main platform implementation
 * ============================================================================ */

class LibretroPlatform : public Platform {
public:
	explicit LibretroPlatform(BackendType backend_type);
	~LibretroPlatform() override;

	// Libretro callback setters
	void setEnvironmentCallback(retro_environment_t cb) { m_environ_cb = cb; }
	void setVideoCallback(retro_video_refresh_t cb) { m_video_cb = cb; }
	void setAudioBatchCallback(retro_audio_sample_batch_t cb) { m_audio_batch_cb = cb; }
	void setInputPollCallback(retro_input_poll_t cb);
	void setInputStateCallback(retro_input_state_t cb);
	void postKeyboardEvent(std::string_view code, bool down);
	void clearKeyboardState();
	void resetFocusState();
	void setLogCallback(void (*cb)(enum retro_log_level, const char*, ...)) { m_log_cb = cb; }
	void setSystemDirectory(std::string_view path) { m_system_dir = std::string(path); }
	void setHwRenderCallbacks(retro_hw_get_current_framebuffer_t get_current_framebuffer);
	void onContextReset();
	void onContextDestroy();
	void switchToSoftwareBackend();
	void setPostProcessOptions(bool enableCrt, bool highDetail);
	void setCrtEffectOptions(bool applyNoise,
								bool applyColorBleed,
								bool applyScanlines,
								bool applyBlur,
								bool applyGlow,
								bool applyFringing,
								bool applyAperture);
	void setDitherType(GameView::DitherType type);
	void setFrameSkipOptions(bool enabled);
	void setFrameSkipNext(bool skip);
	void setPlatformPaused(bool paused);
	bool platformPaused() const { return m_platform_paused; }
	void notifyFocusChange(bool focused);

	// Configuration
	void setAVInfo(const retro_system_av_info& info);
	void setFrameTimeUsec(retro_usec_t usec);
	void setControllerDevice(unsigned port, unsigned device);
	void applyManifestViewport();

	// ROM management
	bool loadRom(const uint8_t* data, size_t size);
	bool loadRomFromPath(const char* path);
	bool loadEmptyCart();
	void unloadRom();
	void tryLoadEngineAssets(const char* romPath);  // Try to load bmsx-bios.rom from ROM directory

	// Emulation control
	void reset();
	void runFrame();

	// State access
	const Framebuffer& getFramebuffer() const { return m_framebuffer; }
	const AudioBuffer& getAudioBuffer() const { return m_audio_buffer; }
	double frameTimeSec() const { return m_frame_time_sec; }

	// Engine access
	EngineCore* engine() { return m_engine.get(); }

	// Save states
	size_t getStateSize() const;
	bool saveState(void* data, size_t size);
	bool loadState(const void* data, size_t size);

	// Cheats
	void resetCheats();
	void setCheat(unsigned index, bool enabled, const char* code);

	// Memory access
	void* getSaveRAM();
	size_t getSaveRAMSize() const;
	void* getSystemRAM();
	size_t getSystemRAMSize() const;

	// Platform interface implementation
	Clock* clock() override { return m_clock.get(); }
	FrameLoop* frameLoop() override { return m_frame_loop.get(); }
	Lifecycle* lifecycle() override { return m_lifecycle.get(); }
	InputHub* inputHub() override { return m_input_hub.get(); }
	AudioService* audioService() override { return m_audio_service.get(); }
	GameViewHost* gameviewHost() override { return m_gameview_host.get(); }
	MicrotaskQueue* microtaskQueue() override { return m_microtask_queue.get(); }
	std::string_view type() override { return "libretro"; }
	void log(LogLevel level, std::string_view message) override;

private:
	void pollInput();
	void processAudio();
	void log(retro_log_level level, const char* fmt, ...);
	bool loadEngineAssetsFromFile(const std::string& path);
	bool loadRomOwned(std::vector<uint8_t>&& data);

	// Libretro callbacks
	retro_environment_t m_environ_cb = nullptr;
	retro_video_refresh_t m_video_cb = nullptr;
	retro_audio_sample_batch_t m_audio_batch_cb = nullptr;
	retro_input_poll_t m_input_poll_cb = nullptr;
	retro_input_state_t m_input_state_cb = nullptr;
	void (*m_log_cb)(enum retro_log_level, const char*, ...) = nullptr;
	std::string m_system_dir;

	// Output buffers
	Framebuffer m_framebuffer;
	AudioBuffer m_audio_buffer;
	InputState m_input_state;

	// AV info
	retro_system_av_info m_av_info{};
	bool m_has_av_info = false;
	bool m_has_pending_viewport = false;
	Vec2 m_pending_viewport;
	double m_frame_time_sec = 1.0 / 50.0;
	BackendType m_backend_type = BackendType::Software;
	retro_hw_get_current_framebuffer_t m_hw_get_current_framebuffer = nullptr;
	bool m_crt_postprocessing_enabled = false;
	i32 m_postprocess_scale = 1;
	GameView::DitherType m_dither_type = GameView::DitherType::None;
	bool m_frameskip_enabled = false;
	bool m_frameskip_next = false;
	bool m_render_assets_need_refresh = true;

	// Controller configuration
	std::array<unsigned, 4> m_controller_devices{};

	// Engine instance
	std::unique_ptr<EngineCore> m_engine;

	// Platform components
	std::unique_ptr<Clock> m_clock;
	std::unique_ptr<FrameLoop> m_frame_loop;
	std::unique_ptr<Lifecycle> m_lifecycle;
	std::unique_ptr<InputHub> m_input_hub;
	std::unique_ptr<AudioService> m_audio_service;
	std::unique_ptr<LibretroGameViewHost> m_gameview_host;
	std::unique_ptr<MicrotaskQueue> m_microtask_queue;

	std::unique_ptr<KeyboardInput> m_keyboard_input;
	std::unique_ptr<PointerInput> m_pointer_input;
	std::array<std::unique_ptr<GamepadInput>, InputState::MAX_PLAYERS> m_gamepad_inputs;

	// Save RAM
	std::vector<uint8_t> m_save_ram;

	// System RAM (if exposed)
	std::vector<uint8_t> m_system_ram;

	bool m_rom_loaded = false;
	bool m_platform_paused = false;
};

/* ============================================================================
 * LibretroInputHub - Input handling for libretro
 * ============================================================================ */

class LibretroInputHub : public InputHub {
public:
	explicit LibretroInputHub(LibretroPlatform* platform);

	void poll();
	void setInputPollCallback(retro_input_poll_t cb) { m_input_poll_cb = cb; }
	void setInputStateCallback(retro_input_state_t cb) { m_input_state_cb = cb; }
	void postKeyboardEvent(std::string_view code, bool down);
	void clearKeyboardState();
	void resetFocusState();

	// InputHub interface
	SubscriptionHandle subscribe(std::function<void(const InputEvt&)> handler) override;
	std::optional<InputEvt> nextEvt() override;
	void clearEvtQ() override;

private:
	LibretroPlatform* m_platform;
	retro_input_poll_t m_input_poll_cb = nullptr;
	retro_input_state_t m_input_state_cb = nullptr;
	std::vector<InputEvt> m_event_queue;
	std::vector<std::function<void(const InputEvt&)>> m_handlers;
	int m_next_handle_id = 1;

	// Previous state for edge detection
	InputState m_prev_state;
	std::array<bool, 5> m_prev_pointer_buttons{};
	i32 m_prev_pointer_x = 0;
	i32 m_prev_pointer_y = 0;
	bool m_prev_pointer_position_valid = false;
	std::unordered_set<std::string> m_pressed_keyboard_codes;
};

/* ============================================================================
 * LibretroAudioService - Audio handling for libretro
 * ============================================================================ */

class LibretroAudioService : public AudioService {
public:
	explicit LibretroAudioService(LibretroPlatform* platform);

	void setAudioBatchCallback(retro_audio_sample_batch_t cb) { m_audio_batch_cb = cb; }
	void setTiming(double sampleRate, double fps);
	void setFrameTimeSec(double seconds);
	void resetQueue();
	void refreshTargetBufferFrames();

	// Collect audio samples from all voices
	void collectSamples(AudioBuffer& buffer);

	// AudioService interface
	Voice* createVoice() override;
	void destroyVoice(Voice* voice) override;
	MasterVolume* masterVolume() override { return &m_master_volume; }
	std::string name() override { return "libretro"; }
	bool ready() override { return true; }
	float sampleRate() override { return m_sample_rate; }

private:
	LibretroPlatform* m_platform;
	retro_audio_sample_batch_t m_audio_batch_cb = nullptr;
	double m_sample_rate = 48000.0;
	double m_nominal_frame_time_sec = 1.0 / 50.0;
	double m_sample_accumulator = 0.0;
	std::vector<int16_t> m_sample_queue;
	size_t m_queue_start_samples = 0;
	size_t m_queue_samples = 0;
	size_t m_target_buffer_frames = 0;

	class LibretroMasterVolume : public MasterVolume {
	public:
		float get() override { return m_volume; }
		void set(float vol) override { m_volume = vol; }
	private:
		float m_volume = 1.0f;
	};

	LibretroMasterVolume m_master_volume;
	std::vector<std::unique_ptr<Voice>> m_voices;
	std::vector<int16_t> m_mix_buffer;
};

/* ============================================================================
 * LibretroClock - Time management for libretro
 * ============================================================================ */

class LibretroClock : public Clock {
public:
	LibretroClock();

	void advanceFrame(double fps);

	// Clock interface
	double now() override { return m_current_time; }
	double origin() override { return 0.0; }
	double elapsed() override { return m_current_time; }

private:
	double m_current_time = 0.0;
};

/* ============================================================================
 * LibretroFrameLoop - Frame loop for libretro
 * ============================================================================ */

class LibretroFrameLoop : public FrameLoop {
public:
	void tick(std::function<void()> callback);

	// FrameLoop interface
	void start(std::function<void(double, double)> callback) override;
	void stop() override;
	bool isRunning() override { return m_running; }

private:
	std::function<void(double, double)> m_callback;
	bool m_running = false;
};

} // namespace bmsx

#endif // BMSX_LIBRETRO_PLATFORM_H
