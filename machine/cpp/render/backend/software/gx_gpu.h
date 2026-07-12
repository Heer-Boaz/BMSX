#pragma once

namespace bmsx {

class RenderPassLibrary;
class SoftwareBackend;
struct GxGpuPipelineState;

void renderGxGpuSoftwareFrame(SoftwareBackend& backend, const GxGpuPipelineState& state);
void registerGxGpuPassSoftware(RenderPassLibrary& registry);

} // namespace bmsx
