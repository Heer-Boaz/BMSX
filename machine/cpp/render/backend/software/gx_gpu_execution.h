#pragma once

#include "common/primitives.h"
#include <cstddef>
#include <span>

namespace bmsx {

class GxGpu;
struct GxGpuSoftwareState;
struct GxGpuCommandStorage;
struct GxGpuDeviceOutput;
struct GxGpuReadbackRequest;

void replaceGxGpuSoftwareVramSnapshot(GxGpuSoftwareState& software, std::span<const u8> bytes, u64 serial);
void executeGxGpuSoftwareCommandPrefix(GxGpuSoftwareState& software, const GxGpuCommandStorage& commands, size_t limit);
void executeGxGpuSoftwareVramCommands(GxGpuSoftwareState& software, const GxGpuDeviceOutput& output, size_t limit);
void readGxGpuSoftwareVram(const GxGpuSoftwareState& software, const GxGpuReadbackRequest& request, u8* pixels);
void captureGxGpuSoftwareVramSnapshot(GxGpuSoftwareState& software, GxGpu& gxGpu);

} // namespace bmsx
