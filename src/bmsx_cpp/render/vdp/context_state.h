#pragma once

namespace bmsx {

class VDP;

void restoreVdpContextState(VDP& vdp);
void captureVdpContextState(VDP& vdp);
void shutdownVdpContextState();

} // namespace bmsx
