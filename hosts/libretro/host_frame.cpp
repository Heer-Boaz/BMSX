#include "host_frame.h"

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
	f64 deltaTime
) {
	presentation.recordHostFrame();

	const f64 hostDeltaMs = deltaTime * 1000.0;
	totalTime += deltaTime;
	const f64 hostFps = 1.0 / deltaTime;

	const HostMenuInput hostMenuInput =
		overlayMenu.tickInput(runtime, input, presenter, rewind, totalTime * 1000.0);
	switch (hostMenuInput) {
		case HostMenuInput::RebootCart:
			return LibretroFrameResult::RebootRequested;
		case HostMenuInput::ExitGame:
			return LibretroFrameResult::ExitRequested;
		case HostMenuInput::Inactive:
		case HostMenuInput::Active:
			break;
	}
	const bool hostMenuActive = hostMenuInput == HostMenuInput::Active;

	presentation.clearPresentation();
	rewind.service(true);
	rewind.runPlayback(hostDeltaMs);
	if (runtime.isDrawPending() && !hostMenuActive && !rewind.active) {
		const i64 previousTickSequence = runtime.frameScheduler.lastTickSequence;
		runtime.frameScheduler.run(runtime, hostDeltaMs);
		GxGpu& gxGpu = runtime.machine.gxGpu;
		while (gxGpu.backendServicePending()) {
			if (gxGpu.backendCommandDrainPending()) {
				presenter.backend().executeGxGpuCommandDrain(gxGpu);
			} else {
				presenter.backend().executeGxGpuReadback(gxGpu);
			}
			runtime.frameScheduler.run(runtime, 0.0);
		}
		presentation.syncAfterRuntimeUpdate(runtime, previousTickSequence);
	} else if (runtime.isDrawPending()) {
		runtime.frameScheduler.clearQueuedTime();
	}
	if (overlayMenu.queueFrameOverlayCommands(
		runtime,
		presenter,
		rewind,
		hostFps
	)) {
		presentation.requestHeldPresentation();
	}
	if (rewind.active) presentation.requestHeldPresentation();
	const bool presented = presentation.render(
		presenter,
		runtime,
		totalTime,
		deltaTime,
		false
	);
	if (runtime.history.checkpointPending) rewind.service(true);
	return presented ? LibretroFrameResult::Presented : LibretroFrameResult::NotPresented;
}

} // namespace bmsx
