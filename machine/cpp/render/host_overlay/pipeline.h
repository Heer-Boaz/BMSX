#pragma once

#include "render/backend/pass/library.h"

namespace bmsx {

class GameView;

void writeHostOverlayState(HostOverlayPipelineState& state);
void writeHostMenuState(HostMenuPipelineState& state, GameView& view);

} // namespace bmsx
