#pragma once

#include "render/backend/pass/library.h"

namespace bmsx {

class VideoPresenter;

void writeHostOverlayState(HostOverlayPipelineState& state, f64 time, f64 delta);
void writeHostMenuState(HostMenuPipelineState& state, VideoPresenter& presenter);

} // namespace bmsx
