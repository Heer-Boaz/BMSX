#pragma once

namespace bmsx {

class GameView;
class RenderPassLibrary;
class SoftwareBackend;
struct VdpRpuFrameOutput;

void renderVdpRpuSoftwareFrame(SoftwareBackend& backend, GameView& view, const VdpRpuFrameOutput& frame);
void registerVdpRpuPassSoftware(RenderPassLibrary& registry);

} // namespace bmsx
