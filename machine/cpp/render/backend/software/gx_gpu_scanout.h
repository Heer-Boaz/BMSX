#pragma once

#include "common/primitives.h"

namespace bmsx {

struct GxGpuPcrtcScanout;
struct GxGpuPipelineState;
struct GxGpuSoftwareState;

void scanoutGxGpuSoftwareVram(
	GxGpuSoftwareState& software,
	u32* pixels,
	i32 pixelsPerRow,
	const GxGpuPipelineState& state,
	const GxGpuPcrtcScanout& scanout,
	u64 vramReplacementSerial
);

} // namespace bmsx
