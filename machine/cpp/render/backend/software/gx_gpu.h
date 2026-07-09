#pragma once

namespace bmsx {

class RenderPassLibrary;
class SoftwareBackend;
struct GxGpuPipelineState;

void renderGxGpuSoftwareFrame(const GxGpuPipelineState& state);
void registerGxGpuPassSoftware(RenderPassLibrary& registry, SoftwareBackend& backend);

} // namespace bmsx
