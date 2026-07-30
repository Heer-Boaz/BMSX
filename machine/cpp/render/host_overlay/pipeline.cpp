#include "render/host_overlay/pipeline.h"

#include "render/video_presenter.h"

namespace bmsx {
void writeHostOverlayPassState(
	const RenderPassDef::RenderGraphPassContext& ctx,
	RenderPassStateStorage& stateStorage
) {
	HostOverlayPipelineState& state = stateStorage.hostOverlay;
	VideoPresenter& presenter = *ctx.presenter;
	state.time = ctx.time;
	state.delta = ctx.delta;
	const HostOverlayFrame frame = presenter.hostOverlayQueue.consumeOverlayFrame();
	state.width = frame.renderWidth;
	state.height = frame.renderHeight;
	state.overlayWidth = frame.logicalWidth;
	state.overlayHeight = frame.logicalHeight;
	state.commandKinds = frame.commandKinds;
	state.commandRefs = frame.commandRefs;
	state.commandCount = frame.commandCount;
}

void writeHostMenuPassState(
	const RenderPassDef::RenderGraphPassContext& ctx,
	RenderPassStateStorage& stateStorage
) {
	HostMenuPipelineState& state = stateStorage.hostMenu;
	VideoPresenter& presenter = *ctx.presenter;
	state.width = static_cast<i32>(presenter.offscreenCanvasSize.x);
	state.height = static_cast<i32>(presenter.offscreenCanvasSize.y);
	state.overlayWidth = static_cast<i32>(presenter.viewportSize.x);
	state.overlayHeight = static_cast<i32>(presenter.viewportSize.y);
	const HostMenuFrame frame = presenter.hostOverlayQueue.consumeHostMenuFrame();
	state.commandKinds = frame.commandKinds;
	state.commandRefs = frame.commandRefs;
	state.commandCount = frame.commandCount;
}

bool shouldExecuteHostOverlayPass(VideoPresenter* presenter, void*) {
	return presenter->hostOverlayQueue.hasPendingOverlayFrame();
}

bool shouldExecuteHostMenuPass(VideoPresenter* presenter, void*) {
	return presenter->hostOverlayQueue.hasPendingHostMenuFrame();
}

} // namespace bmsx
