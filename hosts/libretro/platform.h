/*
 * platform.h - BMSX Platform implementation for libretro
 *
 * This header defines the LibretroPlatform class that bridges the BMSX machine runtime
 * with the libretro API, allowing the machine to run in RetroArch and other
 * libretro frontends.
 */

#ifndef BMSX_LIBRETRO_PLATFORM_H
#define BMSX_LIBRETRO_PLATFORM_H

#include "audio/soundmaster.h"
#include "bmsx_libretro.h"
#include "host_overlay_menu.h"
#include "spec/bmsx/cartridge.h"
#include "platform/platform.h"
#include "render/backend/backend.h"
#include "render/post/device_quantize/mode.h"
#include "presentation_state.h"
#include <array>
#include <memory>
#include <string>
#include <vector>

namespace bmsx {

constexpr f64 DEFAULT_LIBRETRO_AUDIO_SAMPLE_RATE = 48000.0;

class LibretroInputHub;
class LibretroAudioService;
class LibretroHostClock;
class MachineManager;
class Runtime;
class AudioController;
class Input;
class BFont;
class VideoPresenter;

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
 * LibretroVideoOutput - VideoPresenter host for libretro
 * ============================================================================ */

class LibretroVideoOutput : public VideoOutput {
public:
	LibretroVideoOutput(
		Framebuffer& framebuffer,
		BackendType backend_type,
		retro_system_av_info& av_info,
		bool profileGxUploads);

	// VideoOutput interface
	ViewportDimensions getSize(Vec2 viewportSize, Vec2 canvasSize) override;
	SubscriptionHandle onResize(std::function<void(const ViewportDimensions&)> handler) override;
	void setRenderTargetSize(GPUBackend& backend, i32 width, i32 height) override;

	// Create a backend for this platform
	std::unique_ptr<GPUBackend> createBackend() override;

private:
	Framebuffer& m_framebuffer;
	BackendType m_backend_type;
	retro_system_av_info& m_av_info;
	bool m_profile_gx_uploads;
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

	int16_t* beginWrite(size_t num_samples) {
		if (num_samples > buffer.size() / 2u) {
			buffer.resize(num_samples * 2u);
		}
		data = buffer.data();
		samples = 0;
		return buffer.data();
	}

	// disable-next-line single_line_method_pattern -- audio buffer reserves stereo sample storage at the libretro audio boundary.
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
};

/* ============================================================================
 * LibretroPlatform - Main platform implementation
 * ============================================================================ */

class LibretroPlatform : public Platform {
public:
	LibretroPlatform(
		BackendType backend_type,
		retro_system_av_info& av_info,
		bmsx_supervisor_request_line_t supervisorRequestLine,
		bool profileGxUploads);
	~LibretroPlatform() override;

	// Libretro callback setters
	void setEnvironmentCallback(retro_environment_t cb) { m_environ_cb = cb; }
	void setVideoCallback(retro_video_refresh_t cb) { m_video_cb = cb; }
	void setInputPollCallback(retro_input_poll_t cb);
	void setInputStateCallback(retro_input_state_t cb);
	void setLogCallback(void (*cb)(enum retro_log_level, const char*, ...)) { m_log_cb = cb; }
	void setSystemDirectory(std::string_view path) { m_system_dir = std::string(path); }
	void setHwRenderCallbacks(retro_hw_get_current_framebuffer_t get_current_framebuffer,
								retro_hw_get_proc_address_t get_proc_address);
	void onContextReset();
	void onContextDestroy();
	void onContextLost();
	void setCrtEffectOptions(bool applyNoise,
								bool applyColorBleed,
								bool applyScanlines,
								bool applyBlur,
								bool applyGlow,
								bool applyFringing,
								bool applyAperture);
	void setDeviceQuantizeMode(DeviceQuantizeMode mode);
	void setResourceUsageGizmo(bool enabled);
	void setPlatformPaused(bool paused);
	bool running() const { return m_running; }
	bool platformPaused() const { return m_platform_paused; }
	void requestShutdown() override;

	// Configuration
	void setAVInfo(const retro_system_av_info& info);
	void setControllerDevice(unsigned port, unsigned device);

	// ROM management
	bool loadRom(const uint8_t* data, size_t size);
	bool loadRomFromPath(const char* path);
	bool loadCartridgeSlotsOwned(std::array<std::vector<uint8_t>, CARTRIDGE_SLOT_COUNT>&& data);
	bool loadCartridgeSlotsFromPaths(const std::array<std::string, CARTRIDGE_SLOT_COUNT>& paths);
	bool loadEmptyCart();
	void unloadRom();
	void loadSystemRom(const char* romPath);

	// Emulation control
	void reset();
	bool runFrame();

	// State access
	const Framebuffer& getFramebuffer() const { return m_framebuffer; }
	const AudioBuffer& getAudioBuffer() const { return m_audio_buffer; }

	// Machine manager access
	MachineManager* machineManager() { return m_machine_manager.get(); }
	VideoPresenter& videoPresenter() { return *m_video_presenter; }

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
	HostClock* clock() override;
	FrameLoop* frameLoop() override { return m_frame_loop.get(); }
	Lifecycle* lifecycle() override { return m_lifecycle.get(); }
	InputHub* inputHub() override { return m_input_hub.get(); }
	VideoOutput& videoOutput() override { return *m_video_output; }
	MicrotaskQueue* microtaskQueue() override { return m_microtask_queue.get(); }
	std::string_view type() override { return "libretro"; }
	void log(LogLevel level, std::string_view message) override;

private:
	void pollInput();
	bool runHostFrame(Runtime& runtime, f64 deltaTime);
	void activateLoadedRuntime(Runtime& runtime);
	void syncAudioTiming(Runtime& runtime);
	void syncRuntimeAudioTiming(Runtime& runtime);
	void log(retro_log_level level, const char* fmt, ...);
	bool loadSystemRomFromFile(const std::string& path);
	void flushSystemOutput(Runtime& runtime);
	void reportRuntimeError(Runtime& runtime, std::string_view message);

	// Libretro callbacks
	retro_environment_t m_environ_cb = nullptr;
	retro_video_refresh_t m_video_cb = nullptr;
	retro_input_poll_t m_input_poll_cb = nullptr;
	retro_input_state_t m_input_state_cb = nullptr;
	void (*m_log_cb)(enum retro_log_level, const char*, ...) = nullptr;
	std::string m_system_dir;

	// Output buffers
	Framebuffer m_framebuffer;
	AudioBuffer m_audio_buffer;

	double m_frame_time_sec;
	BackendType m_backend_type = BackendType::Software;

	// Controller configuration
	std::array<unsigned, 4> m_controller_devices{};

	// Machine manager instance
	std::unique_ptr<MachineManager> m_machine_manager;

	// Platform components
	std::unique_ptr<LibretroHostClock> m_clock;
	std::unique_ptr<FrameLoop> m_frame_loop;
	std::unique_ptr<Lifecycle> m_lifecycle;
	std::unique_ptr<InputHub> m_input_hub;
	std::unique_ptr<Input> m_input;
	SoundMaster m_sound_master;
	std::unique_ptr<LibretroAudioService> m_audio_service;
	std::unique_ptr<LibretroVideoOutput> m_video_output;
	std::unique_ptr<MicrotaskQueue> m_microtask_queue;
	std::unique_ptr<VideoPresenter> m_video_presenter;
	std::unique_ptr<BFont> m_default_font;
	SubscriptionHandle m_video_resize_subscription;
	SubscriptionHandle m_input_focus_subscription;
	HostOverlayMenu m_host_overlay_menu;
	RenderPresentationState m_screen;

	// Save RAM
	std::vector<uint8_t> m_save_ram;

	// System RAM (if exposed)
	std::vector<uint8_t> m_system_ram;

	bool m_rom_loaded = false;
	bool m_running = false;
	bool m_platform_paused = false;
	f64 m_total_time = 0.0;
	f64 m_delta_time = 0.0;
	f64 m_host_fps = 0.0;
	i64 m_audio_ufps_scaled;
	DeviceQuantizeMode m_device_quantize_mode = DeviceQuantizeMode::None;
};

/* ============================================================================
 * LibretroInputHub - Input handling for libretro
 * ============================================================================ */

class LibretroInputHub : public InputHub {
public:
	LibretroInputHub(
		LibretroPlatform* platform,
		bmsx_supervisor_request_line_t supervisorRequestLine);

	void poll();
	void setInputPollCallback(retro_input_poll_t cb) { m_input_poll_cb = cb; }
	void setInputStateCallback(retro_input_state_t cb) { m_input_state_cb = cb; }
	void postKeyboardEvent(unsigned keycode, bool down);
	void resetState();

	// InputHub interface
	SubscriptionHandle subscribe(std::function<void(const InputEvt&)> handler) override;

private:
	void emitEvent(const InputEvt& evt);
	void publishSupervisorRequestLine();

	LibretroPlatform* m_platform;
	bmsx_supervisor_request_line_t m_supervisor_request_line;
	retro_input_poll_t m_input_poll_cb = nullptr;
	retro_input_state_t m_input_state_cb = nullptr;
	std::vector<SubscriptionEntry<std::function<void(const InputEvt&)>>> m_handlers;
	uint32_t m_next_handler_id = 1;

	// Previous state for edge detection
	InputState m_prev_state;
	std::array<bool, 5> m_prev_pointer_buttons{};
	i32 m_prev_pointer_x = 0;
	i32 m_prev_pointer_y = 0;
	bool m_prev_pointer_position_valid = false;
	bool m_host_supervisor_request_high = false;
	bool m_keyboard_supervisor_request_high = false;
	bool m_prev_supervisor_request_high = false;
	std::array<bool, 256> m_pressed_keyboard_usages{};
};

/* ============================================================================
 * LibretroAudioService - Audio handling for libretro
 * ============================================================================ */

class LibretroAudioService final {
public:
	explicit LibretroAudioService(SoundMaster& soundMaster);

	void setTiming(double sampleRate);
	void resetQueue();

	void collectSamples(AudioController& audioController, AudioBuffer& buffer);

private:
	SoundMaster& m_sound_master;
	double m_sample_rate = DEFAULT_LIBRETRO_AUDIO_SAMPLE_RATE;
	double m_sample_accumulator = 0.0;
};

/* ============================================================================
 * LibretroHostClock - Time management for libretro
 * ============================================================================ */

class LibretroHostClock : public HostClock {
public:
	LibretroHostClock();

	void advanceFrame(double fps);

	// HostClock interface
	double now() override { return m_current_time; }

private:
	double m_current_time = 0.0;
};

/* ============================================================================
 * LibretroFrameLoop - Frame loop for libretro
 * ============================================================================ */

class LibretroFrameLoop : public FrameLoop {
public:
	void runPushedFrame(f64 now, f64 deltaTime);

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
