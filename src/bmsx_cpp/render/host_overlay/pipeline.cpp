#include "render/host_overlay/pipeline.h"

#include "render/gameview.h"

namespace bmsx {
namespace {

void fillHost2DState(Host2DPipelineState& state, GameView& view) {
	state.width = static_cast<i32>(view.offscreenCanvasSize.x);
	state.height = static_cast<i32>(view.offscreenCanvasSize.y);
	state.overlayWidth = static_cast<i32>(view.viewportSize.x);
	state.overlayHeight = static_cast<i32>(view.viewportSize.y);
}

} // namespace

HostOverlayPipelineState buildHostOverlayState(GameView& view) {
	HostOverlayPipelineState state;
	fillHost2DState(state, view);
	return state;
}

HostMenuPipelineState buildHostMenuState(GameView& view) {
	HostMenuPipelineState state;
	fillHost2DState(state, view);
	return state;
}

} // namespace bmsx
