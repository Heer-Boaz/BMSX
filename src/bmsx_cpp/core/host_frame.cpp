#include "core/host_frame.h"

#include "core/engine.h"
#include "core/time.h"
#include "input/manager.h"
#include "machine/runtime/game/table.h"
#include "machine/runtime/game/view_state.h"
#include "machine/runtime/runtime.h"
#include "runtime/assets/edits.h"

#include <chrono>

namespace bmsx {
namespace {
constexpr double MAX_FRAME_DELTA_MS = 250.0;

} // namespace

void runRuntimeHostFrame(
	EngineCore& engine,
	Runtime& runtime,
	MicrotaskQueue& microtasks,
	f64 deltaTime,
	bool platformPaused,
	bool skipRender
) {
	if (engine.m_state != EngineState::Running && engine.m_state != EngineState::Paused) {
		return;
	}
	try {
		const auto tickStart = std::chrono::steady_clock::now();
		runtime.screen.recordHostFrame();
		engine.m_last_tick_timing.inputMs = 0.0;
		engine.m_last_tick_timing.workbenchModeInputMs = 0.0;
		engine.m_last_tick_timing.runtimeTerminalInputMs = 0.0;
		engine.m_last_tick_timing.runtimeUpdateMs = 0.0;
		engine.m_last_tick_timing.workbenchModeMs = 0.0;
		engine.m_last_tick_timing.runtimeTerminalMs = 0.0;
		engine.m_last_tick_timing.microtaskMs = 0.0;

		double hostDeltaMs = deltaTime * 1000.0;
		if (hostDeltaMs > MAX_FRAME_DELTA_MS) {
			hostDeltaMs = MAX_FRAME_DELTA_MS;
		}
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
		syncGameViewViewportSizeFromHost(runtime.gameViewState(), *engine.view());
		syncRuntimeGameViewStateToTable(runtime);
		if (!platformPaused) {
			const i64 previousTickSequence = runtime.frameScheduler.lastTickSequence;
			const auto updateStart = std::chrono::steady_clock::now();
			engine.m_delta_time = runtime.timing.frameDurationMs / 1000.0;
			runtime.frameScheduler.run(runtime, hostDeltaMs);
			applyRuntimeGameViewTableToState(runtime);
			applyGameViewStateToHost(runtime.gameViewState(), *engine.view());
			runtime.screen.syncAfterRuntimeUpdate(runtime, previousTickSequence);
			const auto updateEnd = std::chrono::steady_clock::now();
			engine.m_last_tick_timing.runtimeUpdateMs = to_ms(updateEnd - updateStart);

			const auto terminalStart = std::chrono::steady_clock::now();
			flushRuntimeAssetEdits(runtime.machine().memory());
			const auto terminalEnd = std::chrono::steady_clock::now();
			engine.m_last_tick_timing.runtimeTerminalMs = to_ms(terminalEnd - terminalStart);
		}
		engine.m_delta_time = hostDeltaSeconds;

		const auto microtaskStart = std::chrono::steady_clock::now();
		microtasks.flush();
		const auto microtaskEnd = std::chrono::steady_clock::now();
		engine.m_last_tick_timing.microtaskMs = to_ms(microtaskEnd - microtaskStart);

		engine.m_last_tick_timing.totalMs = to_ms(std::chrono::steady_clock::now() - tickStart);
		if (!skipRender) {
			runtime.screen.render(engine, runtime);
		}
	} catch (const std::exception& e) {
		runtime.handleLuaError(e.what());
	}
}

} // namespace bmsx
