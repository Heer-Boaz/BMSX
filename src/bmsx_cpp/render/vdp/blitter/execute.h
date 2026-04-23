#pragma once

#include "machine/devices/vdp/vdp.h"

namespace bmsx {

void drainReadyVdpExecution(VDP& vdp);
void executeVdpBlitterQueue(VDP& vdp, const std::vector<VDP::BlitterCommand>& queue);

} // namespace bmsx
