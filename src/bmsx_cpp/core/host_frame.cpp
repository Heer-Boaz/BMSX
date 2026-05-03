#include "core/console.h"

#include "core/time.h"
#include "input/manager.h"
#include "machine/runtime/runtime.h"

#include <chrono>

namespace bmsx {
namespace {
constexpr double MAX_FRAME_DELTA_MS = 250.0;
}

void ConsoleCore::runHostFrame(
	Runtime& runtime,
	MicrotaskQueue& microtasks,
	f64 deltaTime,
	bool platformPaused,
	bool skipRender
) {
	if (!acceptHostFrame(deltaTime)) {
		return;
	}
	try {
		const auto tickStart = std::chrono::steady_clock::now();
		runtime.screen.recordHostFrame();

		double hostDeltaMs = deltaTime * 1000.0;
		if (hostDeltaMs > MAX_FRAME_DELTA_MS) {
			hostDeltaMs = MAX_FRAME_DELTA_MS;
		}
		const double hostDeltaSeconds = hostDeltaMs / 1000.0;
		m_delta_time = hostDeltaSeconds;
		m_total_time += hostDeltaSeconds;
		m_frame_count += 1;
		runtime.frameLoop.currentTimeSeconds = m_total_time;
		m_fps = 1.0 / hostDeltaSeconds;

		Input::instance().pollInput();

		runtime.screen.clearPresentation();
		if (!platformPaused) {
			const i64 previousTickSequence = runtime.frameScheduler.lastTickSequence;
			m_delta_time = runtime.timing.frameDurationMs / 1000.0;
			runtime.frameScheduler.run(runtime, hostDeltaMs);
			runtime.screen.syncAfterRuntimeUpdate(runtime, previousTickSequence);
		}
		m_delta_time = hostDeltaSeconds;

		microtasks.flush();

		m_last_tick_timing.totalMs = to_ms(std::chrono::steady_clock::now() - tickStart);
		if (!skipRender) {
			runtime.screen.render(*this, runtime);
		}
	} catch (const std::exception& e) {
		runtime.frameLoop.abandonFrameState(runtime);
		runtime.handleLuaError(e.what());
	} catch (...) {
		runtime.frameLoop.abandonFrameState(runtime);
		runtime.handleLuaError("Unhandled host frame exception.");
	}
}

} // namespace bmsx
