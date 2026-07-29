#pragma once

#include "common/primitives.h"

namespace bmsx {

class SoftwareBackend;
struct GxGpuPcrtcScanout;
struct GxGpuPipelineState;
struct GxGpuSoftwareState;

void scanoutGxGpuSoftwareVram(
	GxGpuSoftwareState& software,
	SoftwareBackend& backend,
	const GxGpuPipelineState& state,
	const GxGpuPcrtcScanout& scanout,
	u64 vramReplacementSerial
);

} // namespace bmsx
