#include "machine/runtime/runtime_frame_loop.h"
#include "core/engine_core.h"
#include "input/input.h"
#include "machine/runtime/runtime.h"
#include <algorithm>

namespace bmsx {
namespace {
constexpr double MAX_FRAME_DELTA_MS = 250.0;

inline double to_ms(std::chrono::steady_clock::duration duration) {
	return std::chrono::duration<double, std::milli>(duration).count();
}
}

void RuntimeFrameLoopState::reset() {
	frameDeltaMs = 0.0;
}

void RuntimeFrameLoopState::runHostFrame(Runtime& runtime, f64 deltaTime, bool platformPaused, bool skipRender) {
	EngineCore& engine = EngineCore::instance();
	if (engine.m_state != EngineState::Running && engine.m_state != EngineState::Paused) {
		return;
	}
	try {
		const auto tickStart = std::chrono::steady_clock::now();
		runtime.screen.beginHostFrame();
		engine.m_last_tick_timing.inputMs = 0.0;
		engine.m_last_tick_timing.runtimeIdeInputMs = 0.0;
		engine.m_last_tick_timing.runtimeTerminalInputMs = 0.0;
		engine.m_last_tick_timing.runtimeUpdateMs = 0.0;
		engine.m_last_tick_timing.runtimeIdeMs = 0.0;
		engine.m_last_tick_timing.runtimeTerminalMs = 0.0;
		engine.m_last_tick_timing.microtaskMs = 0.0;

		const double hostDeltaMs = std::min(deltaTime * 1000.0, MAX_FRAME_DELTA_MS);
		const double hostDeltaSeconds = hostDeltaMs / 1000.0;
		engine.m_delta_time = hostDeltaSeconds;
		engine.m_total_time += hostDeltaSeconds;
		engine.m_frame_count += 1;
		if (hostDeltaSeconds > 0.0) {
			engine.m_fps = 1.0 / hostDeltaSeconds;
		}

		const auto inputStart = std::chrono::steady_clock::now();
		Input::instance().pollInput();
		const auto inputEnd = std::chrono::steady_clock::now();
		engine.m_last_tick_timing.inputMs = to_ms(inputEnd - inputStart);

		runtime.screen.clearPresentation();
		if (!platformPaused) {
			auto ideInputStart = std::chrono::steady_clock::now();
			runtime.tickIdeInput();
			auto ideInputEnd = std::chrono::steady_clock::now();
			engine.m_last_tick_timing.runtimeIdeInputMs = to_ms(ideInputEnd - ideInputStart);

			auto terminalInputStart = std::chrono::steady_clock::now();
			runtime.tickTerminalInput();
			auto terminalInputEnd = std::chrono::steady_clock::now();
			engine.m_last_tick_timing.runtimeTerminalInputMs = to_ms(terminalInputEnd - terminalInputStart);

			const i64 previousTickSequence = runtime.machineScheduler.lastTickSequence;
			auto updateStart = std::chrono::steady_clock::now();
			engine.m_delta_time = runtime.timing.frameDurationMs / 1000.0;
			runtime.machineScheduler.run(runtime, hostDeltaMs);
			runtime.screen.syncAfterRuntimeUpdate(runtime, previousTickSequence);
			auto updateEnd = std::chrono::steady_clock::now();
			engine.m_last_tick_timing.runtimeUpdateMs = to_ms(updateEnd - updateStart);

			auto ideStart = std::chrono::steady_clock::now();
			runtime.tickIDE();
			auto ideEnd = std::chrono::steady_clock::now();
			engine.m_last_tick_timing.runtimeIdeMs = to_ms(ideEnd - ideStart);

			auto terminalStart = std::chrono::steady_clock::now();
			runtime.tickTerminalMode();
			auto terminalEnd = std::chrono::steady_clock::now();
			engine.m_last_tick_timing.runtimeTerminalMs = to_ms(terminalEnd - terminalStart);
		}
		engine.m_delta_time = hostDeltaSeconds;

		if (engine.m_platform && engine.m_platform->microtaskQueue()) {
			const auto microtaskStart = std::chrono::steady_clock::now();
			engine.m_platform->microtaskQueue()->flush();
			const auto microtaskEnd = std::chrono::steady_clock::now();
			engine.m_last_tick_timing.microtaskMs = to_ms(microtaskEnd - microtaskStart);
		}

		engine.m_last_tick_timing.totalMs = to_ms(std::chrono::steady_clock::now() - tickStart);
		if (!skipRender) {
			runtime.screen.render(engine, runtime);
		}
	} catch (const std::exception& e) {
		runtime.handleLuaError(e.what());
	}
}

} // namespace bmsx
