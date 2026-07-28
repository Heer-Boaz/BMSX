#include "render/host_overlay/pipeline.h"

#include "render/video_presenter.h"
#include "render/host_overlay/overlay_queue.h"

namespace bmsx {
void writeHostOverlayState(HostOverlayPipelineState& state, f64 time, f64 delta) {
	state.time = time;
	state.delta = delta;
	const HostOverlayFrame frame = consumeOverlayFrame();
	state.width = frame.renderWidth;
	state.height = frame.renderHeight;
	state.overlayWidth = frame.logicalWidth;
	state.overlayHeight = frame.logicalHeight;
	state.commandKinds = frame.commandKinds;
	state.commandRefs = frame.commandRefs;
	state.commandCount = frame.commandCount;
}

void writeHostMenuState(HostMenuPipelineState& state, VideoPresenter& presenter) {
	state.width = static_cast<i32>(presenter.offscreenCanvasSize.x);
	state.height = static_cast<i32>(presenter.offscreenCanvasSize.y);
	state.overlayWidth = static_cast<i32>(presenter.viewportSize.x);
	state.overlayHeight = static_cast<i32>(presenter.viewportSize.y);
	const HostMenuFrame frame = consumeHostMenuFrame();
	state.commandKinds = frame.commandKinds;
	state.commandRefs = frame.commandRefs;
	state.commandCount = frame.commandCount;
}

} // namespace bmsx
