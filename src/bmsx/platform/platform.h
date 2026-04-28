/**
 * C++ Platform Interface Definitions
 *
 * This header mirrors the TypeScript platform.ts interfaces for use in a C++ port.
 * It is designed to facilitate a libretro-compatible implementation while maintaining
 * API parity with the JavaScript console runtime.
 *
 * Design principles:
 * - No std::function for hot paths (use function pointers or virtual methods)
 * - SubscriptionHandle pattern instead of closure-based unsubscribe
 * - Sync methods alongside async where possible
 * - POD types where feasible for FFI compatibility
 *
 * Generated from: src/bmsx/platform/platform.ts
 */

#pragma once

#include <cstdint>
#include <cstddef>
#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace bmsx {

// Forward declarations
struct InputEvt;
struct AudioClipHandle;
struct VoiceHandle;

// =============================================================================
// Core Types
// =============================================================================

using MonoTime = double;

// =============================================================================
// SubscriptionHandle
// =============================================================================

/**
 * Handle returned by subscription-based APIs.
 * Unlike closure-based unsubscribe patterns, this object model avoids heap allocation.
 */
struct SubscriptionHandle {
	uint32_t id;
	bool active;

	void unsubscribe();

	// Factory for creating handles (implementation-specific)
	static SubscriptionHandle create(std::function<void()> cleanup);
};

// =============================================================================
// TimerHandle
// =============================================================================

struct TimerHandle {
	virtual void cancel() = 0;
	virtual bool isActive() const = 0;
	virtual ~TimerHandle() = default;
};

// =============================================================================
// Clock
// =============================================================================

struct Clock {
	virtual MonoTime now() = 0;
	virtual MonoTime perf_now() = 0;
	virtual double dateNow() = 0;
	virtual std::unique_ptr<TimerHandle> scheduleOnce(double delayMs, std::function<void(MonoTime)> cb) = 0;
	virtual ~Clock() = default;
};

// =============================================================================
// FrameLoop
// =============================================================================

struct FrameLoopHandle {
	virtual void stop() = 0;
	virtual ~FrameLoopHandle() = default;
};

struct FrameLoop {
	// Browser/desktop mode: console runtime requests frames
	virtual std::unique_ptr<FrameLoopHandle> start(std::function<void(MonoTime)> tick) = 0;

	// Libretro mode: host pushes frame (optional, for push-based frame loops)
	virtual void runSingleFrame(MonoTime t) {}

	virtual ~FrameLoop() = default;
};

// =============================================================================
// Input Types
// =============================================================================

enum class DeviceKind : uint8_t {
	Keyboard,
	Gamepad,
	Pointer,
	Touch,
	Virtual
};

struct InputModifiers {
	bool ctrl;
	bool shift;
	bool alt;
};

struct VibrationParams {
	uint32_t duration;
	float intensity;
};

enum class InputEvtType : uint8_t {
	Button,
	Axis1,
	Axis2,
	Connect,
	Disconnect
};

/**
 * Unified input event structure.
 * Uses a type discriminator instead of TypeScript's tagged union.
 */
struct InputEvt {
	InputEvtType type;
	uint32_t deviceId;  // Numeric ID instead of string for performance
	uint32_t code;      // Numeric button/axis code
	MonoTime timestamp;

	// Button-specific
	bool down;
	float value;
	uint32_t pressId;
	InputModifiers modifiers;

	// Axis-specific
	float x;
	float y;  // Only for Axis2

	// Connect-specific (pointer to device info, managed elsewhere)
	void* deviceInfo;
};

struct InputDevice {
	uint32_t id;
	DeviceKind kind;
	std::string description;
	bool supportsVibration;

	virtual void setVibration(const VibrationParams& params) = 0;
	virtual void poll(Clock& clock) = 0;
	virtual ~InputDevice() = default;
};

struct InputHub {
	virtual SubscriptionHandle subscribe(std::function<void(const InputEvt&)> fn) = 0;
	virtual void post(const InputEvt& evt) = 0;
	virtual std::vector<InputDevice*> devices() = 0;
	virtual void setKeyboardCapture(std::function<bool(uint32_t code)> handler) = 0;
	virtual ~InputHub() = default;
};

// =============================================================================
// Audio Types
// =============================================================================

enum class BiquadFilterType : uint8_t {
	Lowpass,
	Highpass,
	Bandpass,
	Lowshelf,
	Highshelf,
	Peaking,
	Notch,
	Allpass
};

struct AudioFilterParams {
	BiquadFilterType type;
	float frequency;
	float q;
	float gain;
};

struct AudioLoop {
	double start;
	double end;  // -1 for no end
};

struct AudioPlaybackParams {
	double offset;
	double rate;
	float gainLinear;
	AudioLoop loop;
	AudioFilterParams filter;
};

struct VoiceEndedEvent {
	double clippedAt;
};

struct AudioClipHandle {
	virtual double duration() const = 0;
	virtual void dispose() = 0;
	virtual ~AudioClipHandle() = default;
};

struct VoiceHandle {
	virtual double startedAt() const = 0;
	virtual double startOffset() const = 0;
	virtual SubscriptionHandle onEnded(std::function<void(const VoiceEndedEvent&)> cb) = 0;
	virtual void setGainLinear(float v) = 0;
	virtual void rampGainLinear(float target, double durationSec) = 0;
	virtual void setFilter(const AudioFilterParams& params) = 0;
	virtual void setRate(double v) = 0;
	virtual void stop() = 0;
	virtual void disconnect() = 0;
	virtual ~VoiceHandle() = default;
};

struct AudioService {
	virtual bool available() const = 0;
	virtual double currentTime() = 0;
	virtual double sampleRate() = 0;
	virtual uint32_t coreQueuedFrames() = 0;
	virtual void setCoreNeedHandler(std::function<void()> handler) = 0;
	virtual void clearCoreStream() = 0;
	virtual void resume() = 0;   // Sync version for libretro
	virtual void suspend() = 0;  // Sync version for libretro
	virtual float getMasterGain() = 0;
	virtual void setMasterGain(float v) = 0;
	virtual void setFrameTimeSec(double seconds) = 0;
	virtual void pushCoreFrames(const int16_t* samples, size_t sampleCount, uint32_t channels, double sampleRate) = 0;
	virtual std::unique_ptr<AudioClipHandle> createClipFromPcm(const int16_t* samples, size_t sampleCount, uint32_t channels, double sampleRate) = 0;

	virtual ~AudioService() = default;
};

// =============================================================================
// Lifecycle
// =============================================================================

struct PlatformExitEvent {
	bool prevented = false;
	std::string returnMessage;

	void preventDefault() { prevented = true; }
	void setReturnMessage(const std::string& msg) { returnMessage = msg; }
};

struct Lifecycle {
	virtual SubscriptionHandle onVisibilityChange(std::function<void(bool visible)> cb) = 0;
	virtual SubscriptionHandle onWillExit(std::function<void(PlatformExitEvent&)> cb) = 0;
	virtual ~Lifecycle() = default;
};

// =============================================================================
// Storage
// =============================================================================

struct StorageService {
	virtual std::string getItem(const std::string& key) = 0;
	virtual void setItem(const std::string& key, const std::string& value) = 0;
	virtual void removeItem(const std::string& key) = 0;
	virtual ~StorageService() = default;
};

// =============================================================================
// RNG
// =============================================================================

struct RngService {
	virtual double next() = 0;
	virtual void seed(uint32_t value) = 0;
	virtual ~RngService() = default;
};

// =============================================================================
// Viewport & Display
// =============================================================================

struct ViewportDimensions {
	int32_t width;
	int32_t height;
};

struct VisibleViewportMetrics {
	int32_t width;
	int32_t height;
	int32_t offsetTop;
	int32_t offsetLeft;
};

struct ViewportMetrics {
	ViewportDimensions document;
	ViewportDimensions windowInner;
	ViewportDimensions screen;
	VisibleViewportMetrics visible;
};

struct SurfaceBounds {
	int32_t width;
	int32_t height;
	int32_t left;
	int32_t top;
};

// =============================================================================
// GameViewCanvas
// =============================================================================

struct GameViewCanvas {
	virtual void* handle() = 0;  // Platform-specific handle (GLFWwindow*, SDL_Window*, framebuffer*, etc.)
	virtual bool isVisible() = 0;
	virtual void setRenderTargetSize(int32_t width, int32_t height) = 0;
	virtual void setDisplaySize(int32_t width, int32_t height) = 0;
	virtual void setDisplayPosition(int32_t left, int32_t top) = 0;
	virtual SurfaceBounds measureDisplay() = 0;

	// Libretro-specific: direct framebuffer access
	virtual uint8_t* getFramebuffer(int32_t* width, int32_t* height, int32_t* pitch) { return nullptr; }

	virtual ~GameViewCanvas() = default;
};

// =============================================================================
// GameViewHost
// =============================================================================

struct ViewportMetricsProvider {
	virtual ViewportMetrics getViewportMetrics() = 0;
	virtual ~ViewportMetricsProvider() = default;
};

struct WindowEventHub {
	virtual SubscriptionHandle subscribe(const std::string& type, std::function<void(void*)> listener) = 0;
	virtual ~WindowEventHub() = default;
};

struct DisplayModeController {
	virtual bool isSupported() = 0;
	virtual bool isFullscreen() = 0;
	virtual void setFullscreen(bool enabled) = 0;  // Sync version
	virtual SubscriptionHandle onChange(std::function<void(bool)> listener) = 0;
	virtual ~DisplayModeController() = default;
};

struct GameViewHost {
	virtual GameViewCanvas* surface() = 0;
	virtual void* createBackend() = 0;  // Returns platform-specific backend

	// Capability queries (simplified from TypeScript's generic pattern)
	virtual ViewportMetricsProvider* getViewportMetrics() = 0;
	virtual WindowEventHub* getWindowEvents() = 0;
	virtual DisplayModeController* getDisplayMode() = 0;

	virtual ~GameViewHost() = default;
};

// =============================================================================
// Onscreen Gamepad (for mobile/touch platforms)
// =============================================================================

enum class OnscreenGamepadControlKind : uint8_t {
	Dpad,
	Action
};

struct OnscreenPointerEvent {
	int32_t pointerId;
	float clientX;
	float clientY;
	float pressure;
	uint32_t buttons;
};

struct OnscreenGamepadPlatformHooks {
	std::function<void(OnscreenGamepadControlKind, const OnscreenPointerEvent&)> pointerDown;
	std::function<void(OnscreenGamepadControlKind, const OnscreenPointerEvent&)> pointerMove;
	std::function<void(OnscreenGamepadControlKind, const OnscreenPointerEvent&)> pointerUp;
	std::function<void()> blur;
	std::function<void()> focus;
	std::function<void()> pointerOut;
};

struct OnscreenGamepadPlatformSession {
	virtual void dispose() = 0;
	virtual ~OnscreenGamepadPlatformSession() = default;
};

struct OnscreenGamepadPlatform {
	virtual std::unique_ptr<OnscreenGamepadPlatformSession> attach(const OnscreenGamepadPlatformHooks& hooks) = 0;
	virtual void hideElements(const std::vector<std::string>& elementIds) = 0;
	virtual std::vector<std::string> collectElementIds(float x, float y, OnscreenGamepadControlKind kind) = 0;
	virtual void setElementActive(const std::string& elementId, bool active) = 0;
	virtual void resetElements(const std::vector<std::string>& elementIds) = 0;
	virtual void updateDpadRing(const std::vector<std::string>& activeElementIds) = 0;
	virtual bool supportsVibration() = 0;
	virtual void vibrate(uint32_t durationMs) = 0;
	virtual ~OnscreenGamepadPlatform() = default;
};

// =============================================================================
// MicrotaskQueue
// =============================================================================

struct MicrotaskQueue {
	virtual void schedule(std::function<void()> task) = 0;
	virtual ~MicrotaskQueue() = default;
};

// =============================================================================
// Clipboard (optional, not needed for libretro)
// =============================================================================

enum class ClipboardPermissionState : int8_t {
	Unknown = -1,
	Prompt = 0,
	Granted = 1,
	Denied = 2
};

struct ClipboardService {
	virtual bool isSupported() = 0;
	virtual void writeText(const std::string& text) = 0;
	virtual ClipboardPermissionState getWritePermissionState() = 0;
	virtual ClipboardPermissionState requestWritePermission() = 0;
	virtual ~ClipboardService() = default;
};

// =============================================================================
// HID (optional, not needed for libretro)
// =============================================================================

struct HIDService {
	virtual bool isSupported() = 0;
	// Simplified for C++ - full HID support would need more complex types
	virtual ~HIDService() = default;
};

// =============================================================================
// Platform
// =============================================================================

/**
 * Main platform contract.
 *
 * Every host environment implements this interface to wire the console runtime to native services.
 * For libretro, most services map directly to retro_* callbacks.
 */
struct Platform {
	virtual Clock& clock() = 0;
	virtual FrameLoop& frames() = 0;
	virtual Lifecycle& lifecycle() = 0;
	virtual InputHub& input() = 0;
	virtual StorageService& storage() = 0;
	virtual MicrotaskQueue& microtasks() = 0;
	virtual void requestShutdown() = 0;
	virtual ClipboardService& clipboard() = 0;
	virtual HIDService& hid() = 0;
	virtual OnscreenGamepadPlatform& onscreenGamepad() = 0;
	virtual AudioService& audio() = 0;
	virtual RngService& rng() = 0;
	virtual GameViewHost& gameviewHost() = 0;
	virtual ~Platform() = default;
};

// =============================================================================
// Button/Key Code Mappings (for libretro input translation)
// =============================================================================

namespace InputCodes {
	// Keyboard codes (matching JavaScript event.code values as numeric IDs)
	constexpr uint32_t KeyA = 0x0041;
	constexpr uint32_t KeyB = 0x0042;
	constexpr uint32_t KeyC = 0x0043;
	// ... etc (full mapping would be extensive)

	// Gamepad buttons (matching standard gamepad mapping)
	constexpr uint32_t GamepadA = 0x1000;
	constexpr uint32_t GamepadB = 0x1001;
	constexpr uint32_t GamepadX = 0x1002;
	constexpr uint32_t GamepadY = 0x1003;
	constexpr uint32_t GamepadLB = 0x1004;
	constexpr uint32_t GamepadRB = 0x1005;
	constexpr uint32_t GamepadLT = 0x1006;
	constexpr uint32_t GamepadRT = 0x1007;
	constexpr uint32_t GamepadSelect = 0x1008;
	constexpr uint32_t GamepadStart = 0x1009;
	constexpr uint32_t GamepadLS = 0x100A;
	constexpr uint32_t GamepadRS = 0x100B;
	constexpr uint32_t GamepadUp = 0x100C;
	constexpr uint32_t GamepadDown = 0x100D;
	constexpr uint32_t GamepadLeft = 0x100E;
	constexpr uint32_t GamepadRight = 0x100F;
	constexpr uint32_t GamepadHome = 0x1010;

	// Pointer buttons
	constexpr uint32_t PointerPrimary = 0x2000;
	constexpr uint32_t PointerMiddle = 0x2001;
	constexpr uint32_t PointerSecondary = 0x2002;
}

} // namespace bmsx
