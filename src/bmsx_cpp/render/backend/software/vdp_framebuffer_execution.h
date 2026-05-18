#pragma once

namespace bmsx {

class SoftwareBackend;
class VDP;

void drainReadyVdpFrameBufferExecutionForSoftware(SoftwareBackend& backend, VDP& vdp);

} // namespace bmsx
