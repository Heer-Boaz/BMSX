#include "host.h"

#include "machine/runtime/runtime.h"
#include "render/video_presenter.h"

namespace bmsx {
namespace {
constexpr f64 kMaxFrameDeltaMs = 250.0;
}

bool LibretroHost::runHostFrame(Runtime& runtime, f64 deltaTime) {
	m_screen.recordHostFrame();

	f64 hostDeltaMs = deltaTime * 1000.0;
	if (hostDeltaMs > kMaxFrameDeltaMs) {
		hostDeltaMs = kMaxFrameDeltaMs;
	}
	const f64 hostDeltaSeconds = hostDeltaMs / 1000.0;
	m_total_time += hostDeltaSeconds;
	m_host_fps = 1.0 / hostDeltaSeconds;

	const HostMenuInput hostMenuInput =
		m_host_overlay_menu.tickInput(m_input, m_video_presenter, m_total_time * 1000.0);
	switch (hostMenuInput) {
		case HostMenuInput::RebootCart:
			runtime.rebootSystem();
			activateLoadedRuntime(runtime);
			return false;
		case HostMenuInput::ExitGame:
			m_environ_cb(RETRO_ENVIRONMENT_SHUTDOWN, nullptr);
			return false;
		case HostMenuInput::Inactive:
		case HostMenuInput::Active:
			break;
	}
	const bool hostMenuActive = hostMenuInput == HostMenuInput::Active;

	m_screen.clearPresentation();
	if (runtime.isDrawPending() && !m_paused && !hostMenuActive) {
		const i64 previousTickSequence = runtime.frameScheduler.lastTickSequence;
		runtime.frameScheduler.run(runtime, hostDeltaMs);
		while (runtime.machine.gxGpu.backendReadbackPending()) {
			m_video_presenter.backend().executeGxGpuReadback(runtime.machine.gxGpu);
			runtime.frameScheduler.run(runtime, 0.0);
		}
		m_screen.syncAfterRuntimeUpdate(runtime, previousTickSequence);
	} else if (runtime.isDrawPending()) {
		runtime.frameScheduler.clearQueuedTime();
	}
	if (hostMenuActive) {
		m_host_overlay_menu.queueRenderCommands(m_video_presenter);
		m_screen.requestHeldPresentation();
	} else if (m_host_overlay_menu.queueFrameOverlayCommands(
		runtime,
		m_video_presenter,
		m_host_fps
	)) {
		m_screen.requestHeldPresentation();
	}
	return m_screen.render(
		m_video_presenter,
		runtime,
		m_total_time,
		hostDeltaSeconds,
		m_paused
	);
}

} // namespace bmsx
