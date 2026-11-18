#pragma once

#include "machine/devices/gx/gpu_pcrtc.h"

namespace bmsx {

// Scanout consumes only latched, owned display state. Command submission and
// readback completion belong to the ordered device/backend boundary, not a pass.
struct GxGpuPresentation {
	GxGpuPcrtcScanout pcrtcScanout;
	u64 vramReplacementSerial;
};

} // namespace bmsx
