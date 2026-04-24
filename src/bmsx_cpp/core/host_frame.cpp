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
	if ((engine.m_state != EngineState::Running && engine.m_state != EngineState::Paused) || deltaTime <= 0.0) {
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
		engine.m_delta_time = hostDeltaSeconds;
		engine.m_total_time += hostDeltaSeconds;
		engine.m_frame_count += 1;
		runtime.frameLoop.currentTimeSeconds = engine.m_total_time;
		engine.m_fps = 1.0 / hostDeltaSeconds;

		Input::instance().pollInput();

		runtime.screen.clearPresentation();
		syncGameViewViewportSizeFromHost(runtime.gameViewState(), *engine.view());
		syncRuntimeGameViewStateToTable(runtime);
		if (!platformPaused) {
			const i64 previousTickSequence = runtime.frameScheduler.lastTickSequence;
			engine.m_delta_time = runtime.timing.frameDurationMs / 1000.0;
			runtime.frameScheduler.run(runtime, hostDeltaMs);
			applyRuntimeGameViewTableToState(runtime);
			applyGameViewStateToHost(runtime.gameViewState(), *engine.view());
			runtime.screen.syncAfterRuntimeUpdate(runtime, previousTickSequence);

			flushRuntimeAssetEdits(runtime.machine().memory());
		}
		engine.m_delta_time = hostDeltaSeconds;

		microtasks.flush();

		engine.m_last_tick_timing.totalMs = to_ms(std::chrono::steady_clock::now() - tickStart);
		if (!skipRender) {
			runtime.screen.render(engine, runtime);
		}
	} catch (const std::exception& e) {
		runtime.handleLuaError(e.what());
	}
}

} // namespace bmsx
