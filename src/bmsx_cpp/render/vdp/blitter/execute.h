#pragma once

#include "machine/devices/vdp/vdp.h"

namespace bmsx {

void drainReadyVdpExecution(VDP& vdp, f64 timeSeconds);

} // namespace bmsx
