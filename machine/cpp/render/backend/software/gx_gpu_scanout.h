#pragma once

namespace bmsx {

class SoftwareBackend;
struct GxGpuPipelineState;

void scanoutGxGpuSoftwareVram(SoftwareBackend& backend, const GxGpuPipelineState& state);

} // namespace bmsx
