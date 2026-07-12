/*
 * platform.h - Platform boundary for BMSX
 *
 * Owns host-specific timing, input, audio, and rendering hooks.
 */

#ifndef BMSX_PLATFORM_H
#define BMSX_PLATFORM_H

#include "common/subscription.h"
#include "common/primitives.h"
#include "machine/scheduler/microtask_queue.h"
#include "render/backend/backend.h"
#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <memory>
#include <vector>

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
	f32 value = 0.0F;
	f32 x = 0.0F;
	f32 y = 0.0F;
};

/* ============================================================================
 * Viewport dimensions
 * ============================================================================ */

struct ViewportDimensions {
	i32 width = 0;
	i32 height = 0;
	f32 viewportScale = 1.0F;
	f32 canvasScale = 1.0F;
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

class HostClock {
public:
	virtual ~HostClock() = default;
	virtual auto now() -> f64 = 0;
};

/* ============================================================================
 * FrameLoop - Animation/game loop
 * ============================================================================ */

class FrameLoop {
public:
	virtual ~FrameLoop() = default;
	virtual void start(std::function<void(f64 now, f64 dt)> callback) = 0;
	virtual void stop() = 0;
	virtual auto isRunning() -> bool = 0;
};

/* ============================================================================
 * Lifecycle - Application lifecycle events
 * ============================================================================ */

class Lifecycle {
public:
	virtual ~Lifecycle() = default;
	virtual auto onWillExit(std::function<void()> handler) -> SubscriptionHandle = 0;
};

/* ============================================================================
 * InputHub - Input event aggregation
 * ============================================================================ */

class InputHub {
public:
	virtual ~InputHub() = default;
	virtual auto subscribe(std::function<void(const InputEvt&)> handler) -> SubscriptionHandle = 0;
	virtual auto nextEvt() -> std::optional<InputEvt> = 0;
	virtual void clearEvtQ() = 0;
};

/* ============================================================================
 * GameViewHost - Rendering surface
 * ============================================================================ */

class GameViewHost {
public:
	virtual ~GameViewHost() = default;
	virtual auto getCapability(std::string_view name) -> void* = 0;
	virtual auto getSize(Vec2 viewportSize, Vec2 canvasSize) -> ViewportDimensions = 0;
	virtual auto onResize(std::function<void(const ViewportDimensions&)> handler) -> SubscriptionHandle = 0;
	virtual auto onFocusChange(std::function<void(bool)> handler) -> SubscriptionHandle = 0;
	virtual void setRenderTargetSize(GPUBackend& backend, i32 width, i32 height) = 0;

	// Create a GPU backend for rendering (platform-specific implementation)
	// Returns nullptr if the platform doesn't provide its own backend
	virtual auto createBackend() -> std::unique_ptr<GPUBackend> { return nullptr; } // Dummy implementation
};

/* ============================================================================
 * Platform - Main platform interface
 * ============================================================================ */

class Platform {
public:
	virtual ~Platform() = default;

	virtual auto clock() -> HostClock* = 0;
	virtual auto frameLoop() -> FrameLoop* = 0;
	virtual auto lifecycle() -> Lifecycle* = 0;
	virtual auto inputHub() -> InputHub* = 0;
	virtual auto gameviewHost() -> GameViewHost* = 0;
	virtual auto microtaskQueue() -> MicrotaskQueue* = 0;
	virtual void requestShutdown() = 0;
	virtual auto type() -> std::string_view = 0;
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
	std::vector<std::function<void()>> m_tasks;
	std::vector<std::function<void()>> m_drainTasks;
};

class DefaultLifecycle : public Lifecycle {
public:
	DefaultLifecycle();
	~DefaultLifecycle() override;

	auto onWillExit(std::function<void()> handler) -> SubscriptionHandle override;
	void triggerExit();

private:
	std::vector<SubscriptionEntry<std::function<void()>>> m_handlers;
	uint32_t m_next_handler_id = 1;
};

} // namespace bmsx

#endif // BMSX_PLATFORM_H
