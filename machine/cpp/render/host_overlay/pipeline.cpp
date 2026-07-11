#include "render/host_overlay/pipeline.h"

#include "core/machine_manager.h"
#include "render/gameview.h"
#include "render/host_overlay/overlay_queue.h"

namespace bmsx {
void writeHostOverlayState(HostOverlayPipelineState& state) {
	state.time = MachineManager::instance().totalTime();
	state.delta = MachineManager::instance().deltaTime();
	const HostOverlayFrame frame = consumeOverlayFrame();
	state.width = frame.renderWidth;
	state.height = frame.renderHeight;
	state.overlayWidth = frame.logicalWidth;
	state.overlayHeight = frame.logicalHeight;
	state.commandKinds = frame.commandKinds;
	state.commandRefs = frame.commandRefs;
	state.commandCount = frame.commandCount;
}

void writeHostMenuState(HostMenuPipelineState& state, GameView& view) {
	state.width = static_cast<i32>(view.offscreenCanvasSize.x);
	state.height = static_cast<i32>(view.offscreenCanvasSize.y);
	state.overlayWidth = static_cast<i32>(view.viewportSize.x);
	state.overlayHeight = static_cast<i32>(view.viewportSize.y);
	const HostMenuFrame frame = consumeHostMenuFrame();
	state.commandKinds = frame.commandKinds;
	state.commandRefs = frame.commandRefs;
	state.commandCount = frame.commandCount;
}

} // namespace bmsx
