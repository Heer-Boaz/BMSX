#include "core/machine_manager.h"

#include "core/host_overlay_menu.h"
#include "common/time.h"
#include "input/manager.h"
#include "machine/runtime/runtime.h"
#include "render/video_presenter.h"

#include <chrono>

namespace bmsx {
namespace {
constexpr double MAX_FRAME_DELTA_MS = 250.0;
}

bool MachineManager::runHostFrame(
	Runtime& runtime,
	MicrotaskQueue& microtasks,
	VideoPresenter& presenter,
	f64 deltaTime,
	bool platformPaused
) {
	if (!acceptHostFrame(deltaTime)) {
		return false;
	}
	const auto tickStart = std::chrono::steady_clock::now();
	m_screen.recordHostFrame();

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
	const bool hostMenuActive = hostOverlayMenu().tickInput(*this, presenter);

	m_screen.clearPresentation();
	if (!platformPaused && !hostMenuActive) {
		m_delta_time = runtime.timing.frameDurationMs / 1000.0;
		const i64 previousTickSequence = runtime.frameScheduler.lastTickSequence;
		runtime.frameScheduler.run(runtime, hostDeltaMs);
		while (runtime.machine.gxGpu.backendReadbackPending()) {
			presenter.backend().executeGxGpuReadback(runtime.machine.gxGpu);
			runtime.frameScheduler.run(runtime, 0.0);
		}
		syncRuntimeAudioTiming();
		m_screen.syncAfterRuntimeUpdate(runtime, previousTickSequence);
	} else {
		runtime.frameScheduler.clearQueuedTime();
	}
	m_delta_time = hostDeltaSeconds;

	microtasks.flush();

	m_last_tick_timing.totalMs = to_ms(std::chrono::steady_clock::now() - tickStart);

	if (hostMenuActive) {
		hostOverlayMenu().queueRenderCommands(*this, presenter);
		m_screen.requestHeldPresentation();
	} else if (hostOverlayMenu().queueFrameOverlayCommands(*this, presenter)) {
		m_screen.requestHeldPresentation();
	}
	return m_screen.render(*this, presenter, runtime, platformPaused);
}

} // namespace bmsx
