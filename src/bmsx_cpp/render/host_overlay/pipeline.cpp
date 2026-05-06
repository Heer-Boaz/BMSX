#include "render/host_overlay/pipeline.h"

#include "render/gameview.h"
#include "render/host_overlay/overlay_queue.h"

namespace bmsx {
namespace {

void fillHost2DState(Host2DPipelineState& state, GameView& view) {
	state.width = static_cast<i32>(view.offscreenCanvasSize.x);
	state.height = static_cast<i32>(view.offscreenCanvasSize.y);
	state.overlayWidth = static_cast<i32>(view.viewportSize.x);
	state.overlayHeight = static_cast<i32>(view.viewportSize.y);
}

} // namespace

HostOverlayPipelineState buildHostOverlayState() {
	const HostOverlayFrame frame = consumeOverlayFrame();
	HostOverlayPipelineState state;
	state.width = frame.renderWidth;
	state.height = frame.renderHeight;
	state.overlayWidth = frame.logicalWidth;
	state.overlayHeight = frame.logicalHeight;
	state.commandKinds = frame.commandKinds;
	state.commandRefs = frame.commandRefs;
	state.commandCount = frame.commandCount;
	return state;
}

HostMenuPipelineState buildHostMenuState(GameView& view) {
	HostMenuPipelineState state;
	fillHost2DState(state, view);
	return state;
}

} // namespace bmsx
