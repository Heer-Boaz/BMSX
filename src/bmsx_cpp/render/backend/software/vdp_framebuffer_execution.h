#pragma once

namespace bmsx {

class RenderPassLibrary;
class SoftwareBackend;
class VDP;

void registerVdpFrameBufferExecutionPass_Software(RenderPassLibrary& registry);
void drainReadyVdpFrameBufferExecutionForSoftware(SoftwareBackend& backend, VDP& vdp);

} // namespace bmsx
