#pragma once

#include "render/backend/pass/library.h"

namespace bmsx {

class VideoPresenter;

void writeHostOverlayState(HostOverlayPipelineState& state);
void writeHostMenuState(HostMenuPipelineState& state, VideoPresenter& presenter);

} // namespace bmsx
