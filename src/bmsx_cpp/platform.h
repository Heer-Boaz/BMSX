/*
 * platform.h - Platform abstraction layer for BMSX
 *
 * This mirrors the TypeScript Platform interface, providing an abstraction
 * over host-specific functionality like timing, input, audio, and rendering.
 */

#ifndef BMSX_PLATFORM_H
#define BMSX_PLATFORM_H

#include "subscription.h"
#include "core/types.h"
#include "render/backend/backend.h"
#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <memory>

namespace bmsx {

/* ============================================================================
 * Input event types
 * ============================================================================ */

enum class InputEvtType {
	ButtonDown,
	ButtonUp,
	AxisMove,
	KeyDown,
	KeyUp,
	PointerDown,
	PointerUp,
	PointerMove,
	PointerWheel
};

struct InputEvt {
	InputEvtType type = InputEvtType::ButtonDown;
	std::string deviceId;
	std::string code;
	f32 value = 0.0f;
	f32 x = 0.0f;
	f32 y = 0.0f;
};

/* ============================================================================
 * Viewport dimensions
 * ============================================================================ */

struct ViewportDimensions {
	i32 width = 0;
	i32 height = 0;
	f32 viewportScale = 1.0f;
	f32 canvasScale = 1.0f;
};

/* ============================================================================
 * Logging
 * ============================================================================ */

enum class LogLevel {
	Debug,
	Info,
	Warn,
	Error
};

/* ============================================================================
 * Clock - Time management
 * ============================================================================ */

class Clock {
public:
	virtual ~Clock() = default;
	virtual f64 now() = 0;       // Current time in milliseconds
	virtual f64 origin() = 0;    // Start time
	virtual f64 elapsed() = 0;   // Time since origin
};

/* ============================================================================
 * FrameLoop - Animation/game loop
 * ============================================================================ */

class FrameLoop {
public:
	virtual ~FrameLoop() = default;
	virtual void start(std::function<void(f64 now, f64 dt)> callback) = 0;
	virtual void stop() = 0;
	virtual bool isRunning() = 0;
};

/* ============================================================================
 * Lifecycle - Application lifecycle events
 * ============================================================================ */

class Lifecycle {
public:
	virtual ~Lifecycle() = default;
	virtual SubscriptionHandle onWillExit(std::function<void()> handler) = 0;
};

/* ============================================================================
 * InputHub - Input event aggregation
 * ============================================================================ */

class InputHub {
public:
	virtual ~InputHub() = default;
	virtual SubscriptionHandle subscribe(std::function<void(const InputEvt&)> handler) = 0;
	virtual std::optional<InputEvt> nextEvt() = 0;
	virtual void clearEvtQ() = 0;
};

/* ============================================================================
 * Voice - Single audio source
 * ============================================================================ */

class Voice {
public:
	virtual ~Voice() = default;
	virtual void play() = 0;
	virtual void stop() = 0;
	virtual void pause() = 0;
	virtual void resume() = 0;
	virtual bool isPlaying() = 0;
	virtual void setVolume(f32 vol) = 0;
	virtual void setPitch(f32 pitch) = 0;
	virtual void setLoop(bool loop) = 0;
	virtual SubscriptionHandle onEnded(std::function<void()> handler) = 0;
};

/* ============================================================================
 * MasterVolume - Global volume control
 * ============================================================================ */

class MasterVolume {
public:
	virtual ~MasterVolume() = default;
	virtual f32 get() = 0;
	virtual void set(f32 vol) = 0;
};

/* ============================================================================
 * AudioService - Audio playback
 * ============================================================================ */

class AudioService {
public:
	virtual ~AudioService() = default;
	virtual Voice* createVoice() = 0;
	virtual void destroyVoice(Voice* voice) = 0;
	virtual MasterVolume* masterVolume() = 0;
	virtual std::string name() = 0;
	virtual bool ready() = 0;
	virtual f32 sampleRate() = 0;
};

/* ============================================================================
 * GameViewHost - Rendering surface
 * ============================================================================ */

class GameViewHost {
public:
	virtual ~GameViewHost() = default;
	virtual void* getCapability(std::string_view name) = 0;
	virtual ViewportDimensions getSize(Vec2 viewportSize, Vec2 canvasSize) = 0;
	virtual SubscriptionHandle onResize(std::function<void(const ViewportDimensions&)> handler) = 0;
	virtual SubscriptionHandle onFocusChange(std::function<void(bool)> handler) = 0;

	// Create a GPU backend for rendering (platform-specific implementation)
	// Returns nullptr if the platform doesn't provide its own backend
	virtual std::unique_ptr<GPUBackend> createBackend() { return nullptr; } // Dummy implementation
};

/* ============================================================================
 * MicrotaskQueue - Deferred task execution
 * ============================================================================ */

class MicrotaskQueue {
public:
	virtual ~MicrotaskQueue() = default;
	virtual void queueMicrotask(std::function<void()> task) = 0;
	virtual void flush() = 0;
};

/* ============================================================================
 * Platform - Main platform interface
 * ============================================================================ */

class Platform {
public:
	virtual ~Platform() = default;

	virtual Clock* clock() = 0;
	virtual FrameLoop* frameLoop() = 0;
	virtual Lifecycle* lifecycle() = 0;
	virtual InputHub* inputHub() = 0;
	virtual AudioService* audioService() = 0;
	virtual GameViewHost* gameviewHost() = 0;
	virtual MicrotaskQueue* microtaskQueue() = 0;
	virtual std::string_view type() = 0;
	virtual void log(LogLevel level, std::string_view message) = 0;
};

/* ============================================================================
 * Default implementations for optional services
 * ============================================================================ */

class DefaultMicrotaskQueue : public MicrotaskQueue {
public:
	void queueMicrotask(std::function<void()> task) override;
	void flush() override;

private:
	std::vector<std::function<void()>> m_queue;
};

class DefaultLifecycle : public Lifecycle {
public:
	DefaultLifecycle();
	~DefaultLifecycle() override;

	SubscriptionHandle onWillExit(std::function<void()> handler) override;
	void triggerExit();

private:
	std::vector<std::function<void()>> m_handlers;
	int m_next_handle_id = 1;
};

} // namespace bmsx

#endif // BMSX_PLATFORM_H
