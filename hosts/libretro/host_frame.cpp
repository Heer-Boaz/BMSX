#include "host_frame.h"
#if BMSX_ENABLE_GLES2
#include "gles_frame_worker.h"
#endif

#include "host_overlay_menu.h"
#include "input.h"
#include "rewind.h"
#include "machine/runtime/runtime.h"
#include "presentation_state.h"
#include "render/video_presenter.h"

namespace bmsx {

LibretroFrameResult runLibretroFrame(
	Runtime& runtime,
	LibretroInput& input,
	HostOverlayMenu& overlayMenu,
	HostRewind& rewind,
	RenderPresentationState& presentation,
	VideoPresenter& presenter,
	f64& totalTime,
	f64 deltaTime,
	bool singleGuestTick,
	[[maybe_unused]] GlesFrameWorker* worker
) {
	presentation.recordHostFrame();

	const f64 hostDeltaMs = deltaTime * 1000.0;
	totalTime += deltaTime;
	const f64 hostFps = 1.0 / deltaTime;

	const HostMenuInput hostMenuInput =
		overlayMenu.tickInput(runtime, input, presenter, rewind, input.pollTimestampMs());
	switch (hostMenuInput) {
		case HostMenuInput::RebootCart:
			return LibretroFrameResult::RebootRequested;
		case HostMenuInput::ExitGame:
			return LibretroFrameResult::ExitRequested;
		case HostMenuInput::SuspendGame:
			return LibretroFrameResult::SuspendRequested;
		case HostMenuInput::Inactive:
		case HostMenuInput::Active:
			break;
	}
	const HostMenuExecution menuExecution = overlayMenu.executionMode();
	const bool menuPaused = menuExecution == HostMenuExecution::Paused;

	presentation.beginHostFrame();
	// Select execution before any service that can restore or advance the machine.
	// Host input, menu drawing and wall time keep running while guest time is held.
	if (!menuPaused) {
		rewind.service(true);
		rewind.runPlayback(hostDeltaMs);
	}
	bool presented = false;
	bool workerConsumedFrame = false;
	if (runtime.isDrawPending() && menuExecution == HostMenuExecution::Live && !rewind.active) {
		const i64 previousTickSequence = runtime.frameScheduler.lastTickSequence;
#if BMSX_ENABLE_GLES2
		if (worker != nullptr) {
			presented = worker->run(totalTime, deltaTime);
			workerConsumedFrame = true;
		} else
#endif
		{
			bool tickCompleted = false;
			if (singleGuestTick) tickCompleted = runtime.frameScheduler.runScheduledToNextLogicalTick(runtime, hostDeltaMs);
			else runtime.frameScheduler.run(runtime, hostDeltaMs);
			GxGpu& gxGpu = runtime.machine.gxGpu;
			while (gxGpu.backendServicePending()) {
				if (gxGpu.backendCommandDrainPending()) {
					presenter.backend().executeGxGpuCommandDrain(gxGpu);
				} else {
					presenter.backend().executeGxGpuReadback(gxGpu);
				}
				runtime.frameScheduler.synchronizeBackendService(runtime);
				if (!singleGuestTick) runtime.frameScheduler.run(runtime, 0.0);
				else if (!tickCompleted) tickCompleted = runtime.frameScheduler.runScheduledToNextLogicalTick(runtime, 0.0);
			}
			presentation.syncAfterRuntimeUpdate(runtime, previousTickSequence);
		}
	} else {
		runtime.frameScheduler.clearQueuedTime();
	}
	if (!workerConsumedFrame) {
		if (overlayMenu.queueFrameOverlayCommands(
			runtime,
			presenter,
			rewind,
			hostFps
		)) {
			presentation.requestHeldPresentation();
		}
		if (rewind.active) presentation.requestHeldPresentation();
		presented = presentation.render(
			presenter,
			runtime,
			totalTime,
			deltaTime,
			false
		);
	}
	if (!menuPaused && runtime.history.checkpointPending) rewind.service(true);
	return presented ? LibretroFrameResult::Presented : LibretroFrameResult::NotPresented;
}

} // namespace bmsx
