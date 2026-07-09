#pragma once

namespace bmsx {

class SoftwareBackend;
struct GxGpuPipelineState;

void bindGxGpuSoftwareScanoutBackend(SoftwareBackend& backend);
void scanoutGxGpuSoftwareVram(const GxGpuPipelineState& state);

} // namespace bmsx
