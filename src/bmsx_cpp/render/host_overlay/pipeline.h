#pragma once

#include "core/primitives.h"
#include "render/shared/queues.h"
#include <cstddef>

namespace bmsx {

class GameView;
class RenderPassLibrary;

struct Host2DPipelineState {
	i32 width = 0;
	i32 height = 0;
	i32 overlayWidth = 0;
	i32 overlayHeight = 0;
	f64 time = 0.0;
	f64 delta = 0.0;
};

struct HostOverlayPipelineState : Host2DPipelineState {
};

using HostMenuPipelineState = Host2DPipelineState;

HostOverlayPipelineState buildHostOverlayState(GameView& view);
HostMenuPipelineState buildHostMenuState(GameView& view);

} // namespace bmsx
